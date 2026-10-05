/**
 * 调速器判定领域存储。
 * 所有写操作走 commit()：先在内存副本上改完，再跑不变式校验，全部通过才一次性落 localStorage；
 * 任一步抛错恢复快照，中间态不落库（docs/governor-rules.md 第 10 节）。
 */
import {
  CURRENT_VERSION,
  GRADE_LABEL,
  judgeGovernor,
} from './rules'
import type { Grade } from './rules'
import {
  SEED_DEVICES,
  SEED_OBSERVATIONS,
  SEED_SUBMISSIONS,
} from './seed'
import type {
  Conclusion,
  GovernorDevice,
  GovernorState,
  HistoryRecord,
  LedgerEvent,
  MissingField,
  MissingItem,
  ShiftCode,
  Todo,
  VerifySubmission,
} from './seed'

const STORAGE_KEY = 'hydropower-plant-om:governor-domain:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export type ActionOK = { ok: true; message: string }
export type ActionFail = { ok: false; message: string }
export type ActionResult = ActionOK | ActionFail

/* ---------------- 班次（唯一性键的一半） ---------------- */

/** 班次划分：08:00-20:00 白班，其余夜班；跨零点归当日日期 */
export function shiftOf(dateTime: string): { shiftDate: string; shift: ShiftCode } {
  const shiftDate = dateTime.slice(0, 10)
  const hour = Number(dateTime.slice(11, 13) || '0')
  return { shiftDate, shift: hour >= 8 && hour < 20 ? '白班' : '夜班' }
}

/* ---------------- 初始迁移（按发生时间重放，缺值单列） ---------------- */

function buildInitial(): GovernorState {
  const state: GovernorState = {
    activeVersion: CURRENT_VERSION,
    devices: clone(SEED_DEVICES),
    current: {},
    history: [],
    todos: [],
    submissions: [],
    missing: [],
    ledger: [],
    seq: 0,
  }
  // 存量记录按发生时间升序迁移
  const observations = [...SEED_OBSERVATIONS].sort((a, b) => a.time.localeCompare(b.time))
  for (const obs of observations) {
    applyConclusion(state, obs.deviceId, obs.time, {
      pressureLocal: obs.pressureLocal,
      pressureRemote: obs.pressureRemote,
      strokeTau: obs.strokeTau,
      vaneTau: obs.vaneTau,
      fullLoadCommand: obs.fullLoadCommand,
    }, true)
  }
  // 存量校验提交按时间迁移（重放，含重复键但本批每装置每班只有一条）
  for (const sub of [...SEED_SUBMISSIONS].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    submitVerificationInternal(state, {
      deviceId: sub.deviceId,
      submittedAt: sub.submittedAt,
      operator: sub.operator,
      pressureLocal: sub.pressureLocal,
      strokeTau: sub.strokeTau,
      fullLoadCommand: sub.fullLoadCommand,
      pressureRemote: sub.pressureRemote,
      vaneTau: sub.vaneTau,
    })
  }
  return state
}

/* ---------------- 结论落地（判定 -> 待办/缺值/台账镜像 同一笔联动） ---------------- */

type JudgePayload = {
  pressureLocal: number | null
  pressureRemote: number | null
  strokeTau: number | null
  vaneTau: number | null
  fullLoadCommand: boolean
}

function requireDevice(state: GovernorState, deviceId: string): GovernorDevice {
  const device = state.devices.find((item) => item.id === deviceId)
  if (!device) {
    throw new Error(`没有找到装置 ${deviceId}`)
  }
  return device
}

function judgeFor(state: GovernorState, device: GovernorDevice, time: string, payload: JudgePayload): Conclusion {
  const result = judgeGovernor({
    rated: device.ratedPressure,
    pressureLocal: payload.pressureLocal,
    pressureRemote: payload.pressureRemote,
    strokeTau: payload.strokeTau,
    vaneTau: payload.vaneTau,
    fullLoadCommand: payload.fullLoadCommand,
    version: state.activeVersion,
  })
  return {
    deviceId: device.id,
    time,
    ...payload,
    grade: result.grade,
    pressureGrade: result.pressureGrade,
    positionGrade: result.positionGrade,
    ratio: result.ratio,
    tau: result.tau,
    action: result.action,
    reasons: result.reasons,
    version: result.version,
    missing: result.missing,
    conflict: result.conflict,
    judgedAt: time,
  }
}

function syncMissing(state: GovernorState, conclusion: Conclusion, time: string): void {
  const fields: Array<{ key: MissingField; gone: boolean }> = [
    { key: '油压实测', gone: conclusion.pressureLocal !== null },
    { key: '行程实测', gone: conclusion.strokeTau !== null },
  ]
  for (const field of fields) {
    const open = state.missing.find(
      (item) => item.deviceId === conclusion.deviceId && item.field === field.key && !item.resolved,
    )
    if (!field.gone && !open) {
      state.missing.push({
        id: `MISS-${state.seq + 1}`,
        deviceId: conclusion.deviceId,
        field: field.key,
        openedAt: time,
        resolved: false,
        resolvedAt: null,
      })
      state.seq += 1
    }
    if (field.gone && open) {
      open.resolved = true
      open.resolvedAt = time
    }
  }
}

function syncTodosAndLedger(state: GovernorState, conclusion: Conclusion, time: string): void {
  const deviceId = conclusion.deviceId
  const severe = conclusion.grade >= 3

  // L3/L4 待校验待办：一台装置一条未关闭
  const verifyTodo = state.todos.find(
    (item) => item.deviceId === deviceId && item.kind === '待校验' && item.open,
  )
  if (severe && !verifyTodo) {
    state.todos.push({
      id: `TODO-${state.seq + 1}`,
      deviceId,
      kind: '待校验',
      open: true,
      grade: conclusion.grade,
      reason: conclusion.action,
      createdAt: time,
      closedAt: null,
    })
    state.seq += 1
  } else if (verifyTodo) {
    verifyTodo.grade = conclusion.grade
    verifyTodo.reason = conclusion.action
    if (!severe) {
      verifyTodo.open = false
      verifyTodo.closedAt = time
    }
  }

  // 两路径冲突 -> L2 通道校验待办（不计异常台数）
  const channelTodo = state.todos.find(
    (item) => item.deviceId === deviceId && item.kind === '通道校验' && item.open,
  )
  if (conclusion.conflict && !channelTodo) {
    state.todos.push({
      id: `TODO-${state.seq + 1}`,
      deviceId,
      kind: '通道校验',
      open: true,
      grade: 2,
      reason: '实测与远传偏差>5%，以实测为准，校验变送器/反馈通道',
      createdAt: time,
      closedAt: null,
    })
    state.seq += 1
  } else if (channelTodo && !conclusion.conflict) {
    channelTodo.open = false
    channelTodo.closedAt = time
  }

  // 继电保护运行台账镜像：与异常待办同生同灭
  const ledger = state.ledger.find((item) => item.deviceId === deviceId && item.open)
  if (severe && !ledger) {
    state.ledger.push({
      id: `LEDG-${state.seq + 1}`,
      deviceId,
      open: true,
      grade: conclusion.grade,
      action: conclusion.action,
      version: conclusion.version,
      openedAt: time,
      closedAt: null,
    })
    state.seq += 1
  } else if (ledger) {
    ledger.grade = conclusion.grade
    ledger.action = conclusion.action
    ledger.version = conclusion.version
    if (!severe) {
      ledger.open = false
      ledger.closedAt = time
    }
  }
}

function applyConclusion(
  state: GovernorState,
  deviceId: string,
  time: string,
  payload: JudgePayload,
  migrated = false,
): Conclusion {
  const device = requireDevice(state, deviceId)
  if (device.status === '已停用') {
    throw new Error(`${deviceId} 已停用，不参与判定`)
  }
  const conclusion = judgeFor(state, device, time, payload)
  state.current[deviceId] = conclusion
  const record: HistoryRecord = { ...clone(conclusion), seq: state.seq + 1, migrated }
  state.seq += 1
  state.history.push(record)
  syncMissing(state, conclusion, time)
  syncTodosAndLedger(state, conclusion, time)
  return conclusion
}

/* ---------------- 校验提交（同班只认第一次；复测重判、等级回落） ---------------- */

type SubmitPayload = JudgePayload & {
  submittedAt: string
  operator: string
}

function submitVerificationInternal(
  state: GovernorState,
  payload: SubmitPayload & { deviceId: string },
): ActionResult {
  const device = requireDevice(state, payload.deviceId)
  if (device.status === '已停用') {
    return { ok: false, message: `${payload.deviceId} 已停用，不再受理校验` }
  }
  const { shiftDate, shift } = shiftOf(payload.submittedAt)
  const duplicate = state.submissions.find(
    (item) =>
      item.deviceId === payload.deviceId &&
      item.shiftDate === shiftDate &&
      item.shift === shift &&
      item.accepted,
  )
  const gradeBefore = state.current[payload.deviceId]?.grade ?? null
  if (duplicate) {
    // 后到的按重复退回：不产生结论、不动待办
    state.submissions.push({
      id: state.submissions.length + 1,
      deviceId: payload.deviceId,
      shiftDate,
      shift,
      submittedAt: payload.submittedAt,
      operator: payload.operator,
      accepted: false,
      rejectReason: `同班次（${shiftDate} ${shift}）已受理第一次校验提交，按重复退回`,
      pressureLocal: payload.pressureLocal,
      strokeTau: payload.strokeTau,
      gradeBefore,
      gradeAfter: null,
    })
    return {
      ok: false,
      message: `${payload.deviceId} ${shiftDate} ${shift} 已有第一次校验提交，本次按重复退回`,
    }
  }

  // 校验必须带复测实测值：禁止无实测「一键正常」
  if (payload.pressureLocal === null && payload.strokeTau === null) {
    return { ok: false, message: '校验必须带现场复测实测值（油压表读数或接力器行程）' }
  }

  const conclusion = applyConclusion(state, payload.deviceId, payload.submittedAt, {
    pressureLocal: payload.pressureLocal,
    pressureRemote: payload.pressureRemote,
    strokeTau: payload.strokeTau,
    vaneTau: payload.vaneTau,
    fullLoadCommand: payload.fullLoadCommand,
  })
  state.submissions.push({
    id: state.submissions.length + 1,
    deviceId: payload.deviceId,
    shiftDate,
    shift,
    submittedAt: payload.submittedAt,
    operator: payload.operator,
    accepted: true,
    rejectReason: null,
    pressureLocal: payload.pressureLocal,
    strokeTau: payload.strokeTau,
    gradeBefore,
    gradeAfter: conclusion.grade,
  })
  const trend =
    gradeBefore !== null && conclusion.grade < gradeBefore
      ? `，等级由 ${GRADE_LABEL[gradeBefore]} 回落为 ${GRADE_LABEL[conclusion.grade]}`
      : gradeBefore !== null && conclusion.grade > gradeBefore
        ? `，等级由 ${GRADE_LABEL[gradeBefore]} 升为 ${GRADE_LABEL[conclusion.grade]}`
        : ''
  return {
    ok: true,
    message: `${payload.deviceId} 校验已受理${trend}，建议动作：${conclusion.action}`,
  }
}

/* ---------------- 停用：关待办、撤台账，历史保留，不再计数 ---------------- */

function disableDeviceInternal(state: GovernorState, deviceId: string, time: string): ActionResult {
  const device = requireDevice(state, deviceId)
  if (device.status === '已停用') {
    return { ok: false, message: `${deviceId} 已是停用状态` }
  }
  device.status = '已停用'
  // 停用装置退出判定与计数：移除当前结论（历史记录保留），关闭全部未关闭联动
  delete state.current[deviceId]
  for (const todo of state.todos) {
    if (todo.deviceId === deviceId && todo.open) {
      todo.open = false
      todo.closedAt = time
    }
  }
  for (const item of state.missing) {
    if (item.deviceId === deviceId && !item.resolved) {
      item.resolved = true
      item.resolvedAt = time
    }
  }
  for (const ledger of state.ledger) {
    if (ledger.deviceId === deviceId && ledger.open) {
      ledger.open = false
      ledger.closedAt = time
    }
  }
  return { ok: true, message: `${deviceId} 已停用，待办与台账镜像同步关闭，历史结论保留` }
}

/* ---------------- 换版重算：在运装置按新口径重判，历史结论保留当时版本 ---------------- */

function activateVersionInternal(state: GovernorState, version: string): ActionResult {
  if (version === state.activeVersion) {
    return { ok: false, message: `当前生效版本已是 ${version}` }
  }
  // 版本不存在会抛错，由 commit 捕获整笔回滚
  state.activeVersion = version
  const time = new Date().toISOString().slice(0, 16).replace('T', ' ')
  for (const device of state.devices) {
    if (device.status !== '在运') continue
    const latest = state.current[device.id]
    if (!latest) continue
    applyConclusion(state, device.id, time, {
      pressureLocal: latest.pressureLocal,
      pressureRemote: latest.pressureRemote,
      strokeTau: latest.strokeTau,
      vaneTau: latest.vaneTau,
      fullLoadCommand: latest.fullLoadCommand,
    })
  }
  return { ok: true, message: `已切换到 ${version} 并按新口径重算全部在运装置，历史结论保留原版本` }
}

/* ---------------- 不变式（提交前对账，不符整笔退回） ---------------- */

export type Reconcile = {
  abnormalCount: number
  openVerifyTodos: number
  ledgerCount: number
  openChannelTodos: number
  missingOpen: number
  historyCount: number
  consistent: boolean
  detailAbnormal: string[]
}

function computeReconcile(state: GovernorState): Reconcile {
  const inService = state.devices.filter((device) => device.status === '在运')
  const detailAbnormal = inService
    .filter((device) => (state.current[device.id]?.grade ?? 1) >= 3)
    .map((device) => device.id)
  const abnormalCount = detailAbnormal.length
  const openVerifyTodos = state.todos.filter(
    (todo) => todo.open && todo.kind === '待校验',
  ).length
  const ledgerCount = state.ledger.filter((item) => item.open).length
  const openChannelTodos = state.todos.filter(
    (todo) => todo.open && todo.kind === '通道校验',
  ).length
  const missingOpen = state.missing.filter((item) => !item.resolved).length

  const consistent =
    abnormalCount === openVerifyTodos &&
    abnormalCount === ledgerCount

  return {
    abnormalCount,
    openVerifyTodos,
    ledgerCount,
    openChannelTodos,
    missingOpen,
    historyCount: state.history.length,
    consistent,
    detailAbnormal,
  }
}

function assertInvariants(state: GovernorState): void {
  const r = computeReconcile(state)
  // 每台在运装置当前结论恰一条（current 只保留在运键）
  for (const device of state.devices) {
    if (device.status === '在运' && !state.current[device.id]) {
      throw new Error(`不变式失败：${device.id} 在运但缺少当前结论`)
    }
    if (device.status === '已停用' && state.current[device.id]) {
      throw new Error(`不变式失败：${device.id} 已停用但仍挂当前结论`)
    }
  }
  if (!r.consistent) {
    throw new Error(
      `对账失败：异常 ${r.abnormalCount} / 待办 ${r.openVerifyTodos} / 台账 ${r.ledgerCount} 三处不一致，整笔退回`,
    )
  }
}

/* ---------------- 持久化与对外动作 ---------------- */

let cache: GovernorState | null = null

function load(): GovernorState {
  if (cache) return cache
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        cache = JSON.parse(raw) as GovernorState
        return cache
      } catch {
        // 落库损坏时回退到迁移种子
      }
    }
  }
  cache = buildInitial()
  persist(cache)
  return cache
}

function persist(state: GovernorState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

/** 整笔事务：改副本 -> 校验不变式 -> 一次落库；失败恢复快照 */
function commit(mutate: (draft: GovernorState) => ActionResult | void): ActionResult {
  const snapshot = clone(load())
  const draft = clone(snapshot)
  try {
    const result = mutate(draft)
    assertInvariants(draft)
    cache = draft
    persist(draft)
    return result ?? { ok: true, message: '操作已提交' }
  } catch (error) {
    cache = snapshot
    persist(snapshot)
    return {
      ok: false,
      message: error instanceof Error ? `事务已整笔退回：${error.message}` : '事务已整笔退回',
    }
  }
}

export function getState(): GovernorState {
  return load()
}

export function reconcile(): Reconcile {
  return computeReconcile(load())
}

export function recordObservation(
  deviceId: string,
  time: string,
  payload: JudgePayload,
): ActionResult {
  return commit((draft) => {
    const conclusion = applyConclusion(draft, deviceId, time, payload)
    return {
      ok: true,
      message: `${deviceId} 判定完成：${GRADE_LABEL[conclusion.grade]}｜${conclusion.action}`,
    }
  })
}

export function submitVerification(
  deviceId: string,
  submittedAt: string,
  operator: string,
  payload: JudgePayload,
): ActionResult {
  return commit((draft) =>
    submitVerificationInternal(draft, { deviceId, submittedAt, operator, ...payload }),
  )
}

export function disableDevice(deviceId: string, time: string): ActionResult {
  return commit((draft) => disableDeviceInternal(draft, deviceId, time))
}

export function activateVersion(version: string): ActionResult {
  return commit((draft) => activateVersionInternal(draft, version))
}

export function resetDomain(): GovernorState {
  cache = buildInitial()
  persist(cache)
  return cache
}

/* ---------------- 导出（对账口径与明细清单一起导出） ---------------- */

export function exportReconcileCsv(): { filename: string; content: string } {
  const state = load()
  const r = computeReconcile(state)
  const lines: string[] = []
  lines.push('调速器异常对账（口径与明细同源）')
  lines.push(
    `生效口径版本,${state.activeVersion},异常装置台数(L3/L4),${r.abnormalCount},检修待办,${r.openVerifyTodos},保护台账,${r.ledgerCount},通道校验待办,${r.openChannelTodos},缺值未补,${r.missingOpen}`,
  )
  lines.push('')
  lines.push('装置编号,所属机组,额定Pn(MPa),等级,油压等级,位置等级,判定时间,口径版本,缺值,路径冲突,建议动作')
  for (const device of state.devices) {
    const c = state.current[device.id]
    if (!c) continue
    lines.push(
      [
        device.id,
        device.unit,
        device.ratedPressure,
        GRADE_LABEL[c.grade],
        GRADE_LABEL[c.pressureGrade],
        GRADE_LABEL[c.positionGrade],
        c.judgedAt,
        c.version,
        c.missing ? '是' : '否',
        c.conflict ? '是' : '否',
        c.action,
      ].join(','),
    )
  }
  lines.push('')
  lines.push('缺值清单（单列，不计异常台数）')
  lines.push('缺值编号,装置编号,缺项,发现时间,状态')
  for (const item of state.missing) {
    lines.push(
      [item.id, item.deviceId, item.field, item.openedAt, item.resolved ? `已补 ${item.resolvedAt ?? ''}` : '待补测'].join(','),
    )
  }
  return { filename: '调速器异常对账明细.csv', content: `﻿${lines.join('\n')}` }
}

export type {
  Conclusion,
  GovernorState,
  HistoryRecord,
  LedgerEvent,
  MissingItem,
  Todo,
  VerifySubmission,
}
