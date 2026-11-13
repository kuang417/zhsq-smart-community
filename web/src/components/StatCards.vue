<template>
  <div class="stat-grid">
    <div v-for="(it, i) in items" :key="i" class="stat-card" :class="{ clickable: !!it.path }"
      :role="it.path ? 'button' : null" :tabindex="it.path ? 0 : null"
      :title="it.path ? `点击查看${it.name}` : it.name"
      @click="onSelect(it)" @keydown.enter="onSelect(it)" @keydown.space.prevent="onSelect(it)">
      <div class="stat-label">{{ it.name }}</div>
      <div class="stat-value">{{ format(it.value) }}<span v-if="it.unit" class="stat-unit">{{ it.unit }}</span></div>
      <div v-if="it.path" class="stat-hint">查看明细 →</div>
    </div>
  </div>
</template>

<script setup>
const emit = defineEmits(['select'])
const props = defineProps({ items: { type: Array, default: () => [] } })
const format = (v) => (typeof v === 'number' ? v.toLocaleString('zh-CN') : (v ?? '-'))
const onSelect = (it) => { if (it.path) emit('select', it) }
</script>

<style scoped>
.stat-card.clickable { cursor: pointer; transition: transform .15s, border-color .15s; }
.stat-card.clickable:hover { border-color: var(--gov-blue-light, #3b82f6); transform: translateY(-2px); }
.stat-card.clickable:focus-visible { outline: 2px solid var(--gov-blue, #1d4ed8); outline-offset: 2px; }
.stat-hint { margin-top: 2px; font-size: 11px; color: var(--gov-blue, #1d4ed8); opacity: 0; transition: opacity .15s; }
.stat-card.clickable:hover .stat-hint, .stat-card.clickable:focus-visible .stat-hint { opacity: 1; }
</style>
