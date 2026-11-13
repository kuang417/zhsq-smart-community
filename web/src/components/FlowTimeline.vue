<template>
  <el-timeline v-if="items.length">
    <el-timeline-item
      v-for="(f, i) in items" :key="i"
      :timestamp="f.time" placement="top"
      :color="i === items.length - 1 ? '#1d4ed8' : '#93c5fd'"
      :hollow="i !== items.length - 1"
    >
      <div style="font-weight:600;color:#1e3a8a">
        {{ f.from ? `${f.from} → ${f.to}` : `创建：${f.to}` }}
        <el-tag size="small" type="info" effect="plain" style="margin-left:6px">{{ f.bizType }}</el-tag>
        <el-tag v-if="f.action === '撤回' || f.action === '退回'" size="small" type="warning" effect="dark" style="margin-left:4px">{{ f.action }}</el-tag>
        <el-tag v-if="f.revokedAt" size="small" type="danger" effect="plain" style="margin-left:4px">已撤回</el-tag>
      </div>
      <div class="muted" style="margin-top:4px">操作人：{{ f.operator }}<span v-if="f.remark"> ｜ {{ f.remark }}</span></div>
      <div v-if="f.revokedAt" class="muted" style="margin-top:2px;font-size:12px">撤回时间：{{ f.revokedAt }} ｜ 撤回人：{{ f.revokedBy || '-' }}</div>
    </el-timeline-item>
  </el-timeline>
  <el-empty v-else description="暂无流转记录" :image-size="70" />
</template>

<script setup>
defineProps({ items: { type: Array, default: () => [] } })
</script>
