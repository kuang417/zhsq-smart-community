<template>
  <div class="login-view">
    <div class="login-glow"></div>
    <div class="grid-login">
      <div class="login-intro">
        <div class="flex gap12" style="margin-bottom:24px">
          <div class="login-mark">◈</div>
          <div>
            <div class="login-name">智慧社区治理平台</div>
            <div class="login-en">SMART COMMUNITY GOVERNANCE · {{ APP_VERSION }}</div>
          </div>
        </div>
        <h1>数据一屏统览<br>事件闭环留痕</h1>
        <p>区 → 街道 → 社区 → 网格 四级组织体系<br>九大业务模块 + 运营中心 · ECharts 自绘可视化 · 全链路加密与审计</p>
        <div class="login-highlights">
          <div v-for="s in highlights" :key="s">{{ s }}</div>
        </div>
        <div class="login-note">以上为当前部署库的实时统计，首次部署的空库显示为 0</div>
      </div>

      <el-card class="login-card">
        <h2>账号登录</h2>
        <p class="muted">四级角色数据范围逐级收窄，账号由系统管理员统一分配</p>
        <el-form label-position="top" @keyup.enter="doLogin">
          <el-form-item label="账号">
            <el-input v-model="username" size="large" placeholder="请输入账号" :prefix-icon="'User'" autocomplete="username" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="password" size="large" type="password" show-password placeholder="请输入密码" :prefix-icon="'Lock'" autocomplete="current-password" />
          </el-form-item>
          <el-button type="primary" size="large" style="width:100%;min-height:44px" :loading="loading" @click="doLogin">登 录</el-button>
        </el-form>
        <el-divider><span class="muted">安全提示</span></el-divider>
        <div class="muted login-tips">
          · 密码加盐哈希存储，连续错误登录将被限流<br>
          · 令牌 2 小时有效，刷新令牌存于 HttpOnly Cookie<br>
          · 明文查看身份证 / 手机号需二次验密授权
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import { useUserStore } from '@/stores/user'
import { APP_VERSION } from '@/utils/app'

const username = ref('')
const password = ref('')
const loading = ref(false)
const router = useRouter()
const route = useRoute()
const store = useUserStore()

/* 登录页统计数字来自公开健康接口的真实库计数，不再写死演示数据 */
const counts = ref(null)
const fmt = (v) => typeof v === 'number' ? v.toLocaleString('zh-CN') : '0'
const highlights = computed(() => {
  const c = counts.value?.counts
  if (!c) return ['四级组织体系', '九大业务模块', '全链路加密', '操作全程留痕']
  return [`${fmt(c.grids)} 网格`, `${fmt(c.population)} 人口`, `${fmt(c.houses)} 房屋`, `${fmt(counts.value?.storage?.tables)} 张数据表`]
})
onMounted(async () => {
  try { counts.value = await api.health() } catch (e) { /* 健康接口不可用时保持能力描述，不阻断登录 */ }
})

const doLogin = async () => {
  if (!username.value.trim() || !password.value) return ElMessage.warning('请输入账号和密码')
  loading.value = true
  try {
    const data = await api.login(username.value.trim(), password.value)
    store.setSession(data)
    ElMessage.success(`欢迎回来，${data.user.name}（${data.user.orgName}）`)
    // 开放重定向防护：用 URL 归一化后的 origin 判断，拦截 //evil.com、/\evil.com 等变体
    const target = String(route.query.redirect || '')
    let safe = '/portal'
    if (target.startsWith('/')) {
      try {
        const u = new URL(target, window.location.origin)
        if (u.origin === window.location.origin && !/^\/\//.test(target) && !/^\/[\\]/.test(target)) {
          safe = u.pathname + u.search + u.hash
        }
      } catch (e) { /* 非法 target 保持默认门户 */ }
    }
    router.push(safe)
  } catch (e) { /* 拦截器已提示，防止 Uncaught (in promise) */ }
  finally { loading.value = false }
}
</script>

<style scoped>
.login-view {
  min-height: 100vh; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden;
  background: linear-gradient(125deg, #0b235c 0%, var(--gov-blue) 55%, var(--gov-cyan) 100%);
}
.login-glow {
  position: absolute; inset: 0;
  background: radial-gradient(circle at 78% 20%, rgba(255, 255, 255, .12), transparent 45%),
              radial-gradient(circle at 15% 80%, rgba(56, 189, 248, .2), transparent 40%);
}
.grid-login { position: relative; z-index: 1; color: #fff; }
.login-mark {
  width: 46px; height: 46px; border-radius: var(--r-lg); background: rgba(255, 255, 255, .16);
  display: grid; place-items: center; font-size: 24px; border: 1px solid rgba(255, 255, 255, .3);
}
.login-name { font-size: var(--fs-xl); font-weight: 800; letter-spacing: 2px; }
.login-en { font-size: var(--fs-sm); opacity: .75; letter-spacing: 3px; }
.login-intro h1 { font-size: 34px; margin: 0 0 var(--r-xl); line-height: 1.35; letter-spacing: 1px; }
.login-intro p { opacity: .85; line-height: 2; font-size: var(--fs-base); margin: 0; }
.login-highlights { display: flex; gap: var(--sp-6); margin-top: 32px; flex-wrap: wrap; }
.login-highlights div { font-size: 13px; opacity: .9; border-left: 2px solid rgba(255, 255, 255, .5); padding-left: var(--r-md); }
.login-note { font-size: var(--fs-xs); opacity: .65; margin-top: var(--sp-3); }
.login-card { border-radius: var(--r-xl) !important; padding: var(--r-md) var(--sp-2); box-shadow: 0 20px 60px rgba(0, 0, 0, .25); }
.login-card h2 { margin: 6px 0 var(--sp-1); color: var(--gov-heading); font-size: 20px; }
.login-card > :deep(p) { margin: 0 0 20px; }
.login-tips { font-size: var(--fs-sm); line-height: 1.9; }
@media (max-width: 768px) {
  .login-intro { display: none; }
  .grid-login { max-width: 420px; width: 94%; }
}
</style>
