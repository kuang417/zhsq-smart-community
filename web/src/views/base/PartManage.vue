<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">部件管理</h2>
      <div class="page-desc">八类部件（摄像头、路灯、健身器材、宣传栏、垃圾桶、消防设施、井盖、其他）；每条含经纬度与状态，支持地图点位关联展示（F3-9）。</div>
      <div class="mini-stats">
        <div v-for="t in typeStats" :key="t.name" class="mini-stat"><div class="v">{{ t.value }}</div><div class="n">{{ t.name }}</div></div>
      </div>
    </div>
    <div class="grid-cols-2">
      <div class="page-card">
        <h3 class="section-title">部件点位图（ECharts 自绘）</h3>
        <EChart :option="option" height="320px" @chart-click="onPoint" />
        <div class="muted" style="margin-top:6px">点击点位查看部件详情；经纬度取自部件主数据，区域按当前角色权限过滤。</div>
      </div>
      <div class="page-card">
        <h3 class="section-title">部件状态分布</h3>
        <EChart :option="statusOption" height="320px" />
      </div>
    </div>
    <CrudTable resource="parts" title="部件台账" :columns="cols" :filters="filters" :form-fields="fields" />
    <el-dialog v-model="visible" title="部件详情" width="400px">
      <el-descriptions :column="1" border size="small" v-if="current">
        <el-descriptions-item label="部件名称">{{ current.name }}</el-descriptions-item>
        <el-descriptions-item label="部件类型">{{ current.type }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ current.status }}</el-descriptions-item>
        <el-descriptions-item label="经纬度">{{ current.lng }}, {{ current.lat }}</el-descriptions-item>
        <el-descriptions-item label="网格编码">{{ current.gridCode }}</el-descriptions-item>
        <el-descriptions-item label="安装日期">{{ current.installDate }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import CrudTable from '@/components/CrudTable.vue'
import EChart from '@/components/EChart.vue'
import { escHtml } from '@/utils/esc'

const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const TYPE_LIST = ['摄像头', '路灯', '健身器材', '宣传栏', '垃圾桶', '消防设施', '井盖', '其他']
const parts = ref([])
const typeStats = ref(TYPE_LIST.map((name) => ({ name, value: 0 })))
const visible = ref(false)
const current = ref(null)
const onPoint = (p) => { if (p.data?.raw) { current.value = p.data.raw; visible.value = true } }

const option = computed(() => {
  const statuses = ['正常', '故障', '维修中', '待更换']
  const colors = { 正常: '#22c55e', 故障: '#ef4444', 维修中: '#f59e0b', 待更换: '#94a3b8' }
  return {
    // p.data.raw 在 legend hover 等场景不存在，必须可选链兜底，否则 tooltip 直接抛错
    tooltip: { formatter: (p) => `${escHtml(p.data?.raw?.name || '')}<br/>类型：${escHtml(p.data?.raw?.type || '')}<br/>状态：${escHtml(p.data?.raw?.status || '')}` },
    legend: { data: statuses, bottom: 0, textStyle: { fontSize: 10 } },
    grid: { left: 55, right: 20, top: 16, bottom: 34 },
    xAxis: { type: 'value', name: '经度', min: 108.27, max: 108.37, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: '#eef2f8' } } },
    yAxis: { type: 'value', name: '纬度', min: 22.77, max: 22.87, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: '#eef2f8' } } },
    series: statuses.map((s) => ({
      name: s, type: 'scatter', symbolSize: 7,
      itemStyle: { color: colors[s], opacity: .82 },
      data: parts.value.filter((p) => p.status === s).map((p) => ({ value: [p.lng, p.lat], raw: p }))
    }))
  }
})
const statusOption = computed(() => ({
  color: ['#22c55e', '#ef4444', '#f59e0b', '#94a3b8'], tooltip: { trigger: 'item' },
  legend: { bottom: 0, textStyle: { fontSize: 10 } },
  series: [{ type: 'pie', radius: ['42%', '68%'], center: ['50%', '44%'],
    data: ['正常', '故障', '维修中', '待更换'].map((s) => ({ name: s, value: parts.value.filter((p) => p.status === s).length })) }]
}))
const cols = [
  { prop: 'name', label: '部件名称', minWidth: 150 }, { prop: 'type', label: '类型', width: 120, type: 'tag' },
  { prop: 'status', label: '状态', width: 100, type: 'status' }, { prop: 'lng', label: '经度', width: 120 },
  { prop: 'lat', label: '纬度', width: 120 }, { prop: 'gridCode', label: '网格编码', width: 140 },
  { prop: 'installDate', label: '安装日期', width: 120 }
]
const filters = [
  { prop: 'type', label: '部件类型', type: 'select', options: opts(TYPE_LIST) },
  { prop: 'status', label: '状态', type: 'select', options: opts(['正常', '故障', '维修中', '待更换']) },
  { prop: 'gridCode', label: '网格', type: 'grid' }
]
const fields = [
  { prop: 'name', label: '部件名称', required: true },
  { prop: 'type', label: '类型', type: 'select', options: opts(TYPE_LIST) },
  { prop: 'status', label: '状态', type: 'select', options: opts(['正常', '故障', '维修中', '待更换']) },
  { prop: 'gridCode', label: '网格编码', required: true },
  { prop: 'lng', label: '经度' }, { prop: 'lat', label: '纬度' }
]
onMounted(async () => {
  const d = await api.list('parts', { pageSize: 500 })
  parts.value = d.records
  typeStats.value = TYPE_LIST.map((name) => ({ name, value: d.records.filter((p) => p.type === name).length }))
})
</script>
