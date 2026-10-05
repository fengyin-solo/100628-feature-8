/**
 * 调速器统一判定域：唯一落库处。
 *
 * 设计约束（对应交接口径）：
 * - 所有写操作走 mutate()：先在草稿上改完、跑提交前对账校验，通过才一次性写盘；
 *   任一步失败整笔退回，localStorage 里不会出现中间态。
 * - 结论（等级/建议动作/状态）只存在 devices.current 这一份，待办、继电保护台账、对账台数全部由它派生。
 * - 历史结论以 records 追加保存：换版重算、校验复判都新增记录，旧记录保留当时等级与版本，不覆盖。
 * - 存量记录首次进入时从旧台账（seed 里的两张纸数据）按发生时间迁移落库，缺值进 missing 单列。
 */
import { SEED_ROWS } from '@/data/seed'
import type { EntryRow } from '@/data/types'
import {
  CURRENT_START_VERSION,
  type Grade,
  type JudgeOutcome,
  gradeToStatus,
  judgeOnce,
  thresholdOf,
} from './rules'

const STORAGE_KEY = 'hydropower-plant-om:governor-domain:v1'

export type ReadingValues = {
  pressureMPa: number | null
  openingPct: number | null
  openingLimitPct: number | null
  strokeMm: number | null
  strokeLimitMm: number | null
}

export type ReadingPath = '交接填报' | '现场实测'

export type EffectiveReading = {
  values: ReadingValues
  /** 每个字段取自哪一路；两路打架时现场实测覆盖交接填报，并在这里留痕。 */
  fieldSource: Record<keyof ReadingValues, ReadingPath | null>
}

export type CurrentConclusion = {
  grade: Grade
  action: string
  status: string
  version: string
  judgedAt: string
  pressureRatio: number | null
  openingRatio: number | null
  pressureReason: string
  openingReason: string
  pressureImputed: boolean
  manuallyDisabled: boolean
}

export type GovernorDevice = {
  id: number
  code: string
  unit: string
  ratedPressureMPa: number
  reported: ReadingValues
  measured: ReadingValues | null
  effective: EffectiveReading
  occurredAt: string
  current: CurrentConclusion
}

export type JudgmentRecord = {
  id: number
  deviceId: number
  deviceCode: string
  occurredAt: string
  judgedAt: string
  version: string
  grade: Grade
  action: string
  trigger: '存量迁移' | '校验复判' | '换版重算' | '人工停用'
  pressureReason: string
  openingReason: string
}

export type CalibrationSubmission = {
  id: number
  deviceId: number
  deviceCode: string
  shiftKey: string
  shiftLabel: string
  operator: string
  submittedAt: string
  reading: ReadingValues
  gradeAfter: Grade
}

export type MissingItem = {
  id: number
  deviceId: number
  deviceCode: string
  occurredAt: string
  fields: string[]
  resolved: boolean
  resolvedAt: string | null
  note: string
}

export type MigrationInfo = {
  migratedAt: string
  version: string
  legacyCount: number
  migratedCount: number
}

export type GovernorDomainState = {
  schema: 'governor-domain'
  schemaVersion: 1
  ruleVersion: string
  migrated: MigrationInfo | null
  devices: GovernorDevice[]
  records: JudgmentRecord[]
  calibrations: CalibrationSubmission[]
  missing: MissingItem[]
  seq: number
}

export type TodoItem = {
  deviceId: number
  code: string
  unit: string
  occurredAt: string
  grade: Grade
  action: string
  pressureReason: string
  openingReason: string
  version: string
}

export type AbnormalLedgerRow = {
  deviceId: number
  code: string
  unit: string
  grade: Grade
  status: string
  action: string
  version: string
  judgedAt: string
  pressureRatio: number | null
  openingRatio: number | null
  hitReason: string
}

export type ReconcileCheck = { name: string; left: number; right: number; ok: boolean }

export type ReconcileReport = {
  ruleVersion: string
  at: string
  total: number
  normal: number
  attention: number
  abnormal: number
  severe: number
  disabled: number
  todoCount: number
  ledgerAbnormalCount: number
  missingOpen: number
  matched: boolean
  checks: ReconcileCheck[]
}

function emptyReadings(): ReadingValues {
  return { pressureMPa: null, openingPct: null, openingLimitPct: null, strokeMm: null, strokeLimitMm: null }
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 把 "2.36MPa"、"78%"、"186 mm"、"—"、"调速器样例1" 这类纸面值解析成数字；解析不出按缺失处理。 */
export function parseNum(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const text = String(raw).trim()
  if (text === '' || text === '—' || text === '-' || text === '/') return null
  const matched = text.replace(',', '.').match(/-?\d+(\.\d+)?/)
  if (!matched) return null
  const value = Number(matched[0])
  return Number.isFinite(value) ? value : null
}

/** 两路取值仲裁：同字段两路都有且不一致时，以现场实测为准，全平台统一用这一份。 */
export function resolveEffective(reported: ReadingValues, measured: ReadingValues | null): EffectiveReading {
  const values = emptyReadings()
  const fieldSource = Object.keys(values).reduce(
    (acc, key) => {
      acc[key as keyof ReadingValues] = null
      return acc
    },
    {} as EffectiveReading['fieldSource'],
  )
  ;(Object.keys(values) as (keyof ReadingValues)[]).forEach((key) => {
    const reportedValue = reported[key]
    const measuredValue = measured ? measured[key] : null
    if (measuredValue !== null) {
      values[key] = measuredValue
      fieldSource[key] = '现场实测'
    } else {
      values[key] = reportedValue
      fieldSource[key] = reportedValue === null ? null : '交接填报'
    }
  })
  return { values, fieldSource }
}

function judgeDevice(device: { ratedPressureMPa: number; effective: EffectiveReading }, version: string): JudgeOutcome {
  const v = device.effective.values
  return judgeOnce(
    {
      pressure: v.pressureMPa,
      opening: v.openingPct,
      openingLimit: v.openingLimitPct,
      stroke: v.strokeMm,
      strokeLimit: v.strokeLimitMm,
      ratedPressureMPa: device.ratedPressureMPa,
    },
    version,
  )
}

const MISSING_FIELD_LABEL: Record<keyof ReadingValues, string> = {
  pressureMPa: '油压值',
  openingPct: '导叶开度',
  openingLimitPct: '开度限位',
  strokeMm: '接力器行程',
  strokeLimitMm: '行程上限',
}

type MigrationOutput = {
  state: GovernorDomainState
  missing: MissingItem[]
}

/** 存量迁移：旧台账记录按发生时间升序逐条落库，每条立刻按统一口径判定；缺值不拦迁移，单列待补。 */
function migrateLegacy(legacy: EntryRow[], at: string): MigrationOutput {
  const ordered = [...legacy].sort((a, b) => {
    const ta = String(a['记录时间'] ?? a['校验日期'] ?? '')
    const tb = String(b['记录时间'] ?? b['校验日期'] ?? '')
    return ta.localeCompare(tb)
  })

  const state: GovernorDomainState = {
    schema: 'governor-domain',
    schemaVersion: 1,
    ruleVersion: CURRENT_START_VERSION,
    migrated: null,
    devices: [],
    records: [],
    calibrations: [],
    missing: [],
    seq: 0,
  }

  for (const row of ordered) {
    const code = String(row['装置编号'] ?? '').trim()
    if (!code) {
      throw new Error('存量记录存在缺少装置编号的行，迁移整笔中止，旧记录保持原样')
    }
    state.seq += 1
    const id = state.seq
    const ratedPressure = parseNum(row['额定油压']) ?? 2.5
    const reported: ReadingValues = {
      pressureMPa: parseNum(row['油压值']),
      openingPct: parseNum(row['导叶开度']),
      openingLimitPct: parseNum(row['开度限位']),
      strokeMm: parseNum(row['接力器行程']),
      strokeLimitMm: parseNum(row['行程上限']),
    }
    const hasMeasured =
      row['实测油压值'] !== undefined || row['实测导叶开度'] !== undefined || row['实测接力器行程'] !== undefined
    const measured: ReadingValues | null = hasMeasured
      ? {
          pressureMPa: parseNum(row['实测油压值']),
          openingPct: parseNum(row['实测导叶开度']),
          openingLimitPct: reported.openingLimitPct,
          strokeMm: parseNum(row['实测接力器行程']),
          strokeLimitMm: reported.strokeLimitMm,
        }
      : null

    const missingFields = (Object.keys(reported) as (keyof ReadingValues)[]).filter((key) => {
      const inReported = reported[key] === null
      const inMeasured = measured ? measured[key] === null : true
      return inReported && inMeasured
    })
    if (missingFields.length > 0) {
      state.seq += 1
      state.missing.push({
        id: state.seq,
        deviceId: id,
        deviceCode: code,
        occurredAt: String(row['记录时间'] ?? row['校验日期'] ?? ''),
        fields: missingFields.map((key) => MISSING_FIELD_LABEL[key]),
        resolved: false,
        resolvedAt: null,
        note: '存量迁移时该字段两路都读不到值，按缺值单列；油压缺失按补判区间从严定为关注',
      })
    }

    const occurredAt = String(row['记录时间'] ?? row['校验日期'] ?? '')
    const device: GovernorDevice = {
      id,
      code,
      unit: String(row['所属机组'] ?? '—'),
      ratedPressureMPa: ratedPressure,
      reported,
      measured,
      effective: resolveEffective(reported, measured),
      occurredAt,
      current: {} as CurrentConclusion,
    }
    const outcome = judgeDevice(device, CURRENT_START_VERSION)
    device.current = {
      grade: outcome.grade,
      action: outcome.action,
      status: gradeToStatus(outcome.grade),
      version: CURRENT_START_VERSION,
      judgedAt: at,
      pressureRatio: outcome.pressure.ratio,
      openingRatio: outcome.opening.ratio,
      pressureReason: outcome.pressure.reason,
      openingReason: outcome.opening.reason,
      pressureImputed: outcome.pressure.imputed,
      manuallyDisabled: false,
    }
    state.devices.push(device)
    state.seq += 1
    state.records.push({
      id: state.seq,
      deviceId: id,
      deviceCode: code,
      occurredAt,
      judgedAt: at,
      version: CURRENT_START_VERSION,
      grade: outcome.grade,
      action: outcome.action,
      trigger: '存量迁移',
      pressureReason: outcome.pressure.reason,
      openingReason: outcome.opening.reason,
    })
  }

  state.migrated = {
    migratedAt: at,
    version: CURRENT_START_VERSION,
    legacyCount: legacy.length,
    migratedCount: state.devices.length,
  }
  return { state, missing: state.missing }
}

// ---- 持久化 ----

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): GovernorDomainState | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as GovernorDomainState
  } catch {
    return null
  }
}

function writeStorage(state: GovernorDomainState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

let cache: GovernorDomainState | null = null

export function getState(): GovernorDomainState {
  if (cache) return cache
  const existing = readStorage()
  if (existing) {
    cache = existing
    return cache
  }
  // 首次进入：旧台账（两张纸）按发生时间整批迁移；迁移抛错则一条都不落库。
  const migrated = migrateLegacy(SEED_ROWS['governor'] ?? [], nowText())
  writeStorage(migrated.state)
  cache = migrated.state
  return cache
}

/** 提交前对账：台数对不上就抛错，mutate 调用方整笔退回，调用处看到的还是旧数据。 */
function assertReconciled(state: GovernorDomainState): void {
  const reports = deriveReconcile(state)
  const failed = reports.checks.filter((check) => !check.ok)
  if (failed.length > 0 || !reports.matched) {
    throw new Error(`提交前对账失败（${failed.map((item) => item.name).join('、') || '台数不一致'}），本笔操作已整笔退回`)
  }
}

function mutate(mutator: (draft: GovernorDomainState) => void): GovernorDomainState {
  const previous = getState()
  const draft = clone(previous)
  try {
    mutator(draft)
    assertReconciled(draft)
    writeStorage(draft)
  } catch (error) {
    // 整笔退回：草稿丢弃、缓存与存储都保持上一版，落盘失败也不留内存中间态。
    cache = previous
    throw error
  }
  cache = draft
  return draft
}

function rejudgeDevice(device: GovernorDevice, state: GovernorDomainState, trigger: JudgmentRecord['trigger'], at: string): void {
  const outcome = judgeDevice(device, state.ruleVersion)
  device.current = {
    ...device.current,
    grade: outcome.grade,
    action: outcome.action,
    status: device.current.manuallyDisabled ? '已停用' : gradeToStatus(outcome.grade),
    version: state.ruleVersion,
    judgedAt: at,
    pressureRatio: outcome.pressure.ratio,
    openingRatio: outcome.opening.ratio,
    pressureReason: outcome.pressure.reason,
    openingReason: outcome.opening.reason,
    pressureImputed: outcome.pressure.imputed,
  }
  state.seq += 1
  state.records.push({
    id: state.seq,
    deviceId: device.id,
    deviceCode: device.code,
    occurredAt: device.occurredAt,
    judgedAt: at,
    version: state.ruleVersion,
    grade: outcome.grade,
    action: outcome.action,
    trigger,
    pressureReason: outcome.pressure.reason,
    openingReason: outcome.opening.reason,
  })
}

// ---- 派生读取：待办、继电保护台账、对账台数全部由同一份结论派生 ----

export function deriveTodos(state: GovernorDomainState): TodoItem[] {
  return state.devices
    .filter((device) => device.current.grade === '关注' && !device.current.manuallyDisabled)
    .map((device) => ({
      deviceId: device.id,
      code: device.code,
      unit: device.unit,
      occurredAt: device.occurredAt,
      grade: device.current.grade,
      action: device.current.action,
      pressureReason: device.current.pressureReason,
      openingReason: device.current.openingReason,
      version: device.current.version,
    }))
}

export function deriveAbnormalLedger(state: GovernorDomainState): AbnormalLedgerRow[] {
  return state.devices
    .filter((device) => device.current.grade === '异常' || device.current.grade === '严重')
    .map((device) => ({
      deviceId: device.id,
      code: device.code,
      unit: device.unit,
      grade: device.current.grade,
      status: device.current.status,
      action: device.current.action,
      version: device.current.version,
      judgedAt: device.current.judgedAt,
      pressureRatio: device.current.pressureRatio,
      openingRatio: device.current.openingRatio,
      hitReason: [device.current.pressureReason, device.current.openingReason].join('；'),
    }))
}

export function deriveReconcile(state: GovernorDomainState): ReconcileReport {
  const total = state.devices.length
  // 人工挂牌停用的装置移出待校验/待办（停用即不再安排校验），单列为停用档；
  // 异常/严重装置停用后仍留在继电保护异常台账，异常台数不丢。
  const active = state.devices.filter((d) => !d.current.manuallyDisabled)
  const disabled = total - active.length
  const normal = active.filter((d) => d.current.grade === '正常').length
  const attention = active.filter((d) => d.current.grade === '关注').length
  const abnormalOnly = active.filter((d) => d.current.grade === '异常').length
  const severeActive = active.filter((d) => d.current.grade === '严重').length
  const severe = state.devices.filter((d) => d.current.grade === '严重').length
  const abnormal = state.devices.filter((d) => d.current.grade === '异常' || d.current.grade === '严重').length
  const todoCount = deriveTodos(state).length
  const ledgerAbnormalCount = deriveAbnormalLedger(state).length
  const missingOpen = state.missing.filter((item) => !item.resolved).length
  const devicesWithOpenMissing = new Set(
    state.missing.filter((item) => !item.resolved).map((item) => item.deviceId),
  ).size

  const checks: ReconcileCheck[] = [
    { name: '调速器异常台数 = 继电保护运行台账镜像台数', left: abnormal, right: ledgerAbnormalCount, ok: abnormal === ledgerAbnormalCount },
    { name: '待校验装置台数 = 检修班组校验待办条数', left: attention, right: todoCount, ok: attention === todoCount },
    { name: '正常+待校验+异常+停用台数 = 调速器总台数', left: normal + attention + abnormalOnly + severeActive + disabled, right: total, ok: normal + attention + abnormalOnly + severeActive + disabled === total },
    { name: '缺值单列条数 = 仍带未补缺值的装置台数', left: missingOpen, right: devicesWithOpenMissing, ok: missingOpen === devicesWithOpenMissing },
  ]
  return {
    ruleVersion: state.ruleVersion,
    at: nowText(),
    total,
    normal,
    attention,
    abnormal,
    severe,
    disabled,
    todoCount,
    ledgerAbnormalCount,
    missingOpen,
    matched: checks.every((check) => check.ok),
    checks,
  }
}

// ---- 对外只读接口 ----

export function listDevices(): GovernorDevice[] {
  return getState().devices
}

export function getDevice(id: number): GovernorDevice | null {
  return getState().devices.find((device) => device.id === id) ?? null
}

export function listTodos(): TodoItem[] {
  return deriveTodos(getState())
}

export function listAbnormalLedger(): AbnormalLedgerRow[] {
  return deriveAbnormalLedger(getState())
}

export function listMissing(): MissingItem[] {
  return getState().missing
}

export function listHistory(deviceId: number): JudgmentRecord[] {
  return getState()
    .records.filter((record) => record.deviceId === deviceId)
    .sort((a, b) => b.id - a.id)
}

export function listCalibrations(): CalibrationSubmission[] {
  return [...getState().calibrations].sort((a, b) => b.id - a.id)
}

export function reconcile(): ReconcileReport {
  return deriveReconcile(getState())
}

export function migrationInfo(): MigrationInfo | null {
  return getState().migrated
}

// ---- 对外写接口（全部事务化） ----

export type SubmitResult = { ok: boolean; message: string }

/**
 * 校验提交：
 * - 同一台调速器同一班次只认第一次，后到的按重复整笔退回（不留中间态、不增结论）；
 * - 必须带现场实测三量（油压/开度/行程）及对应限值，缺一整笔退回；
 * - 提交后按当前口径用实测值重判，油压异常等级随实测结果回落，待办与台账自动派生。
 */
export function submitCalibration(input: {
  deviceId: number
  shiftKey: string
  shiftLabel: string
  operator: string
  reading: ReadingValues
}): SubmitResult {
  const state = getState()
  const device = state.devices.find((item) => item.id === input.deviceId)
  if (!device) {
    return { ok: false, message: `没有找到编号为 ${input.deviceId} 的调速器` }
  }
  const duplicate = state.calibrations.some(
    (item) => item.deviceId === input.deviceId && item.shiftKey === input.shiftKey,
  )
  if (duplicate) {
    return { ok: false, message: `${device.code} 在 ${input.shiftLabel} 已提交过校验，同一班次只认第一次，本次按重复退回` }
  }
  const r = input.reading
  const valid =
    r.pressureMPa !== null && r.pressureMPa > 0 &&
    r.openingPct !== null && r.openingPct >= 0 &&
    r.openingLimitPct !== null && r.openingLimitPct > 0 &&
    r.strokeMm !== null && r.strokeMm >= 0 &&
    r.strokeLimitMm !== null && r.strokeLimitMm > 0
  if (!valid) {
    return { ok: false, message: `${device.code} 校验必须填报齐全现场实测油压、导叶开度/开度限位、接力器行程/行程上限，本笔整笔退回` }
  }

  try {
    mutate((draft) => {
      const target = draft.devices.find((item) => item.id === input.deviceId)
      if (!target) throw new Error('调速器在提交过程中被重置，请重试')
      const at = nowText()
      target.measured = { ...r }
      target.effective = resolveEffective(target.reported, target.measured)
      rejudgeDevice(target, draft, '校验复判', at)
      draft.seq += 1
      draft.calibrations.push({
        id: draft.seq,
        deviceId: target.id,
        deviceCode: target.code,
        shiftKey: input.shiftKey,
        shiftLabel: input.shiftLabel,
        operator: input.operator,
        submittedAt: at,
        reading: { ...r },
        gradeAfter: target.current.grade,
      })
      // 实测值补齐后，对应缺值记录关闭（仍在缺值清单里列示，注明已补测）。
      draft.missing.forEach((item) => {
        if (item.deviceId === target.id && !item.resolved) {
          item.resolved = true
          item.resolvedAt = at
        }
      })
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '校验提交失败，已整笔退回' }
  }
  const refreshed = getDevice(input.deviceId)
  return {
    ok: true,
    message: `${device.code} 校验已受理，已按现场实测值复判为「${refreshed?.current.grade ?? '—'}」（${state.ruleVersion} 口径）`,
  }
}

/** 阈值换版：按新口径把所有已判定装置重算一遍；旧记录保留当时等级并注明版本，不覆盖。 */
export function switchRuleVersion(version: string): SubmitResult {
  const spec = thresholdOf(version)
  const state = getState()
  if (state.ruleVersion === version) {
    return { ok: false, message: `当前已经是 ${version} 口径，无需重算` }
  }
  try {
    mutate((draft) => {
      draft.ruleVersion = spec.version
      const at = nowText()
      draft.devices.forEach((device) => rejudgeDevice(device, draft, '换版重算', at))
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '换版重算失败，已整笔退回' }
  }
  return { ok: true, message: `阈值口径已切换为 ${version}（${spec.note}），存量装置已全部按新口径重算，旧结论保留等级与版本` }
}

export function disableDevice(deviceId: number): SubmitResult {
  const device = getDevice(deviceId)
  if (!device) {
    return { ok: false, message: `没有找到编号为 ${deviceId} 的调速器` }
  }
  if (device.current.manuallyDisabled) {
    return { ok: false, message: `${device.code} 已是停用状态` }
  }
  try {
    mutate((draft) => {
      const target = draft.devices.find((item) => item.id === deviceId)
      if (!target) throw new Error('调速器在操作过程中被重置，请重试')
      target.current.manuallyDisabled = true
      target.current.status = '已停用'
      const at = nowText()
      draft.seq += 1
      draft.records.push({
        id: draft.seq,
        deviceId: target.id,
        deviceCode: target.code,
        occurredAt: target.occurredAt,
        judgedAt: at,
        version: draft.ruleVersion,
        grade: target.current.grade,
        action: '人工挂牌停用',
        trigger: '人工停用',
        pressureReason: target.current.pressureReason,
        openingReason: target.current.openingReason,
      })
    })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '停用失败，已整笔退回' }
  }
  return { ok: true, message: `${device.code} 已挂牌停用，异常台账仍保留其异常台数` }
}

/** 清掉本域数据并按当前 seed 重新迁移（演示用：回到两张纸刚并轨时的状态）。 */
export function resetDomain(): void {
  const migrated = migrateLegacy(SEED_ROWS['governor'] ?? [], nowText())
  writeStorage(migrated.state)
  cache = migrated.state
}

export function domainStorageKey(): string {
  return STORAGE_KEY
}
