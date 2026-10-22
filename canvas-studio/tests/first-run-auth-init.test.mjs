/**
 * 首启直进创作台 + 登录入口初始化守卫（2026-10-22）。
 *
 * 症状：桌面版首次启动停在「欢迎 / 设置」而不是创作台；左下角也没有「登录 / 注册」，
 * 只剩「本地模式」。根因是两处**接线时序**，都不是 UI 文案问题：
 * 1. `StudioFrame` 挂载时同步读 `configForms` 快照；0.2.1 的首帧是
 *    `{ status: 'loading', value: undefined }`，空串被 `initAuthStore` 当成
 *    「未配置 Supabase」并永久降级 —— 后续 mirror 就绪也没有任何人再初始化；
 * 2. `showFirstRun` 由 localStorage 标记决定，自动挂载首启设置页，挡住创作台。
 *
 * 本守卫只钉**接线**（与 auth-entry-gate 同一手法）：等 ready 再初始化并订阅后续就绪；
 * 首启不得再按 onboarded 标记自动挂载 FirstRunSettings（组件保留，供以后手动入口用）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const readSource = (relative) => readFileSync(join(here, relative), 'utf8')
/** 只剥块注释与整行注释（注释里提到旧写法是允许的）。 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const FRAME = codeOnly(readSource('../src/client/StudioFrame.tsx'))

test('auth store 等 settings mirror ready 后再初始化，并订阅后续就绪', () => {
  // 挂载即读 value 会把 undefined 变成空串 → 永久 unconfigured（本次回归本体）。
  assert.doesNotMatch(
    FRAME,
    /initAuthStore\(\{\s*supabaseUrl:\s*scope\.getSnapshot\(\)\.value/,
    '不得在挂载时直接读快照 value 初始化 auth —— configForms 首帧是 loading/undefined',
  )
  assert.match(
    FRAME,
    /if \(snapshot\.status !== 'ready'\) return/,
    '初始化前必须判 ready（loading / unavailable 都不得当成「未配置」）',
  )
  assert.match(
    FRAME,
    /const unsubscribe = scope\.subscribe\(applyConfig\)/,
    '必须订阅 mirror 的后续就绪事件（首帧 loading 时只有订阅才拿得到 ready）',
  )
  assert.match(FRAME, /unsubscribe\(\)/, 'effect 清理必须退订（避免重挂载后重复初始化）')
})

test('首启不按 onboarded 标记自动挂载 FirstRunSettings（直接进创作台）', () => {
  assert.doesNotMatch(FRAME, /isCanvasStudioOnboarded/, '首启闸不得再读 onboarded 标记')
  assert.doesNotMatch(FRAME, /showFirstRun/, '首启设置页的自动挂载 state 必须移除')
  assert.doesNotMatch(FRAME, /<FirstRunSettings/, '首启不得自动渲染 FirstRunSettings')
})
