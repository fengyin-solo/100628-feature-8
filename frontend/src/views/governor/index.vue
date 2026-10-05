<template>
  <section class="page" data-module="governor">
    <header class="page-head">
      <div>
        <h2>调速器统一判定（油压 / 导叶开度一套口径）</h2>
        <p class="page-desc">
          油压按额定油压 Pr 的上下限分档；导叶开度顶到开度限位、接力器行程到顶按同一套到顶比阈值判定。
          一次判定同时给出等级与建议动作，全平台只有这一份结论。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportList">导出判定清单</button>
        <button class="btn" type="button" @click="exportReconcile">导出对账与明细</button>
        <button class="btn ghost" type="button" @click="resetAll">重置回两纸并轨初始</button>
      </div>
    </header>

    <!-- 当前口径与阈值：判定条件、上下限全写在台面上 -->
    <article class="rule-card">
      <header class="rule-head">
        <div>
          <strong>当前生效口径：{{ state.ruleVersion }}</strong>
          <span class="rule-note">{{ activeSpec.note }}（{{ activeSpec.effectiveFrom }} 起执行）· 额定油压 Pr = {{ activeSpec.ratedPressureMPa }}MPa</span>
        </div>
        <div class="version-switch">
          <span class="switch-label">换版重算：</span>
          <button
            v-for="spec in versions"
            :key="spec.version"
            class="btn"
            :class="{ primary: spec.version === state.ruleVersion }"
            type="button"
            :disabled="spec.version === state.ruleVersion"
            @click="changeVersion(spec.version)"
          >
            {{ spec.version }}
          </button>
        </div>
      </header>
      <div class="rule-grid">
        <div>
          <h4>油压分档（以额定油压 Pr 的比例计）</h4>
          <table class="mini-table">
            <thead><tr><th>等级</th><th>下限</th><th>上限</th><th>建议动作</th></tr></thead>
            <tbody>
              <tr v-for="row in pressureTable" :key="row.grade" :class="`row-grade-${row.grade}`">
                <td>{{ row.grade }}</td><td>{{ row.lower }}</td><td>{{ row.upper }}</td><td class="action-cell">{{ row.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4>开度/行程到顶判定（到顶比 = 实测 ÷ 限位，两路取大值共用阈值）</h4>
          <table class="mini-table">
            <thead><tr><th>等级</th><th>条件</th><th>建议动作</th></tr></thead>
            <tbody>
              <tr v-for="row in openingTable" :key="row.grade" :class="`row-grade-${row.grade}`">
                <td>{{ row.grade }}</td><td v-html="row.condition"></td><td class="action-cell">{{ row.action }}</td>
              </tr>
            </tbody>
          </table>
          <p class="impute-note">
            缺值补判：历史油压缺失的按 ({{ activeSpec.pressure.abnormalLow }}Pr, {{ activeSpec.pressure.normalLow }}Pr]
            补判区间从严定为「关注/待校验」，先补实测再复判；开度与行程两路全缺时本路不参与定级，缺值单列。
          </p>
        </div>
      </div>
      <div class="path-rule">
        两路读数先后与冲突：统一先取<b>交接填报</b>、再取<b>现场实测</b>；同字段两路都有且不一致时，
        <b>以现场实测那一份为准</b>并覆盖填报值，所有模块统一读这一份取值。
      </div>
    </article>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="item.cls">{{ item.value }}</strong>
      </article>
    </div>

    <div class="reconcile-bar" :class="report.matched ? 'ok' : 'bad'">
      <span>对账（{{ report.ruleVersion }}）：{{ report.matched ? '一致' : '不一致' }}</span>
      <label v-for="check in report.checks" :key="check.name" class="check-pill" :class="{ fail: !check.ok }">
        {{ check.name }}：{{ check.left }} = {{ check.right }}
      </label>
    </div>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: tab.key === activeTab }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}<span v-if="tab.count !== null" class="tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <p v-if="migration" class="migration-note">
      存量记录已于 {{ migration.migratedAt }} 按发生时间迁移落库：旧台账 {{ migration.legacyCount }} 条，迁入 {{ migration.migratedCount }} 台装置，初始口径 {{ migration.version }}。
    </p>

    <!-- 判定清单 -->
    <table v-if="activeTab === 'judgments'" class="data-table">
      <thead>
        <tr>
          <th>装置编号</th><th>所属机组</th><th>发生时间</th>
          <th>填报油压</th><th>实测油压</th><th>判定油压(取值路径)</th>
          <th>导叶开度/限位</th><th>行程/上限</th><th>到顶比</th>
          <th>综合等级</th><th>建议动作</th><th>装置状态</th><th>口径版本</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="device in devices" :key="device.id" :class="`row-grade-${device.current.grade}`">
          <td>{{ device.code }}<span v-if="device.current.pressureImputed" class="tag warn">缺值补判</span></td>
          <td>{{ device.unit }}</td>
          <td>{{ device.occurredAt }}</td>
          <td>{{ fmt(device.reported.pressureMPa, 'MPa') }}</td>
          <td>{{ device.measured?.pressureMPa === undefined || device.measured?.pressureMPa === null ? '—' : fmt(device.measured.pressureMPa, 'MPa') }}</td>
          <td>
            {{ device.effective.values.pressureMPa === null ? '缺失' : fmt(device.effective.values.pressureMPa, 'MPa') }}
            <span class="path-tag">{{ device.effective.fieldSource.pressureMPa ?? '缺值' }}</span>
          </td>
          <td>{{ fmt(device.effective.values.openingPct, '%') }} / {{ fmt(device.effective.values.openingLimitPct, '%') }}</td>
          <td>{{ fmt(device.effective.values.strokeMm, 'mm') }} / {{ fmt(device.effective.values.strokeLimitMm, 'mm') }}</td>
          <td>{{ device.current.openingRatio === null ? '—' : `${(device.current.openingRatio * 100).toFixed(1)}%` }}</td>
          <td :class="`grade-${device.current.grade}`">{{ device.current.grade }}</td>
          <td class="action-cell">{{ device.current.action }}</td>
          <td>{{ device.current.status }}</td>
          <td>{{ device.current.version }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openCalibration(device)">安排校验</button>
            <button class="link" type="button" @click="openHistory(device)">结论沿革</button>
            <button
              v-if="!device.current.manuallyDisabled && (device.current.grade === '异常' || device.current.grade === '严重')"
              class="link danger"
              type="button"
              @click="disable(device)"
            >
              停用装置
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 缺值单列 -->
    <table v-else-if="activeTab === 'missing'" class="data-table">
      <thead>
        <tr><th>装置编号</th><th>发生时间</th><th>缺失字段</th><th>状态</th><th>补测关闭时间</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in missing" :key="item.id">
          <td>{{ item.deviceCode }}</td>
          <td>{{ item.occurredAt }}</td>
          <td>{{ item.fields.join('、') }}</td>
          <td :class="item.resolved ? 'ok-text' : 'error-text'">{{ item.resolved ? '已补测关闭' : '待补测' }}</td>
          <td>{{ item.resolvedAt ?? '—' }}</td>
          <td>{{ item.note }}</td>
        </tr>
        <tr v-if="!missing.length"><td colspan="6" class="empty-state">没有缺值记录</td></tr>
      </tbody>
    </table>

    <!-- 校验受理记录 -->
    <table v-else-if="activeTab === 'calibrations'" class="data-table">
      <thead>
        <tr><th>装置编号</th><th>班次</th><th>提交人</th><th>提交时间</th><th>实测油压</th><th>到顶比</th><th>复判等级</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in calibrations" :key="item.id">
          <td>{{ item.deviceCode }}</td>
          <td>{{ item.shiftLabel }}</td>
          <td>{{ item.operator }}</td>
          <td>{{ item.submittedAt }}</td>
          <td>{{ fmt(item.reading.pressureMPa, 'MPa') }}</td>
          <td>{{ `${(Math.max((item.reading.openingPct ?? 0) / (item.reading.openingLimitPct ?? 1), (item.reading.strokeMm ?? 0) / (item.reading.strokeLimitMm ?? 1)) * 100).toFixed(1)}%` }}</td>
          <td :class="`grade-${item.gradeAfter}`">{{ item.gradeAfter }}</td>
        </tr>
        <tr v-if="!calibrations.length"><td colspan="7" class="empty-state">本班/本班次尚无校验受理记录（同机同班次重复提交只认第一次）</td></tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ devices.length }} 台调速器 · 数据与结论同事务落库，提交前对账不过则整笔退回</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <CalibrationDialog :device="calibrationDevice" @close="calibrationDevice = null" @done="onCalibrationDone" />
    <HistoryDialog :device="historyDevice" @close="historyDevice = null" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  disableDevice,
  downloadCsv,
  exportGovernorCsv,
  exportReconcileCsv,
  listCalibrations,
  listDevices,
  listMissing,
  migrationInfo,
  reconcile,
  resetDomain,
  switchVersion,
  thresholdVersions,
} from '@/api/governor-service'
import { GRADE_ACTION, type Grade } from '@/domain/governor/rules'
import type { GovernorDevice } from '@/domain/governor/state'
import CalibrationDialog from './components/CalibrationDialog.vue'
import HistoryDialog from './components/HistoryDialog.vue'

const versions = thresholdVersions()
const activeTab = ref<'judgments' | 'missing' | 'calibrations'>('judgments')
const calibrationDevice = ref<GovernorDevice | null>(null)
const historyDevice = ref<GovernorDevice | null>(null)
const message = ref('')
const messageOk = ref(false)

// 页面每次交互都从同一份落库状态现算，保证待办、台账、台数永远对得上。
const devices = ref(listDevices())
const missing = ref(listMissing())
const calibrations = ref(listCalibrations())
const migration = ref(migrationInfo())
const report = ref(reconcile())
const state = computed(() => ({ ruleVersion: report.value.ruleVersion }))
const activeSpec = computed(() => versions.find((item) => item.version === state.value.ruleVersion) ?? versions[0])

function refresh() {
  devices.value = listDevices()
  missing.value = listMissing()
  calibrations.value = listCalibrations()
  migration.value = migrationInfo()
  report.value = reconcile()
}

function notify(text: string, ok: boolean) {
  message.value = text
  messageOk.value = ok
}

const statsCards = computed(() => [
  { label: '调速器总台数', value: report.value.total, cls: '' },
  { label: '正常', value: report.value.normal, cls: 'grade-正常' },
  { label: '待校验（关注）', value: report.value.attention, cls: 'grade-关注' },
  { label: '异常装置（异常+严重）', value: report.value.abnormal, cls: 'grade-异常' },
  { label: '人工停用', value: report.value.disabled, cls: '' },
  { label: '缺值未补', value: report.value.missingOpen, cls: 'grade-关注' },
])

const tabs = computed(() => [
  { key: 'judgments' as const, label: '统一判定清单', count: null },
  { key: 'missing' as const, label: '缺值单列', count: report.value.missingOpen },
  { key: 'calibrations' as const, label: '校验受理记录', count: calibrations.value.length },
])

const pressureTable = computed(() => {
  const p = activeSpec.value.pressure
  const rows: { grade: Grade; lower: string; upper: string; action: string }[] = [
    { grade: '严重', lower: '—', upper: `≤ ${p.accidentLow}Pr`, action: GRADE_ACTION['严重'] },
    { grade: '异常', lower: `> ${p.accidentLow}Pr`, upper: `≤ ${p.abnormalLow}Pr`, action: GRADE_ACTION['异常'] },
    { grade: '关注', lower: `> ${p.abnormalLow}Pr`, upper: `< ${p.normalLow}Pr`, action: GRADE_ACTION['关注'] },
    { grade: '正常', lower: `≥ ${p.normalLow}Pr`, upper: `≤ ${p.normalHigh}Pr`, action: GRADE_ACTION['正常'] },
    { grade: '关注', lower: `> ${p.normalHigh}Pr`, upper: `≤ ${p.abnormalHigh}Pr`, action: GRADE_ACTION['关注'] },
    { grade: '异常', lower: `> ${p.abnormalHigh}Pr`, upper: `≤ ${p.overHigh}Pr`, action: GRADE_ACTION['异常'] },
    { grade: '严重', lower: `> ${p.overHigh}Pr`, upper: '—（硬上限）', action: GRADE_ACTION['严重'] },
  ]
  return rows
})

const openingTable = computed(() => {
  const o = activeSpec.value.opening
  return [
    { grade: '正常' as Grade, condition: `到顶比 &lt; ${o.limitReached * 100}%`, action: GRADE_ACTION['正常'] },
    { grade: '关注' as Grade, condition: `${o.limitReached * 100}% ≤ 到顶比 ≤ ${o.overLimit * 100}%（顶到限位）`, action: GRADE_ACTION['关注'] },
    { grade: '异常' as Grade, condition: `到顶比 &gt; ${o.overLimit * 100}%`, action: GRADE_ACTION['异常'] },
    { grade: '严重' as Grade, condition: `到顶比 &gt; ${o.hardUpper * 100}%（硬上限）`, action: GRADE_ACTION['严重'] },
  ]
})

function fmt(value: number | null, unit: string): string {
  return value === null ? '—' : `${value}${unit}`
}

function openCalibration(device: GovernorDevice) {
  calibrationDevice.value = device
}

function openHistory(device: GovernorDevice) {
  historyDevice.value = device
}

function onCalibrationDone() {
  refresh()
  const device = calibrationDevice.value
  calibrationDevice.value = null
  if (device) {
    const latest = listDevices().find((item) => item.id === device.id)
    notify(`校验已受理：${device.code} 复判为「${latest?.current.grade ?? '—'}」，异常台数与待办已同步`, true)
  }
}

function disable(device: GovernorDevice) {
  const result = disableDevice(device.id)
  refresh()
  notify(result.message, result.ok)
}

function changeVersion(version: string) {
  const result = switchVersion(version)
  refresh()
  notify(result.message, result.ok)
}

function exportList() {
  downloadCsv(exportGovernorCsv())
}

function exportReconcile() {
  downloadCsv(exportReconcileCsv())
}

function resetAll() {
  resetDomain()
  refresh()
  notify('已重置为两纸并轨初始状态（存量按发生时间重新迁移）', true)
}
</script>

<style scoped>
.rule-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
.rule-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.rule-note { color: var(--muted); font-size: 12px; margin-left: 10px; }
.version-switch { display: flex; align-items: center; gap: 6px; }
.switch-label { font-size: 12px; color: var(--muted); }
.rule-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px; }
.rule-grid h4 { margin: 0 0 6px; font-size: 13px; }
.mini-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mini-table th, .mini-table td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.action-cell { color: var(--muted); }
.impute-note { font-size: 12px; color: #b54708; margin: 8px 0 0; }
.path-rule { margin-top: 10px; font-size: 12px; background: #eef4ff; border-radius: 6px; padding: 6px 10px; }
.reconcile-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; }
.reconcile-bar.ok { background: #ecfdf3; color: #067647; border: 1px solid #abefc6; }
.reconcile-bar.bad { background: #fef3f2; color: #b42318; border: 1px solid #fda29b; }
.check-pill { background: rgba(255, 255, 255, 0.7); border-radius: 999px; padding: 2px 10px; }
.check-pill.fail { background: #fee4e2; }
.tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.tab { border: 1px solid var(--border); background: #fff; border-bottom: none; border-radius: 6px 6px 0 0; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.tab.active { background: var(--brand); color: #fff; border-color: var(--brand); }
.tab-count { display: inline-block; margin-left: 6px; background: rgba(0, 0, 0, 0.08); border-radius: 999px; padding: 0 8px; font-size: 12px; }
.migration-note { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.tag { display: inline-block; border-radius: 4px; padding: 0 6px; font-size: 11px; margin-left: 4px; }
.tag.warn { background: #fffaeb; color: #b54708; }
.path-tag { display: inline-block; font-size: 11px; color: var(--muted); background: #f1f5f9; border-radius: 4px; padding: 0 6px; margin-left: 4px; }
.row-grade-关注 td { background: #fffaeb; }
.row-grade-异常 td { background: #fef3f2; }
.row-grade-严重 td { background: #fef3f2; font-weight: 600; }
:deep(.grade-正常) { color: #067647; font-weight: 600; }
:deep(.grade-关注) { color: #b54708; font-weight: 600; }
:deep(.grade-异常) { color: #b42318; font-weight: 600; }
:deep(.grade-严重) { color: #7a271a; font-weight: 700; }
:deep(.ok-text) { color: #067647; }
.link.danger { color: #b42318; }
</style>
