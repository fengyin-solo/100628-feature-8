import assert from 'node:assert'

// localStorage 垫片
const mem = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
  },
}

export function main() {
const store = require('../src/domain/governor/store.ts')
const { getState, reconcile, submitVerification, recordObservation, activateVersion, disableDevice, resetDomain } = store

let r = reconcile()
console.log('初始对账:', JSON.stringify(r))

// 1. 初始迁移后台数三处一致；异常=3（GOVE-0002 L3、GOVE-0005 L3、GOVE-0008 L4）
assert.strictEqual(r.consistent, true, '初始迁移后必须对账一致')
assert.deepStrictEqual(r.detailAbnormal.sort(), ['GOVE-0002', 'GOVE-0005', 'GOVE-0008'])
assert.strictEqual(r.abnormalCount, 3)
assert.strictEqual(r.openVerifyTodos, 3)
assert.strictEqual(r.ledgerCount, 3)

const s0 = getState()
// 缺值：GOVE-0006 油压实测、GOVE-0007 油压+行程 => 3 条
assert.strictEqual(r.missingOpen, 3, '缺值清单应为 3 条')
// 通道冲突：GOVE-0001（2.70 vs 2.40 偏差 11%）
assert.strictEqual(r.openChannelTodos, 1)

// GOVE-0003：迁移后经 10-04 校验 3.24/4.0=0.81 v1->L2，待办关闭
const c3 = s0.current['GOVE-0003']
assert.strictEqual(c3.grade, 2, '3号机复测后应回落 L2')
assert.ok(!s0.todos.some((t) => t.deviceId === 'GOVE-0003' && t.open && t.kind === '待校验'))

// 2. 同班重复提交只认第一次（今天 2026-10-05 白班）
const first = submitVerification('GOVE-0002', '2026-10-05 09:00', '检修-甲', {
  pressureLocal: 2.2, pressureRemote: 2.2, strokeTau: 70, vaneTau: 70, fullLoadCommand: false,
})
assert.strictEqual(first.ok, true, first.message)
// 2.2/2.5=0.88 -> v1 L1，待办应关闭
assert.strictEqual(reconcile().abnormalCount, 2, '2号机校验正常后异常台数应降到 2')

const dup = submitVerification('GOVE-0002', '2026-10-05 14:00', '检修-乙', {
  pressureLocal: 0.5, pressureRemote: 0.5, strokeTau: 70, vaneTau: 70, fullLoadCommand: false,
})
assert.strictEqual(dup.ok, false)
assert.match(dup.message, /重复退回/)
// 重复提交不得改结论：异常台数仍 2
assert.strictEqual(reconcile().abnormalCount, 2)
const s1 = getState()
assert.strictEqual(s1.current['GOVE-0002'].pressureLocal, 2.2)
assert.strictEqual(s1.submissions.filter((x) => !x.accepted).length, 1)

// 夜班算另一班次，可受理
const night = submitVerification('GOVE-0002', '2026-10-05 21:00', '检修-丙', {
  pressureLocal: 1.9, pressureRemote: 1.9, strokeTau: 70, vaneTau: 70, fullLoadCommand: false,
})
assert.strictEqual(night.ok, true)
// 1.9/2.5=0.76 -> L3，异常回到 3
assert.strictEqual(reconcile().abnormalCount, 3)

// 3. 无实测值的校验被拒（禁止一键正常）
const noMeasure = submitVerification('GOVE-0005', '2026-10-05 10:00', '检修-丁', {
  pressureLocal: null, pressureRemote: 3.5, strokeTau: null, vaneTau: 99, fullLoadCommand: false,
})
assert.strictEqual(noMeasure.ok, false)
assert.match(noMeasure.message, /必须带现场复测实测值/)

// 4. 缺值补测后关闭缺值、重判
const missBefore = reconcile().missingOpen
const fill = recordObservation('GOVE-0006', '2026-10-05 10:30', {
  pressureLocal: 2.2, pressureRemote: 2.35, strokeTau: 60, vaneTau: 60, fullLoadCommand: false,
})
assert.strictEqual(fill.ok, true, fill.message)
assert.strictEqual(reconcile().missingOpen, missBefore - 1)

// 5. 停用：关待办/台账，异常台数下降且对账一致
const beforeDisable = reconcile().abnormalCount
const dis = disableDevice('GOVE-0008', '2026-10-05 11:00')
assert.strictEqual(dis.ok, true)
const rd = reconcile()
assert.strictEqual(rd.abnormalCount, beforeDisable - 1)
assert.strictEqual(rd.consistent, true)
assert.ok(!getState().current['GOVE-0008'])
// 停用装置再判定被拒
const judgeDisabled = recordObservation('GOVE-0008', '2026-10-05 11:10', {
  pressureLocal: 2.5, pressureRemote: 2.5, strokeTau: 50, vaneTau: 50, fullLoadCommand: false,
})
assert.strictEqual(judgeDisabled.ok, false)

// 6. 换版 v2 重算：GOVE-0001 油压 2.7/2.5=1.08 在 v2 恰为 L1 边界(就低)；制造一个升降级样本
//    先录入 0.87Pn 装置（用 GOVE-0002 当前夜班 L3 之上再录一条观察到 GOVE-0001? 改用 GOVE-0004：2.6/2.5=1.04 v1/v2 均L1）
//    直接对 GOVE-0001 录 P=2.175 (0.87Pn)：v1 L1(>=0.85)，v2 L2(<0.88)
const obs87 = recordObservation('GOVE-0001', '2026-10-05 12:00', {
  pressureLocal: 2.175, pressureRemote: 2.17, strokeTau: 50, vaneTau: 50, fullLoadCommand: false,
})
assert.strictEqual(obs87.ok, true)
assert.strictEqual(getState().current['GOVE-0001'].grade, 1, 'v1 下 0.87Pn 为 L1')
const v2 = activateVersion('v2.0')
assert.strictEqual(v2.ok, true, v2.message)
const c1v2 = getState().current['GOVE-0001']
assert.strictEqual(c1v2.grade, 2, 'v2 下 0.87Pn 应为 L2')
assert.strictEqual(c1v2.version, 'v2.0')
// 历史结论保留当时版本
const hist = getState().history.filter((h) => h.deviceId === 'GOVE-0001')
assert.ok(hist.some((h) => h.version === 'v1.0' && h.grade === 1))
assert.ok(hist.some((h) => h.version === 'v2.0'))
// 换版后台账/待办仍一致
assert.strictEqual(reconcile().consistent, true)

// 7. 事务回滚：切到不存在的版本必须整笔退回，状态不变
const bad = activateVersion('v9.9')
assert.strictEqual(bad.ok, false)
assert.match(bad.message, /整笔退回/)
assert.strictEqual(getState().activeVersion, 'v2.0')

// 8. 重置
resetDomain()
assert.strictEqual(reconcile().abnormalCount, 3)
assert.strictEqual(reconcile().consistent, true)

console.log('\n全部断言通过 ✓')
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exit(1)
}
