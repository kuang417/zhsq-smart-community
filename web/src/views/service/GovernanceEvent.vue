<template>
  <div class="page">
    <div class="page-card">
      <div class="flex gap8">
        <div><h2 class="page-title">治理万家（事件闭环）</h2><div class="page-desc" style="margin:0">居民上报 → 社区派发网格员 → 网格员现场处置 → 结果回填 → 归档；全程留痕（上报时间、派发人、处置人、处置结果、照片），状态机禁止跳步（F6-5 / 验收项3）。</div></div>
        <span class="spacer"></span>
        <el-button :icon="'Iphone'" @click="openResident">打开居民端上报事件</el-button>
      </div>
      <!-- 标准流程示意：不代表某一条单据的当前进度，单据状态请在下方列表查看 -->
      <el-steps :active="-1" align-center style="margin:18px 0 2px">
        <el-step title="居民上报" description="扫码提交事件" />
        <el-step title="社区派发" description="指派网格员" />
        <el-step title="现场处置" description="处置中" />
        <el-step title="结果回填" description="已办结" />
        <el-step title="归档留痕" description="已归档" />
      </el-steps>
      <div class="muted" style="text-align:center;margin-bottom:10px">标准流程示意 · 非单据实时进度，具体状态请查看下方列表</div>
      <el-alert v-if="statsError" type="error" :closable="false" :title="statsError" class="mb12">
        <el-button size="small" @click="loadStats">重新加载</el-button>
      </el-alert>
      <div class="mini-stats">
        <div v-for="s in statuses" :key="s.name" class="mini-stat"><div class="v">{{ s.value }}</div><div class="n">{{ s.name }}</div></div>
      </div>
    </div>
    <CrudTable resource="governanceEvents" title="治理万家事件" flow="治理万家" :columns="cols" :filters="filters" :form-fields="fields" show-reveal />
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
// 事件类型同样以服务端字典为准，与居民端提交校验保持同一口径
const typeOptions = ref([])
const openResident = () => openResidentPreview(store.user)
const cols = [
  { prop: 'code', label: '事件编号', width: 160 }, { prop: 'type', label: '事件类型', width: 110, type: 'tag' },
  { prop: 'title', label: '事件标题', minWidth: 210 }, { prop: 'reporter', label: '上报人', width: 100 },
  { prop: 'reporterPhone', label: '联系电话（脱敏）', width: 150 }, { prop: 'location', label: '地点', minWidth: 160 },
  { prop: 'status', label: '状态', width: 110, type: 'status' }, { prop: 'reportTime', label: '上报时间', width: 160 },
  { prop: 'dispatcher', label: '派发人', width: 100 }, { prop: 'handler', label: '处置人', width: 100 },
  { prop: 'result', label: '处置结果', minWidth: 190 }, { prop: 'photos', label: '现场照片', width: 100 }
]
const filters = computed(() => [
  { prop: 'status', label: '事件状态', type: 'select', options: opts(['待派发', '已派发', '处置中', '已办结', '已归档']) },
  { prop: 'type', label: '事件类型', type: 'select', options: opts(typeOptions.value) },
  { prop: 'orgCode', label: '按组织范围', type: 'org' }
])
const fields = computed(() => [
  { prop: 'title', label: '事件标题', required: true },
  { prop: 'type', label: '事件类型', type: 'select', options: opts(typeOptions.value) },
  { prop: 'reporter', label: '上报人' }, { prop: 'reporterPhone', label: '联系电话' },
  { prop: 'location', label: '地点' }, { prop: 'gridCode', label: '网格编码', required: true },
  { prop: 'orgCode', label: '组织编码' }, { prop: 'description', label: '事件描述', type: 'textarea' }
])
// 状态不进录入表单：新建固定为「待派发」，后续只能经流转 / 撤回 / 退回变更并留痕
const loadStats = async () => {
  statsError.value = ''
  try {
    statuses.value = await Promise.all(['待派发', '已派发', '处置中', '已办结', '已归档'].map(async (name) => ({
      name, value: (await api.list('governanceEvents', { status: name, pageSize: 1 })).total
    })))
  } catch (e) {
    statuses.value = []
    statsError.value = '状态统计加载失败，请稍后重试（下方列表不受影响）'
  }
}
onMounted(async () => {
  try { typeOptions.value = (await api.dicts())?.eventTypes || [] } catch (e) { typeOptions.value = [] }
  loadStats()
})
</script>
