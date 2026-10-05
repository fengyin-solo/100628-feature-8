<template>
  <section class="page" data-module="maintenance-todo">
    <header class="page-head">
      <div>
        <h2>检修班组待办 · 调速器校验入口</h2>
        <p class="page-desc">
          调速器判成 L3/L4 的装置自动落到这里；提交复测校验后按当前口径重判，等级回落即关闭待办。
          同一台装置同一班次只认第一次提交，后到的按重复退回。
        </p>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待校验待办（=异常装置台数）</span>
        <strong class="stat-value">{{ rec.openVerifyTodos }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">通道校验待办（L2，不计异常）</span>
        <strong class="stat-value">{{ rec.openChannelTodos }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">保护台账镜像</span>
        <strong class="stat-value">{{ rec.ledgerCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">调速器页异常台数</span>
        <strong class="stat-value">{{ rec.abnormalCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item" :class="{ ok: rec.consistent }">
        两处读数：调速器 {{ rec.abnormalCount }} 台 ＝ 本入口待办 {{ rec.openVerifyTodos }} 条 ＝ 保护台账 {{ rec.ledgerCount }} 条
        {{ rec.consistent ? '✓ 对得上' : '✗ 对不上，事务退回' }}
      </span>
    </p>

    <JudgeForm
      v-if="formOpen"
      :devices="state.devices"
      kind="verify"
      :locked-device="lockedDevice"
      hint="复测实测值决定等级：好转回落、待办关闭；同班重复提交只认第一次。"
      @submit="handleVerify"
      @cancel="formOpen = false"
    />
    <p v-else class="page-actions">
      <button class="btn primary" type="button" @click="openForm('')">登记一次校验提交</button>
    </p>
    <p v-if="message" :class="messageOk ? 'ok-text' : 'error-text'" class="form-message">{{ message }}</p>

    <h3>待办清单（另一个入口看到的待校验装置）</h3>
    <table class="data-table">
      <thead>
        <tr><th>待办号</th><th>装置</th><th>机组</th><th>类型</th><th>等级</th><th>来源/原因</th><th>产生时间</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="todo in state.todos.slice().reverse()" :key="todo.id">
          <td>{{ todo.id }}</td>
          <td>{{ todo.deviceId }}</td>
          <td>{{ unitOf(todo.deviceId) }}</td>
          <td>{{ todo.kind }}</td>
          <td :class="gradeClass(todo.grade)">{{ gradeLabel(todo.grade) }}</td>
          <td class="action-cell">{{ todo.reason }}</td>
          <td>{{ todo.createdAt }}</td>
          <td>{{ todo.open ? '待处理' : `已关闭 ${todo.closedAt ?? ''}` }}</td>
          <td>
            <button v-if="todo.open && todo.kind === '待校验'" class="link" type="button" @click="openForm(todo.deviceId)">
              去校验
            </button>
            <span v-else-if="todo.open">等通道复测</span>
            <span v-else>—</span>
          </td>
        </tr>
      </tbody>
    </table>

    <h3>校验提交记录（含重复退回）</h3>
    <table class="data-table">
      <thead>
        <tr><th>#</th><th>装置</th><th>班次</th><th>提交时间</th><th>提交人</th><th>复测油压</th><th>复测行程</th><th>等级变化</th><th>受理结果</th></tr>
      </thead>
      <tbody>
        <tr v-for="s in state.submissions.slice().reverse()" :key="s.id" :class="{ rejected: !s.accepted }">
          <td>{{ s.id }}</td>
          <td>{{ s.deviceId }}</td>
          <td>{{ s.shiftDate }} {{ s.shift }}</td>
          <td>{{ s.submittedAt }}</td>
          <td>{{ s.operator }}</td>
          <td>{{ s.pressureLocal === null ? '缺' : `${s.pressureLocal} MPa` }}</td>
          <td>{{ s.strokeTau === null ? '缺' : `${s.strokeTau}%` }}</td>
          <td>
            <template v-if="s.accepted">
              {{ s.gradeBefore === null ? '—' : gradeLabel(s.gradeBefore) }} →
              <strong :class="gradeClass(s.gradeAfter ?? 1)">{{ s.gradeAfter === null ? '—' : gradeLabel(s.gradeAfter) }}</strong>
            </template>
            <span v-else>未重判</span>
          </td>
          <td :class="s.accepted ? 'ok-text' : 'error-text'">
            {{ s.accepted ? '受理（第一次）' : `重复退回：${s.rejectReason ?? ''}` }}
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import JudgeForm from '@/views/governor/JudgeForm.vue'
import { GRADE_LABEL } from '@/domain/governor/rules'
import type { Grade } from '@/domain/governor/rules'
import { getState, reconcile, submitVerification } from '@/domain/governor/store'
import type { GovernorState } from '@/domain/governor/store'

const state = ref<GovernorState>(getState())
const rec = ref(reconcile())
const formOpen = ref(false)
const lockedDevice = ref('')
const message = ref('')
const messageOk = ref(true)

function unitOf(deviceId: string): string {
  return state.value.devices.find((item) => item.id === deviceId)?.unit ?? '—'
}
function gradeLabel(g: Grade): string {
  return GRADE_LABEL[g]
}
function gradeClass(g: Grade): string {
  return `g${g}`
}

function refresh(): void {
  state.value = getState()
  rec.value = reconcile()
}

function openForm(deviceId: string): void {
  lockedDevice.value = deviceId
  formOpen.value = true
  message.value = ''
}

function handleVerify(payload: {
  deviceId: string
  time: string
  operator: string
  pressureLocal: number | null
  pressureRemote: number | null
  strokeTau: number | null
  vaneTau: number | null
  fullLoadCommand: boolean
}): void {
  const result = submitVerification(payload.deviceId, payload.time, payload.operator, {
    pressureLocal: payload.pressureLocal,
    pressureRemote: payload.pressureRemote,
    strokeTau: payload.strokeTau,
    vaneTau: payload.vaneTau,
    fullLoadCommand: payload.fullLoadCommand,
  })
  messageOk.value = result.ok
  message.value = result.message
  if (result.ok) formOpen.value = false
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.g1 { color: #067647; }
.g2 { color: #b54708; }
.g3 { color: #b42318; }
.g4 { color: #7a271a; background: #fee4e2; }
.ok-text { color: #067647; }
.error-text { color: #b42318; }
.form-message { font-size: 13px; margin: 0 0 10px; }
.action-cell { max-width: 320px; }
tr.rejected td { background: #fef3f2; }
.legend-item.ok { background: #dcfae6; }
</style>
