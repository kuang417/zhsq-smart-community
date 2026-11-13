/**
 * 统一时间工具（V2.4 修复 UTC / 本地时间混用）
 *
 * 历史问题：新增记录用 `toISOString()` 写出 UTC 的 "YYYY-MM-DD HH:mm:ss"，
 * 而种子数据与该格式在 JS 里被 `Date.parse` 当作本地时间解析；
 * 在东八区等于把新写入的业务时间倒退 8 小时，导致流转留痕排序错乱、
 * SLA 计时与「30 分钟可撤回窗口」全部失真。
 *
 * 现在全站只通过 localStamp() 写业务时间、通过 stampEpoch() 读回 epoch 毫秒，
 * 两端都落在服务器本地时区，与 SQLite datetime('now','localtime') 一致。
 */
const pad = (n) => String(n).padStart(2, '0')

/** 本地时间 "YYYY-MM-DD HH:mm:ss" */
export const localStamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** 解析本地格式 / ISO 格式时间，失败返回 NaN */
export const stampEpoch = (v) => {
  if (v == null || v === '') return NaN
  const raw = String(v)
  const t = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T'))
  return Number.isNaN(t) ? Date.parse(raw) : t
}
