<template>
  <div v-if="device" class="dialog-mask" @click.self="close">
    <div class="dialog">
      <header class="dialog-head">
        <h3>安排校验 · {{ device.code }}（{{ device.unit }}）</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>
      <p class="dialog-tip">
        班次 {{ session.shiftLabel }} · 提交人 {{ session.operator }}。同一台调速器同一班次只认第一次，后到的按重复退回；
        必须填报齐全现场实测三量，缺一项整笔退回。
      </p>
      <div class="form-grid">
        <label>
          <span>现场实测油压 (MPa)</span>
          <input v-model.number="form.pressureMPa" type="number" step="0.01" min="0" />
        </label>
        <label>
          <span>导叶开度 (%)</span>
          <input v-model.number="form.openingPct" type="number" step="0.1" min="0" />
        </label>
        <label>
          <span>开度限位 (%)</span>
          <input v-model.number="form.openingLimitPct" type="number" step="0.1" min="0" />
        </label>
        <label>
          <span>接力器行程 (mm)</span>
          <input v-model.number="form.strokeMm" type="number" step="0.1" min="0" />
        </label>
        <label>
          <span>行程上限 (mm)</span>
          <input v-model.number="form.strokeLimitMm" type="number" step="0.1" min="0" />
        </label>
      </div>
      <p class="path-note">两路读数打架时以现场实测这一份为准，提交后统一按实测值复判。</p>
      <footer class="dialog-foot">
        <span v-if="message" :class="ok ? 'ok-text' : 'error-text'">{{ message }}</span>
        <div>
          <button class="btn" type="button" @click="close">取消</button>
          <button class="btn primary" type="button" @click="submit">提交校验</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

import { submitGovernorCalibration, type ReadingValues } from '@/api/governor-service'
import type { GovernorDevice } from '@/domain/governor/state'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ device: GovernorDevice | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done'): void }>()

const session = useSessionStore()

function blankForm(): ReadingValues {
  return { pressureMPa: null, openingPct: null, openingLimitPct: null, strokeMm: null, strokeLimitMm: null }
}

const form = reactive<ReadingValues>(blankForm())
const message = ref('')
const ok = ref(false)

watch(
  () => props.device,
  (device) => {
    message.value = ''
    const next = blankForm()
    if (device) {
      // 默认带出已有的实测值，没有实测值再带填报值，方便现场核对后覆盖。
      const source = device.measured ?? device.reported
      next.pressureMPa = source.pressureMPa
      next.openingPct = source.openingPct
      next.openingLimitPct = source.openingLimitPct
      next.strokeMm = source.strokeMm
      next.strokeLimitMm = source.strokeLimitMm
    }
    Object.assign(form, next)
  },
  { immediate: true },
)

function shiftKey(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${today}|${session.shiftLabel}`
}

function close() {
  emit('close')
}

function toNumber(raw: number | string | null | undefined): number | null {
  if (raw === '' || raw === null || raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function submit() {
  if (!props.device) return
  const result = submitGovernorCalibration({
    deviceId: props.device.id,
    shiftKey: shiftKey(),
    shiftLabel: session.shiftLabel,
    operator: session.operator,
    reading: {
      pressureMPa: toNumber(form.pressureMPa),
      openingPct: toNumber(form.openingPct),
      openingLimitPct: toNumber(form.openingLimitPct),
      strokeMm: toNumber(form.strokeMm),
      strokeLimitMm: toNumber(form.strokeLimitMm),
    },
  })
  message.value = result.message
  ok.value = result.ok
  if (result.ok) {
    emit('done')
  }
}
</script>

<style scoped>
.dialog-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 20; }
.dialog { background: #fff; border-radius: 10px; width: 640px; max-width: calc(100vw - 32px); padding: 18px 20px; }
.dialog-head { display: flex; justify-content: space-between; align-items: center; }
.dialog-head h3 { margin: 0; font-size: 16px; }
.dialog-tip { font-size: 12px; color: var(--muted); margin: 8px 0 12px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.form-grid label span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-grid input { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; }
.path-note { font-size: 12px; color: var(--muted); margin: 10px 0 0; }
.dialog-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; }
.dialog-foot > div { display: flex; gap: 8px; }
.ok-text { color: #067647; font-size: 12px; }
</style>
