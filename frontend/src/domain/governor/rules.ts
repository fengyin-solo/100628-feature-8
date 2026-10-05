/**
 * 调速器油压与导叶开度统一判定口径（全平台唯一一份）。
 *
 * 这一份文件同时管两件过去写在两张纸上的事：
 *   1) 油压按额定油压 Pr 的上下限分档；
 *   2) 导叶开度顶到开度限位、或接力器行程顶到行程上限时，按同一套「到顶比」阈值判定。
 *
 * 一次判定只产出一个等级 + 一条建议动作，不允许任何模块再保存第二套互相打架的结论。
 * 换版只准在这里加版本：旧结论保留当时等级并注明版本，新判定按启用版本重算（见 state.ts）。
 */

/** 统一等级：由轻到重排序，取油压、开度两路结果的最高档作为装置综合等级。 */
export type Grade = '正常' | '关注' | '异常' | '严重'

export const GRADE_ORDER: Grade[] = ['正常', '关注', '异常', '严重']

export function maxGrade(a: Grade, b: Grade): Grade {
  return GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? a : b
}

/** 综合等级驱动的建议动作：一次判定同时给出等级与建议动作。 */
export const GRADE_ACTION: Record<Grade, string> = {
  正常: '正常运行，按周期巡检',
  关注: '判为待校验：落到检修班组校验待办，安排一次校验并复测油压/开度',
  异常: '立即降负荷并通知检修班组到场处理，未消缺前不得并网；停用前继续挂异常账',
  严重: '立即事故停机、切断压油装置并挂牌停用，按事故处理流程上报',
}

/** 装置状态（沿用既有台账的四档字样，严重映射为已停用）。 */
export function gradeToStatus(grade: Grade): string {
  switch (grade) {
    case '正常':
      return '正常'
    case '关注':
      return '待校验'
    case '异常':
      return '异常'
    case '严重':
      return '已停用'
  }
}

/** 油压分档阈值，全部以额定油压 Pr 的比例表达；上下限一并写死，不允许现场各说各的。 */
export type PressureBands = {
  /** 版本说明用：判定时优先按下限（p/Pr 从小到大）命中，第一个满足的区间即最终等级。 */
  /** 事故低油压硬上限：比值 ≤ 该值即「严重」。 */
  accidentLow: number
  /** 低油压异常上限：(accidentLow, abnormalLow] 为「异常」。 */
  abnormalLow: number
  /** 运行允许下限：(abnormalLow, normalLow] 为「关注」。 */
  normalLow: number
  /** 运行允许上限：[normalLow, normalHigh] 为「正常」。 */
  normalHigh: number
  /** 高油压异常下限：(normalHigh, abnormalHigh] 为「异常」。 */
  abnormalHigh: number
  /** 过压硬上限：比值 > 该值即「严重」。 */
  overHigh: number
}

/** 开度/行程「到顶比」分档阈值，导叶开度与接力器行程共用这一套，不分开立口径。 */
export type OpeningBands = {
  /** 到顶预警线：比值 ≥ 该值（即顶到限位/行程上限）判「关注」，进待校验。 */
  limitReached: number
  /** 越限异常线：比值 > 该值判「异常」。 */
  overLimit: number
  /** 越限硬上限：比值 > 该值判「严重」，立即停机。 */
  hardUpper: number
}

export type ThresholdVersion = {
  version: string
  effectiveFrom: string
  note: string
  ratedPressureMPa: number
  pressure: PressureBands
  opening: OpeningBands
}

/**
 * v1.0 —— 2026-10-05 起统一执行的首版口径（两张纸合并后的第一版）。
 * 油压：正常带 0.90Pr~1.05Pr；关注带 0.85~0.90Pr 与 1.05~1.10Pr；
 *       异常带 0.80~0.85Pr 与 1.10~1.15Pr；≤0.80Pr 或 >1.15Pr 为严重。
 * 到顶比：≥1.00 为顶到限位（关注）；>1.02 异常；>1.05 严重（硬上限）。
 */
export const THRESHOLD_VERSIONS: ThresholdVersion[] = [
  {
    version: 'v1.0',
    effectiveFrom: '2026-10-05',
    note: '两纸合并首版：油压按额定油压上下限分档，开度顶限位/行程到顶统一按到顶比判定',
    ratedPressureMPa: 2.5,
    pressure: {
      accidentLow: 0.8,
      abnormalLow: 0.85,
      normalLow: 0.9,
      normalHigh: 1.05,
      abnormalHigh: 1.1,
      overHigh: 1.15,
    },
    opening: {
      limitReached: 1.0,
      overLimit: 1.02,
      hardUpper: 1.05,
    },
  },
  {
    version: 'v1.1',
    effectiveFrom: '2026-10-05',
    note: '换版演练口径：油压正常带收窄到 0.95Pr~1.04Pr，到顶预警线提前到 0.98',
    ratedPressureMPa: 2.5,
    pressure: {
      accidentLow: 0.8,
      abnormalLow: 0.88,
      normalLow: 0.95,
      normalHigh: 1.04,
      abnormalHigh: 1.08,
      overHigh: 1.12,
    },
    opening: {
      limitReached: 0.98,
      overLimit: 1.0,
      hardUpper: 1.03,
    },
  },
]

/** 存量装置首次统一判定时锁定的版本（两纸并轨的第一版）。 */
export const CURRENT_START_VERSION = 'v1.0'

/** 当前可切换到的最新版本。 */
export const CURRENT_VERSION = 'v1.1'

export function thresholdOf(version: string): ThresholdVersion {
  const found = THRESHOLD_VERSIONS.find((item) => item.version === version)
  if (!found) {
    throw new Error(`阈值口径没有「${version}」这个版本`)
  }
  return found
}

export type PressureResult = {
  grade: Grade
  /** 判定使用的油压相对额定值的比值，缺值补判时给出补判假设比值 0.85。 */
  ratio: number | null
  /** 缺值补判标记：历史油压缺失时按 (abnormalLow, normalLow] 补判区间从严定为「关注」。 */
  imputed: boolean
  reason: string
}

export type OpeningResult = {
  grade: Grade
  /** 到顶比：max(导叶开度/开度限位, 接力器行程/行程上限)。 */
  ratio: number | null
  /** 命中的是哪一路：开度限位 / 接力器行程 / 两路都缺。 */
  hitBy: '开度限位' | '接力器行程' | null
  imputed: boolean
  reason: string
}

/**
 * 油压分档判定。ratio 为 null（历史值缺失）时按补判区间处理：
 * 补判范围取 (abnormalLow, normalLow]（v1.0 即 0.85Pr~0.90Pr）的从严端，直接定「关注/待校验」，
 * 即「缺值不能当正常」，先安排校验拿到实测值后再复判。
 */
export function judgePressure(ratio: number | null, spec: ThresholdVersion): PressureResult {
  const band = spec.pressure
  if (ratio === null) {
    return {
      grade: '关注',
      ratio: null,
      imputed: true,
      reason: `油压历史值缺失，按补判区间(${band.abnormalLow}Pr, ${band.normalLow}Pr]从严补判为关注`,
    }
  }
  if (ratio <= band.accidentLow) {
    return { grade: '严重', ratio, imputed: false, reason: `油压 ${ratio.toFixed(3)}Pr ≤ 事故低油压硬上限 ${band.accidentLow}Pr` }
  }
  if (ratio <= band.abnormalLow) {
    return { grade: '异常', ratio, imputed: false, reason: `油压 ${ratio.toFixed(3)}Pr 落在低油压异常带 (${band.accidentLow}Pr, ${band.abnormalLow}Pr]` }
  }
  if (ratio < band.normalLow) {
    return { grade: '关注', ratio, imputed: false, reason: `油压 ${ratio.toFixed(3)}Pr 低于运行允许下限 ${band.normalLow}Pr` }
  }
  if (ratio <= band.normalHigh) {
    return { grade: '正常', ratio, imputed: false, reason: `油压 ${ratio.toFixed(3)}Pr 在正常带 [${band.normalLow}Pr, ${band.normalHigh}Pr]` }
  }
  if (ratio <= band.abnormalHigh) {
    return { grade: '关注', ratio, imputed: false, reason: `油压 ${ratio.toFixed(3)}Pr 高于运行允许上限 ${band.normalHigh}Pr` }
  }
  if (ratio <= band.overHigh) {
    return { grade: '异常', ratio, imputed: false, reason: `油压 ${ratio.toFixed(3)}Pr 落在高油压异常带 (${band.abnormalHigh}Pr, ${band.overHigh}Pr]` }
  }
  return { grade: '严重', ratio, imputed: false, reason: `油压 ${ratio.toFixed(3)}Pr > 过压硬上限 ${band.overHigh}Pr` }
}

/**
 * 开度顶限位 / 接力器行程到顶的统一判定。
 * 两路都换算成「到顶比」后取最大值，共用同一套阈值；任何一路顶到上限都算数。
 */
export function judgeOpening(
  opening: number | null,
  openingLimit: number | null,
  stroke: number | null,
  strokeLimit: number | null,
  spec: ThresholdVersion,
): OpeningResult {
  const candidates: { ratio: number; hitBy: '开度限位' | '接力器行程' }[] = []
  if (opening !== null && openingLimit !== null && openingLimit > 0) {
    candidates.push({ ratio: opening / openingLimit, hitBy: '开度限位' })
  }
  if (stroke !== null && strokeLimit !== null && strokeLimit > 0) {
    candidates.push({ ratio: stroke / strokeLimit, hitBy: '接力器行程' })
  }
  if (candidates.length === 0) {
    return { grade: '正常', ratio: null, hitBy: null, imputed: true, reason: '开度/限位与行程/行程上限两路数据均缺失，本路不参与定级（缺值已单列）' }
  }
  candidates.sort((a, b) => b.ratio - a.ratio)
  const top = candidates[0]
  const band = spec.opening
  const pct = (top.ratio * 100).toFixed(1)
  if (top.ratio > band.hardUpper) {
    return { grade: '严重', ratio: top.ratio, hitBy: top.hitBy, imputed: false, reason: `${top.hitBy}到顶比 ${pct}% > 越限硬上限 ${band.hardUpper * 100}%` }
  }
  if (top.ratio > band.overLimit) {
    return { grade: '异常', ratio: top.ratio, hitBy: top.hitBy, imputed: false, reason: `${top.hitBy}到顶比 ${pct}% 越过异常线 ${band.overLimit * 100}%` }
  }
  if (top.ratio >= band.limitReached) {
    return { grade: '关注', ratio: top.ratio, hitBy: top.hitBy, imputed: false, reason: `${top.hitBy}到顶比 ${pct}% 已顶到限位（≥ ${band.limitReached * 100}%）` }
  }
  return { grade: '正常', ratio: top.ratio, hitBy: top.hitBy, imputed: false, reason: `${top.hitBy}到顶比 ${pct}%，未顶到限位` }
}

export type JudgeInput = {
  pressure: number | null
  opening: number | null
  openingLimit: number | null
  stroke: number | null
  strokeLimit: number | null
  /** 装置自身额定油压；不传时取口径版本默认额定值（2.5MPa）。 */
  ratedPressureMPa?: number
}

export type JudgeOutcome = {
  grade: Grade
  action: string
  pressure: PressureResult
  opening: OpeningResult
}

/** 一次判定：油压、开度两路各算一次，综合取最高档；建议动作由综合等级唯一决定。 */
export function judgeOnce(input: JudgeInput, version: string): JudgeOutcome {
  const spec = thresholdOf(version)
  const ratedPressure = input.ratedPressureMPa ?? spec.ratedPressureMPa
  const pressure = judgePressure(
    input.pressure === null ? null : input.pressure / ratedPressure,
    spec,
  )
  const opening = judgeOpening(input.opening, input.openingLimit, input.stroke, input.strokeLimit, spec)
  const grade = maxGrade(pressure.grade, opening.grade)
  return { grade, action: GRADE_ACTION[grade], pressure, opening }
}
