<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">历史学习</h2>
      <div class="page-desc">五个历史时期时间轴展示，每个时期下设八个二级栏目，卡片配图展示（F2-11）。</div>
      <el-timeline>
        <el-timeline-item v-for="(p, i) in periods" :key="p" :timestamp="`第 ${i + 1} 时期`" placement="top"
          :color="i === active ? '#1d4ed8' : '#93c5fd'" :hollow="i !== active" :size="i === active ? 'large' : 'normal'">
          <div class="flex gap8" style="cursor:pointer" @click="active = i">
            <strong :style="{ color: i === active ? '#1d4ed8' : '#334155' }">{{ p }}</strong>
            <el-tag size="small" effect="plain">8 个栏目</el-tag>
            <span class="muted">点击查看栏目卡片</span>
          </div>
        </el-timeline-item>
      </el-timeline>
    </div>
    <div class="page-card">
      <h3 class="section-title">{{ periods[active] }} · 二级栏目</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px">
        <div v-for="c in current" :key="c.id" class="hist-card" @click="detail = c">
          <div class="hist-cover" :style="{ background: coverColor(c.cover) }">
            <span style="font-size:30px">◈</span>
            <span style="font-size:11px;letter-spacing:2px;opacity:.85">{{ c.cover.toUpperCase() }}</span>
          </div>
          <div style="padding:10px 12px">
            <div style="font-weight:700;color:#1e3a8a;font-size:13px">{{ c.column }}</div>
            <div class="muted" style="margin-top:4px;line-height:1.6;height:36px;overflow:hidden">{{ c.summary }}</div>
            <div class="muted" style="margin-top:6px">👁 {{ c.views }} 次学习</div>
          </div>
        </div>
      </div>
    </div>
    <el-dialog v-model="detailVisible" :title="detail?.title" width="520px">
      <div class="hist-cover" :style="{ background: coverColor(detail?.cover), height: '130px', marginBottom: '12px' }">
        <span style="font-size:38px">◈</span><span style="letter-spacing:3px">{{ detail?.period }}</span>
      </div>
      <div style="white-space:pre-line;line-height:2;color:#334155">{{ detail?.content || detail?.summary }}</div>
      <div class="muted" style="margin-top:12px">栏目：{{ detail?.column }} ｜ 累计学习 {{ detail?.views }} 次</div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'

const periods = ['新民主主义革命时期', '社会主义革命和建设时期', '改革开放和社会主义现代化建设新时期', '中国特色社会主义新时代', '党史学习教育常态化']
const active = ref(3)
const items = ref([])
const detail = ref(null)
const detailVisible = ref(false)
const current = computed(() => items.value.filter((x) => x.period === periods[active.value]))
const colors = ['#1d4ed8,#38bdf8', '#7c3aed,#c084fc', '#0891b2,#22d3ee', '#b45309,#fbbf24', '#be123c,#fb7185', '#0f766e,#34d399', '#4338ca,#818cf8', '#0c4a6e,#0284c7', '#831843,#f472b6', '#3f6212,#a3e635', '#7c2d12,#fb923c', '#312e81,#a5b4fc']
const coverColor = (c) => {
  const i = parseInt(String(c || 'h1').replace(/\D/g, ''), 10) || 1
  const [a, b] = colors[i % colors.length].split(',')
  return `linear-gradient(135deg, ${a}, ${b})`
}
// 用 computed 代理控制弹窗显隐
import { watch } from 'vue'
watch(detail, (v) => { detailVisible.value = !!v })
watch(detailVisible, (v) => { if (!v) detail.value = null })
onMounted(async () => { items.value = (await api.list('historyLearn', { pageSize: 100 })).records })
</script>

<style scoped>
.hist-card { border:1px solid #e5eaf3;border-radius:10px;overflow:hidden;cursor:pointer;transition:.2s;background:#fff }
.hist-card:hover { transform:translateY(-3px);box-shadow:0 8px 20px rgba(29,78,216,.14) }
.hist-cover { height:92px;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px }
</style>
