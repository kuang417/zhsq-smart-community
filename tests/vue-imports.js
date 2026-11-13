/**
 * 前端静态防线：检测 .vue 的 <script> 中使用了 Vue / Element Plus 具名 API 却漏写 import。
 *
 * 背景：Vite / Rollup 构建不会校验自由变量，漏导入（如 reactive）能 0 error 构建通过，
 * 但浏览器执行 setup 时会抛 ReferenceError 导致整页白屏。
 * 本测试不依赖服务、不依赖浏览器，纳入 test:all 常驻，作为真机回归之外的兜底。
 *
 * 用法：node tests/vue-imports.js
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'web', 'src')

const VUE_APIS = [
  'ref', 'reactive', 'computed', 'watch', 'watchEffect', 'shallowRef', 'shallowReactive',
  'toRef', 'toRefs', 'unref', 'isRef', 'nextTick', 'onMounted', 'onBeforeMount',
  'onUpdated', 'onBeforeUpdate', 'onUnmounted', 'onBeforeUnmount', 'onActivated',
  'onDeactivated', 'inject', 'provide', 'getCurrentInstance', 'useSlots', 'useAttrs',
  'markRaw', 'toRaw', 'readonly', 'h', 'defineAsyncComponent', 'customRef', 'triggerRef'
]
const EP_APIS = ['ElMessage', 'ElMessageBox', 'ElNotification', 'ElLoading', 'ElConfigProvider']

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 200) })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + String(detail).slice(0, 150) : ''}`)
}

const files = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.vue')) files.push(p)
  }
}
walk(SRC)

const isIdentChar = (c) => c !== undefined && /[A-Za-z0-9_$.]/.test(c)
/** 检测标识符是否被真正调用（name(...) / name(...)），排除对象成员与更长标识符 */
const hasCall = (text, name) => {
  let i = 0
  while (true) {
    i = text.indexOf(name + '(', i)
    if (i === -1) return false
    if (!isIdentChar(text[i - 1])) return true
    i += name.length
  }
}
const hasMemberUse = (text, name) => {
  let i = 0
  while (true) {
    i = text.indexOf(name + '.', i)
    if (i === -1) return false
    if (!isIdentChar(text[i - 1])) return true
    i += name.length
  }
}
/** 收集 `import { a, b as c } from 'xxx'` 绑定的本地名字（按来源模块过滤） */
const importedFrom = (body, module) => {
  const names = new Set()
  const re = new RegExp("import\\s*\\{([^}]*)\\}\\s*from\\s*['\"]" + module + "['\"]", 'g')
  for (const m of body.matchAll(re)) {
    m[1].split(',').forEach((s) => {
      const local = s.trim().split(/\s+as\s+/).pop().trim()
      if (local) names.add(local)
    })
  }
  return names
}

const vueMissing = []
const epMissing = []
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const m = src.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  if (!m) continue
  // 去掉注释，避免注释里的示例文字造成误报
  const body = m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  const vueImported = importedFrom(body, 'vue')
  const epImported = importedFrom(body, 'element-plus')
  for (const api of VUE_APIS) {
    if (hasCall(body, api) && !vueImported.has(api)) vueMissing.push(`${rel} → ${api}`)
  }
  for (const api of EP_APIS) {
    if ((hasCall(body, api) || hasMemberUse(body, api)) && !epImported.has(api)) epMissing.push(`${rel} → ${api}`)
  }
}

check(`扫描前端组件（共 ${files.length} 个 .vue）`, files.length >= 30, `files=${files.length}`)
check('所有组件无漏导入的 Vue 组合式 API', vueMissing.length === 0, vueMissing.join('; '))
check('所有组件无漏导入的 Element Plus 具名 API', epMissing.length === 0, epMissing.join('; '))

// 固化本次事故：GeoPlatform.vue 曾因 reactive 未导入导致 /geo 整页崩溃
const geo = fs.readFileSync(path.join(SRC, 'views', 'GeoPlatform.vue'), 'utf8')
check('GeoPlatform.vue 显式从 vue 导入 reactive', /import\s*\{[^}]*\breactive\b[^}]*\}\s*from\s*['"]vue['"]/.test(geo))

const failed = checks.filter((c) => !c.ok)
console.log(`\n=== 结果：${checks.length - failed.length} 项通过 / ${failed.length} 项失败 ===`)
if (failed.length) { failed.forEach((f) => console.log('❌ ' + f.name + ' → ' + f.detail)); process.exitCode = 1 }
