import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

// 使用 import.meta.glob 让 Vite 静态收集全部页面（含子目录），避免动态变量导入无法生成 chunk
const viewModules = import.meta.glob('../views/**/*.vue')
const L = (p) => viewModules[`../views/${p}.vue`]

const routes = [
  { path: '/login', component: L('Login'), meta: { public: true } },
  { path: '/resident', component: L('Resident'), meta: { public: true } },
  { path: '/screen', component: L('Screen'), meta: { module: 'screen' } },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/portal' },
      { path: 'portal', component: L('Portal'), meta: { module: 'portal' } },
      { path: 'party/org', component: L('party/PartyOrg'), meta: { module: 'party' } },
      { path: 'party/member', component: L('party/PartyMember'), meta: { module: 'party' } },
      { path: 'party/honor', component: L('party/HonorFlow'), meta: { module: 'party' } },
      { path: 'party/meeting', component: L('party/Meeting'), meta: { module: 'party' } },
      { path: 'party/learn', component: L('party/Learn'), meta: { module: 'party' } },
      { path: 'party/history', component: L('party/PartyHistory'), meta: { module: 'party' } },
      { path: 'base/grid', component: L('base/GridManage'), meta: { module: 'base' } },
      { path: 'base/popstats', component: L('base/PopStats'), meta: { module: 'base' } },
      { path: 'base/population', component: L('base/Population'), meta: { module: 'base' } },
      { path: 'base/tags', component: L('base/SpecialTags'), meta: { module: 'base' } },
      { path: 'base/building', component: L('base/BuildingManage'), meta: { module: 'base' } },
      { path: 'base/enterprise', component: L('base/Enterprise'), meta: { module: 'base' } },
      { path: 'base/community', component: L('base/CommunityManage'), meta: { module: 'base' } },
      { path: 'base/part', component: L('base/PartManage'), meta: { module: 'base' } },
      { path: 'panorama', component: L('Panorama'), meta: { module: 'panorama' } },
      { path: 'micro', component: L('MicroStation'), meta: { module: 'micro' } },
      { path: 'service/message', component: L('service/MessageCenter'), meta: { module: 'service' } },
      { path: 'service/overview', component: L('service/OverviewManage'), meta: { module: 'service' } },
      { path: 'service/request', component: L('service/ServiceRequest'), meta: { module: 'service' } },
      { path: 'service/event', component: L('service/GovernanceEvent'), meta: { module: 'service' } },
      { path: 'publish', component: L('Publish'), meta: { module: 'publish' } },
      { path: 'sensing', component: L('Sensing'), meta: { module: 'sensing' } },
      { path: 'geo', component: L('GeoPlatform'), meta: { module: 'geo' } },
      { path: 'ops', component: L('Ops'), meta: { module: 'ops' } }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/portal' }
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const store = useUserStore()
  if (to.meta.public) return true
  if (!store.logged) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.meta.module && !store.allowedModules.includes(to.meta.module)) {
    ElMessage.warning('当前角色无该模块访问权限，已返回首页')
    return { path: '/portal' }
  }
  // 路径级权限：以后端下发的 sys_menu.path 为准，防止手输 URL 绕过菜单。
  // fail-closed：菜单为空时也不能整体跳过校验，只允许回首页。
  if (to.path !== '/portal' && !store.allowedPaths.includes(to.path)) {
    ElMessage.warning('当前角色无该页面访问权限，已返回首页')
    return { path: '/portal' }
  }
  return true
})

export default router
