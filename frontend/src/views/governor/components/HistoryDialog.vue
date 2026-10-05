<template>
  <div v-if="device" class="dialog-mask" @click.self="close">
    <div class="dialog wide">
      <header class="dialog-head">
        <h3>判定结论沿革 · {{ device.code }}（{{ device.unit }}）</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>
      <p class="dialog-tip">
        换版重算与校验复判都只追加新结论：历史等级与所用口径版本全部保留，不覆盖；当前生效的是第一条。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>判定时间</th><th>触发</th><th>口径版本</th><th>当时等级</th><th>建议动作</th><th>油压判定</th><th>开度判定</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id">
            <td>{{ record.judgedAt }}</td>
            <td>{{ record.trigger }}</td>
            <td>{{ record.version }}</td>
            <td :class="gradeClass(record.grade)">{{ record.grade }}</td>
            <td>{{ record.action }}</td>
            <td>{{ record.pressureReason }}</td>
            <td>{{ record.openingReason }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { listHistory } from '@/api/governor-service'
import type { GovernorDevice, JudgmentRecord } from '@/domain/governor/state'
import type { Grade } from '@/domain/governor/rules'

const props = defineProps<{ device: GovernorDevice | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const records = computed<JudgmentRecord[]>(() => (props.device ? listHistory(props.device.id) : []))

function close() {
  emit('close')
}

function gradeClass(grade: Grade): string {
  return `grade-${grade}`
}
</script>

<style scoped>
.dialog-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 20; }
.dialog { background: #fff; border-radius: 10px; width: 640px; max-width: calc(100vw - 32px); padding: 18px 20px; max-height: 80vh; overflow: auto; }
.dialog.wide { width: 900px; }
.dialog-head { display: flex; justify-content: space-between; align-items: center; }
.dialog-head h3 { margin: 0; font-size: 16px; }
.dialog-tip { font-size: 12px; color: var(--muted); margin: 8px 0 12px; }
:deep(.grade-正常) { color: #067647; font-weight: 600; }
:deep(.grade-关注) { color: #b54708; font-weight: 600; }
:deep(.grade-异常) { color: #b42318; font-weight: 600; }
:deep(.grade-严重) { color: #7a271a; font-weight: 700; }
</style>
