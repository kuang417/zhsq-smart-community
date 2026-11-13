/**
 * HTML 文本转义（V2.5 审计修复）
 *
 * ECharts 的 tooltip.formatter 默认以 renderMode:'html' 渲染返回值（等价于 innerHTML），
 * 而 tooltip 里的名称/类型/状态常来自可由表单写入的业务数据（组织名、网格名、设备名、部件名）。
 * 生产 CSP 可挡内联脚本，但挡不住 <style> / <a> 之类的 UI 伪造；开发环境无 CSP 时可直接执行脚本。
 * 所有拼进 formatter 的动态文本必须先转义。
 */
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c])
export default escHtml
