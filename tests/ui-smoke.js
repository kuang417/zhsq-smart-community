/**
 * 自包含前端真机回归：Node 22 内置 fetch / WebSocket + 本机 Chrome DevTools Protocol。
 * 不依赖 Tabbit / Playwright / Puppeteer 等外部自动化通道。
 *
 * 用法：先启动服务，再执行 npm run test:ui
 * 环境变量：ZHSQ_UI_BASE_URL（默认 http://127.0.0.1:8081）、CHROME_PATH（可选）
 *
 * 说明：会提交一条居民端测试申请以验证凭条链路，结束后通过管理员接口删除该业务主记录；
 * 如需彻底恢复干净演示数据，可执行 npm run reset。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.ZHSQ_UI_BASE_URL || 'http://127.0.0.1:8081'
const PORT = Number(process.env.ZHSQ_UI_CDP_PORT || 9333)
const TMP = path.join(os.tmpdir(), `zhsq-ui-smoke-${Date.now()}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chromeCandidates = [
  process.env.CHROME_PATH,
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)
const CHROME = chromeCandidates.find((p) => fs.existsSync(p))

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 180) })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + String(detail).slice(0, 120) : ''}`)
}

async function cleanupBusinessRecord(code) {
  if (!code) return
  try {
    const login = await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json()
    const token = login?.data?.token
    if (!token) return
    const list = await (await fetch(`${BASE}/api/serviceRequests?keyword=${encodeURIComponent(code)}&pageSize=5`, {
      headers: { Authorization: `Bearer ${token}` }
    })).json()
    const row = list?.data?.records?.find((r) => r.code === code)
    if (row) await fetch(`${BASE}/api/serviceRequests/${encodeURIComponent(row.id)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    })
  } catch (e) { /* 清理失败不掩盖测试结果，由 npm run reset 兜底 */ }
}

async function main() {
  if (!CHROME) {
    console.log('⚠️ 未找到 Chrome / Edge，跳过真机回归（本机安装浏览器后请重跑 npm run test:ui）')
    return
  }
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null)
  if (!health || health.code !== 0) throw new Error(`服务未就绪：${BASE}/api/health`)

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${TMP}`, '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' })
  const cleanup = () => {
    try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) { /* 忽略 */ }
    try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) { /* 忽略 */ }
  }

  try {
    let ver = null
    for (let i = 0; i < 40; i++) {
      try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break }
      catch (e) { await sleep(250) }
    }
    if (!ver) throw new Error('Chrome CDP 端口未就绪')
    console.log(`浏览器：${ver.Browser}\n`)

    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/login')}`, { method: 'PUT' })).json()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    let seq = 0
    const pending = new Map()
    const errors = []
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data)
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
      if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + String(m.params?.exceptionDetails?.text || '').slice(0, 160))
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error')
        errors.push('console: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 160))
    }
    const cmd = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时: ' + method)) } }, 15000)
    })
    const ev = async (expression) => {
      const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.text))
      return r.result?.result?.value
    }
    const goto = async (p, wait = 1000) => { await cmd('Page.navigate', { url: BASE + p }); await sleep(wait) }
    const clickText = (selector, text) => ev(`(() => { const b=[...document.querySelectorAll('${selector}')].find(x=>x.innerText.includes('${text}')); if(b){b.click(); return true} return false })()`)
    const setInput = (expression) => ev(`(() => { const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}; ${expression}; return true })()`)

    await cmd('Page.enable'); await cmd('Runtime.enable')

    /* 1. 登录页：版本统一、统计数字来自真实库、无演示账号提示 */
    await goto('/login', 1200)
    const loginPage = await ev(`(() => ({
      version: document.querySelector('.login-en')?.innerText || '',
      highlights: document.querySelector('.login-highlights')?.innerText.replace(/\\n/g,' | ') || '',
      hasDemoWord: /DEMO|演示|模拟|一键登录/.test(document.body.innerText),
      labels: [...document.querySelectorAll('.login-card .el-form-item__label')].map(x=>x.innerText)
    }))()`)
    check('登录页版本统一为 V2.6', loginPage.version.includes('V2.6'), loginPage.version)
    check('登录页统计数字动态取库', /网格/.test(loginPage.highlights) && /人口/.test(loginPage.highlights), loginPage.highlights)
    check('登录页无演示 / 模拟文案', !loginPage.hasDemoWord)
    check('登录表单有可见 label', loginPage.labels.includes('账号') && loginPage.labels.includes('密码'), loginPage.labels.join('/'))

    await setInput(`set(document.querySelector('input[autocomplete="username"]'),'admin'); set(document.querySelector('input[autocomplete="current-password"]'),'admin123')`)
    await ev(`document.querySelector('.login-card button').click()`)
    let logged = false
    for (let i = 0; i < 30; i++) { await sleep(300); if (await ev('location.pathname') === '/portal') { logged = true; break } }
    check('管理员可正常登录并进入工作台', logged)
    if (!logged) throw new Error('登录失败，后续页面无法验证')

    /* 2. 全站页面遍历：渲染 + 运行时异常 */
    const paths = ['/portal', '/party/org', '/party/member', '/party/honor', '/party/meeting', '/party/learn', '/party/history',
      '/base/grid', '/base/popstats', '/base/population', '/base/tags', '/base/building', '/base/enterprise', '/base/community', '/base/part',
      '/panorama', '/micro', '/service/message', '/service/overview', '/service/request', '/service/event', '/publish',
      '/sensing', '/screen', '/geo', '/ops', '/resident?grid=450102010101']
    const bad = []
    for (const p of paths) {
      const before = errors.length
      let len = 0
      // 懒加载 chunk（ECharts 约 1MB）偶发超过首轮等待；失败时重新导航一次，
      // 重试仍为空才判定为真实渲染失败，避免把加载抖动当成功能缺陷。
      for (let attempt = 0; attempt < 2; attempt++) {
        await cmd('Page.navigate', { url: BASE + p })
        for (let k = 0; k < 14; k++) {
          await sleep(240)
          len = await ev(`document.querySelector('#app')?.innerText.length || 0`).catch(() => 0)
          if (len > 40) break
        }
        if (len > 40) break
      }
      if (len <= 40 || errors.length > before) bad.push(`${p}(len=${len}, err=${errors.slice(before, before + 1)})`)
    }
    check(`27 个页面全部渲染且无运行时错误`, bad.length === 0 && errors.length === 0, bad.join('; ') || `errors=${errors.length}`)

    /* 3. 响应式：侧栏折叠 / 抽屉 / 无横向溢出 / 弹窗不超屏 */
    const responsive = {}
    for (const w of [1440, 1024, 768, 390]) {
      await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w <= 768 })
      await goto('/portal', 800)
      // 等主布局真正挂载再取计算样式，避免把 Vue 挂载 / CSS 加载抖动判成断点失效
      for (let k = 0; k < 8; k++) {
        if (await ev(`!!document.querySelector('.layout-side')`)) break
        await sleep(250)
      }
      responsive[w] = await ev(`(() => { const s=document.querySelector('.layout-side'), t=document.querySelector('.menu-toggle'); const cs=s?getComputedStyle(s):null;
        return { w: cs?.width, tr: cs?.transform, toggle: t?getComputedStyle(t).display:'none', overflow: document.body.scrollWidth > window.innerWidth } })()`)
    }
    check('1440px 侧栏为常规宽度', responsive[1440].w === '200px', JSON.stringify(responsive[1440]))
    check('1024px 侧栏折叠为图标栏', responsive[1024].w === '64px', JSON.stringify(responsive[1024]))
    check('768 / 390px 侧栏收进抽屉且汉堡可见',
      responsive[768].toggle !== 'none' && responsive[390].toggle !== 'none' && responsive[390].tr !== 'none',
      `768=${JSON.stringify(responsive[768])} / 390=${JSON.stringify(responsive[390])}`)
    check('四档分辨率均无横向溢出', Object.values(responsive).every((r) => !r.overflow))

    await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await goto('/base/population', 1100)
    await clickText('button', '新增')
    await sleep(700)
    const dialog = await ev(`(() => { const d=document.querySelector('.el-dialog'); return d?{ w:Math.round(d.getBoundingClientRect().width), vw:window.innerWidth }:null })()`)
    check('390px 下弹窗不超出视口', dialog && dialog.w <= dialog.vw, JSON.stringify(dialog))
    await cmd('Emulation.clearDeviceMetricsOverride')

    /* 4. 演示件：生产构建强制关闭，示意边界如实标注 */
    await goto('/sensing', 1400)
    const sensing = await ev(`(() => ({
      placeholder: document.querySelectorAll('.alarm-no-image').length,
      fake: document.querySelectorAll('.alarm-snapshot').length,
      jump: [...document.querySelectorAll('button')].filter(b=>b.innerText.includes('跳步演示')).length,
      stamp: document.querySelector('.data-stamp')?.innerText || ''
    }))()`)
    check('生产构建不渲染模拟抓拍画面', sensing.fake === 0 && sensing.placeholder > 0, JSON.stringify(sensing))
    check('生产构建隐藏跳步演示按钮', sensing.jump === 0)
    check('感知平台标注数据截止时间与实时通道状态', /数据截至/.test(sensing.stamp) && /实时通道|自动刷新|降级为/.test(sensing.stamp), sensing.stamp.slice(0, 110))

    await goto('/screen', 1400)
    const screen = await ev(`(() => ({
      full: !!document.querySelector('.dark-view-full'),
      schematic: document.body.innerText.includes('示意边界'),
      stamp: document.querySelector('.data-stamp')?.innerText || '',
      refresh: [...document.querySelectorAll('button')].some(b=>b.innerText.includes('刷新数据'))
    }))()`)
    check('大屏全屏布局 + 示意边界标注 + 刷新入口', screen.full && screen.schematic && screen.refresh, JSON.stringify(screen))
    check('大屏如实标注实时通道 / 降级轮询状态', /实时通道|自动刷新|降级为/.test(screen.stamp), screen.stamp.slice(0, 110))
    check('独立全屏大屏同样接入实时通道（不停留在离线态）',
      !/未连接/.test(screen.stamp) && /已连接|降级为|连接中/.test(screen.stamp), screen.stamp.slice(0, 110))
    const chartCss = await ev(`[...document.styleSheets].some(s=>{try{return [...s.cssRules].some(r=>r.cssText.includes('.chart-mask') && r.cssText.includes('@media') === false)}catch(e){return false}})`)
    check('图表空态 / 加载态样式已加载', chartCss)

    /* 4.1 V2.4：实时通道状态、超期工作台、状态回退入口 */
    await goto('/portal', 1300)
    const p2 = await ev(`(() => ({
      live: document.querySelector('.live-flag')?.className || '',
      liveText: document.querySelector('.live-flag')?.innerText || '',
      overdueTag: [...document.querySelectorAll('.el-tag')].some(t=>t.innerText.includes('超期')),
      overdueSwitch: document.body.innerText.includes('仅看超期'),
      slaHeader: [...document.querySelectorAll('th')].some(t=>t.innerText.includes('办理时限')),
      kpi: document.body.innerText.includes('超期待办')
    }))()`)
    check('顶栏如实展示实时通道状态', /is-live|is-polling|is-connecting/.test(p2.live) && p2.liveText.length > 0, p2.live + ' / ' + p2.liveText)
    check('工作台展示超期数量、筛选开关、时限列与 KPI',
      p2.overdueTag && p2.overdueSwitch && p2.slaHeader && p2.kpi, JSON.stringify(p2))

    await goto('/service/request', 1600)
    const rollback = await ev(`(() => ({
      revoke: [...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='撤回'),
      back: [...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='退回'),
      flows: [...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='留痕')
    }))()`)
    check('办事管理提供撤回 / 退回 / 留痕入口', rollback.revoke && rollback.back && rollback.flows, JSON.stringify(rollback))

    /* 4.2 交互态运行时校验：setup 之外的事件处理同样可能因漏导入标识符而崩溃 */
    const errBeforeBasemap = errors.length
    await goto('/geo', 1600)
    const bmBtn = await clickText('button', '离线底图')
    await sleep(800)
    const bmDialog = await ev(`(() => { const d=[...document.querySelectorAll('.el-dialog')].find(x=>x.offsetParent!==null);
      return d ? { visible:true, compliant:/地图数据合规要求|禁止导入/.test(d.innerText) } : { visible:false } })()`)
    check('地理平台离线底图弹窗可打开且含合规提示（无运行时异常）',
      bmBtn && bmDialog.visible && bmDialog.compliant && errors.length === errBeforeBasemap,
      JSON.stringify(bmDialog) + ' newErrors=' + (errors.length - errBeforeBasemap))
    await ev(`(() => { const b=[...document.querySelectorAll('.el-dialog button')].find(x=>x.innerText.includes('取消')); if(b) b.click(); return true })()`)
    await sleep(300)

    const errBeforeLearn = errors.length
    await goto('/party/learn', 1600)
    await clickText('button', '新增')
    await sleep(900)
    const editor = await ev(`(() => ({ dialog:[...document.querySelectorAll('.el-dialog')].some(x=>x.offsetParent!==null),
      rich:!!document.querySelector('.rt-editor'), editable:!!document.querySelector('.rt-body[contenteditable]'),
      tools:document.querySelectorAll('.rt-toolbar .rt-btn').length }))()`)
    check('学习资料新增弹窗渲染富文本编辑器（无运行时异常）',
      editor.dialog && editor.rich && editor.editable && editor.tools >= 8 && errors.length === errBeforeLearn,
      JSON.stringify(editor) + ' newErrors=' + (errors.length - errBeforeLearn))
    await ev(`(() => { const b=[...document.querySelectorAll('.el-dialog button')].find(x=>x.innerText.includes('取消')); if(b) b.click(); return true })()`)
    await sleep(300)

    /* 4.3 网格人员录入入口：台账人员列 / 人员主数据页签 / 弹窗下拉 / 微站维护入口 */
    const errBeforeGridPerson = errors.length
    await goto('/base/grid', 1800)
    const gridPage = await ev(`(() => ({
      tabs: [...document.querySelectorAll('.el-tabs__item')].map(x=>x.innerText),
      headers: [...document.querySelectorAll('th')].map(x=>x.innerText),
      desc: document.querySelector('.page-desc')?.innerText || ''
    }))()`)
    check('网格台账展示网格长 / 网格员列',
      gridPage.headers.some(h=>h.includes('网格长')) && gridPage.headers.some(h=>h.includes('网格员')),
      gridPage.headers.join('/'))
    check('网格组织提供「人员主数据」新增 / 编辑页签',
      gridPage.tabs.some(t=>t.includes('人员主数据')), gridPage.tabs.join(' / '))
    check('页面说明指向明确的录入路径', /人员主数据/.test(gridPage.desc) && /编辑/.test(gridPage.desc), gridPage.desc.slice(0, 90))

    await clickText('button', '新增')
    await sleep(900)
    const personForm = await ev(`(() => {
      const d=[...document.querySelectorAll('.el-dialog')].find(x=>x.offsetParent!==null);
      if(!d) return { dialog:false, labels:[], selects:0 }
      return { dialog:true, labels:[...d.querySelectorAll('.el-form-item__label')].map(x=>x.innerText),
        selects:d.querySelectorAll('.el-select').length }
    })()`)
    check('网格台账录入弹窗含网格长 / 网格员下拉',
      personForm.dialog && personForm.labels.some(l=>l.includes('网格长'))
        && personForm.labels.some(l=>l.includes('网格员')) && personForm.selects >= 2,
      JSON.stringify(personForm))
    await ev(`(() => { const b=[...document.querySelectorAll('.el-dialog button')].find(x=>x.innerText.includes('取消')); if(b) b.click(); return true })()`)
    await sleep(300)

    await goto('/micro', 1500)
    const microBtn = await ev(`[...document.querySelectorAll('button')].some(b=>b.innerText.includes('维护人员'))`)
    check('网格微站提供人员维护入口', microBtn)
    check('网格人员相关页面无运行时异常', errors.length === errBeforeGridPerson,
      'newErrors=' + (errors.length - errBeforeGridPerson))

    /* 5. 居民端：字段级校验、凭条保存与恢复、错误分层 */
    await goto('/resident?grid=450102010101', 1400)
    await ev(`sessionStorage.clear()`)
    await goto('/resident?grid=450102010101', 1200)
    await clickText('.h5-tabbar .item', '办事')
    await sleep(350)
    await clickText('button', '提交申请')
    await sleep(450)
    const validation = await ev(`[...document.querySelectorAll('.el-form-item__error')].map(x=>x.innerText)`)
    check('居民端空表单显示字段级错误', validation.length >= 2, validation.join('/'))

    await setInput(`const inputs=[...document.querySelectorAll('.h5-body input')];
      set(inputs.find(x=>x.placeholder.includes('姓名')),'自动化测试居民');
      set(inputs.find(x=>x.placeholder.includes('11 位手机号')),'13800009999')`)
    await sleep(250)
    await clickText('button', '提交申请')
    await sleep(1400)
    const receipt = await ev(`(() => ({ shown: !!document.querySelector('.receipt-card'),
      code: document.querySelector('.receipt-card strong')?.innerText || '',
      copy: [...document.querySelectorAll('.receipt-card button')].some(b=>b.innerText.includes('复制凭条')),
      save: [...document.querySelectorAll('.receipt-card button')].some(b=>b.innerText.includes('保存图片')),
      stored: !!sessionStorage.getItem('zhsq:receipt:service') }))()`)
    check('提交后生成可复制 / 可保存的查询凭条', receipt.shown && receipt.copy && receipt.save && !!receipt.code, JSON.stringify(receipt))
    check('凭条写入会话存储（刷新不丢）', receipt.stored)

    await goto('/resident?grid=450102010101', 1200)
    await clickText('.h5-tabbar .item', '办事')
    await sleep(350)
    const restored = await ev(`!!document.querySelector('.receipt-card')`)
    check('刷新页面后凭条自动恢复', restored)

    await clickText('.h5-tabbar .item', '进度')
    await sleep(350)
    await setInput(`const inputs=[...document.querySelectorAll('.h5-body input')];
      set(inputs.find(x=>x.placeholder.includes('11 位手机号')),'13800000000');
      set(inputs.find(x=>x.placeholder.includes('如 BS')),'BS${Date.now()}0001');
      set(inputs.find(x=>x.placeholder.includes('6 位查询码')),'000000')`)
    await sleep(250)
    await clickText('button', '查询进度')
    await sleep(1200)
    const wrong = await ev(`(() => { const a=document.querySelector('.h5-body .el-alert'); return a?a.innerText.replace(/\\n/g,' | '):'' })()`)
    check('三要素不匹配给出针对性提示与下一步动作', /不匹配/.test(wrong) && /核对凭条/.test(wrong), wrong.slice(0, 140))

    await cleanupBusinessRecord(receipt.code)
    ws.close()
  } finally {
    cleanup()
  }

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n=== 结果：${checks.length - failed.length} 项通过 / ${failed.length} 项失败 ===`)
  if (failed.length) { failed.forEach((f) => console.log('❌ ' + f.name + ' → ' + f.detail)); process.exitCode = 1 }
}

main().catch((e) => { console.error('UI 冒烟执行异常：', e); process.exitCode = 1 })
