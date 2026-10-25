/**
 * 主题预设（`src/remotion/themes.ts`）的守卫。
 *
 * 为什么值得测：主题是**一次展开成颜色值**的脚手架参数（manifest 里不存 themeId）。
 * 一旦展开错，整片底色/强调色全错，而 manifest 看起来完全合法 —— 这种错误只能靠
 * 「主题表本身对不对 + 未知 id 会不会静默变成黑片」这两类断言兜住。
 *
 * 运行：node --test tests/render-themes.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_THEME_ID, THEMES, resolveTheme, themeGuidance } from '../lib/remotion/themes.js'

test('T·①：主题表自洽 —— 键与 id 一致、四套齐全、颜色都是 #rrggbb', () => {
  assert.ok(Object.keys(THEMES).length >= 4, '至少 4 套（否则"主题"没有选择意义）')
  for (const [key, theme] of Object.entries(THEMES)) {
    assert.equal(theme.id, key, `键 ${key} 与 theme.id 必须一致（否则按 id 查会查空）`)
    for (const field of ['backgroundColor', 'backgroundLayer', 'accent', 'textColor']) {
      assert.match(theme[field], /^#[0-9A-Fa-f]{6}$/u, `${key}.${field} 必须是 #rrggbb`)
    }
    assert.ok(theme.motion.unitDurationInFrames > 0)
    assert.ok(theme.motion.wordDelayFrames >= 0)
    assert.ok(theme.note.length > 10, `${key} 必须写明适用片型（用户看不到代码）`)
  }
})

test('T·②：缺省主题必须与既有骨架同色（不传 theme 时像素不变）', () => {
  const { theme, fellBack } = resolveTheme(undefined)
  assert.equal(theme.id, DEFAULT_THEME_ID)
  assert.equal(fellBack, false)
  assert.equal(theme.backgroundColor, '#0B1220', '老骨架的底色，改了等于让所有历史片子换色')
  assert.equal(theme.backgroundLayer, '#111827')
})

test('T·③：未知主题名回落缺省并**明确报 fellBack**（不静默换色）', () => {
  const { theme, fellBack } = resolveTheme('nope-theme')
  assert.equal(theme.id, DEFAULT_THEME_ID)
  assert.equal(fellBack, true, '拼错主题名必须让调用方知道回落了 —— 静默换色最难查')
})

test('T·④：guidance 必须带上强调色与动效基线（模型据此写轨）', () => {
  const theme = THEMES['ink-press']
  assert.ok(theme)
  const text = themeGuidance(theme)
  assert.ok(text.includes(theme.accent), `要给出强调色值（${theme.accent}）`)
  assert.match(text, /动效基线/u)
  assert.ok(text.includes(String(theme.motion.unitDurationInFrames)), '要给出单元素入场帧数')
})

test('T·⑤：只提供深色主题（浅色会与固定浅色正文撞车）', () => {
  // textCard 的正文色由 variant 固定为浅色系 ⇒ 浅底主题必然看不清。
  // 这条断言防的是「有人顺手加一套浅色主题」而没同时解决文字色。
  for (const theme of Object.values(THEMES)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(theme.backgroundColor.slice(i, i + 2), 16))
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    assert.ok(luminance < 80, `${theme.id} 的底色太亮（亮度 ${luminance.toFixed(0)}）—— 浅底配固定浅色正文会看不见`)
  }
})
