<template>
  <section class="page" data-module="governor">
    <header class="page-head">
      <div>
        <h2>调速器管理 · 油压与开度统一判定</h2>
        <p class="page-desc">
          口径 v{{ state.activeVersion }}（{{ activeMeta.effectiveAt }} 生效）：油压按 P/Pn 上下限分档，顶开度限位/行程到顶走同一套 L1~L4；
          一次判定一条结论，等级与建议动作同时给出。阈值见 <code>docs/governor-rules.md</code>。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="formKind = 'observe'">补录实测/判定</button>
        <button class="btn" type="button" @click="exportCsv">导出对账明细</button>
        <button class="btn ghost" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">异常装置（L3/L4，去重）</span>
        <strong class="stat-value">{{ rec.abnormalCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检修待办（待校验）</span>
        <strong class="stat-value">{{ rec.openVerifyTodos }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">保护台账镜像（打开）</span>
        <strong class="stat-value">{{ rec.ledgerCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">通道校验待办 / 缺值未补</span>
        <strong class="stat-value">{{ rec.openChannelTodos }} / {{ rec.missingOpen }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item" :class="{ ok: rec.consistent }">
        对账：{{ rec.consistent ? '三处台数一致 ✓' : '不一致，事务将被退回 ✗' }}（异常 {{ rec.abnormalCount }}＝待办 {{ rec.openVerifyTodos }}＝台账 {{ rec.ledgerCount }}）
      </span>
      <span class="legend-item">历史判定记录：{{ rec.historyCount }} 条（只追加不改写，注明口径版本）</span>
    </p>

    <div class="version-bar">
      <span>口径换版重算：</span>
      <button
        v-for="tv in versions"
        :key="tv.version"
        class="btn"
        :class="{ primary: tv.version === state.activeVersion }"
        type="button"
        :title="tv.note"
        @click="switchVersion(tv.version)"
      >
        {{ tv.version }}（{{ tv.effectiveAt }}）{{ tv.version === state.activeVersion ? '·生效中' : '' }}
      </button>
      <span class="version-note">换版按新口径重算在运装置；既有结论保留当时等级并注明版本。</span>
    </div>

    <JudgeForm
      v-if="formKind"
      :devices="state.devices"
      :kind="formKind"
      :hint="formKind === 'verify' ? '校验必须带复测实测值；同装置同班次第二次提交按重复退回，等级随复测值回落。' : '取值以现场实测（路径A）为准；与远传偏差>5% 以实测定级并挂通道校验。'"
      @submit="handleSubmit"
      @cancel="formKind = null"
    />

    <p v-if="message" :class="messageOk ? 'ok-text' : 'error-text'" class="form-message">{{ message }}</p>

    <h3>当前结论（每台装置一份，唯一取值）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>装置</th><th>机组</th><th>Pn</th><th>油压实测/远传</th><th>P/Pn</th>
          <th>行程/开度反馈 τ</th><th>工况</th><th>油压档</th><th>位置档</th><th>综合等级</th>
          <th>建议动作</th><th>口径</th><th>标记</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="device in state.devices" :key="device.id">
          <template v-if="device.status === '在运' && current[device.id]">
            <td>{{ device.id }}</td>
            <td>{{ device.unit }}</td>
            <td>{{ device.ratedPressure }}</td>
            <td>{{ fmt(current[device.id].pressureLocal) }} / {{ fmt(current[device.id].pressureRemote) }}</td>
            <td>{{ ratioText(current[device.id].ratio) }}</td>
            <td>{{ fmt(current[device.id].strokeTau, '%') }} / {{ fmt(current[device.id].vaneTau, '%') }}</td>
            <td>{{ current[device.id].fullLoadCommand ? '满发' : '非满发' }}</td>
            <td :class="gradeClass(current[device.id].pressureGrade)">{{ gradeLabel(current[device.id].pressureGrade) }}</td>
            <td :class="gradeClass(current[device.id].positionGrade)">{{ gradeLabel(current[device.id].positionGrade) }}</td>
            <td :class="gradeClass(current[device.id].grade)"><strong>{{ gradeLabel(current[device.id].grade) }}</strong></td>
            <td class="action-cell">{{ current[device.id].action }}</td>
            <td>{{ current[device.id].version }}</td>
            <td>
              <span v-if="current[device.id].missing" class="tag warn">缺值</span>
              <span v-if="current[device.id].conflict" class="tag danger">路径冲突</span>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openVerify(device.id)">提交校验</button>
              <button class="link danger-link" type="button" @click="disable(device.id)">停用</button>
            </td>
          </template>
          <template v-else>
            <td>{{ device.id }}</td><td>{{ device.unit }}</td><td>{{ device.ratedPressure }}</td>
            <td colspan="10" class="empty-state">已停用：不判定、不计数，历史结论保留</td>
            <td>—</td>
          </template>
        </tr>
      </tbody>
    </table>

    <div class="two-col">
      <div>
        <h3>缺值清单（单独列示，不计异常台数，本班/24h 内补测）</h3>
        <table class="data-table">
          <thead><tr><th>编号</th><th>装置</th><th>缺项</th><th>发现时间</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="item in openMissing" :key="item.id">
              <td>{{ item.id }}</td><td>{{ item.deviceId }}</td><td>{{ item.field }}</td>
              <td>{{ item.openedAt }}</td><td>待补测（按 L2 档补判）</td>
            </tr>
            <tr v-if="!openMissing.length"><td colspan="5" class="empty-state">无未补测缺值</td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <h3>路径冲突（以实测为准，通道校验待办）</h3>
        <table class="data-table">
          <thead><tr><th>装置</th><th>实测油压</th><th>远传油压</th><th>实测行程</th><th>开度反馈</th><th>判定依据</th></tr></thead>
          <tbody>
            <tr v-for="c in conflictRows" :key="c.deviceId">
              <td>{{ c.deviceId }}</td><td>{{ fmt(c.pressureLocal) }}</td><td>{{ fmt(c.pressureRemote) }}</td>
              <td>{{ fmt(c.strokeTau, '%') }}</td><td>{{ fmt(c.vaneTau, '%') }}</td><td>统一取实测</td>
            </tr>
            <tr v-if="!conflictRows.length"><td colspan="6" class="empty-state">无路径冲突</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <h3>历史判定与校验流水（含迁移记录，保留当时等级与版本）</h3>
    <table class="data-table">
      <thead>
        <tr><th>#</th><th>装置</th><th>时间</th><th>等级</th><th>口径</th><th>来源</th><th>依据</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in recentHistory" :key="item.seq">
          <td>{{ item.seq }}</td><td>{{ item.deviceId }}</td><td>{{ item.judgedAt }}</td>
          <td :class="gradeClass(item.grade)">{{ gradeLabel(item.grade) }}</td>
          <td>{{ item.version }}</td>
          <td>{{ item.migrated ? '存量迁移' : '在线判定' }}</td>
          <td class="action-cell">{{ item.reasons.join('；') }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import JudgeForm from './JudgeForm.vue'
import {
  THRESHOLD_VERSIONS,
  GRADE_LABEL,
} from '@/domain/governor/rules'
import type { Grade } from '@/domain/governor/rules'
import {
  activateVersion,
  disableDevice,
  exportReconcileCsv,
  getState,
  recordObservation,
  reconcile,
  resetDomain,
  submitVerification,
} from '@/domain/governor/store'
import type { GovernorState } from '@/domain/governor/store'

const versions = THRESHOLD_VERSIONS
const state = ref<GovernorState>(getState())
const rec = ref(reconcile())
const formKind = ref<'observe' | 'verify' | null>(null)
const lockedDevice = ref('')
const message = ref('')
const messageOk = ref(true)

const activeMeta = computed(
  () => versions.find((item) => item.version === state.value.activeVersion) ?? versions[0],
)
const current = computed(() => state.value.current)
const openMissing = computed(() => state.value.missing.filter((item) => !item.resolved))
const conflictRows = computed(() =>
  Object.values(state.value.current).filter((item) => item.conflict),
)
const recentHistory = computed(() => [...state.value.history].slice(-12).reverse())

function gradeLabel(g: Grade): string {
  return GRADE_LABEL[g]
}
function gradeClass(g: Grade): string {
  return `g${g}`
}
function fmt(v: number | null, suffix = ''): string {
  return v === null || v === undefined ? '缺' : `${v}${suffix}`
}
function ratioText(r: number | null): string {
  return r === null ? '—' : r.toFixed(3)
}

function refresh(): void {
  state.value = getState()
  rec.value = reconcile()
}

function flash(ok: boolean, text: string): void {
  messageOk.value = ok
  message.value = text
}

function openVerify(deviceId: string): void {
  lockedDevice.value = deviceId
  formKind.value = 'verify'
  message.value = ''
}

function handleSubmit(payload: {
  deviceId: string
  time: string
  operator: string
  pressureLocal: number | null
  pressureRemote: number | null
  strokeTau: number | null
  vaneTau: number | null
  fullLoadCommand: boolean
}): void {
  const result =
    formKind.value === 'verify'
      ? submitVerification(payload.deviceId, payload.time, payload.operator, {
          pressureLocal: payload.pressureLocal,
          pressureRemote: payload.pressureRemote,
          strokeTau: payload.strokeTau,
          vaneTau: payload.vaneTau,
          fullLoadCommand: payload.fullLoadCommand,
        })
      : recordObservation(payload.deviceId, payload.time, {
          pressureLocal: payload.pressureLocal,
          pressureRemote: payload.pressureRemote,
          strokeTau: payload.strokeTau,
          vaneTau: payload.vaneTau,
          fullLoadCommand: payload.fullLoadCommand,
        })
  flash(result.ok, result.message)
  if (result.ok) {
    formKind.value = null
    lockedDevice.value = ''
  }
  refresh()
}

function disable(deviceId: string): void {
  const result = disableDevice(deviceId, new Date().toISOString().slice(0, 16).replace('T', ' '))
  flash(result.ok, result.message)
  refresh()
}

function switchVersion(version: string): void {
  const result = activateVersion(version)
  flash(result.ok, result.message)
  refresh()
}

function exportCsv(): void {
  const { filename, content } = exportReconcileCsv()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function resetAll(): void {
  state.value = resetDomain()
  refresh()
  flash(true, '已回到按存量记录迁移后的初始状态')
}

onMounted(refresh)
</script>

<style scoped>
.version-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; font-size: 13px; }
.version-note { color: var(--muted); font-size: 12px; }
.form-message { font-size: 13px; margin: 0 0 10px; }
.ok-text { color: #067647; }
.g1 { color: #067647; }
.g2 { color: #b54708; }
.g3 { color: #b42318; }
.g4 { color: #7a271a; background: #fee4e2; }
.tag { border-radius: 999px; padding: 1px 8px; font-size: 12px; margin-right: 4px; }
.tag.warn { background: #fef0c7; color: #b54708; }
.tag.danger { background: #fee4e2; color: #b42318; }
.action-cell { max-width: 260px; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
.danger-link { color: #b42318; }
code { background: #eef2f7; padding: 0 4px; border-radius: 4px; }
</style>
