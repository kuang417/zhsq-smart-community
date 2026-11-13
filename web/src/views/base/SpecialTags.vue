<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">特殊群体标签</h2>
      <div class="page-desc">九类标签维护与按标签筛选统计；点击标签卡片即可查看该群体的人口明细（F3-5）。</div>
      <div class="mini-stats">
        <div v-for="t in tags" :key="t.name" class="mini-stat" style="cursor:pointer;border:1px solid #dbe6fb"
          :style="active === t.name ? 'background:#e0ecff;border-color:#1d4ed8' : ''" @click="pick(t.name)">
          <div class="v">{{ t.value.toLocaleString() }}</div><div class="n">{{ t.name }}</div>
        </div>
      </div>
    </div>
    <div class="grid-cols-2">
      <div class="page-card"><h3 class="section-title">九类标签人数分布</h3><EChart :option="option" height="330px" /></div>
      <div class="page-card">
        <h3 class="section-title">{{ active ? `「${active}」人口明细` : '全部特殊群体人口明细' }}</h3>
        <div class="muted mb12">当前筛选：{{ active || '全部含标签人口' }} ｜ 身份证、手机号默认脱敏</div>
        <el-table :data="rows" size="small" border max-height="290" v-loading="loading">
          <el-table-column prop="name" label="姓名" width="100" />
          <el-table-column prop="idcard" label="身份证" width="185" />
          <el-table-column prop="age" label="年龄" width="70" />
          <el-table-column prop="tags" label="标签" minWidth="150" />
          <el-table-column prop="address" label="住址" minWidth="180" show-overflow-tooltip />
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import EChart from '@/components/EChart.vue'

const tags = ref([])
const active = ref('')
const rows = ref([])
const loading = ref(false)
const option = computed(() => ({
  color: ['#1d4ed8'], tooltip: { trigger: 'axis' }, grid: { left: 100, right: 30, top: 16, bottom: 26 },
  xAxis: { type: 'value', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { color: '#eef2f8' } } },
  yAxis: { type: 'category', data: tags.value.map((t) => t.name), axisLabel: { fontSize: 10 } },
  series: [{ type: 'bar', data: tags.value.map((t) => t.value), barWidth: '55%',
    itemStyle: { color: '#f59e0b', borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', fontSize: 10 } }]
}))
const loadRows = async () => {
  loading.value = true
  try {
    const params = { pageSize: 20 }
    if (active.value) params.tags = active.value
    rows.value = (await api.list('population', params)).records
  } finally { loading.value = false }
}
const pick = (name) => { active.value = active.value === name ? '' : name; loadRows() }
onMounted(async () => {
  const d = await api.populationStats('')
  tags.value = d.tags
  loadRows()
})
</script>
