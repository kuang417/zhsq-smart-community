<template>
  <div class="dark-view dark-view-full">
    <div class="dark-head">
      <div>
        <h1>智 慧 社 区 · 决 策 大 屏</h1>
        <div class="muted" style="color:#8fb4e6">当前时间 {{ clock }} ｜ 数据范围：{{ user?.orgName }} ｜ ECharts 自绘地图，三级下钻</div>
        <div class="data-stamp">统计口径：当前角色可见范围内已入库数据 ｜ 数据截至 {{ updatedAt || '加载中' }}（{{ liveLabel }}） ｜ {{ SCHEMATIC_MAP_NOTE }}</div>
        <div v-if="loadError" class="data-stamp" style="color:#fca5a5">数据加载失败：{{ loadError }} ｜ 请点击「刷新数据」重试</div>
      </div>
      <div class="flex gap8">
        <el-tag effect="dark" type="primary">{{ levelName }}</el-tag>
        <el-button size="small" :icon="'Refresh'" :loading="reloading" @click="reload">刷新数据</el-button>
        <el-button size="small" :disabled="level === 1" @click="drillUp">↑ 返回上级</el-button>
        <el-button size="small" @click="$router.push('/portal')">返回工作台</el-button>
      </div>
    </div>

    <!-- 顶部三大总数 -->
    <div class="grid-cols-3 mb12">
      <div v-for="t in bigNumbers" :key="t.name" class="panel-dark" style="text-align:center">
        <div style="font-size:13px;color:#8fb4e6;letter-spacing:2px">{{ t.name }}</div>
        <div style="font-size:34px;font-weight:800;color:#38bdf8;text-shadow:0 0 20px rgba(56,189,248,.5);font-variant-numeric:tabular-nums">{{ t.value.toLocaleString() }}</div>
      </div>
    </div>

    <div class="grid-side-250">
      <!-- 左列指标 -->
      <div>
        <div class="panel-dark mb12">
          <h3>数字党建（六项）</h3>
          <div class="dark-grid dark-kpi-cols">
            <div v-for="x in data.digitalParty" :key="x.name" class="dark-kpi"><div class="v">{{ fmt(x.value) }}</div><div class="n">{{ x.name }}</div></div>
          </div>
        </div>
        <div class="panel-dark mb12">
          <h3>一核多元（五项）</h3>
          <div class="dark-grid dark-kpi-cols">
            <div v-for="x in data.multiGovernance" :key="x.name" class="dark-kpi"><div class="v">{{ fmt(x.value) }}</div><div class="n">{{ x.name }}</div></div>
          </div>
        </div>
        <div class="panel-dark">
          <h3>网格微站（四项）</h3>
          <div class="dark-grid dark-kpi-cols">
            <div v-for="x in data.microStation" :key="x.name" class="dark-kpi"><div class="v">{{ fmt(x.value) }}</div><div class="n">{{ x.name }}</div></div>
          </div>
        </div>
      </div>

      <!-- 中间地图 -->
      <div>
        <div class="panel-dark mb12">
          <div class="flex gap8 mb12">
            <h3 style="margin:0;flex:1">地图三级下钻：全区 → 街道 → 社区 → 楼栋</h3>
            <span class="schematic-note">{{ SCHEMATIC_MAP_NOTE }} ｜ 点击区域下钻，点击楼栋查看人口明细</span>
          </div>
          <div class="flex gap8" style="margin-bottom:6px">
            <el-tag v-for="(c, i) in crumbs" :key="i" size="small" effect="dark" :type="i === crumbs.length - 1 ? 'primary' : 'info'">{{ c }}</el-tag>
          </div>
          <EChart :option="mapOption" height="clamp(260px, 42vh, 420px)" @chart-click="onChartClick" />
        </div>
        <div class="panel-dark">
          <h3>事件处置趋势（近 12 个月）</h3>
          <EChart :option="trendOption" height="150px" />
        </div>
      </div>

      <!-- 右列人口分析 -->
      <div>
        <div class="panel-dark mb12"><h3>人口五数对比</h3><EChart :option="fiveOption" height="180px" /></div>
        <div class="panel-dark mb12"><h3>一老一小分析</h3><EChart :option="oldOption" height="160px" /></div>
        <div class="panel-dark mb12"><h3>人员分类统计</h3><EChart :option="typeOption" height="180px" /></div>
        <div class="panel-dark"><h3>年龄结构七档</h3><EChart :option="ageOption" height="160px" /></div>
      </div>
    </div>

    <el-dialog v-model="buildingVisible" :title="building?.building?.name || '楼栋明细'" width="540px">
      <el-descriptions :column="2" border size="small" v-if="building">
        <el-descriptions-item label="所属网格">{{ building.gridName }}</el-descriptions-item>
        <el-descriptions-item label="户数">{{ building.households }} 户</el-descriptions-item>
        <el-descriptions-item label="建筑类型">{{ building.building.buildingType }}</el-descriptions-item>
        <el-descriptions-item label="居住人口">{{ building.total }} 人</el-descriptions-item>
      </el-descriptions>
      <h3 class="section-title" style="margin-top:14px">户籍 / 未落户 / 常住 / 流动明细</h3>
      <EChart :option="buildingPie" height="220px" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { api } from '@/api'
import { useUserStore } from '@/stores/user'
import { buildGeoJSON, darkAxis, DARK_PALETTE } from '@/utils/format'
import { SCHEMATIC_MAP_NOTE } from '@/utils/app'
import EChart from '@/components/EChart.vue'
import { liveLabel, onLiveRefresh } from '@/utils/live'
import { escHtml } from '@/utils/esc'

const store = useUserStore()
const user = computed(() => store.user)
const data = ref({ totals: {}, digitalParty: [], multiGovernance: [], microStation: [], population: {}, eventTrend: [] })
const orgs = ref([])
const geoValues = ref([])
const buildings = ref([])
const level = ref(1)
// V2.6：根组织编码 / 名称改从服务端组织台账取，不再写死演示用的 450102 / 兴宁区
const focus = ref('')
const loadError = ref('')
const rootOrg = computed(() => orgs.value.find((o) => Number(o.orgLevel) === 1) || null)
const rootCode = computed(() => rootOrg.value?.orgCode || String(user.value?.orgCode || '').slice(0, 6))
const mapOption = ref({})
const buildingVisible = ref(false)
const building = ref(null)
const clock = ref('')
const updatedAt = ref('')
const reloading = ref(false)
let timer = null
const fmt = (v) => typeof v === 'number' ? v.toLocaleString('zh-CN') : (v ?? 0)
const bigNumbers = computed(() => [
  { name: '实有人口总数', value: data.value.totals?.population || 0 },
  { name: '实有房屋总数', value: data.value.totals?.houses || 0 },
  { name: '党员总数', value: data.value.totals?.partyMembers || 0 }
])
const levelName = computed(() => ['全区', '街道', '社区', '楼栋'][level.value - 1])
const crumbs = computed(() => {
  const byCode = new Map(orgs.value.map((o) => [o.orgCode, o]))
  const chain = []
  let code = level.value === 1 ? '' : focus.value
  while (code && code.length >= 8) {
    const n = byCode.get(code)
    if (!n) break
    chain.unshift(n.orgName)
    code = n.parentCode
  }
  return [rootOrg.value?.orgName || '本级行政区', ...chain]
})
const currentNodes = computed(() => {
  const list = orgs.value
  if (level.value === 1) return list.filter((o) => o.orgLevel === 2)
  if (level.value === 2) return list.filter((o) => o.orgLevel === 3 && o.parentCode === focus.value)
  if (level.value === 3) return list.filter((o) => o.orgLevel === 4 && o.parentCode === focus.value)
  return list.filter((o) => o.orgCode === focus.value)
})
const regionValue = (code) => geoValues.value.filter((v) => String(v.gridCode).startsWith(code)).reduce((a, b) => a + b.value, 0)

function rebuild() {
  const nodes = currentNodes.value
  if (!nodes.length) { mapOption.value = { title: { text: '该层级暂无可见区域', left: 'center', top: 'center', textStyle: { color: '#8fb4e6' } } }; return }
  const mapName = `zhsq-map-${level.value}-${focus.value}`
  echarts.registerMap(mapName, buildGeoJSON(nodes))
  const mapData = nodes.map((n) => ({ name: n.orgName, value: regionValue(n.orgCode) }))
  const scatterData = level.value === 4
    ? buildings.value.map((b) => ({ name: b.name, value: [b.lng, b.lat], raw: b }))
    : geoValues.value.filter((v) => String(v.gridCode).startsWith(focus.value)).map((v) => ({ name: v.name, value: [v.lng, v.lat], raw: v }))
  mapOption.value = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: (p) => p.seriesType === 'map'
        ? `<b>${escHtml(p.name)}</b><br/>人口：${escHtml(fmt(p.value || 0))} 人<br/><span style="color:#7dd3fc">点击下钻</span>`
        : `<b>${escHtml(p.name)}</b><br/><span style="color:#7dd3fc">点击查看明细</span>`
    },
    visualMap: {
      min: 0, max: Math.max(1, ...mapData.map((d) => d.value)), left: 12, bottom: 12,
      inRange: { color: ['#0d3b7a', '#1d6fc4', '#38bdf8', '#a5f3fc'] },
      textStyle: { color: '#8fb4e6', fontSize: 10 }, calculable: true
    },
    series: [
      {
        type: 'map', map: mapName, geoIndex: 0,
        label: { show: level.value < 4, color: '#dbeafe', fontSize: 10 },
        itemStyle: { areaColor: '#123b78', borderColor: '#38bdf8', borderWidth: 1.2, shadowColor: 'rgba(56,189,248,.35)', shadowBlur: 8 },
        emphasis: { label: { color: '#fff', fontSize: 12 }, itemStyle: { areaColor: '#0ea5e9' } },
        data: mapData
      },
      {
        type: 'effectScatter', coordinateSystem: 'geo', geoIndex: 0, zlevel: 2, symbolSize: level.value === 4 ? 11 : 5,
        rippleEffect: { brushType: 'stroke', scale: 2.4 },
        itemStyle: { color: level.value === 4 ? '#fbbf24' : '#67e8f9', shadowBlur: 8, shadowColor: '#38bdf8' },
        data: scatterData
      }
    ],
    geo: { map: mapName, roam: true, zoom: 1.05, label: { show: false }, itemStyle: { areaColor: '#123b78', borderColor: '#38bdf8', borderWidth: 1 } }
  }
}

const onChartClick = async (p) => {
  if (level.value === 4) {
    if (p.data?.raw?.id && p.data.raw.buildingType) {
      try { building.value = await api.buildingDetail(p.data.raw.id); buildingVisible.value = true } catch (e) { /* 拦截器 */ }
    }
    return
  }
  const node = currentNodes.value.find((n) => n.orgName === p.name)
  if (!node) return
  focus.value = node.orgCode
  level.value = level.value + 1
  if (level.value === 4) {
    const d = await api.list('buildings', { gridCode: focus.value, pageSize: 100 })
    buildings.value = d.records
  }
  rebuild()
}
const drillUp = () => {
  if (level.value === 1) return
  const byCode = new Map(orgs.value.map((o) => [o.orgCode, o]))
  if (level.value === 2) { focus.value = rootCode.value; level.value = 1 }
  else if (level.value === 3) {
    const parent = byCode.get(focus.value)?.parentCode
    focus.value = parent || rootCode.value
    level.value = parent ? 2 : 1
  } else { focus.value = byCode.get(focus.value)?.parentCode || focus.value.slice(0, 10); level.value = 3 }
  rebuild()
}

const p = computed(() => data.value.population || {})
const fiveOption = computed(() => ({
  color: ['#38bdf8'], tooltip: { trigger: 'axis' }, grid: { left: 52, right: 14, top: 12, bottom: 34 },
  xAxis: { type: 'category', data: (p.value.five || []).map((x) => x.name), ...darkAxis },
  yAxis: { type: 'value', ...darkAxis },
  series: [{ type: 'bar', data: (p.value.five || []).map((x) => x.value), barWidth: '52%',
    itemStyle: { color: '#38bdf8', borderRadius: [3, 3, 0, 0] }, label: { show: true, position: 'top', color: '#a5f3fc', fontSize: 9 } }]
}))
const oldOption = computed(() => ({
  color: ['#fbbf24'], tooltip: { trigger: 'axis' }, grid: { left: 90, right: 24, top: 10, bottom: 20 },
  xAxis: { type: 'value', ...darkAxis }, yAxis: { type: 'category', data: (p.value.oldAndYoung || []).map((x) => x.name), ...darkAxis },
  series: [{ type: 'bar', data: (p.value.oldAndYoung || []).map((x) => x.value), barWidth: '55%',
    itemStyle: { color: '#f59e0b', borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', color: '#fde68a', fontSize: 9 } }]
}))
const typeOption = computed(() => ({
  color: DARK_PALETTE, tooltip: { trigger: 'item' }, legend: { bottom: 0, textStyle: { color: '#8fb4e6', fontSize: 9 } },
  series: [{ type: 'pie', radius: ['38%', '62%'], center: ['50%', '42%'],
    data: (p.value.byType || []).map((x) => ({ name: x.name, value: x.value })), label: { color: '#c7d8f7', fontSize: 9 } }]
}))
const ageOption = computed(() => ({
  tooltip: { trigger: 'axis' }, grid: { left: 42, right: 14, top: 14, bottom: 30 },
  xAxis: { type: 'category', data: (p.value.ages || []).map((x) => x.name), ...darkAxis, axisLabel: { ...darkAxis.axisLabel, rotate: 35 } },
  yAxis: { type: 'value', ...darkAxis },
  series: [{ type: 'line', smooth: true, data: (p.value.ages || []).map((x) => x.value),
    itemStyle: { color: '#34d399' }, areaStyle: { color: 'rgba(52,211,153,.22)' } }]
}))
const trendOption = computed(() => ({
  color: ['#38bdf8', '#34d399'], tooltip: { trigger: 'axis' }, legend: { right: 10, textStyle: { color: '#8fb4e6', fontSize: 10 }, data: ['上报', '办结'] },
  grid: { left: 42, right: 16, top: 24, bottom: 24 },
  xAxis: { type: 'category', data: (data.value.eventTrend || []).map((x) => x.month), ...darkAxis },
  yAxis: { type: 'value', ...darkAxis },
  series: [
    { name: '上报', type: 'line', smooth: true, data: (data.value.eventTrend || []).map((x) => x.value), itemStyle: { color: '#38bdf8' }, areaStyle: { color: 'rgba(56,189,248,.15)' } },
    { name: '办结', type: 'line', smooth: true, data: (data.value.eventTrend || []).map((x) => x.done), itemStyle: { color: '#34d399' } }
  ]
}))
const buildingPie = computed(() => ({
  color: DARK_PALETTE, tooltip: { trigger: 'item', formatter: '{b}: {c} 人 ({d}%)' }, legend: { bottom: 0 },
  series: [{ type: 'pie', radius: ['38%', '64%'], center: ['50%', '44%'],
    data: (building.value?.detail || []).map((x) => ({ name: x.name, value: x.value })) }]
}))

const tick = () => { clock.value = new Date().toLocaleString('zh-CN', { hour12: false }) }
const reload = async () => {
  reloading.value = true
  try {
    const [s, o, g] = await Promise.all([api.screenStats(), api.orgOptions(0), api.geoStats('人口')])
    data.value = s; orgs.value = o; geoValues.value = g.values
    if (!focus.value) focus.value = rootCode.value
    updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    loadError.value = ''
    rebuild()
  } catch (e) {
    loadError.value = e?.bizMessage || e?.message || '请检查网络或重新登录'
  } finally { reloading.value = false }
}
let offLive = null
onMounted(async () => {
  tick(); timer = setInterval(tick, 1000)
  await reload()
  offLive = onLiveRefresh(reload, {
    minInterval: 15000,
    topics: ['population', 'houses', 'grids', 'serviceRequests', 'governanceEvents', 'alarms', 'poll']
  })
})
onBeforeUnmount(() => { clearInterval(timer); offLive?.() })
</script>
