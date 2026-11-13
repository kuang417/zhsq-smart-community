<template>
  <div class="chart-wrap" :style="{ height }" role="img" :aria-label="ariaLabel">
    <div ref="box" class="chart-box"></div>
    <!-- 覆盖层而非隐藏容器：保持 ECharts 实例尺寸正确，避免空态切回时图表不重绘 -->
    <div v-if="loading" class="chart-mask">数据加载中…</div>
    <div v-else-if="showEmpty" class="chart-mask">{{ emptyText }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '300px' },
  notMerge: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无数据（当前筛选条件下没有可展示的记录）' }
})
const emit = defineEmits(['chart-click', 'ready'])
const box = ref(null)
let chart = null
let observer = null

/** 只在「确实没有任何可绘制数据」时显示空态；带 title 的自定义提示交给 ECharts 渲染 */
const showEmpty = computed(() => {
  const o = props.option
  if (!o || typeof o !== 'object') return true
  const series = o.series
  if (!Array.isArray(series) || series.length === 0) return !o.title
  return series.every((s) => {
    const d = s?.data
    if (Array.isArray(d)) return d.length === 0
    if (d && typeof d === 'object') return Object.keys(d).length === 0
    return true
  })
})
const ariaLabel = computed(() => props.loading ? '图表数据加载中' : (showEmpty.value ? props.emptyText : '数据图表'))

const render = () => {
  if (!chart || !props.option) return
  chart.setOption(props.option, props.notMerge)
}

onMounted(async () => {
  await nextTick()
  chart = echarts.init(box.value, null, { renderer: 'canvas' })
  render()
  chart.on('click', (params) => emit('chart-click', params))
  observer = new ResizeObserver(() => chart && chart.resize())
  observer.observe(box.value)
  emit('ready', chart)
})
watch(() => props.option, render, { deep: true })
onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
  chart = null
})
defineExpose({ getChart: () => chart, echarts })
</script>
