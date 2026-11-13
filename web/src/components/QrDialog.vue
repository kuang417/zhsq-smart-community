<template>
  <el-dialog :model-value="modelValue" :title="`便民码 · ${gridName || gridCode}`" width="380px" align-center @update:model-value="v => emit('update:modelValue', v)">
    <div class="qr-box" v-loading="loading">
      <img v-if="img" :src="img" alt="便民码" style="width:220px;height:220px" />
      <div style="font-size:13px;font-weight:700;color:#1e3a8a;margin-top:10px">{{ gridName }}</div>
      <div class="muted" style="margin-top:4px">编码 {{ gridCode }}</div>
      <div class="muted" style="margin-top:8px;word-break:break-all">扫码进入本网格居民端：{{ url }}</div>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button type="primary" plain @click="download">下载图片</el-button>
      <el-button type="primary" @click="print">打印</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import QRCode from 'qrcode'
import { api } from '@/api'
import { ElMessage } from 'element-plus'

const props = defineProps({
  modelValue: Boolean,
  gridCode: { type: String, default: '' },
  gridName: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])
const img = ref('')
const url = ref('')
const loading = ref(false)
/** 快速切换网格时，后返回的旧二维码不得覆盖当前网格的标题/图片 */
let qrSeq = 0

watch(() => [props.modelValue, props.gridCode], async ([open]) => {
  if (!open || !props.gridCode) return
  const seq = ++qrSeq
  img.value = ''
  loading.value = true
  try {
    const d = await api.qr(props.gridCode)
    if (seq !== qrSeq) return
    url.value = d.url
    const png = await QRCode.toDataURL(d.url, { width: 440, margin: 1, color: { dark: '#12318c', light: '#ffffff' } })
    if (seq !== qrSeq) return
    img.value = png
  } catch (e) { if (seq === qrSeq) ElMessage.error('便民码生成失败') }
  finally { if (seq === qrSeq) loading.value = false }
}, { immediate: true })

const download = () => {
  if (!img.value) return ElMessage.warning('便民码尚未生成，请稍候再试')
  const a = document.createElement('a')
  a.href = img.value
  a.download = `便民码_${props.gridCode}.png`
  a.click()
  ElMessage.success('已下载便民码图片')
}
/** 打印窗口是独立文档、不继承主站 CSP，所有动态文本必须转义，防止网格名称里的 HTML 被执行 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const print = () => {
  const w = window.open('', '_blank')
  if (!w) return ElMessage.warning('浏览器拦截了打印窗口，请使用下载图片后打印')
  w.document.write(`<html><head><title>便民码打印</title><meta charset="utf-8"><style>body{text-align:center;font-family:Microsoft YaHei;padding:36px}h3{color:#12318c}p{font-size:13px;color:#555}</style></head>
    <body><h3>${esc(props.gridName)}</h3><img src="${esc(img.value)}" width="260"/><p>扫码进入本网格居民端 · 编码 ${esc(props.gridCode)}</p></body></html>`)
  w.document.close()
  setTimeout(() => { if (!w.closed) w.print() }, 400)
}
</script>
