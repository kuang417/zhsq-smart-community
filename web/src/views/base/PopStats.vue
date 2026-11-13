<template>
  <div class="page">
    <div class="page-card">
      <div class="flex gap8 mb12">
        <div><h2 class="page-title">实有人口统计</h2><div class="page-desc" style="margin:0">七项统计（总数 / 户籍 / 常住 / 未落户 / 流动 / 境外 / 系统未分配）+ 年龄结构七档；统计结果按组织范围与角色数据权限自动收窄（F3-3），页面加载时取数。</div></div>
        <span class="spacer"></span>
        <el-select v-model="orgCode" placeholder="按组织范围统计" clearable filterable style="width:220px" @change="load">
          <el-option v-for="o in orgs" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </div>
      <StatCards :items="sevenCards" />
    </div>

    <div class="grid-cols-2">
      <div class="page-card"><h3 class="section-title">年龄结构七档</h3><EChart :option="ageOption" height="280px" /></div>
      <div class="page-card"><h3 class="section-title">人口类型构成</h3><EChart :option="typeOption" height="280px" /></div>
      <div class="page-card"><h3 class="section-title">九类特殊群体标签</h3><EChart :option="tagOption" height="300px" /></div>
      <div class="page-card">
        <h3 class="section-title">按街道分布 / 一老一小</h3>
        <div class="mini-stats mb12">
          <div v-for="x in oldYoung" :key="x.name" class="mini-stat"><div class="v">{{ x.value.toLocaleString() }}</div><div class="n">{{ x.name }}</div></div>
        </div>
        <EChart :option="streetOption" height="220px" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import StatCards from '@/components/StatCards.vue'
import EChart from '@/components/EChart.vue'
import { DARK_PALETTE } from '@/utils/format'

const data = ref({ seven: [], ages: [], byType: [], tags: [], byStreet: [], oldAndYoung: [] })
const orgs = ref([])
const orgCode = ref('')
const sevenCards = computed(() => data.value.seven.map((x, i) => ({ name: x.name, value: x.value, unit: i === 0 ? '人' : '' })))
const oldYoung = computed(() => data.value.oldAndYoung || [])
const axis = { axisLabel: { color: '#64748b', fontSize: 10 }, axisLine: { lineStyle: { color: '#cbd5e1' } }, splitLine: { lineStyle: { color: '#eef2f8' } } }

const ageOption = computed(() => ({
  color: ['#3b82f6'], tooltip: { trigger: 'axis' },
  grid: { left: 50, right: 20, top: 20, bottom: 40 },
  xAxis: { type: 'category', data: (data.value.ages || []).map((x) => x.name), ...axis, axisLabel: { ...axis.axisLabel, rotate: 25 } },
  yAxis: { type: 'value', ...axis },
  series: [{ type: 'bar', data: (data.value.ages || []).map((x) => x.value), barWidth: '55%',
    itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#60a5fa' }, { offset: 1, color: '#1d4ed8' }] }, borderRadius: [4, 4, 0, 0] },
    label: { show: true, position: 'top', fontSize: 10, color: '#475569' } }]
}))
const typeOption = computed(() => ({
  color: DARK_PALETTE, tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: 0, textStyle: { fontSize: 10 } },
  series: [{ type: 'pie', radius: ['38%', '66%'], center: ['50%', '45%'],
    data: (data.value.byType || []).map((x) => ({ name: x.name, value: x.value })),
    label: { fontSize: 10 } }]
}))
const tagOption = computed(() => ({
  tooltip: { trigger: 'axis' }, grid: { left: 100, right: 30, top: 12, bottom: 24 },
  xAxis: { type: 'value', ...axis },
  yAxis: { type: 'category', data: (data.value.tags || []).map((x) => x.name), ...axis },
  series: [{ type: 'bar', data: (data.value.tags || []).map((x) => x.value), barWidth: '58%',
    itemStyle: { color: '#f59e0b', borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', fontSize: 10 } }]
}))
const streetOption = computed(() => ({
  color: ['#0ea5e9'], tooltip: { trigger: 'axis' }, grid: { left: 50, right: 20, top: 18, bottom: 40 },
  xAxis: { type: 'category', data: (data.value.byStreet || []).map((x) => x.name), ...axis },
  yAxis: { type: 'value', ...axis },
  series: [{ type: 'bar', data: (data.value.byStreet || []).map((x) => x.value), barWidth: '45%',
    itemStyle: { color: '#0ea5e9', borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', fontSize: 10 } }]
}))
const load = async () => { data.value = await api.populationStats(orgCode.value) }
onMounted(async () => { orgs.value = await api.orgOptions(0); load() })
</script>
