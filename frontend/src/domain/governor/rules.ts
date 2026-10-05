/**
 * 调速器油压 / 导叶开度判定规则。
 * 阈值与 docs/governor-rules.md 同源：改阈值必须同时改文档第 2、3、8 节。
 * 等级 L1 正常 < L2 关注 < L3 待校验 < L4 危急，数值越大越严重。
 */

export type Grade = 1 | 2 | 3 | 4

export const GRADE_LABEL: Record<Grade, string> = {
  1: 'L1 正常',
  2: 'L2 关注',
  3: 'L3 待校验',
  4: 'L4 危急',
}

export type ThresholdVersion = {
  version: string
  effectiveAt: string
  note: string
  /** 油压分档边界（P/Pn），边界点就低不就高：等于边界归入较低档 */
  pressure: {
    l1Min: number
    l1Max: number
    l2Min: number
    l2Max: number
    l3Min: number
    l3Max: number
  }
  /** 位置分档边界（归一化 τ，百分数） */
  position: {
    l2Below: number // τ > 该值且未顶限位 -> L2
  }
}

export const THRESHOLD_VERSIONS: ThresholdVersion[] = [
  {
    version: 'v1.0',
    effectiveAt: '2026-09-01',
    note: '首发口径',
    pressure: { l1Min: 0.85, l1Max: 1.1, l2Min: 0.8, l2Max: 1.15, l3Min: 0.7, l3Max: 1.25 },
    position: { l2Below: 95 },
  },
  {
    version: 'v2.0',
    effectiveAt: '2026-10-10',
    note: '收紧正常带（0.88~1.08Pn），近限位关注线提前到 92%',
    pressure: { l1Min: 0.88, l1Max: 1.08, l2Min: 0.82, l2Max: 1.12, l3Min: 0.7, l3Max: 1.25 },
    position: { l2Below: 92 },
  },
]

export function thresholdOf(version: string): ThresholdVersion {
  const found = THRESHOLD_VERSIONS.find((item) => item.version === version)
  if (!found) {
    throw new Error(`阈值版本 ${version} 不存在`)
  }
  return found
}

export const CURRENT_VERSION = 'v1.0'

/** 两条路径相对偏差超过该值即判冲突：|实测-远传| / 实测 > 5% */
export const PATH_DEVIATION_LIMIT = 0.05

/** 缺值补判档位（文档第 5 节）：不填数值，补判 L2，范围 0.80Pn~0.85Pn 侧 */
export const MISSING_PRESSURE_GRADE: Grade = 2

export type PressureInput = {
  /** 现场实测油压（路径 A，定级依据）；null 表示缺值 */
  local: number | null
  /** 监控远传油压（路径 B，仅旁证） */
  remote: number | null
  rated: number
}

export type PressureResult = {
  grade: Grade
  ratio: number | null
  missing: boolean
  conflict: boolean
  reason: string
}

export function gradePressure(input: PressureInput, tv: ThresholdVersion): PressureResult {
  const { local, remote, rated } = input
  if (!(rated > 0)) {
    throw new Error('额定油压 Pn 必须为正数')
  }
  const conflict =
    local !== null && remote !== null && Math.abs(local - remote) / local > PATH_DEVIATION_LIMIT

  if (local === null) {
    return {
      grade: MISSING_PRESSURE_GRADE,
      ratio: remote === null ? null : remote / rated,
      missing: true,
      conflict,
      reason:
        remote === null
          ? '油压实测缺失且无远传，按缺值口径补判 L2（0.80~0.85Pn 侧），列缺值清单、24h 内补测'
          : '仅有远传油压、无现场实测，按缺值处理，远传不定级，列缺值清单补测',
    }
  }

  const ratio = local / rated
  const b = tv.pressure
  let grade: Grade
  let reason: string
  if (ratio >= b.l1Min && ratio <= b.l1Max) {
    grade = 1
    reason = `P/Pn=${ratio.toFixed(3)}，落在正常带 ${b.l1Min}~${b.l1Max}Pn`
  } else if (
    (ratio >= b.l2Min && ratio < b.l1Min) ||
    (ratio > b.l1Max && ratio <= b.l2Max)
  ) {
    grade = 2
    reason = `P/Pn=${ratio.toFixed(3)}，落在关注带（${b.l2Min}~${b.l1Min} 或 ${b.l1Max}~${b.l2Max}Pn），加密观测`
  } else if (
    (ratio >= b.l3Min && ratio < b.l2Min) ||
    (ratio > b.l2Max && ratio <= b.l3Max)
  ) {
    grade = 3
    reason = `P/Pn=${ratio.toFixed(3)}，落在待校验带（${b.l3Min}~${b.l2Min} 或 ${b.l2Max}~${b.l3Max}Pn），落检修待办`
  } else {
    grade = 4
    reason = `P/Pn=${ratio.toFixed(3)}，越危急界（<${b.l3Min} 或 >${b.l3Max}Pn，绝对上限 ${b.l3Max}Pn），立即处置`
  }
  if (conflict) {
    reason += '；实测与远传偏差>5%，以实测为准，挂通道校验待办'
  }
  return { grade, ratio, missing: false, conflict, reason }
}

export type PositionInput = {
  /** 接力器行程实测归一化（路径 A，%）；null 表示缺值 */
  strokeTau: number | null
  /** 导叶开度反馈归一化（路径 B，%） */
  vaneTau: number | null
  /** 开度指令/负荷工况：true=满发（指令≥95%），false=非满发 */
  fullLoadCommand: boolean
}

export type PositionResult = {
  grade: Grade
  tau: number | null
  missing: boolean
  conflict: boolean
  reason: string
}

export function gradePosition(input: PositionInput, tv: ThresholdVersion): PositionResult {
  const { strokeTau, vaneTau, fullLoadCommand } = input
  const local = strokeTau
  const remote = vaneTau
  const conflict =
    local !== null && remote !== null && Math.abs(local - remote) / local > PATH_DEVIATION_LIMIT

  if (local === null) {
    return {
      grade: 1,
      tau: remote,
      missing: true,
      conflict,
      reason:
        remote === null
          ? '行程实测缺失，位置侧不抬级；如油压同时缺值按缺值清单补测'
          : '仅有开度反馈、无行程实测，位置侧不抬级，远传只作工况旁证',
    }
  }

  let grade: Grade
  let reason: string
  if (local >= 100) {
    if (fullLoadCommand) {
      grade = 1
      reason = `τ=${local.toFixed(1)}% 顶限位但机组满发（指令≥95%），按工况正常，班抄注明满发顶限位`
    } else {
      grade = 3
      reason = `τ=${local.toFixed(1)}% 顶开度限位/行程到顶且非满发，判顶限位 L3，落检修待办校验反馈与机械限位`
    }
  } else if (local > tv.position.l2Below) {
    grade = 2
    reason = `τ=${local.toFixed(1)}% 近限位未顶（>${tv.position.l2Below}%），核对水头/负荷工况`
  } else {
    grade = 1
    reason = `τ=${local.toFixed(1)}%，未近限位`
  }
  if (conflict) {
    reason += '；行程实测与开度反馈偏差>5%，以行程实测为准，挂通道校验待办'
  }
  return { grade, tau: local, missing: false, conflict, reason }
}

export const GRADE_ACTION: Record<Grade, string> = {
  1: '正常运行，班抄留痕',
  2: '加密观测至本班结束，查泵启停/漏气/工况，不派待办、不计异常台数',
  3: '安排校验：核对压力表/反馈传感器/油泵启停定值与机械限位，异常未消除前每班复测',
  4: '立即处置：切手动或备用油泵补气补油，不恢复按规程停机，同步安排检修',
}

export type JudgeInput = {
  rated: number
  pressureLocal: number | null
  pressureRemote: number | null
  strokeTau: number | null
  vaneTau: number | null
  fullLoadCommand: boolean
  version: string
}

export type JudgeResult = {
  grade: Grade
  action: string
  pressureGrade: Grade
  positionGrade: Grade
  ratio: number | null
  tau: number | null
  missing: boolean
  conflict: boolean
  reasons: string[]
  version: string
}

/** 一次判定同时给出等级与建议动作；综合等级 = max(油压等级, 位置等级) */
export function judgeGovernor(input: JudgeInput): JudgeResult {
  const tv = thresholdOf(input.version)
  const p = gradePressure(
    { local: input.pressureLocal, remote: input.pressureRemote, rated: input.rated },
    tv,
  )
  const t = gradePosition(
    {
      strokeTau: input.strokeTau,
      vaneTau: input.vaneTau,
      fullLoadCommand: input.fullLoadCommand,
    },
    tv,
  )
  const maxGrade: Grade = Math.max(p.grade, t.grade) as Grade
  // 文档第 3/4 节：油压与位置同时命中 L3 及以上，综合抬为 L4
  const grade: Grade = p.grade >= 3 && t.grade >= 3 ? 4 : maxGrade
  const reasons: string[] = [`油压：${p.reason}`, `位置：${t.reason}`]
  if (p.grade >= 3 && t.grade >= 3) {
    reasons.push('油压与位置同时命中待校验及以上，按 L4 危急合并处置')
  }
  return {
    grade: grade === 4 && p.grade < 4 && t.grade < 4 ? 3 : grade,
    action: GRADE_ACTION[grade],
    pressureGrade: p.grade,
    positionGrade: t.grade,
    ratio: p.ratio,
    tau: t.tau,
    missing: p.missing || t.missing,
    conflict: p.conflict || t.conflict,
    reasons,
    version: input.version,
  }
}
