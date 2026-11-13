/**
 * 全量回归的限流窗口守卫
 *
 * 服务端三道限流都是 60 秒滑动窗口（全局 1200 / 登录 10 / 居民端 120）。
 * 一轮 test:all 含 200 并发读 + 50 并发写 + 数百次接口调用，背靠背连跑两轮
 * 会落在同一窗口内触发 429，被误读成功能缺陷。这里不改任何安全阈值，
 * 只在「距上一轮完成不足一个窗口」时错开等待，让每轮使用独立的限流窗口。
 *
 * 用法：test:all 开头 `--start`，结尾 `--end`。单独运行某个测试文件不受影响。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
const FILE = path.join(
  os.tmpdir(),
  `zhsq-test-window-${crypto.createHash('sha256').update(BASE).digest('hex').slice(0, 10)}.txt`
)
const WINDOW_MS = 65000   // 60s 滑动窗口 + 5s 余量
const mode = process.argv[2] || '--start'

if (mode === '--end') {
  try { fs.writeFileSync(FILE, String(Date.now())) } catch { /* 忽略 */ }
} else {
  let last = 0
  try { last = Number(fs.readFileSync(FILE, 'utf8').trim()) || 0 } catch { /* 首次运行 */ }
  const wait = WINDOW_MS - (Date.now() - last)
  if (wait > 0) {
    console.log(`⏳ 距上一轮全量回归不足 60s，等待 ${Math.ceil(wait / 1000)}s 让限流窗口滑出（安全阈值不变）`)
    await new Promise((r) => setTimeout(r, wait))
  }
}
