import { useUserStore } from '@/stores/user'

/**
 * 按钮级权限：v-permission="'ops'" / v-permission="['ops','screen']"
 *
 * 注意：这是 UI 层的可见性控制，不是安全边界；服务端已对每个资源做 assertResource 校验。
 * 实现上不物理删除 DOM（会破坏 Vue 的 vnode 引用），改为隐藏并在权限刷新后重算。
 */
const apply = (el, binding) => {
  const store = useUserStore()
  const keys = (Array.isArray(binding.value) ? binding.value : [binding.value]).filter(Boolean)
  if (!keys.length) return
  const allowed = keys.some((k) => store.can(k) || store.allowedModules.includes(k))
  el.style.display = allowed ? '' : 'none'
  el.setAttribute('aria-hidden', allowed ? 'false' : 'true')
}

export default {
  mounted: apply,
  updated: apply
}
