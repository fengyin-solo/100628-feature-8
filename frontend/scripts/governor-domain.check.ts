/**
 * 调速器统一判定域的逻辑自测：用最小 localStorage 桩在 Node 里跑，
 * 不依赖浏览器。跑完即退出（node --import tsx scripts/governor-domain.check.ts）。
 */
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
  clear() { this.map.clear() }
}
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: new MemoryStorage(),
}

import assert from 'node:assert/strict'

import {
  CURRENT_START_VERSION,
  judgeOnce,
  thresholdOf,
} from '../src/domain/governor/rules'
import {
  disableDevice,
  getState,
  listAbnormalLedger,
  listDevices,
  listHistory,
  listMissing,
  listTodos,
  reconcile,
  resetDomain,
  submitCalibration,
  switchRuleVersion,
} from '../src/domain/governor/state'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// ---- 纯规则：油压分档 ----
const spec = thresholdOf(CURRENT_START_VERSION)
check('油压正常带 0.944Pr(2.36/2.5) 判正常', () => {
  assert.equal(judgeOnce({ pressure: 2.36, opening: 78, openingLimit: 100, stroke: 156, strokeLimit: 200 }, 'v1.0').grade, '正常')
})
check('油压 0.872Pr(2.18) 判关注/待校验', () => {
  assert.equal(judgeOnce({ pressure: 2.18, opening: 62, openingLimit: 100, stroke: 124, strokeLimit: 200 }, 'v1.0').grade, '关注')
})
check('油压 1.064Pr(2.66) 高油压侧判关注', () => {
  assert.equal(judgeOnce({ pressure: 2.66, opening: 80, openingLimit: 100, stroke: 160, strokeLimit: 200 }, 'v1.0').grade, '关注')
})
check('油压 0.816Pr(2.04) 判异常', () => {
  assert.equal(judgeOnce({ pressure: 2.04, opening: 55, openingLimit: 100, stroke: 110, strokeLimit: 200 }, 'v1.0').grade, '异常')
})
check('油压 0.78Pr(1.95) 触事故低油压上限判严重', () => {
  assert.equal(judgeOnce({ pressure: 1.95, opening: 40, openingLimit: 100, stroke: 80, strokeLimit: 200 }, 'v1.0').grade, '严重')
})
check('油压 0.72Pr(1.80) 判严重', () => {
  assert.equal(judgeOnce({ pressure: 1.80, opening: 96, openingLimit: 100, stroke: 192, strokeLimit: 200 }, 'v1.0').grade, '严重')
})
check('到顶比 1.00(开度顶限位+行程1.005) 判关注', () => {
  assert.equal(judgeOnce({ pressure: 2.30, opening: 100, openingLimit: 100, stroke: 201, strokeLimit: 200 }, 'v1.0').grade, '关注')
})
check('到顶比 1.03(行程越限) 判异常', () => {
  assert.equal(judgeOnce({ pressure: 2.32, opening: 103, openingLimit: 100, stroke: 206, strokeLimit: 200 }, 'v1.0').grade, '异常')
})
check('硬上限：到顶比 1.06 判严重', () => {
  assert.equal(judgeOnce({ pressure: 2.3, opening: 100, openingLimit: 100, stroke: 212, strokeLimit: 200 }, 'v1.0').grade, '严重')
})
check('综合等级取两路最高档：油压关注+开度异常 -> 异常', () => {
  assert.equal(judgeOnce({ pressure: 2.18, opening: 103, openingLimit: 100, stroke: 206, strokeLimit: 200 }, 'v1.0').grade, '异常')
})
check('油压缺失按补判区间从严判关注且打 imputed 标记', () => {
  const outcome = judgeOnce({ pressure: null, opening: 70, openingLimit: 100, stroke: 140, strokeLimit: 200 }, 'v1.0')
  assert.equal(outcome.grade, '关注')
  assert.equal(outcome.pressure.imputed, true)
})
check('开度与行程两路全缺：本路不参与定级', () => {
  const outcome = judgeOnce({ pressure: 2.36, opening: null, openingLimit: null, stroke: null, strokeLimit: null }, 'v1.0')
  assert.equal(outcome.grade, '正常')
  assert.equal(outcome.opening.imputed, true)
})

// ---- 存量迁移 ----
check('存量按发生时间升序迁移：首台是 09-28 的 GOVE-0001', () => {
  resetDomain()
  const devices = listDevices()
  assert.equal(devices[0].code, 'GOVE-0001')
  assert.equal(devices.at(-1)?.code, 'GOVE-0010')
  assert.equal(getState().migrated?.legacyCount, 10)
  assert.equal(getState().migrated?.version, CURRENT_START_VERSION)
})
check('迁移后一次判定一台一档，初始台数：正常2 关注4 异常4 严重2', () => {
  const r = reconcile()
  assert.equal(r.total, 10)
  assert.equal(r.normal, 2)
  assert.equal(r.attention, 4)
  assert.equal(r.abnormal, 4)
  assert.equal(r.severe, 2)
  assert.equal(r.matched, true)
})
check('待办清单只含关注装置，台数 = 关注档（4条）', () => {
  assert.equal(listTodos().length, 4)
})
check('继电保护台账镜像台数 = 异常台数（4台：2异常+2严重）', () => {
  assert.equal(listAbnormalLedger().length, 4)
})
check('缺值单列：GOVE-0009 油压缺失单独列示且未关闭', () => {
  const open = listMissing().filter((m) => !m.resolved)
  assert.equal(open.length, 1)
  assert.equal(open[0].deviceCode, 'GOVE-0009')
  assert.ok(open[0].fields.includes('油压值'))
})
check('两路打架以现场实测为准：GOVE-0010 判定油压取实测 2.30（填报 2.60 被覆盖）', () => {
  const d = listDevices().find((x) => x.code === 'GOVE-0010')!
  assert.equal(d.effective.values.pressureMPa, 2.3)
  assert.equal(d.effective.fieldSource.pressureMPa, '现场实测')
  assert.equal(d.current.grade, '正常')
})

// ---- 校验提交：等级回落、同班重复退回、缺项整笔退回 ----
const reading = { pressureMPa: 2.32, openingPct: 80, openingLimitPct: 100, strokeMm: 160, strokeLimitMm: 200 }
check('GOVE-0009 补实测后由关注回落为正常，待办变3条、缺值关闭', () => {
  const id = listDevices().find((x) => x.code === 'GOVE-0009')!.id
  const res = submitCalibration({ deviceId: id, shiftKey: '2026-10-05|白班', shiftLabel: '白班', operator: '测试员', reading })
  assert.equal(res.ok, true)
  assert.equal(reconcile().attention, 3)
  assert.equal(listTodos().length, 3)
  assert.equal(listMissing().filter((m) => !m.resolved).length, 0)
  assert.equal(listHistory(id)[0].trigger, '校验复判')
  assert.equal(listHistory(id)[0].grade, '正常')
})
check('同一台同一班次第二次提交按重复退回，记录数不增加', () => {
  const id = listDevices().find((x) => x.code === 'GOVE-0009')!.id
  const before = getState().calibrations.length
  const res = submitCalibration({ deviceId: id, shiftKey: '2026-10-05|白班', shiftLabel: '白班', operator: '另一人', reading })
  assert.equal(res.ok, false)
  assert.match(res.message, /重复退回/)
  assert.equal(getState().calibrations.length, before)
})
check('换一个班次提交仍被接受（只按同班次去重）', () => {
  const id = listDevices().find((x) => x.code === 'GOVE-0009')!.id
  const res = submitCalibration({ deviceId: id, shiftKey: '2026-10-05|夜班', shiftLabel: '夜班', operator: '测试员', reading })
  assert.equal(res.ok, true)
})
check('实测缺项整笔退回：不输油压直接拒绝，状态不变', () => {
  const id = listDevices().find((x) => x.code === 'GOVE-0002')!.id
  const gradeBefore = listDevices().find((x) => x.id === id)!.current.grade
  const res = submitCalibration({
    deviceId: id, shiftKey: '2026-10-05|夜班', shiftLabel: '夜班', operator: '测试员',
    reading: { ...reading, pressureMPa: null },
  })
  assert.equal(res.ok, false)
  assert.equal(listDevices().find((x) => x.id === id)!.current.grade, gradeBefore)
})

// ---- 事务：中间态不落库 ----
check('事务失败整笔退回：落盘抛错时设备读数与受理记录全部回到操作前', () => {
  const id = listDevices().find((x) => x.code === 'GOVE-0002')!.id
  const before = JSON.stringify(getState())
  const storage = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage
  const original = storage.setItem.bind(storage)
  const calls = { count: 0 }
  storage.setItem = (key: string, value: string) => {
    if (key.includes('governor-domain') && calls.count >= 0) {
      calls.count += 1
      throw new Error('模拟落盘失败')
    }
    return original(key, value)
  }
  try {
    const res = submitCalibration({
      deviceId: id, shiftKey: '2026-10-06|白班', shiftLabel: '白班', operator: '测试员',
      reading: { pressureMPa: 2.3, openingPct: 80, openingLimitPct: 100, strokeMm: 160, strokeLimitMm: 200 },
    })
    assert.equal(res.ok, false)
    assert.match(res.message, /整笔退回|落盘/)
  } finally {
    storage.setItem = original
  }
  // 内存缓存与持久化存储都应停在操作前：没有半截复判结论，也没有多出一条受理记录。
  assert.equal(JSON.stringify(getState()), before)
})
check('落盘恢复后同一笔校验可以重新提交成功', () => {
  const id = listDevices().find((x) => x.code === 'GOVE-0002')!.id
  const res = submitCalibration({
    deviceId: id, shiftKey: '2026-10-06|白班', shiftLabel: '白班', operator: '测试员',
    reading: { pressureMPa: 2.3, openingPct: 80, openingLimitPct: 100, strokeMm: 160, strokeLimitMm: 200 },
  })
  assert.equal(res.ok, true)
  assert.equal(listDevices().find((x) => x.id === id)!.current.grade, '正常')
  assert.equal(reconcile().matched, true)
})

// ---- 换版：按新口径重算，旧结论保留等级和版本 ----
check('换版 v1.1：全部装置重算；GOVE-0001(2.36=0.944Pr) 在收紧口径下由正常变关注', () => {
  const historiesBefore = listHistory(listDevices().find((x) => x.code === 'GOVE-0001')!.id).length
  const res = switchRuleVersion('v1.1')
  assert.equal(res.ok, true)
  const d = listDevices().find((x) => x.code === 'GOVE-0001')!
  assert.equal(d.current.version, 'v1.1')
  assert.equal(d.current.grade, '关注')
  const history = listHistory(d.id)
  assert.equal(history[0].trigger, '换版重算')
  assert.equal(history[0].grade, '关注')
  // 旧结论保留：迁移那条仍是 v1.0 正常
  const old = history.find((h) => h.trigger === '存量迁移')!
  assert.equal(old.version, 'v1.0')
  assert.equal(old.grade, '正常')
  assert.ok(history.length >= historiesBefore + 1)
})
check('换版后对账仍然一致，两处异常台数仍然相等', () => {
  const r = reconcile()
  assert.equal(r.matched, true)
  assert.equal(r.abnormal, listAbnormalLedger().length)
})
check('切回 v1.0 后 GOVE-0001 恢复正常档（重算可逆，历史继续追加不覆盖）', () => {
  switchRuleVersion('v1.0')
  const d = listDevices().find((x) => x.code === 'GOVE-0001')!
  assert.equal(d.current.grade, '正常')
  assert.equal(d.current.version, 'v1.0')
})

// ---- 停用：异常台账不丢台数 ----
check('严重装置停用后状态为已停用，仍计入异常台账台数', () => {
  const id = listDevices().find((x) => x.code === 'GOVE-0007')!.id
  assert.equal(disableDevice(id).ok, true)
  const d = listDevices().find((x) => x.id === id)!
  assert.equal(d.current.status, '已停用')
  assert.equal(reconcile().matched, true)
  assert.equal(listAbnormalLedger().filter((r) => r.deviceId === id).length, 1)
})
check('停用的关注装置同步移出待办与待校验台数（GOVE-0003 停用校验）', () => {
  const id = listDevices().find((x) => x.code === 'GOVE-0003')!.id
  assert.equal(listDevices().find((x) => x.id === id)!.current.grade, '关注')
  const attentionBefore = reconcile().attention
  assert.equal(disableDevice(id).ok, true)
  assert.equal(listTodos().some((t) => t.deviceId === id), false)
  assert.equal(reconcile().attention, attentionBefore - 1)
  assert.equal(listDevices().find((x) => x.id === id)!.current.status, '已停用')
  assert.equal(reconcile().matched, true)
})

// ---- 额定参数化：Pr 不同也能按比例分档 ----
check('额定参数化：Pr=4.0MPa 的装置 3.5MPa(0.875Pr) 同样判关注', () => {
  assert.equal(judgeOnce({ pressure: 3.5, opening: 50, openingLimit: 100, stroke: 100, strokeLimit: 200, ratedPressureMPa: 4 }, 'v1.0').grade, '关注')
})

console.log(`\n全部 ${passed} 项检查通过`)
