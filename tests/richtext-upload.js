/**
 * 学习教育"富文本 + 附件上传"回归
 *
 * 新增能力：
 *   - POST /api/upload?type=image|file：鉴权、白名单扩展名、随机文件名、返回 {url,name,size}；
 *   - GET /uploads/:name：托管上传文件（图片 inline / 其它 attachment，防目录穿越）；
 *   - learnings.content 落库前经 sanitizeRichText 净化（剥离 script / on* 事件 / 危险协议）。
 *
 * 断言：
 *   1) 未鉴权上传 → 401；
 *   2) 上传图片（png）→ 200 且 url 以 /uploads/ 开头；
 *   3) 上传后 url 可访问（200，Content-Type 为 image/*，Content-Disposition inline）；
 *   4) 上传不支持的类型（.exe）→ 400；
 *   5) 上传非图片却声明 type=image（.txt）→ 400；
 *   6) 新建学习资料带 HTML content（含 <script>/onerror）→ 落库后被净化：无 script、无 onerror，保留 <p>/<img src="/uploads/">。
 *
 * 用法：先 npm start（已加载新代码），再 node tests/richtext-upload.js
 */
import { login } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const callJson = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, code: data?.code, data: data?.data, raw: data }
}
// multipart 上传（文件为 Blob，需带文件名与 mime）
const uploadFile = async (token, type, blob, filename) => {
  const fd = new FormData()
  fd.append('file', blob, filename)
  const r = await fetch(`${BASE}/api/upload?type=${type}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, code: data?.code, data: data?.data, raw: data }
}

// 1x1 透明 PNG（合法图片，便于校验图片上传链路）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const pngBlob = new Blob([Buffer.from(PNG_B64, 'base64')], { type: 'image/png' })
const txtBlob = new Blob(['hello'], { type: 'text/plain' })
const exeBlob = new Blob(['MZ'], { type: 'application/octet-stream' })

const main = async () => {
  const token = await login('admin', 'admin123')
  console.log('\n=== 学习教育：富文本编辑器 + 附件上传回归 ===')

  // 1) 未鉴权上传 → 401
  const noAuth = await uploadFile('', 'image', pngBlob, 'x.png')
  check('未鉴权上传被拦截（401）', noAuth.status === 401, `status=${noAuth.status}`)

  // 2) 上传图片 → 200，url 以 /uploads/ 开头
  const upImg = await uploadFile(token, 'image', pngBlob, '封面.png')
  check('图片上传成功（200）', upImg.status === 200 && upImg.code === 0, `code=${upImg.code}`)
  const imgUrl = upImg.data?.url || ''
  check('返回 url 以 /uploads/ 开头', imgUrl.startsWith('/uploads/'), imgUrl)

  // 3) 上传文件可访问：图片 inline + image/*
  if (imgUrl) {
    const r = await fetch(BASE + imgUrl)
    const ct = r.headers.get('content-type') || ''
    const cd = r.headers.get('content-disposition') || ''
    check('上传图片可访问（200, image/*）', r.status === 200 && ct.startsWith('image/'), `ct=${ct}`)
    check('图片以 inline 方式返回', cd.includes('inline'), cd)
  }

  // 4) 不支持的文件类型（.exe）→ 400
  const upExe = await uploadFile(token, 'file', exeBlob, 'virus.exe')
  check('不支持的文件类型被拒绝（400）', upExe.status === 400, `status=${upExe.status}`)

  // 5) type=image 却传 .txt → 400（扩展名与类型不符）
  const upTxtAsImg = await uploadFile(token, 'image', txtBlob, 'note.txt')
  check('图片类型下传非图片被拒绝（400）', upTxtAsImg.status === 400, `status=${upTxtAsImg.status}`)

  // 6) HTML content 净化
  const dirty = '<p>学习要点</p><script>alert(1)</script><img src="/uploads/test.png" onerror="x()"><a href="javascript:alert(2)">坏链</a>'
  const createRes = await callJson('/api/learnings', {
    method: 'POST', token, body: {
      title: '富文本净化测试资料', category: '政治理论', publisher: '区委组织部',
      publishDate: '2026-11-12', hours: 2, attachments: 0, content: dirty
    }
  })
  check('新建富文本学习资料成功', createRes.status === 200 && createRes.code === 0, `code=${createRes.code}`)
  if (createRes.status === 200) {
    const id = createRes.data?.id
    const getRes = await callJson(`/api/learnings/${id}`, { token })
    const saved = getRes.data?.content || ''
    check('净化后去除 <script>', !/<script/i.test(saved), saved.slice(0, 60))
    check('净化后去除 onerror 事件属性', !/onerror/i.test(saved), saved.slice(0, 60))
    check('净化后去除 javascript: 危险协议链接', !/javascript:/i.test(saved), saved.slice(0, 60))
    check('净化后保留 <p> 与 <img src="/uploads/">', /<p>学习要点<\/p>/i.test(saved) && /<img[^>]+src="\/uploads\//i.test(saved), saved.slice(0, 80))
    // 清理：删除测试数据，避免污染演示库
    await callJson(`/api/learnings/${id}`, { method: 'DELETE', token })
  }

  console.log(`\n结果：${pass} 通过 / ${failCount} 失败`)
  process.exit(failCount ? 1 : 0)
}
main().catch((e) => { console.error('测试异常', e); process.exit(1) })
