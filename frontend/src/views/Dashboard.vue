<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { reconcile as governorReconcile } from '@/api/governor-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])

function refresh() {
  const payload = loadOverview()
  // 调速器的台数以统一判定域为准：概览、调速器页、校验待办、继电保护台账读到的是同一份。
  const governor = governorReconcile()
  payload.modules = payload.modules.map((row) =>
    row.name === '调速器'
      ? { ...row, created: governor.total, pending: governor.attention, abnormal: governor.abnormal }
      : row,
  )
  const totals = payload.modules.reduce(
    (acc, row) => ({ created: acc.created + row.created, pending: acc.pending + row.pending, abnormal: acc.abnormal + row.abnormal }),
    { created: 0, pending: 0, abnormal: 0 },
  )
  payload.cards = payload.cards.map((card) => {
    if (card.label === '登记总量') return { ...card, value: totals.created }
    if (card.label === '待处理') return { ...card, value: totals.pending }
    if (card.label === '异常量') return { ...card, value: totals.abnormal }
    return card
  })
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

onMounted(refresh)
</script>
