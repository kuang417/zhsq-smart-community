import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import { useUserStore } from './stores/user'
import permission from './directives/permission'
import './styles/main.css'

const app = createApp(App)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })
app.directive('permission', permission)

// 令牌只在内存：需要登录的页面才用 HttpOnly Cookie 静默换发 access；
// 登录页 / 居民端无需会话，避免产生无意义的 401 请求
const isPublicPage = ['/login', '/resident'].some((p) => window.location.pathname.startsWith(p))
const user = useUserStore()
const ready = isPublicPage ? Promise.resolve(false) : user.restore()
ready.finally(() => {
  app.use(router)
  app.mount('#app')
})
