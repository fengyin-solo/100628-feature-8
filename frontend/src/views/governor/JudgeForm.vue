<template>
  <form class="judge-form" @submit.prevent="submit">
    <div class="form-grid">
      <label>
        <span>装置编号</span>
        <select v-model="deviceId" :disabled="lockedDevice !== undefined">
          <option value="" disabled>请选择</option>
          <option v-for="device in devices" :key="device.id" :value="device.id">
            {{ device.id }}（{{ device.unit }} / Pn {{ device.ratedPressure }}MPa）
          </option>
        </select>
      </label>
      <label>
        <span>时间</span>
        <input v-model="time" type="datetime-local" required />
      </label>
      <label>
        <span>{{ kind === 'verify' ? '复测油压实测 MPa（路径A）' : '油压实测 MPa（路径A）' }}</span>
        <input v-model.number="pressureLocal" type="number" step="0.01" placeholder="缺值留空" />
      </label>
      <label>
        <span>油压远传 MPa（路径B）</span>
        <input v-model.number="pressureRemote" type="number" step="0.01" placeholder="缺值留空" />
      </label>
      <label>
        <span>接力器行程 τ %（路径A）</span>
        <input v-model.number="strokeTau" type="number" step="0.1" placeholder="缺值留空" />
      </label>
      <label>
        <span>导叶开度反馈 τ %（路径B）</span>
        <input v-model.number="vaneTau" type="number" step="0.1" placeholder="缺值留空" />
      </label>
      <label class="check-line">
        <input v-model="fullLoadCommand" type="checkbox" />
        <span>满发工况（开度指令≥95%，顶限位判正常）</span>
      </label>
      <label v-if="kind === 'verify'">
        <span>校验人</span>
        <input v-model="operator" required placeholder="检修班组人员" />
      </label>
    </div>
    <p v-if="hint" class="form-hint">{{ hint }}</p>
    <div class="form-actions">
      <button class="btn primary" type="submit">{{ kind === 'verify' ? '提交校验（同班重复自动退回）' : '按当前口径判定' }}</button>
      <button class="btn ghost" type="button" @click="$emit('cancel')">取消</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import type { GovernorDevice } from '@/domain/governor/seed'

const props = defineProps<{
  devices: GovernorDevice[]
  kind: 'observe' | 'verify'
  lockedDevice?: string
  hint?: string
}>()

const emit = defineEmits<{
  (e: 'submit', payload: {
    deviceId: string
    time: string
    operator: string
    pressureLocal: number | null
    pressureRemote: number | null
    strokeTau: number | null
    vaneTau: number | null
    fullLoadCommand: boolean
  }): void
  (e: 'cancel'): void
}>()

function nowLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const deviceId = ref(props.lockedDevice ?? '')
const time = ref(nowLocal())
const pressureLocal = ref<number | null>(null)
const pressureRemote = ref<number | null>(null)
const strokeTau = ref<number | null>(null)
const vaneTau = ref<number | null>(null)
const fullLoadCommand = ref(false)
const operator = ref('检修班组')

function num(v: number | null): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null
}

function submit() {
  if (!deviceId.value) return
  emit('submit', {
    deviceId: deviceId.value,
    time: time.value.replace('T', ' '),
    operator: operator.value,
    pressureLocal: num(pressureLocal.value),
    pressureRemote: num(pressureRemote.value),
    strokeTau: num(strokeTau.value),
    vaneTau: num(vaneTau.value),
    fullLoadCommand: fullLoadCommand.value,
  })
}
</script>

<style scoped>
.judge-form { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.form-grid label span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-grid input, .form-grid select { width: 100%; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.check-line { display: flex; align-items: center; gap: 6px; grid-column: span 2; }
.check-line input { width: auto; }
.form-hint { font-size: 12px; color: var(--muted); margin: 8px 0 0; }
.form-actions { margin-top: 10px; display: flex; gap: 8px; }
</style>
