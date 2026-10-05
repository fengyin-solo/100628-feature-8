<template>
  <section class="page" data-module="protection">
    <header class="page-head">
      <div>
        <h2>继电保护管理</h2>
        <p class="page-desc">维护保护装置，围绕装置编号、保护类型、定值单号、上次校验日做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记保护装置</button>
        <button class="btn" type="button" @click="exportRows">导出继电保护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无继电保护数据，可先登记保护装置</td>
        </tr>
      </tbody>
    </table>

    <h3 class="mirror-title">调速器异常装置运行台账（镜像调速器统一判定，跨模块台数一致）</h3>
    <p class="mirror-desc">
      本台账只镜像调速器那一份结论，不在这里另判；当前口径 {{ governorReport.ruleVersion }}，
      调速器异常装置 <strong :class="governorReport.abnormal === governorReport.ledgerAbnormalCount ? 'ok-text' : 'error-text'">{{ governorReport.abnormal }}</strong> 台，
      本台账镜像 <strong>{{ governorReport.ledgerAbnormalCount }}</strong> 台，
      {{ governorReport.matched ? '两处台数一致' : '台数不一致（请检查）' }}。
    </p>
    <table class="data-table mirror-table">
      <thead>
        <tr>
          <th>装置编号</th><th>所属机组</th><th>等级</th><th>装置状态</th><th>建议动作</th><th>口径版本</th><th>判定时间</th><th>命中原因</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in governorLedger" :key="row.deviceId">
          <td>{{ row.code }}</td>
          <td>{{ row.unit }}</td>
          <td :class="`grade-${row.grade}`">{{ row.grade }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.action }}</td>
          <td>{{ row.version }}</td>
          <td>{{ row.judgedAt }}</td>
          <td>{{ row.hitReason }}</td>
        </tr>
        <tr v-if="!governorLedger.length">
          <td colspan="8" class="empty-state">调速器当前没有异常装置，台账镜像为空</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条继电保护记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listAbnormalLedger, reconcile } from '@/api/governor-service'
import type { AbnormalLedgerRow } from '@/domain/governor/state'
import type { EntryRow } from '@/data/types'

const governorLedger = ref<AbnormalLedgerRow[]>(listAbnormalLedger())
const governorReport = ref(reconcile())

const meta = moduleMeta('protection')
const columns = ["装置编号", "保护类型", "定值单号", "上次校验日", "下次校验日", "动作次数", "校验人员", "装置状态"]
const actions = ["提交校验", "标记异常", "退出运行"]
const statuses = ["待校验", "正常", "异常", "已退出"]
const stats = [{"label": "正常保护装置", "value": 0}, {"label": "待校验装置", "value": 0}, {"label": "即将到期装置", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '保护装置登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    governorLedger.value = listAbnormalLedger()
    governorReport.value = reconcile()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '继电保护列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.mirror-title { font-size: 14px; margin: 20px 0 6px; }
.mirror-desc { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.mirror-table { margin-bottom: 8px; }
:deep(.grade-异常) { color: #b42318; font-weight: 600; }
:deep(.grade-严重) { color: #7a271a; font-weight: 700; }
:deep(.ok-text) { color: #067647; }
:deep(.error-text) { color: #b42318; }
</style>
