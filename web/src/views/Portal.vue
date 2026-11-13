<template>
  <div class="portal">
    <div class="portal-hero">
      <h1>智慧社区治理平台 · 统一门户</h1>
      <p>{{ user?.orgName }} ｜ {{ user?.roleName }} ｜ {{ user?.scopeDesc }} ｜ 数据截至 {{ todo?.generatedAt || '加载中' }} ｜ {{ liveLabel }}</p>
    </div>

    <StatCards :items="kpis" class="mb12" @select="onKpi" />

    <div class="portal-cols">
      <div class="portal-panel">
        <h3><el-icon><Briefcase /></el-icon> 工作应用</h3>
        <div class="app-grid">
          <div v-for="a in workApps" :key="a.title" class="app-card" :class="{ disabled: !can(a.module) }" @click="go(a)">
            <div class="app-icon"><el-icon><component :is="a.icon" /></el-icon></div>
            <div class="app-name">{{ a.title }}</div>
            <div class="app-sub">{{ can(a.module) ? a.sub : '当前角色无权限' }}</div>
          </div>
        </div>
      </div>
      <div class="portal-panel">
        <h3><el-icon><Service /></el-icon> 服务应用</h3>
        <div class="app-grid">
          <div v-for="a in serviceApps" :key="a.title" class="app-card" :class="{ disabled: !can(a.module) }" @click="go(a)">
            <div class="app-icon"><el-icon><component :is="a.icon" /></el-icon></div>
            <div class="app-name">{{ a.title }}</div>
            <div class="app-sub">{{ can(a.module) ? a.sub : '当前角色无权限' }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="portal-panel" style="margin-top:16px">
      <h3><el-icon><DataBoard /></el-icon> 三大平台</h3>
      <div class="platform-grid">
        <div v-for="a in platforms" :key="a.title" v-permission="a.module" class="platform-card" :class="{ disabled: !can(a.module) }" @click="go(a)">
          <div><div class="t">{{ a.title }}</div><div class="s">{{ can(a.module) ? a.sub : '当前角色无权限' }}</div></div>
          <el-icon><component :is="a.icon" /></el-icon>
        </div>
      </div>
    </div>

    <!-- 真工作台：待办按状态聚合、按角色数据范围过滤，行可点击直达对应模块 -->
    <div class="portal-panel" style="margin-top:16px">
      <div class="flex gap8" style="align-items:center;margin-bottom:10px">
        <h3 style="margin:0"><el-icon><Bell /></el-icon> 我的待办</h3>
        <el-tag size="small" type="danger" effect="plain">共 {{ todo?.total ?? 0 }} 条</el-tag>
        <el-tag size="small" type="warning" effect="plain">超期 {{ todo?.overdue?.total ?? 0 }} 条</el-tag>
        <span class="spacer"></span>
        <!-- 不用 inline-prompt：两种状态都要有可见文字，用户才知道这个开关在筛什么 -->
        <el-switch v-model="overdueOnly" active-text="仅看超期" inactive-text="全部待办" aria-label="仅看超期待办" @change="loadTodo" />
        <span class="muted hide-sm" style="font-size:12px">点击任意一行可直接前往处理</span>
        <el-button size="small" :icon="'Refresh'" :loading="todoLoading" @click="loadTodo">刷新</el-button>
      </div>
      <el-alert v-if="todoError" type="error" :closable="false" :title="todoError" style="margin-bottom:10px">
        <el-button size="small" @click="loadTodo">重试</el-button>
      </el-alert>
      <el-tabs v-model="todoTab">
        <el-tab-pane v-for="g in todoGroups" :key="g.key" :name="g.key">
          <template #label>{{ g.label }}（{{ todo?.counts?.[g.key] ?? 0 }}）</template>
          <el-table :data="todo?.groups?.[g.key] || []" size="small" border v-loading="todoLoading" @row-click="openTodo">
            <el-table-column v-for="c in todoColumns[g.key]" :key="c.prop" :prop="c.prop" :label="c.label"
              :min-width="c.width || 130" show-overflow-tooltip />
            <el-table-column label="办理时限" width="150">
              <template #default="{ row }">
                <el-tag v-if="row._sla?.overdue" size="small" type="danger" effect="dark">超期 {{ Math.round(row._sla.ageHours - row._sla.slaHours) }}h</el-tag>
                <el-tag v-else-if="row._sla?.ageHours != null" size="small" type="success" effect="plain">余 {{ Math.max(0, Math.round(row._sla.remainingHours)) }}h</el-tag>
                <span v-else class="muted">未设时限</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }"><el-tag size="small" :type="statusType(row.status)">{{ row.status }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="90" align="center">
              <template #default="{ row }"><el-button link type="primary" size="small" @click.stop="openTodo(row)">去处理</el-button></template>
            </el-table-column>
            <template #empty>
              <span class="muted">当前数据范围内暂无待处理事项</span>
            </template>
          </el-table>
        </el-tab-pane>
      </el-tabs>
      <div class="muted" style="font-size:12px;margin-top:8px">
        时限口径：{{ todo?.sla?.note || '按业务提交 / 上报 / 告警时刻起算' }}；
        办事 {{ todo?.sla?.byFlow?.['办事'] ?? 48 }}h ｜ 治理万家 {{ todo?.sla?.byFlow?.['治理万家'] ?? 24 }}h ｜ 告警 {{ todo?.sla?.byFlow?.['告警'] ?? 4 }}h。超期只提醒，不自动改变状态。
      </div>
      <div class="flex" style="justify-content:flex-end;margin-top:8px">
        <el-button link type="primary" @click="goAllTodo">在业务模块查看全部 →</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import { useUserStore } from '@/stores/user'
import { statusType } from '@/utils/format'
import { liveLabel, onLiveRefresh } from '@/utils/live'
import StatCards from '@/components/StatCards.vue'

const router = useRouter()
const store = useUserStore()
const user = computed(() => store.user)
const can = (module) => store.allowedModules.includes(module)
const go = (a) => can(a.module) ? router.push(a.path) : ElMessage.warning(`「${a.title}」不在当前角色的可见菜单范围内`)

const overview = ref({})
const todo = ref(null)
const todoError = ref('')
const todoLoading = ref(false)
const todoTab = ref('events')
const overdueOnly = ref(false)
let offLiveTodo = null

const todoGroups = [
  { key: 'events', label: '治理万家', path: '/service/event', module: 'service' },
  { key: 'requests', label: '便民办事', path: '/service/request', module: 'service' },
  { key: 'alarms', label: '感知告警', path: '/sensing', module: 'sensing' }
]
const todoColumns = {
  events: [
    { prop: 'title', label: '事件标题', width: 220 }, { prop: 'type', label: '类型' },
    { prop: 'location', label: '地点', width: 180 }, { prop: 'reportTime', label: '上报时间', width: 160 }
  ],
  requests: [
    { prop: 'item', label: '办理事项', width: 180 }, { prop: 'applicant', label: '申请人' },
    { prop: 'gridCode', label: '网格编码', width: 150 }, { prop: 'submitTime', label: '提交时间', width: 160 }
  ],
  alarms: [
    { prop: 'type', label: '预警类型' }, { prop: 'location', label: '地点', width: 190 },
    { prop: 'gridCode', label: '网格编码', width: 150 }, { prop: 'alarmTime', label: '告警时间', width: 160 }
  ]
}

const kpis = computed(() => [
  { name: '实有人口', value: overview.value.population || 0, unit: '人', path: '/base/population' },
  { name: '实有房屋', value: overview.value.houses || 0, unit: '套', path: '/base/building' },
  { name: '建筑 / 网格', value: overview.value.buildings || 0, unit: '栋', path: '/base/building' },
  { name: '网格', value: overview.value.grids || 0, unit: '个', path: '/base/grid' },
  { name: '党员', value: overview.value.partyMembers || 0, unit: '人', path: '/party/member' },
  { name: '企业', value: overview.value.enterprises || 0, unit: '家', path: '/base/enterprise' },
  { name: '待办事件', value: todo.value?.counts?.events ?? overview.value.pendingEvents ?? 0, unit: '件', path: '/service/event' },
  { name: '待处置告警', value: todo.value?.counts?.alarms ?? overview.value.pendingAlarms ?? 0, unit: '条', path: '/sensing' },
  { name: '超期待办', value: todo.value?.overdue?.total ?? 0, unit: '件', path: '/service/event' }
])
const onKpi = (it) => router.push(it.path)

const workApps = [
  { title: '党建引领', sub: '组织树 / 党员 / 三会一课', icon: 'Flag', path: '/party/org', module: 'party' },
  { title: '数据全景', sub: '四页签综合查询', icon: 'Search', path: '/panorama', module: 'panorama' },
  { title: '基础信息', sub: '人口 / 房屋 / 网格', icon: 'OfficeBuilding', path: '/base/grid', module: 'base' }
]
const serviceApps = [
  { title: '便民服务', sub: '办事 / 治理万家', icon: 'Service', path: '/service/request', module: 'service' },
  { title: '发布系统', sub: '新闻 / 政策 / 活动', icon: 'Document', path: '/publish', module: 'publish' },
  { title: '网格微站', sub: '微站信息 / 便民码', icon: 'Grid', path: '/micro', module: 'micro' }
]
const platforms = [
  { title: '感知平台', sub: '五大主题 · 设备告警联动', icon: 'Warning', path: '/sensing', module: 'sensing' },
  { title: '决策大屏', sub: '人口分析 · 地图三级下钻', icon: 'DataBoard', path: '/screen', module: 'screen' },
  { title: '地理平台', sub: '五图层 · 热力图 · 空间查询', icon: 'Location', path: '/geo', module: 'geo' }
]

const loadTodo = async () => {
  todoLoading.value = true
  todoError.value = ''
  try { todo.value = await api.todo(8, overdueOnly.value) }
  catch (e) { todoError.value = e?.response?.data?.message || e?.message || '待办数据加载失败' }
  finally { todoLoading.value = false }
}
const openTodo = (row) => {
  const g = todoGroups.find((x) => x.key === row._group) || todoGroups[0]
  if (!can(g.module)) return ElMessage.warning('当前角色无该模块访问权限')
  router.push({ path: g.path, query: { status: row.status } })
}
const goAllTodo = () => {
  const g = todoGroups.find((x) => x.key === todoTab.value) || todoGroups[0]
  router.push(g.path)
}

onMounted(async () => {
  try { overview.value = await api.overview() } catch (e) { /* 拦截器已提示 */ }
  loadTodo()
  // 待办工作台由实时通道驱动；降级轮询时同样会收到 poll 信号
  offLiveTodo = onLiveRefresh(loadTodo, { minInterval: 5000, topics: ['todo', 'poll'] })
})
onBeforeUnmount(() => offLiveTodo?.())
</script>
