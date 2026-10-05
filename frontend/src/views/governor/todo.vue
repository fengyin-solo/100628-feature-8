<template>
  <section class="page" data-module="governor-todo">
    <header class="page-head">
      <div>
        <h2>检修班组 · 调速器校验待办</h2>
        <p class="page-desc">
          凡是在统一判定里判成「关注/待校验」的调速器，自动落到本班组这份待办清单；不在这里另判等级，
          结论只有调速器页面那一份。同一台同一班次重复提交校验只认第一次，后到按重复退回。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="downloadCsv(exportReconcileCsv())">导出对账与明细</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">本班组待安排校验（=调速器待校验台数）</span>
        <strong class="stat-value grade-关注">{{ todos.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">调速器异常装置台数（两处读数一致）</span>
        <strong class="stat-value grade-异常">{{ report.abnormal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">继电保护运行台账镜像台数</span>
        <strong class="stat-value grade-异常">{{ report.ledgerAbnormalCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">对账结果（{{ report.ruleVersion }}）</span>
        <strong class="stat-value" :class="report.matched ? 'grade-正常' : 'grade-异常'">
          {{ report.matched ? '一致' : '不一致' }}
        </strong>
      </article>
    </div>

    <h3 class="block-title">待办清单（按发生时间）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>装置编号</th><th>所属机组</th><th>发生时间</th><th>待判等级</th><th>建议动作</th>
          <th>油压判定原因</th><th>开度判定原因</th><th>口径版本</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in todos" :key="item.deviceId" class="row-grade-关注">
          <td>{{ item.code }}</td>
          <td>{{ item.unit }}</td>
          <td>{{ item.occurredAt }}</td>
          <td class="grade-关注">{{ item.grade }}</td>
          <td>{{ item.action }}</td>
          <td>{{ item.pressureReason }}</td>
          <td>{{ item.openingReason }}</td>
          <td>{{ item.version }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openCalibration(item.deviceId)">录入实测 / 提交校验</button>
          </td>
        </tr>
        <tr v-if="!todos.length">
          <td colspan="9" class="empty-state">暂无待校验装置：待办与调速器页面的「待校验」台数实时一致</td>
        </tr>
      </tbody>
    </table>

    <h3 class="block-title">本班校验受理记录（重复提交在此可见，只保留第一次受理）</h3>
    <table class="data-table">
      <thead>
        <tr><th>装置编号</th><th>班次</th><th>提交人</th><th>提交时间</th><th>实测油压</th><th>复判等级</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in calibrations" :key="item.id">
          <td>{{ item.deviceCode }}</td>
          <td>{{ item.shiftLabel }}</td>
          <td>{{ item.operator }}</td>
          <td>{{ item.submittedAt }}</td>
          <td>{{ item.reading.pressureMPa }}MPa</td>
          <td :class="`grade-${item.gradeAfter}`">{{ item.gradeAfter }}</td>
        </tr>
        <tr v-if="!calibrations.length"><td colspan="6" class="empty-state">尚无受理记录</td></tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>校验提交后按现场实测值复判，油压异常等级跟着回落，本页台数、调速器页、继电保护台账同步变化</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <CalibrationDialog :device="calibrationDevice" @close="calibrationDevice = null" @done="onDone" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  downloadCsv,
  exportReconcileCsv,
  listCalibrations,
  listDevices,
  listTodos,
  reconcile,
  type TodoItem,
} from '@/api/governor-service'
import type { GovernorDevice } from '@/domain/governor/state'
import CalibrationDialog from '@/views/governor/components/CalibrationDialog.vue'

const todos = ref<TodoItem[]>(listTodos())
const calibrations = ref(listCalibrations())
const report = ref(reconcile())
const calibrationDevice = ref<GovernorDevice | null>(null)
const message = ref('')
const messageOk = ref(false)

const todoDevices = computed(() => listDevices())

function refresh() {
  todos.value = listTodos()
  calibrations.value = listCalibrations()
  report.value = reconcile()
}

function openCalibration(deviceId: number) {
  calibrationDevice.value = todoDevices.value.find((device) => device.id === deviceId) ?? null
}

function onDone() {
  const code = calibrationDevice.value?.code ?? ''
  calibrationDevice.value = null
  refresh()
  message.value = `${code} 校验已受理，待办与异常台数已同步回落/更新`
  messageOk.value = true
}
</script>

<style scoped>
.block-title { font-size: 14px; margin: 16px 0 8px; }
.row-grade-关注 td { background: #fffaeb; }
:deep(.grade-正常) { color: #067647; font-weight: 600; }
:deep(.grade-关注) { color: #b54708; font-weight: 600; }
:deep(.grade-异常) { color: #b42318; font-weight: 600; }
:deep(.ok-text) { color: #067647; }
</style>
