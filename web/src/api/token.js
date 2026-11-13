/**
 * 令牌只保存在 JS 内存中，不写入 localStorage / sessionStorage。
 * access token 2 小时后失效，页面刷新时用 HttpOnly Cookie 中的 refresh token 静默换发。
 * X-Sensitive-Token 为二次验密换取的 5 分钟明文查看授权。
 */
let accessToken = ''
let sensitiveToken = ''

export const getToken = () => accessToken
export const setToken = (t) => { accessToken = t || '' }
export const getSensitiveToken = () => sensitiveToken
export const setSensitiveToken = (t) => { sensitiveToken = t || '' }
export const clearTokens = () => { accessToken = ''; sensitiveToken = '' }
