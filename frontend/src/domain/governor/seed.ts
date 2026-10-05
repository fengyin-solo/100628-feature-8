/** 调速器判定领域的种子数据：模拟「两张纸 + 监控远传」的存量记录，按发生时间迁移重放。 */
import type { Grade } from './rules'

export type ShiftCode = '白班' | '夜班'

export type GovernorDevice = {
  id: string
  unit: string
  ratedPressure: number
  status: '在运' | '已停用'
}

export type ObservationInput = {
  time: string
  pressureLocal: number | null
  pressureRemote: number | null
  strokeTau: number | null
  vaneTau: number | null
  fullLoadCommand: boolean
}

export type Conclusion = ObservationInput & {
  deviceId: string
  grade: Grade
  pressureGrade: Grade
  positionGrade: Grade
  ratio: number | null
  tau: number | null
  action: string
  reasons: string[]
  version: string
  missing: boolean
  conflict: boolean
  judgedAt: string
}

export type HistoryRecord = Conclusion & { seq: number; migrated?: boolean }

export type TodoKind = '待校验' | '通道校验'

export type Todo = {
  id: string
  deviceId: string
  kind: TodoKind
  open: boolean
  grade: Grade
  reason: string
  createdAt: string
  closedAt: string | null
}

export type VerifySubmission = {
  id: number
  deviceId: string
  shiftDate: string
  shift: ShiftCode
  submittedAt: string
  operator: string
  accepted: boolean
  rejectReason: string | null
  pressureLocal: number | null
  strokeTau: number | null
  gradeBefore: Grade | null
  gradeAfter: Grade | null
}

export type MissingField = '油压实测' | '行程实测'

export type MissingItem = {
  id: string
  deviceId: string
  field: MissingField
  openedAt: string
  resolved: boolean
  resolvedAt: string | null
}

export type LedgerEvent = {
  id: string
  deviceId: string
  open: boolean
  grade: Grade
  action: string
  version: string
  openedAt: string
  closedAt: string | null
}

export type GovernorState = {
  activeVersion: string
  devices: GovernorDevice[]
  current: Record<string, Conclusion>
  history: HistoryRecord[]
  todos: Todo[]
  submissions: VerifySubmission[]
  missing: MissingItem[]
  ledger: LedgerEvent[]
  seq: number
}

export const SEED_DEVICES: GovernorDevice[] = [
  { id: 'GOVE-0001', unit: '1号机', ratedPressure: 2.5, status: '在运' },
  { id: 'GOVE-0002', unit: '2号机', ratedPressure: 2.5, status: '在运' },
  { id: 'GOVE-0003', unit: '3号机', ratedPressure: 4.0, status: '在运' },
  { id: 'GOVE-0004', unit: '4号机', ratedPressure: 2.5, status: '在运' },
  { id: 'GOVE-0005', unit: '5号机', ratedPressure: 4.0, status: '在运' },
  { id: 'GOVE-0006', unit: '6号机', ratedPressure: 2.5, status: '在运' },
  { id: 'GOVE-0007', unit: '7号机', ratedPressure: 4.0, status: '在运' },
  { id: 'GOVE-0008', unit: '8号机', ratedPressure: 2.5, status: '在运' },
]

/** 存量观测记录（含两纸条冲突、缺值、顶限位、满发等情形），按发生时间迁移 */
export const SEED_OBSERVATIONS: Array<ObservationInput & { deviceId: string; migrated?: boolean }> = [
  // 1号机：正常，但实测 2.70 与远传 2.40 偏差 11%，走通道校验
  {
    deviceId: 'GOVE-0001', time: '2026-10-04 09:20',
    pressureLocal: 2.7, pressureRemote: 2.4, strokeTau: 80, vaneTau: 80,
    fullLoadCommand: false, migrated: true,
  },
  // 2号机：P/Pn=0.78，L3 待校验
  {
    deviceId: 'GOVE-0002', time: '2026-10-04 09:40',
    pressureLocal: 1.95, pressureRemote: 1.96, strokeTau: 70, vaneTau: 70,
    fullLoadCommand: false, migrated: true,
  },
  // 3号机：10-03 先判 L3（0.75Pn）
  {
    deviceId: 'GOVE-0003', time: '2026-10-03 15:10',
    pressureLocal: 3.0, pressureRemote: 3.02, strokeTau: 65, vaneTau: 65,
    fullLoadCommand: false, migrated: true,
  },
  // 4号机：满发顶限位，判正常
  {
    deviceId: 'GOVE-0004', time: '2026-10-04 10:05',
    pressureLocal: 2.6, pressureRemote: 2.59, strokeTau: 100, vaneTau: 100,
    fullLoadCommand: true, migrated: true,
  },
  // 5号机：非满发顶限位，L3
  {
    deviceId: 'GOVE-0005', time: '2026-10-04 10:20',
    pressureLocal: 3.52, pressureRemote: 3.5, strokeTau: 100, vaneTau: 99.5,
    fullLoadCommand: false, migrated: true,
  },
  // 6号机：油压实测缺失、仅有远传 -> 缺值 L2
  {
    deviceId: 'GOVE-0006', time: '2026-10-04 10:40',
    pressureLocal: null, pressureRemote: 2.35, strokeTau: 60, vaneTau: 60,
    fullLoadCommand: false, migrated: true,
  },
  // 7号机：油压、行程全缺 -> 缺值 L2，缺值清单两条
  {
    deviceId: 'GOVE-0007', time: '2026-10-04 11:00',
    pressureLocal: null, pressureRemote: null, strokeTau: null, vaneTau: null,
    fullLoadCommand: false, migrated: true,
  },
  // 8号机：P/Pn=0.68 且非满发顶限位，油压 L4 + 位置 L3 -> L4
  {
    deviceId: 'GOVE-0008', time: '2026-10-04 11:20',
    pressureLocal: 1.7, pressureRemote: 1.72, strokeTau: 100, vaneTau: 100,
    fullLoadCommand: false, migrated: true,
  },
]

/** 存量校验提交：3号机 10-04 白班第一次校验，复测 3.24（0.81Pn）-> v1 回落 L2，待办关闭 */
export const SEED_SUBMISSIONS: Array<{
  deviceId: string
  submittedAt: string
  operator: string
  pressureLocal: number
  strokeTau: number
  fullLoadCommand: boolean
  pressureRemote: number
  vaneTau: number
}> = [
  {
    deviceId: 'GOVE-0003',
    submittedAt: '2026-10-04 11:30',
    operator: '检修-王工',
    pressureLocal: 3.24,
    pressureRemote: 3.22,
    strokeTau: 65,
    vaneTau: 65,
    fullLoadCommand: false,
  },
]
