/**
 * 调速器统一判定的页面服务层：页面只读/只调这里，不直接碰持久化。
 * 导出的明细 CSV 与对账台数取自同一次读取，口径与明细清单一起变。
 */
import {
  CURRENT_VERSION,
  GRADE_ACTION,
  THRESHOLD_VERSIONS,
  type ThresholdVersion,
} from '@/domain/governor/rules'
import {
  disableDevice,
  domainStorageKey,
  listAbnormalLedger,
  listCalibrations,
  listDevices,
  listHistory,
  listMissing,
  listTodos,
  migrationInfo,
  reconcile,
  resetDomain,
  submitCalibration,
  switchRuleVersion,
  type ReadingValues,
  type ReconcileReport,
  type TodoItem,
} from '@/domain/governor/state'

export {
  disableDevice,
  listAbnormalLedger,
  listCalibrations,
  listDevices,
  listHistory,
  listMissing,
  listTodos,
  migrationInfo,
  reconcile,
  resetDomain,
  submitCalibration,
  switchRuleVersion,
  domainStorageKey,
}
export type { ReadingValues, ReconcileReport, TodoItem }

export function thresholdVersions(): ThresholdVersion[] {
  return THRESHOLD_VERSIONS
}

export function latestVersion(): string {
  return CURRENT_VERSION
}

export function gradeAction(grade: string): string {
  return GRADE_ACTION[grade as keyof typeof GRADE_ACTION] ?? ''
}

export function switchVersion(version: string) {
  return switchRuleVersion(version)
}

export function submitGovernorCalibration(input: {
  deviceId: number
  shiftKey: string
  shiftLabel: string
  operator: string
  reading: ReadingValues
}) {
  return submitCalibration(input)
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 调速器主清单导出：每行就是一份唯一结论（等级、建议动作、版本、两路取值仲裁来源都在）。 */
export function exportGovernorCsv(): { filename: string; content: string } {
  const devices = listDevices()
  const header = [
    '装置编号', '所属机组', '发生时间', '额定油压(MPa)',
    '填报油压(MPa)', '实测油压(MPa)', '判定油压(MPa)', '油压取值路径',
    '导叶开度(%)', '开度限位(%)', '接力器行程(mm)', '行程上限(mm)', '到顶比(%)', '到顶命中',
    '综合等级', '建议动作', '装置状态', '结论版本', '判定时间', '缺值补判',
  ]
  const lines = [header.join(',')]
  devices.forEach((device) => {
    const v = device.effective.values
    lines.push(
      [
        device.code,
        device.unit,
        device.occurredAt,
        device.ratedPressureMPa,
        v.pressureMPa ?? '',
        device.measured?.pressureMPa ?? '',
        v.pressureMPa ?? '',
        device.effective.fieldSource.pressureMPa ?? '缺值',
        v.openingPct ?? '',
        v.openingLimitPct ?? '',
        v.strokeMm ?? '',
        v.strokeLimitMm ?? '',
        device.current.openingRatio === null ? '' : (device.current.openingRatio * 100).toFixed(1),
        device.current.openingRatio === null ? '两路缺失' : '按到顶判定',
        device.current.grade,
        device.current.action,
        device.current.status,
        device.current.version,
        device.current.judgedAt,
        device.current.pressureImputed ? '是' : '否',
      ].map(csvCell).join(','),
    )
  })
  return { filename: '调速器统一判定清单.csv', content: `﻿${lines.join('\n')}` }
}

/** 对账导出：对账口径（台数与勾稽检查）与明细清单在同一次读取里一起导出。 */
export function exportReconcileCsv(): { filename: string; content: string } {
  const report = reconcile()
  const lines: string[] = []
  lines.push(`调速器异常对账（口径版本 ${report.ruleVersion}，导出时间 ${report.at}）`)
  lines.push('')
  lines.push(['总台数', report.total].join(','))
  lines.push(['正常', report.normal].join(','))
  lines.push(['待校验(关注)', report.attention].join(','))
  lines.push(['异常装置台数(异常+严重，含停用未消缺)', report.abnormal].join(','))
  lines.push(['其中严重', report.severe].join(','))
  lines.push(['人工停用台数', report.disabled].join(','))
  lines.push(['检修班组校验待办条数', report.todoCount].join(','))
  lines.push(['继电保护运行台账镜像台数', report.ledgerAbnormalCount].join(','))
  lines.push(['缺值未补条数', report.missingOpen].join(','))
  lines.push(['对账结果', report.matched ? '一致' : '不一致'].join(','))
  lines.push('')
  lines.push(['勾稽检查', '左值', '右值', '结果'].join(','))
  report.checks.forEach((check) => {
    lines.push([check.name, check.left, check.right, check.ok ? '一致' : '不一致'].map(csvCell).join(','))
  })
  lines.push('')
  lines.push('—— 异常装置明细（继电保护运行台账同一份取值）——')
  lines.push(['装置编号', '所属机组', '等级', '装置状态', '建议动作', '口径版本', '判定时间', '命中原因'].join(','))
  listAbnormalLedger().forEach((row) => {
    lines.push([row.code, row.unit, row.grade, row.status, row.action, row.version, row.judgedAt, row.hitReason].map(csvCell).join(','))
  })
  lines.push('')
  lines.push('—— 缺值单列 ——')
  lines.push(['装置编号', '发生时间', '缺失字段', '状态', '说明'].join(','))
  listMissing().forEach((item) => {
    lines.push([item.deviceCode, item.occurredAt, item.fields.join('/'), item.resolved ? '已补测' : '待补测', item.note].map(csvCell).join(','))
  })
  return { filename: '调速器对账与明细.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadCsv(payload: { filename: string; content: string }): void {
  const blob = new Blob([payload.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = payload.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
