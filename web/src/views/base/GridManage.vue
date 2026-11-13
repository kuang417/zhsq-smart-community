<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">网格组织 / 便民码</h2>
      <div class="page-desc">区 / 街道 / 社区 / 网格四级树；网格长与网格员以「网格台账」的绑定为准，姓名统一取自「人员主数据」，修改后网格组织、网格微站、居民端同步联动。新增人员请到下方「人员主数据」页签，给网格配人请在「网格台账」点目标网格的「编辑」（F3-1 / F3-2 / 验收项4）。</div>
    </div>
    <div class="grid-side-300">
      <div class="page-card">
        <h3 class="section-title">四级组织树</h3>
        <el-input v-model="kw" placeholder="组织名称检索" clearable size="small" class="mb12" />
        <el-tree :data="tree" :props="{ children: 'children', label: 'orgName' }" highlight-current default-expand-all
          :filter-node-method="(v, d) => !v || d.orgName.includes(v)" ref="treeRef" @node-click="onNode" style="max-height:560px;overflow:auto">
          <template #default="{ data }">
            <div class="flex gap8"><el-tag size="small" effect="plain">{{ data.levelName }}</el-tag><span style="font-size:13px">{{ data.orgName }}</span></div>
          </template>
        </el-tree>
      </div>
      <div>
        <div class="page-card" v-if="grid">
          <h3 class="section-title">{{ grid.gridName }} · 网格微站信息</h3>
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="网格编码">{{ grid.gridCode }}</el-descriptions-item>
            <el-descriptions-item label="网格长">{{ personName(grid.leaderId) }}</el-descriptions-item>
            <el-descriptions-item label="网格员">{{ (Array.isArray(grid.workerIds) ? grid.workerIds : []).map(personName).join('、') }}</el-descriptions-item>
            <el-descriptions-item label="实有人口">{{ grid.populationCount }} 人</el-descriptions-item>
            <el-descriptions-item label="党员数">{{ grid.partyMemberCount }} 人</el-descriptions-item>
            <el-descriptions-item label="经纬度">{{ grid.lng }}, {{ grid.lat }}</el-descriptions-item>
          </el-descriptions>
          <div class="flex gap8 mt12">
            <el-button size="small" type="primary" plain :icon="'Plus'" @click="goPersonConfig">配置网格人员</el-button>
            <el-button size="small" :icon="'Edit'" @click="editPersonVisible = true">修改网格长姓名</el-button>
            <el-button size="small" type="primary" :icon="'FullScreen'" @click="qrVisible = true">查看 / 下载便民码</el-button>
            <el-button size="small" :icon="'Iphone'" @click="openResident">打开居民端</el-button>
          </div>
          <div class="flex gap12 mt12" style="align-items:flex-start">
            <img v-if="qrImg" :src="qrImg" width="110" height="110" style="border:1px solid #e5eaf3;border-radius:6px;background:#fff" />
            <div class="muted" style="line-height:1.9">
              便民码链接：<span style="color:#1d4ed8">{{ qrUrl }}</span><br>
              居民扫码后进入本网格 H5 页面，可浏览公开信息、在线办事、上报事件并查询进度。<br>
              每个网格二维码唯一，支持下载 PNG 与打印张贴。
            </div>
          </div>
        </div>
        <el-tabs v-model="tab" type="border-card" class="mt12">
          <el-tab-pane label="网格台账（配置网格长 / 网格员）" name="grid">
            <CrudTable resource="grids" title="网格台账" :columns="cols" :filters="filters" :form-fields="fields" :extra-query="extra" />
          </el-tab-pane>
          <el-tab-pane label="人员主数据（新增 / 编辑人员）" name="person">
            <CrudTable resource="persons" title="人员主数据" :columns="personCols" :filters="personFilters" :form-fields="personFields" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>
    <QrDialog v-model="qrVisible" :grid-code="grid?.gridCode || ''" :grid-name="grid?.gridName || ''" />

    <el-dialog v-model="editPersonVisible" title="修改人员主数据（全局联动）" width="440px">
      <el-alert type="info" :closable="false" title="网格长姓名存放在人员主数据表，修改后网格组织、网格微站、派发记录中的显示会同步变化。" style="margin-bottom:12px" />
      <el-form label-width="90px">
        <el-form-item label="新姓名"><el-input v-model="newName" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="editPersonVisible = false">取消</el-button><el-button type="primary" @click="savePerson">保存并验证联动</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import QRCode from 'qrcode'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import CrudTable from '@/components/CrudTable.vue'
import QrDialog from '@/components/QrDialog.vue'

const tree = ref([])
const grid = ref(null)
const persons = ref(new Map())
const kw = ref('')
const treeRef = ref(null)
const qrVisible = ref(false)
const qrImg = ref('')
const qrUrl = ref('')
const extra = ref({})
const tab = ref('grid')
// 与「网格微站」共享当前选中网格：两页各选一个网格最容易让人误以为人员数据不一致
const CURRENT_GRID_KEY = 'zhsq:currentGridCode'
const editPersonVisible = ref(false)
const newName = ref('')
const PERSON_ROLES = ['网格长', '网格员', '社区书记', '街道负责人', '区级负责人', '其他']
watch(kw, (v) => treeRef.value?.filter(v))
const personName = (id) => persons.value.get(id) || id || '-'
const goPersonConfig = () => {
  tab.value = 'grid'
  ElMessage.info('请在「网格台账」点击目标网格的「编辑」选择网格长 / 网格员；如需新增人员请切到「人员主数据」页签')
}

const cols = [
  { prop: 'gridCode', label: '网格编码', width: 140 }, { prop: 'gridName', label: '网格名称', minWidth: 170 },
  { prop: 'parentCode', label: '所属社区', width: 130 },
  { prop: 'leaderId', label: '网格长', width: 110, formatter: (v) => personName(v) },
  { prop: 'workerIds', label: '网格员', minWidth: 180, formatter: (v) => Array.isArray(v) && v.length ? v.map(personName).join('、') : '-' },
  { prop: 'populationCount', label: '实有人口', width: 100, type: 'num' },
  { prop: 'partyMemberCount', label: '党员数', width: 90 },
  { prop: 'lng', label: '经度', width: 120 }, { prop: 'lat', label: '纬度', width: 120 }
]
const filters = [{ prop: 'orgCode', label: '按组织范围', type: 'org' }]
const fields = [
  { prop: 'gridName', label: '网格名称', required: true }, { prop: 'gridCode', label: '网格编码', required: true },
  { prop: 'orgCode', label: '组织编码', required: true }, { prop: 'parentCode', label: '上级社区编码' },
  { prop: 'leaderId', label: '网格长', type: 'person' },
  { prop: 'workerIds', label: '网格员', type: 'persons', default: [] },
  { prop: 'lng', label: '经度' }, { prop: 'lat', label: '纬度' }
]
/** 人员主数据：新增 / 编辑网格长、网格员的唯一入口（姓名在这里维护，绑定在网格台账） */
const personCols = [
  { prop: 'name', label: '姓名', width: 110 },
  { prop: 'role', label: '岗位', width: 120, type: 'tag' },
  { prop: 'phone', label: '手机号', width: 140 },
  { prop: 'orgCode', label: '所属组织编码', width: 150 },
  { prop: 'gridCode', label: '所属网格编码', width: 150 },
  { prop: 'title', label: '职务说明', minWidth: 140 }
]
const personFilters = [{ prop: 'orgCode', label: '按组织范围', type: 'org' }]
const personFields = [
  { prop: 'name', label: '姓名', required: true },
  { prop: 'role', label: '岗位', required: true, type: 'select', default: '网格员', options: PERSON_ROLES.map((v) => ({ label: v, value: v })) },
  { prop: 'phone', label: '手机号' },
  { prop: 'orgCode', label: '所属组织', required: true, type: 'org' },
  { prop: 'gridCode', label: '所属网格', type: 'grid' },
  { prop: 'title', label: '职务说明' }
]

const loadPersons = async () => {
  const d = await api.list('persons', { pageSize: 500 })
  persons.value = new Map(d.records.map((p) => [p.id, p.name]))
}
const onNode = async (node) => {
  extra.value = { orgCode: node.orgCode }
  if (node.orgLevel === 4) {
    const d = await api.list('grids', { gridCode: node.orgCode, pageSize: 1 })
    grid.value = d.records[0] || null
    if (grid.value) {
      sessionStorage.setItem(CURRENT_GRID_KEY, grid.value.gridCode)
      buildQr(grid.value.gridCode)
    }
  } else {
    grid.value = null
    qrImg.value = ''
  }
}
const buildQr = async (code) => {
  const d = await api.qr(code)
  qrUrl.value = d.url
  qrImg.value = await QRCode.toDataURL(d.url, { width: 220, margin: 1, color: { dark: '#12318c' } })
}
const openResident = () => window.open(grid.value?.qrUrl, '_blank')
const savePerson = async () => {
  if (!grid.value?.leaderId) return ElMessage.warning('当前网格尚未配置网格长，请先在「网格台账」中编辑选择')
  try {
    await api.update('persons', grid.value.leaderId, { name: newName.value })
    await loadPersons()
    ElMessage.success('主数据已更新：网格组织 / 微站 / 派发记录均同步显示新姓名')
    editPersonVisible.value = false
  } catch (e) { /* 拦截器提示 */ }
}
onMounted(async () => {
  tree.value = await api.orgTree()
  await loadPersons()
  const saved = sessionStorage.getItem(CURRENT_GRID_KEY)
  const savedRow = saved ? (await api.list('grids', { gridCode: saved, pageSize: 1 })).records[0] : null
  const first = savedRow || (await api.list('grids', { pageSize: 1 })).records[0]
  if (first) { grid.value = first; buildQr(first.gridCode) }
  newName.value = personName(grid.value?.leaderId)
})
</script>
