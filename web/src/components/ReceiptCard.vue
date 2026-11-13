<template>
  <div class="h5-card receipt-card">
    <h4>✅ {{ kindLabel }}成功 · 请保存查询凭条</h4>
    <div class="receipt-body">
      <div class="receipt-row"><span>{{ codeLabel }}</span><strong>{{ receipt.code }}</strong></div>
      <div class="receipt-row"><span>查询码</span><strong class="receipt-code">{{ receipt.queryCode }}</strong></div>
      <div class="receipt-row"><span>手机号</span><strong>{{ receipt.phone }}</strong></div>
      <div class="receipt-row"><span>当前状态</span><el-tag size="small" type="warning">{{ receipt.status }}</el-tag></div>
    </div>
    <div class="muted" style="margin-top:8px;line-height:1.7">
      {{ note }} 查询码仅在提交时返回，请复制或保存图片；本凭条仅保留在当前浏览器标签页会话中。
    </div>
    <div class="receipt-actions">
      <el-button type="primary" plain :icon="'DocumentCopy'" @click="copy">复制凭条</el-button>
      <el-button type="primary" plain :icon="'Picture'" @click="saveImage">保存图片</el-button>
      <el-button :icon="'Delete'" @click="emit('clear')">不再显示</el-button>
    </div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'

const props = defineProps({
  kindLabel: { type: String, default: '提交' },
  codeLabel: { type: String, default: '业务编号' },
  receipt: { type: Object, required: true },
  note: { type: String, default: '进度查询需同时校验手机号 + 业务编号 + 查询码。' }
})
const emit = defineEmits(['clear'])

const text = () => [
  '智慧社区治理平台 · 查询凭条',
  `业务类型：${props.kindLabel}`,
  `${props.codeLabel}：${props.receipt.code}`,
  `查询码：${props.receipt.queryCode}`,
  `手机号：${props.receipt.phone}`,
  `当前状态：${props.receipt.status}`,
  '进度查询需同时校验手机号 + 业务编号 + 查询码，请妥善保存。'
].join('\n')

const copy = async () => {
  const value = text()
  try {
    await navigator.clipboard.writeText(value)
  } catch (e) {
    // 局域网 http 等非安全上下文没有 Clipboard API，降级到临时 textarea
    const ta = document.createElement('textarea')
    ta.value = value
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (!ok) return ElMessage.warning('浏览器未允许复制，请改用「保存图片」')
  }
  ElMessage.success('凭条已复制，可粘贴到备忘录或发送给居民')
}

const saveImage = () => {
  const c = document.createElement('canvas')
  c.width = 660
  c.height = 440
  const ctx = c.getContext('2d')
  const F = '"Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#1d4ed8'
  ctx.fillRect(0, 0, c.width, 72)
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold 26px ${F}`
  ctx.fillText('智慧社区治理平台 · 查询凭条', 28, 46)
  ctx.fillStyle = '#1f2937'
  ctx.font = `20px ${F}`
  const rows = [
    `业务类型：${props.kindLabel}`,
    `${props.codeLabel}：${props.receipt.code}`,
    `手机号：${props.receipt.phone}`,
    `当前状态：${props.receipt.status}`
  ]
  rows.forEach((r, i) => ctx.fillText(r, 32, 130 + i * 40))
  ctx.fillStyle = '#dc2626'
  ctx.font = `bold 30px ${F}`
  ctx.fillText(`查询码：${props.receipt.queryCode}`, 32, 320)
  ctx.fillStyle = '#6b7280'
  ctx.font = `16px ${F}`
  ctx.fillText('进度查询需同时校验手机号 + 业务编号 + 查询码', 32, 372)
  ctx.fillText('请妥善保存，查询码仅在提交时显示一次', 32, 402)
  const a = document.createElement('a')
  a.download = `查询凭条-${props.receipt.code}.png`
  a.href = c.toDataURL('image/png')
  document.body.appendChild(a)
  a.click()
  a.remove()
  ElMessage.success('凭条图片已保存')
}
</script>

<style scoped>
.receipt-card { border: 1px solid #bfd3fa; }
.receipt-body { line-height: 2; font-size: 13px; }
.receipt-row { display: flex; align-items: center; gap: 8px; }
.receipt-row > span:first-child { width: 72px; color: var(--gov-sub); flex-shrink: 0; }
.receipt-row strong { color: var(--gov-blue); }
.receipt-code { color: var(--c-danger) !important; font-size: 16px; letter-spacing: 2px; }
</style>
