<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">实有建筑 / 房屋</h2>
      <div class="page-desc">按街道、建筑类型、建筑用途筛选；顶部统计总数、居住、商务、其他四类。点击建筑行可查看楼栋弹窗（户籍 / 未落户 / 常住 / 流动明细，对应大屏 F8-5）（F3-6）。</div>
      <StatCards :items="cards" />
    </div>
    <el-tabs v-model="tab" type="border-card">
      <el-tab-pane label="建筑台账" name="building">
        <CrudTable resource="buildings" title="实有建筑" :columns="buildingCols" :filters="buildingFilters" :form-fields="buildingFields" @row-click="openBuilding" />
      </el-tab-pane>
      <el-tab-pane label="房屋明细" name="house">
        <CrudTable resource="houses" title="实有房屋" :columns="houseCols" :filters="houseFilters" :form-fields="houseFields" />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="visible" :title="detail?.building?.name || '楼栋明细'" width="560px">
      <el-descriptions :column="2" border size="small" v-if="detail">
        <el-descriptions-item label="所属网格">{{ detail.gridName }}</el-descriptions-item>
        <el-descriptions-item label="建筑类型">{{ detail.building.buildingType }}</el-descriptions-item>
        <el-descriptions-item label="用途">{{ detail.building.purpose }}</el-descriptions-item>
        <el-descriptions-item label="层数 / 户数">{{ detail.building.floors }} 层 / {{ detail.households }} 户</el-descriptions-item>
        <el-descriptions-item label="建成年份">{{ detail.building.buildYear }}</el-descriptions-item>
        <el-descriptions-item label="居住人口">{{ detail.total }} 人</el-descriptions-item>
      </el-descriptions>
      <h3 class="section-title" style="margin-top:14px">人口构成明细</h3>
      <EChart :option="pieOption" height="230px" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import CrudTable from '@/components/CrudTable.vue'
import StatCards from '@/components/StatCards.vue'
import EChart from '@/components/EChart.vue'
import { DARK_PALETTE } from '@/utils/format'

const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const tab = ref('building')
const cards = ref([])
const visible = ref(false)
const detail = ref(null)
const buildingCols = [
  { prop: 'name', label: '建筑名称', minWidth: 180 }, { prop: 'buildingType', label: '建筑类型', width: 130, type: 'tag' },
  { prop: 'purpose', label: '用途', width: 90, type: 'tag' }, { prop: 'floors', label: '层数', width: 80 },
  { prop: 'households', label: '户数', width: 90 }, { prop: 'buildYear', label: '建成年份', width: 100 },
  { prop: 'gridCode', label: '网格编码', width: 135 }, { prop: 'status', label: '状态', width: 100, type: 'status' }
]
const buildingFilters = [
  { prop: 'purpose', label: '建筑用途', type: 'select', options: opts(['居住', '商务', '其他']) },
  { prop: 'buildingType', label: '建筑类型', type: 'select', options: opts(['多层住宅', '高层住宅', '商住两用', '商业楼宇', '公共配套']) },
  { prop: 'streetCode', label: '按街道/社区', type: 'org' }
]
const buildingFields = [
  { prop: 'name', label: '建筑名称', required: true },
  { prop: 'buildingType', label: '建筑类型', type: 'select', options: opts(['多层住宅', '高层住宅', '商住两用', '商业楼宇', '公共配套']) },
  { prop: 'purpose', label: '用途', type: 'select', options: opts(['居住', '商务', '其他']) },
  { prop: 'gridCode', label: '网格编码', required: true }, { prop: 'floors', label: '层数', type: 'number' },
  { prop: 'lng', label: '经度' }, { prop: 'lat', label: '纬度' }
]
const houseCols = [
  { prop: 'code', label: '房屋编码', width: 140 }, { prop: 'buildingId', label: '建筑ID', width: 120 },
  { prop: 'unit', label: '单元', width: 80 }, { prop: 'room', label: '房号', width: 100 },
  { prop: 'area', label: '面积(㎡)', width: 110 }, { prop: 'purpose', label: '用途', width: 100, type: 'tag' },
  { prop: 'gridCode', label: '网格编码', width: 140 }
]
const houseFilters = [{ prop: 'gridCode', label: '网格', type: 'grid' }]
// 房屋明细此前漏配表单，点「新增」会弹出 0 字段空表单并写入空记录；补齐字段并与后端 required 对齐
const houseFields = [
  { prop: 'code', label: '房屋编码', required: true },
  { prop: 'buildingId', label: '建筑ID', required: true },
  { prop: 'gridCode', label: '网格编码', required: true },
  { prop: 'unit', label: '单元' }, { prop: 'room', label: '房号' },
  { prop: 'area', label: '面积(㎡)', type: 'number' },
  { prop: 'purpose', label: '用途', type: 'select', options: opts(['居住', '商务', '其他']) }
]
const pieOption = computed(() => ({
  color: DARK_PALETTE, tooltip: { trigger: 'item', formatter: '{b}: {c} 人 ({d}%)' },
  legend: { bottom: 0, textStyle: { fontSize: 11 } },
  series: [{ type: 'pie', radius: ['40%', '65%'], center: ['50%', '44%'],
    data: (detail.value?.detail || []).map((x) => ({ name: x.name, value: x.value })) }]
}))
const openBuilding = async (row) => {
  try {
    detail.value = await api.buildingDetail(row.id)
    visible.value = true
  } catch (e) { /* 拦截器提示 */ }
}
onMounted(async () => { cards.value = (await api.buildingStats('')).cards })
</script>
