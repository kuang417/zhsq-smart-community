<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">运营中心</h2>
      <div class="page-desc">订阅合同管理（签约 / 试用 / 到期预警 / 终止）、设备与处置指标、运营看板（用户数、模块使用量）；仅区级管理员可见（F10-1~F10-3）。</div>
      <StatCards :items="kpis" />
    </div>

    <div class="grid-ops">
      <div class="page-card"><h3 class="section-title">模块使用量</h3><EChart :option="moduleOption" height="250px" /></div>
      <div class="page-card"><h3 class="section-title">运营指标趋势（近 7 日）</h3><EChart :option="trendOption" height="250px" /></div>
      <div class="page-card"><h3 class="section-title">合同状态分布</h3><EChart :option="contractOption" height="250px" /></div>
    </div>

    <div class="page-card" v-if="expiring.length">
      <h3 class="section-title">⚠ 合同到期预警</h3>
      <el-table :data="expiring" size="small" border>
        <el-table-column prop="code" label="合同编号" width="150" />
        <el-table-column prop="party" label="签约方" minWidth="220" />
        <el-table-column prop="endDate" label="到期日期" width="130" />
        <el-table-column prop="status" label="状态" width="120"><template #default="{ row }"><el-tag size="small" type="danger">{{ row.status }}</el-tag></template></el-table-column>
      </el-table>
    </div>

    <CrudTable resource="contracts" title="订阅合同" :columns="cols" :filters="filters" :form-fields="fields" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import StatCards from '@/components/StatCards.vue'
import EChart from '@/components/EChart.vue'
import CrudTable from '@/components/CrudTable.vue'

const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const d = ref({ contracts: [], moduleUsage: [], usageTrend: [], contractStatus: [], onlineRate: 0, avgHandleHours: 0, users: 0, expiring: 0 })
const kpis = computed(() => [
  { name: '设备在线率', value: d.value.onlineRate, unit: '%' },
  { name: '告警平均处置时长', value: d.value.avgHandleHours, unit: '小时' },
  { name: '平台用户数', value: d.value.users, unit: '个' },
  { name: '订阅合同', value: d.value.contracts.length, unit: '份' },
  { name: '到期预警', value: d.value.expiring, unit: '份' }
])
const expiring = computed(() => d.value.contracts.filter((c) => c.status === '到期预警'))
const moduleOption = computed(() => ({
  tooltip: { trigger: 'axis' }, grid: { left: 90, right: 22, top: 10, bottom: 22 },
  xAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f8' } }, axisLabel: { fontSize: 10 } },
  yAxis: { type: 'category', data: d.value.moduleUsage.map((x) => x.name), axisLabel: { fontSize: 10 } },
  series: [{ type: 'bar', data: d.value.moduleUsage.map((x) => x.value), barWidth: '58%',
    itemStyle: { color: '#3b82f6', borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', fontSize: 9 } }]
}))
const trendOption = computed(() => ({
  tooltip: { trigger: 'axis' }, legend: { right: 8, data: ['访问量', '用户数'] }, grid: { left: 42, right: 14, top: 28, bottom: 24 },
  xAxis: { type: 'category', data: d.value.usageTrend.map((x) => x.day), axisLabel: { fontSize: 10 } },
  yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f8' } } },
  series: [
    { name: '访问量', type: 'line', smooth: true, data: d.value.usageTrend.map((x) => x.pv), itemStyle: { color: '#1d4ed8' }, areaStyle: { color: 'rgba(29,78,216,.12)' } },
    { name: '用户数', type: 'line', smooth: true, data: d.value.usageTrend.map((x) => x.uv), itemStyle: { color: '#0ea5e9' } }
  ]
}))
const contractOption = computed(() => ({
  color: ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444'], tooltip: { trigger: 'item' }, legend: { bottom: 0 },
  series: [{ type: 'pie', radius: ['40%', '66%'], center: ['50%', '44%'], data: d.value.contractStatus }]
}))
const cols = [
  { prop: 'code', label: '合同编号', width: 150 }, { prop: 'party', label: '签约方', minWidth: 220 },
  { prop: 'status', label: '状态', width: 120, type: 'status' }, { prop: 'amount', label: '合同金额(元)', width: 140, type: 'num' },
  { prop: 'startDate', label: '开始日期', width: 120 }, { prop: 'endDate', label: '到期日期', width: 120 },
  { prop: 'modules', label: '订阅模块数', width: 120 }, { prop: 'contact', label: '联系人', width: 100 },
  { prop: 'phone', label: '联系电话（脱敏）', width: 150 }
]
const filters = [{ prop: 'status', label: '合同状态', type: 'select', options: opts(['签约', '试用', '到期预警', '终止']) }]
const fields = [
  { prop: 'party', label: '签约方', required: true },
  { prop: 'status', label: '状态', type: 'select', options: opts(['签约', '试用', '到期预警', '终止']) },
  { prop: 'amount', label: '合同金额(元)', type: 'number' }, { prop: 'startDate', label: '开始日期', placeholder: 'YYYY-MM-DD' },
  { prop: 'endDate', label: '到期日期', placeholder: 'YYYY-MM-DD' }, { prop: 'modules', label: '订阅模块数', type: 'number' },
  { prop: 'contact', label: '联系人' }, { prop: 'phone', label: '联系电话' }
]
onMounted(async () => { d.value = await api.opsStats() })
</script>
