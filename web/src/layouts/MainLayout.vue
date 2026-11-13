<template>
  <div class="layout">
    <div v-if="mobileOpen && isMobile" class="layout-mask" @click="mobileOpen = false"></div>
    <aside class="layout-side" :class="{ open: mobileOpen, collapsed }">
      <div class="layout-logo">
        <div class="logo-icon"><el-icon><OfficeBuilding /></el-icon></div>
        <div v-if="!collapsed" class="logo-text">智慧社区治理平台<br><span>SMART COMMUNITY · {{ APP_VERSION }}</span></div>
      </div>
      <div class="layout-menu">
        <el-menu :default-active="$route.path" router :collapse="collapsed" :collapse-transition="false"
          background-color="#0e2a68" text-color="#c7d8f7" active-text-color="#fff">
          <template v-for="m in menus" :key="m.key">
            <el-sub-menu v-if="m.children && m.children.length" :index="m.key">
              <template #title><el-icon><component :is="m.icon" /></el-icon><span>{{ m.title }}</span></template>
              <el-menu-item v-for="c in m.children" :key="c.key" :index="c.path">{{ c.title }}</el-menu-item>
            </el-sub-menu>
            <el-menu-item v-else :index="m.path">
              <el-icon><component :is="m.icon" /></el-icon><span>{{ m.title }}</span>
            </el-menu-item>
          </template>
        </el-menu>
      </div>
      <div v-if="!collapsed" class="side-scope">
        数据范围：{{ user?.orgName }}<br>{{ user?.scopeDesc }}
      </div>
    </aside>

    <div class="layout-main">
      <header class="layout-top">
        <div class="flex gap12">
          <el-button class="menu-toggle" size="small" :icon="'Menu'" aria-label="展开导航菜单" @click="mobileOpen = !mobileOpen" />
          <el-icon class="hide-sm" style="color:var(--gov-blue);font-size:18px"><Location /></el-icon>
          <strong style="color:var(--gov-heading)">{{ currentTitle }}</strong>
          <span class="muted hide-md">/ 智慧社区治理平台 {{ APP_VERSION }}</span>
        </div>
        <div class="top-actions">
          <el-autocomplete v-model="searchText" :fetch-suggestions="querySearch" :debounce="300"
            :trigger-on-focus="false" clearable style="width:280px"
            placeholder="全局检索：姓名 / 编号 / 地址" @select="onSearchSelect">
            <template #default="{ item }">
              <div class="global-search-item">
                <el-tag size="small" effect="plain">{{ item._label }}</el-tag>
                <span class="txt">{{ item.value }}</span>
              </div>
            </template>
          </el-autocomplete>
          <el-tooltip :content="liveLabel" placement="bottom">
            <span class="live-flag" :class="'is-' + liveStatus" role="status" :aria-label="'实时数据通道：' + liveShort">
              <span class="live-flag-dot"></span><span class="hide-md">{{ liveShort }}</span>
            </span>
          </el-tooltip>
          <el-badge :value="todoCount" :hidden="!todoCount" :max="99">
            <el-button size="small" :icon="'Bell'" aria-label="查看待办" @click="router.push('/portal')"><span class="hide-sm">待办</span></el-button>
          </el-badge>
          <el-button class="hide-md" size="small" :icon="'Iphone'" @click="openResident">居民端预览</el-button>
          <div class="user-chip hide-sm">
            <el-icon><User /></el-icon>
            <span>{{ user?.name }}</span>
            <span class="role-tag">{{ user?.roleName }}</span>
          </div>
          <el-button size="small" type="danger" plain :icon="'SwitchButton'" @click="logout"><span class="hide-sm">退出</span></el-button>
        </div>
      </header>
      <main class="layout-content"><router-view v-slot="{ Component }"><component :is="Component" /></router-view></main>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { api, RESOURCE_ROUTES } from '@/api'
import { useUserStore } from '@/stores/user'
import { APP_VERSION } from '@/utils/app'
import { startLive, stopLive, onLiveRefresh, liveStatus, liveLabel, liveShort } from '@/utils/live'
import { clearSchema } from '@/utils/schema'
import { openResidentPreview } from '@/utils/grid'

const store = useUserStore()
const route = useRoute()
const router = useRouter()
const menus = computed(() => store.menus)
const user = computed(() => store.user)
const currentTitle = computed(() => {
  const all = []
  const walk = (l) => l.forEach((m) => { all.push(m); if (m.children) walk(m.children) })
  walk(menus.value)
  return all.find((m) => m.path === route.path)?.title || '首页'
})

/* 响应式导航：≤1200px 折叠为图标，≤768px 变抽屉 */
const vw = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const onResize = () => { vw.value = window.innerWidth }
const isMobile = computed(() => vw.value <= 768)
const collapsed = computed(() => vw.value <= 1200 && !isMobile.value)
const mobileOpen = ref(false)
watch(() => route.path, () => { mobileOpen.value = false })
watch(isMobile, (v) => { if (!v) mobileOpen.value = false })

/* 顶栏全局检索：后端 FTS5 已实现模块授权 + 数据范围过滤，前端只负责接线与跳转 */
const searchText = ref('')
let searchSeq = 0
const querySearch = async (q, cb) => {
  const kw = String(q || '').trim()
  if (!kw) return cb([])
  const seq = ++searchSeq
  try {
    const d = await api.search(kw, 10)
    if (seq !== searchSeq) return cb([])  // 丢弃过期响应，避免结果错位
    cb((d?.items || []).map((i) => {
      const [path, label] = RESOURCE_ROUTES[i.resource] || ['/portal', '数据']
      return {
        value: String(i.name || i.title || i.gridName || i.orgName || i.code || i.id || '记录'),
        _label: label, _path: path,
        _keyword: String(i.code || i.id || i.name || i.title || '')
      }
    }))
  } catch (e) { cb([]) }
}
const onSearchSelect = (item) => {
  if (!item?._path) return
  router.push({ path: item._path, query: item._keyword ? { keyword: item._keyword } : {} })
  searchText.value = ''
}

/* 待办红点：优先由实时通道驱动；通道不可用时回落 60 秒轻量轮询 */
const todoCount = ref(0)
let todoTimer = null
let offLiveTodo = null
const loadTodoCount = async () => {
  try { todoCount.value = (await api.todo(1, false, { silentError: true }))?.total ?? 0 }
  catch (e) { /* 静默失败，保持上一次数值，不打扰使用者 */ }
}

onMounted(async () => {
  window.addEventListener('resize', onResize)
  try { store.setProfile(await api.profile()) } catch (e) { /* 忽略 */ }
  loadTodoCount()
  startLive()
  offLiveTodo = onLiveRefresh(loadTodoCount, { minInterval: 4000, topics: ['todo', 'poll'] })
  todoTimer = setInterval(() => { if (liveStatus.value !== 'live') loadTodoCount() }, 60000)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (todoTimer) clearInterval(todoTimer)
  offLiveTodo?.()
  // 不在此处 stopLive：切换到独立全屏路由（如 /screen）时主布局会卸载，
  // 但实时通道是应用级的，应由订阅者自行维持；只有登出才真正关闭连接。
})

const logout = async () => {
  // 确认框放在 try 内，用户点「取消」时不再产生 Uncaught (in promise)
  try {
    await ElMessageBox.confirm('确认退出登录？将清除本地令牌并返回登录页', '退出确认', { type: 'warning' })
  } catch (e) { return }
  try { await api.logout() } catch (e) { /* 忽略 */ }
  // 会话级筛选缓存随退出一并清除，避免下一位使用者看到上一位的检索条件
  try {
    // 统一清理平台会话缓存：筛选条件 + 居民端凭条（含一次性查询码）
    Object.keys(sessionStorage).filter((k) => k.startsWith('zhsq:')).forEach((k) => sessionStorage.removeItem(k))
  } catch (e) { /* 忽略 */ }
  store.clear()
  clearSchema()
  stopLive()          // 退出后不再接收任何变化信号
  router.push('/login')
}
// 居民端预览不再写死演示网格编码：按当前角色的数据范围从服务端取真实网格
const openResident = () => openResidentPreview(user.value)
</script>

<style scoped>
.global-search-item { display: flex; align-items: center; gap: 8px; line-height: 30px; }
.global-search-item .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.logo-text { font-weight: 700; font-size: 15px; letter-spacing: .5px; }
.logo-text span { font-size: 10px; font-weight: 400; opacity: .6; }
.side-scope { padding: 12px 16px; color: #8fa8d8; font-size: 11px; border-top: 1px solid rgba(255, 255, 255, .1); }
.layout-side.collapsed { width: 64px; }
.layout-side.collapsed .layout-logo { padding: 0 17px; }
.menu-toggle { display: none; }
.live-flag { display: inline-flex; align-items: center; gap: 6px; padding: 0 6px; font-size: 12px; color: var(--gov-sub); white-space: nowrap; }
.live-flag-dot { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; display: inline-block; flex: none; }
.live-flag.is-live .live-flag-dot { background: #16a34a; box-shadow: 0 0 0 3px rgba(22, 163, 74, .16); }
.live-flag.is-polling .live-flag-dot { background: #f59e0b; }
.live-flag.is-connecting .live-flag-dot { background: var(--gov-blue); animation: live-pulse 1.2s ease-in-out infinite; }
@keyframes live-pulse { 50% { opacity: .35; transform: scale(.75); } }
@media (max-width: 768px) {
  .menu-toggle { display: inline-flex; }
}
</style>
