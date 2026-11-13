<template>
  <div class="rt-editor">
    <div class="rt-toolbar">
      <button type="button" class="rt-btn" title="加粗" @mousedown.prevent="cmd('bold')"><b>B</b></button>
      <button type="button" class="rt-btn" title="斜体" @mousedown.prevent="cmd('italic')"><i>I</i></button>
      <button type="button" class="rt-btn" title="下划线" @mousedown.prevent="cmd('underline')"><u>U</u></button>
      <button type="button" class="rt-btn" title="删除线" @mousedown.prevent="cmd('strikeThrough')"><s>S</s></button>
      <span class="rt-sep" />
      <select class="rt-sel" title="段落样式" @change="applyBlock">
        <option value="p">正文</option>
        <option value="h1">标题 1</option>
        <option value="h2">标题 2</option>
        <option value="h3">标题 3</option>
        <option value="blockquote">引用</option>
      </select>
      <span class="rt-sep" />
      <button type="button" class="rt-btn" title="无序列表" @mousedown.prevent="cmd('insertUnorderedList')">• 列表</button>
      <button type="button" class="rt-btn" title="有序列表" @mousedown.prevent="cmd('insertOrderedList')">1. 列表</button>
      <span class="rt-sep" />
      <button type="button" class="rt-btn" title="插入 / 编辑链接" @mousedown.prevent="insertLink">🔗 链接</button>
      <button type="button" class="rt-btn" title="插入图片（上传后内嵌）" @mousedown.prevent="pickImage">🖼 图片</button>
      <button type="button" class="rt-btn" title="上传附件" @mousedown.prevent="pickFile">📎 附件</button>
      <span class="rt-sep" />
      <button type="button" class="rt-btn" title="清除格式" @mousedown.prevent="cmd('removeFormat')">⌫ 清除</button>
      <button type="button" class="rt-btn" title="撤销" @mousedown.prevent="cmd('undo')">↶</button>
      <button type="button" class="rt-btn" title="重做" @mousedown.prevent="cmd('redo')">↷</button>
    </div>
    <div ref="editor" class="rt-body rt-content" :style="{ minHeight: height }"
      contenteditable="true" :data-placeholder="placeholder"
      @input="onInput" @blur="onInput" @focus="onFocus" />
    <input ref="imgInput" type="file" accept="image/*" hidden @change="onImagePicked" />
    <input ref="fileInput" type="file" hidden @change="onFilePicked" />
  </div>
</template>

<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '请输入学习内容，支持排版、插入图片与附件…' },
  height: { type: String, default: '260px' }
})
const emit = defineEmits(['update:modelValue'])
const editor = ref(null)
const imgInput = ref(null)
const fileInput = ref(null)

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const escapeAttr = (s) => escapeHtml(s).replace(/'/g, '&#39;')

function syncFromModel() {
  if (!editor.value) return
  const v = props.modelValue || ''
  if (editor.value.innerHTML !== v) editor.value.innerHTML = v
}
onMounted(syncFromModel)
// 仅当外部值与本组件不同才回写，避免打断用户正在输入的光标
watch(() => props.modelValue, () => nextTick(syncFromModel))

function onInput() {
  const html = editor.value?.innerHTML || ''
  emit('update:modelValue', html === '<br>' ? '' : html)
}
function onFocus() { editor.value?.classList.remove('rt-empty') }

function cmd(c) {
  editor.value?.focus()
  document.execCommand(c, false, null)
  onInput()
}
function applyBlock(e) {
  editor.value?.focus()
  const v = e.target.value
  document.execCommand('formatBlock', false, v === 'p' ? '<p>' : `<${v}>`)
  onInput()
  e.target.value = 'p'
}
function insertLink() {
  const url = window.prompt('请输入链接地址（http(s):// 或 / 相对路径）', 'https://')
  if (!url) return
  editor.value?.focus()
  document.execCommand('createLink', false, url)
  onInput()
}
function pickImage() { imgInput.value?.click() }
async function onImagePicked(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (file.size > 20 * 1024 * 1024) return ElMessage.warning('图片超过 20MB 限制')
  const tip = ElMessage.info('图片上传中…')
  try {
    const d = await api.uploadFile(file, 'image')
    editor.value?.focus()
    const img = `<img src="${escapeAttr(d.url)}" alt="${escapeAttr(file.name)}" style="max-width:100%;border-radius:6px;margin:6px 0" />`
    document.execCommand('insertHTML', false, img)
    onInput()
    ElMessage.success('图片已插入')
  } catch (err) { /* 拦截器已提示 */ }
  finally { tip?.close?.() }
}
function pickFile() { fileInput.value?.click() }
async function onFilePicked(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  const tip = ElMessage.info('文件上传中…')
  try {
    const d = await api.uploadFile(file, 'file')
    editor.value?.focus()
    const sizeKb = (d.size / 1024).toFixed(1)
    const chip = `<a href="${escapeAttr(d.url)}" target="_blank" rel="noopener noreferrer" class="rt-attach">📎 ${escapeHtml(file.name)}（${sizeKb} KB）</a>`
    document.execCommand('insertHTML', false, chip)
    onInput()
    ElMessage.success('附件已插入')
  } catch (err) { /* 拦截器已提示 */ }
  finally { tip?.close?.() }
}
</script>

<style scoped>
.rt-editor { border: 1px solid #dcdfe6; border-radius: 8px; overflow: hidden; background: #fff; }
.rt-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid #ebeef5; background: #fafafa; }
.rt-btn { min-width: 30px; height: 28px; padding: 0 8px; border: 1px solid #dcdfe6; border-radius: 6px; background: #fff; color: #303133; cursor: pointer; font-size: 13px; line-height: 1; }
.rt-btn:hover { border-color: #409eff; color: #409eff; }
.rt-sel { height: 28px; border: 1px solid #dcdfe6; border-radius: 6px; background: #fff; color: #303133; padding: 0 6px; font-size: 13px; }
.rt-sep { width: 1px; height: 18px; background: #ebeef5; margin: 0 2px; }
.rt-body { padding: 10px 12px; min-height: 260px; outline: none; font-size: 14px; color: #303133; line-height: 1.8; }
.rt-body:empty::before { content: attr(data-placeholder); color: #a8abb2; }
.rt-body:focus { box-shadow: inset 0 0 0 2px rgba(64, 158, 255, 0.15); }
</style>

<!-- 内容区样式需作用于 v-html 注入的节点（编辑器内与详情页共用），故不写 scoped -->
<style>
.rt-content { word-break: break-word; }
.rt-content img { max-width: 100%; border-radius: 6px; margin: 6px 0; }
.rt-content .rt-attach { display: inline-block; padding: 4px 10px; background: #eef4ff; border: 1px solid #cddcff; border-radius: 6px; color: #17357f; text-decoration: none; margin: 3px 6px 3px 0; }
.rt-content .rt-attach:hover { background: #dce8ff; }
</style>
