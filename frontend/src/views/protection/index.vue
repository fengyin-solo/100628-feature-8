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

    <section class="link-panel">
      <header class="link-head">
        <h3>运行台账联动 · 调速器异常装置</h3>
        <span :class="rec.consistent ? 'ok-text' : 'error-text'">
          {{ rec.consistent ? '跨模块台数一致 ✓' : '台数不一致（事务已拦截）✗' }}
        </span>
      </header>
      <p class="link-count">
        调速器异常（L3/L4）<strong>{{ rec.abnormalCount }}</strong> 台 ＝ 检修待办
        <strong>{{ rec.openVerifyTodos }}</strong> 条 ＝ 本台账镜像 <strong>{{ rec.ledgerCount }}</strong> 条；
        缺值单列 {{ rec.missingOpen }} 台、通道校验 {{ rec.openChannelTodos }} 条（均不计异常台数）。
      </p>
      <table class="data-table">
        <thead>
          <tr><th>台账号</th><th>调速器</th><th>等级</th><th>建议动作（随判定同笔写入）</th><th>口径版本</th><th>发生时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in openLedger" :key="item.id">
            <td>{{ item.id }}</td>
            <td>{{ item.deviceId }}</td>
            <td :class="gradeClass(item.grade)">{{ gradeLabel(item.grade) }}</td>
            <td>{{ item.action }}</td>
            <td>{{ item.version }}</td>
            <td>{{ item.openedAt }}</td>
          </tr>
          <tr v-if="!openLedger.length">
            <td colspan="6" class="empty-state">当前无调速器异常镜像（台数 0，与调速器页一致）</td>
          </tr>
        </tbody>
      </table>
    </section>

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
import type { EntryRow } from '@/data/types'
import { GRADE_LABEL } from '@/domain/governor/rules'
import type { Grade } from '@/domain/governor/rules'
import { getState, reconcile } from '@/domain/governor/store'

const meta = moduleMeta('protection')
const columns = ["装置编号", "保护类型", "定值单号", "上次校验日", "下次校验日", "动作次数", "校验人员", "装置状态"]
const actions = ["提交校验", "标记异常", "退出运行"]
const statuses = ["待校验", "正常", "异常", "已退出"]

// 跨模块联动：调速器异常台数由统一结论库算出，与调速器页、检修待办同源
const governorState = ref(getState())
const rec = ref(reconcile())
const openLedger = computed(() => governorState.value.ledger.filter((item) => item.open))
const stats = computed(() => [
  { label: "正常保护装置", value: rows.value.filter((row) => String(row.status) === "正常").length },
  { label: "待校验装置", value: rows.value.filter((row) => String(row.status) === "待校验").length },
  { label: "调速器异常联动(L3/L4)", value: rec.value.abnormalCount },
])
function gradeLabel(g: Grade): string {
  return GRADE_LABEL[g]
}
function gradeClass(g: Grade): string {
  return `g${g}`
}

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
    governorState.value = getState()
    rec.value = reconcile()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '继电保护列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.link-panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.link-head { display: flex; justify-content: space-between; align-items: center; }
.link-head h3 { margin: 0 0 6px; font-size: 15px; }
.link-count { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.ok-text { color: #067647; }
.error-text { color: #b42318; }
.g3 { color: #b42318; }
.g4 { color: #7a271a; background: #fee4e2; }
</style>
