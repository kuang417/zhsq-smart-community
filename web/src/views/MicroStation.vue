<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">网格微站</h2>
      <div class="page-desc">四级组织树浏览；每个网格挂载唯一便民码，支持下载与打印；查看微站基本信息与人员构成（网格长、网格员、党员数等）（F5-1~F5-3）。</div>
    </div>
    <div class="grid-side-300">
      <div class="page-card">
        <h3 class="section-title">区 → 街道 → 社区 → 网格</h3>
        <el-input v-model="kw" placeholder="组织名称检索" clearable size="small" class="mb12" />
        <el-tree :data="tree" :props="{ children: 'children', label: 'orgName' }" highlight-current
          :filter-node-method="(v, d) => !v || d.orgName.includes(v)" ref="treeRef" @node-click="onNode" style="max-height:540px;overflow:auto">
          <template #default="{ data }"><div class="flex gap8"><el-tag size="small" effect="plain">{{ data.levelName }}</el-tag><span style="font-size:13px">{{ data.orgName }}</span></div></template>
        </el-tree>
      </div>
      <div>
        <div class="page-card" v-if="grid">
          <div class="flex gap8 mb12">
            <h3 class="section-title" style="margin:0;flex:1">{{ grid.gridName }} · 微站信息</h3>
            <el-button size="small" plain :icon="'Edit'" @click="$router.push('/base/grid')">维护人员</el-button>
            <el-button size="small" type="primary" :icon="'FullScreen'" @click="qrVisible = true">便民码下载 / 打印</el-button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 150px;gap:14px">
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="网格编码">{{ grid.gridCode }}</el-descriptions-item>
              <el-descriptions-item label="所属社区">{{ communityName }}</el-descriptions-item>
              <el-descriptions-item label="网格长">{{ personName(grid.leaderId) }}</el-descriptions-item>
              <el-descriptions-item label="网格员">{{ (Array.isArray(grid.workerIds) ? grid.workerIds : []).map(personName).join('、') }}</el-descriptions-item>
              <el-descriptions-item label="党员数">{{ grid.partyMemberCount }} 人</el-descriptions-item>
              <el-descriptions-item label="实有人口">{{ grid.populationCount }} 人</el-descriptions-item>
              <el-descriptions-item label="便民码链接" :span="2"><span style="color:#1d4ed8;word-break:break-all">{{ qrUrl }}</span></el-descriptions-item>
            </el-descriptions>
            <div style="text-align:center">
              <img v-if="qrImg" :src="qrImg" width="132" height="132" style="border:1px solid #e5eaf3;border-radius:6px;background:#fff" />
              <div class="muted" style="margin-top:6px">扫码进入本网格居民端</div>
            </div>
          </div>
        </div>
        <div class="page-card">
          <h3 class="section-title">微站列表</h3>
          <div class="toolbar">
            <el-input v-model="keyword" placeholder="网格名称 / 编码" clearable style="width:220px" @keyup.enter="loadList" />
            <el-button type="primary" :icon="'Search'" @click="loadList">查询</el-button>
            <span class="spacer"></span><span class="muted">共 {{ total }} 个微站</span>
          </div>
          <el-table :data="list" size="small" border max-height="320" @row-click="pickRow">
            <el-table-column prop="gridName" label="微站名称" minWidth="180" />
            <el-table-column prop="gridCode" label="网格编码" width="140" />
            <el-table-column prop="populationCount" label="实有人口" width="110" />
            <el-table-column prop="partyMemberCount" label="党员数" width="90" />
            <el-table-column label="便民码" width="110">
              <template #default="{ row }"><el-button link type="primary" size="small" @click.stop="openQr(row)">查看 / 下载</el-button></template>
            </el-table-column>
          </el-table>
          <div class="flex" style="justify-content:flex-end;margin-top:10px">
            <el-pagination background layout="prev, pager, next" :total="total" v-model:current-page="pageNum" :page-size="10" @change="loadList" />
          </div>
        </div>
      </div>
    </div>
    <QrDialog v-model="qrVisible" :grid-code="grid?.gridCode || ''" :grid-name="grid?.gridName || ''" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import QRCode from 'qrcode'
import { api } from '@/api'
import QrDialog from '@/components/QrDialog.vue'
import { onLiveRefresh } from '@/utils/live'

const tree = ref([])
const grid = ref(null)
const persons = ref(new Map())
const orgNames = ref(new Map())
const qrImg = ref('')
const qrUrl = ref('')
const qrVisible = ref(false)
const kw = ref('')
const treeRef = ref(null)
const keyword = ref('')
const pageNum = ref(1)
const total = ref(0)
const list = ref([])
watch(kw, (v) => treeRef.value?.filter(v))
const personName = (id) => persons.value.get(id) || id || '-'
// 与「网格组织 / 网格台账」共享当前选中网格，避免两页各选一个网格造成人员看起来不一致
const CURRENT_GRID_KEY = 'zhsq:currentGridCode'
const communityName = ref('')
let offLive = null

const loadList = async () => {
  const d = await api.list('grids', { pageNum: pageNum.value, pageSize: 10, keyword: keyword.value })
  list.value = d.records
  total.value = d.total
}
const selectGrid = async (g) => {
  grid.value = g
  sessionStorage.setItem(CURRENT_GRID_KEY, g.gridCode)
  communityName.value = orgNames.value.get(g.parentCode) || g.parentCode
  const d = await api.qr(g.gridCode)
  qrUrl.value = d.url
  qrImg.value = await QRCode.toDataURL(d.url, { width: 260, margin: 1, color: { dark: '#12318c' } })
}
const onNode = async (node) => {
  if (node.orgLevel === 4) {
    const d = await api.list('grids', { gridCode: node.orgCode, pageSize: 1 })
    if (d.records[0]) selectGrid(d.records[0])
  }
}
const pickRow = (row) => selectGrid(row)
const openQr = (row) => { selectGrid(row); qrVisible.value = true }
const refreshPersons = async () => {
  const p = await api.list('persons', { pageSize: 500 }).catch(() => null)
  persons.value = new Map((Array.isArray(p?.records) ? p.records : []).map((x) => [x.id, x.name]))
}
const refreshCurrentGrid = async () => {
  if (!grid.value?.gridCode) return
  const d = await api.list('grids', { gridCode: grid.value.gridCode, pageSize: 1 }).catch(() => null)
  if (d?.records?.[0]) grid.value = d.records[0]
}
onMounted(async () => {
  tree.value = await api.orgTree()
  const [p, o] = await Promise.all([api.list('persons', { pageSize: 500 }), api.orgOptions(0)])
  persons.value = new Map(p.records.map((x) => [x.id, x.name]))
  orgNames.value = new Map(o.map((x) => [x.value, x.label]))
  await loadList()
  const saved = sessionStorage.getItem(CURRENT_GRID_KEY)
  const savedRow = saved ? (await api.list('grids', { gridCode: saved, pageSize: 1 }).catch(() => null))?.records?.[0] : null
  const target = savedRow || list.value[0]
  if (target) selectGrid(target)
  // 人员主数据 / 网格绑定变更后自动同步，避免「网格组织改了、微站还是旧人名」
  offLive = onLiveRefresh(async () => { await refreshPersons(); await refreshCurrentGrid() },
    { minInterval: 10000, topics: ['persons', 'grids', 'poll'] })
})
onBeforeUnmount(() => offLive?.())
</script>
