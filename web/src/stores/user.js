import { defineStore } from 'pinia'
import { api } from '@/api'
import { setToken, clearTokens, getToken } from '@/api/token'

/** 会话信息全在内存；页面刷新后由 main.js 调 restore() 用 HttpOnly Cookie 静默恢复 */
export const useUserStore = defineStore('user', {
  state: () => ({
    token: '',
    user: null,
    menus: [],
    permissions: [],
    dicts: null
  }),
  getters: {
    logged: (s) => !!s.token,
    role: (s) => s.user?.role || '',
    orgLevel: (s) => s.user?.orgLevel || 4,
    allowedModules: (s) => {
      const out = []
      const walk = (list) => list.forEach((m) => { out.push(m.module); if (m.children) walk(m.children) })
      walk(s.menus)
      return [...new Set(out)]
    },
    /** 路由路径级权限：后端下发的菜单 path 集合 */
    allowedPaths: (s) => {
      const out = []
      const walk = (list) => list.forEach((m) => { if (m.path) out.push(m.path); if (m.children) walk(m.children) })
      walk(s.menus)
      return out
    },
    can: (s) => (key) => s.permissions.includes(key)
  },
  actions: {
    setSession(data) {
      this.token = data.token
      this.user = data.user
      this.menus = data.menus || []
      this.permissions = data.permissions || []
      setToken(data.token)
    },
    setProfile(data) {
      this.user = data.user
      this.menus = data.menus || []
      this.permissions = data.permissions || []
    },
    clear() {
      this.token = ''
      this.user = null
      this.menus = []
      this.permissions = []
      this.dicts = null
      clearTokens()
    },
    /** 页面刷新时恢复会话；复用 request.js 的 refresh 单例，避免与 401 自动刷新并发把 refresh 令牌互相吊销 */
    async restore() {
      try {
        const { refreshSession } = await import('@/api/request')
        if (!(await refreshSession())) { this.clear(); return false }
        const data = await api.profile()
        this.token = getToken()
        this.user = data.user
        this.menus = data.menus || []
        this.permissions = data.permissions || []
        return true
      } catch { this.clear(); return false }
    },
    async loadDicts(injected) {
      if (!this.dicts) this.dicts = await (injected || api).dicts()
      return this.dicts
    }
  }
})
