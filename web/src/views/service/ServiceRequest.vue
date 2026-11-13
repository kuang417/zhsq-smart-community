<template>
  <div class="page">
    <div class="page-card">
      <div class="flex gap8">
        <div><h2 class="page-title">办事管理</h2><div class="page-desc" style="margin:0">居民在线提交申请 → 待受理 → 办理中 → 已办结；每次流转自动向居民推送进度通知，全程记录办理人、时间、意见（F6-4）。</div></div>
        <span class="spacer"></span>
        <el-button :icon="'Iphone'" @click="openResident">打开居民端在线申请</el-button>
      </div>
      <!-- 标准流程示意：不代表某一条单据的当前进度，单据状态请在下方列表查看 -->
      <el-steps :active="-1" align-center style="margin:18px 0 2px">
        <el-step title="居民在线提交" description="便民码扫码进入" />
        <el-step title="待受理" description="社区受理审核" />
        <el-step title="办理中" description="办理人处理" />
        <el-step title="已办结" description="推送结果并归档" />
      </el-steps>
      <div class="muted" style="text-align:center;margin-bottom:10px">标准流程示意 · 非单据实时进度，具体状态请查看下方列表</div>
      <el-alert v-if="statsError" type="error" :closable="false" :title="statsError" class="mb12">
        <el-button size="small" @click="loadStats">重新加载</el-button>
      </el-alert>
      <div class="mini-stats">
        <div v-for="s in statuses" :key="s.name" class="mini-stat"><div class="v">{{ s.value }}</div><div class="n">{{ s.name }}</div></div>
      </div>
    </div>
    <CrudTable resource="serviceRequests" title="办事申请" flow="办事" :columns="cols" :filters="filters" :form-fields="fields" show-reveal />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import CrudTable from '@/components/CrudTable.vue'
import { useUserStore } from '@/stores/user'
import { openResidentPreview } from '@/utils/grid'
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const store = useUserStore()
const statuses = ref([])
const statsError = ref('')
// V2.6：办理事项选项改为服务端字典单一来源。此前前端写死列表，
// 一旦字典调整，居民端按字典枚举校验会拒绝这些「前端仍可提交」的事项。
const itemOptions = ref([])
const openResident = () => openResidentPreview(store.user)
const cols = [
  { prop: 'code', label: '申请编号', width: 160 }, { prop: 'applicant', label: '申请人', width: 100 },
  { prop: 'applicantPhone', label: '联系电话（脱敏）', width: 150 }, { prop: 'item', label: '办理事项', minWidth: 160 },
  { prop: 'gridCode', label: '网格编码', width: 140 }, { prop: 'status', label: '当前状态', width: 110, type: 'status' },
  { prop: 'submitTime', label: '提交时间', width: 165 }, { prop: 'handler', label: '办理人', width: 100 },
  { prop: 'opinion', label: '办理意见', minWidth: 180 }
]
const filters = computed(() => [
  { prop: 'status', label: '办理状态', type: 'select', options: opts(['待受理', '办理中', '已办结']) },
  { prop: 'item', label: '办理事项', type: 'select', options: opts(itemOptions.value) },
  { prop: 'orgCode', label: '按组织范围', type: 'org' }
])
const fields = computed(() => [
  { prop: 'applicant', label: '申请人', required: true }, { prop: 'applicantPhone', label: '联系电话' },
  { prop: 'item', label: '办理事项', type: 'select', options: opts(itemOptions.value) },
  { prop: 'gridCode', label: '网格编码', required: true }, { prop: 'orgCode', label: '组织编码' },
  { prop: 'content', label: '申请内容', type: 'textarea' }
])
// 状态不进录入表单：新建固定为「待受理」，后续只能经流转 / 撤回 / 退回变更并留痕
const loadStats = async () => {
  statsError.value = ''
  try {
    statuses.value = await Promise.all(['待受理', '办理中', '已办结'].map(async (name) => ({
      name, value: (await api.list('serviceRequests', { status: name, pageSize: 1 })).total
    })))
  } catch (e) {
    statuses.value = []
    statsError.value = '状态统计加载失败，请稍后重试（下方列表不受影响）'
  }
}
onMounted(async () => {
  try { itemOptions.value = (await api.dicts())?.serviceItems || [] } catch (e) { itemOptions.value = [] }
  loadStats()
})
</script>
