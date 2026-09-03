/**
 * brand 令牌纯函数冒烟测试（brand-identity-proposal.md §3）。
 * 直连 Host tsc 编译产物 lib/brand.js。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BRAND_FIXED, BRAND_PRESETS, brandCssText, DEFAULT_BRAND_PRESET, FAVICON_DATA_URL, resolveBrandPreset,
} from '../lib/brand.js'

test('resolveBrandPreset：未知/空 id 一律回退默认（电影紫）', () => {
  assert.equal(resolveBrandPreset(undefined).id, DEFAULT_BRAND_PRESET)
  assert.equal(resolveBrandPreset(null).id, DEFAULT_BRAND_PRESET)
  assert.equal(resolveBrandPreset('nope').id, DEFAULT_BRAND_PRESET)
  assert.equal(resolveBrandPreset('ocean-blue').id, 'ocean-blue')
  assert.equal(resolveBrandPreset('amber-creative').id, 'amber-creative')
})

test('brandCssText：输出含预设选择器、双轨明暗、固定色与非配色令牌', () => {
  const css = brandCssText('cinema-violet')
  assert.ok(css.includes('body[data-cs-brand="cinema-violet"]'))
  assert.ok(css.includes('body[data-ds-dark-theme][data-cs-brand="cinema-violet"]'))
  // 固定功能色（不随预设切换）
  assert.ok(css.includes(`--cs-gold: ${BRAND_FIXED.gold};`))
  assert.ok(css.includes(`--cs-teal: ${BRAND_FIXED.teal};`))
  // 非配色令牌
  assert.ok(css.includes('--cs-radius-md: 8px;'))
  assert.ok(css.includes('--cs-duration-base: 200ms;'))
  assert.ok(css.includes('--cs-ease: cubic-bezier(0.2, 0, 0, 1);'))
  // 深色轨道取主 accent，浅色轨道取 deep
  assert.ok(css.includes(`--cs-accent: ${BRAND_PRESETS['cinema-violet'].accent};`))
  assert.ok(css.includes(`--cs-accent: ${BRAND_PRESETS['cinema-violet'].accentDeep};`))
  // 选中节点光环
  assert.ok(css.includes('--cs-glow-accent: 0 0 0 1px var(--cs-accent-soft)'))
})

test('brandCssText：四套预设全部产出完整令牌（颜色 / 间距 / 圆角 / 阴影 / 动效）', () => {
  const required = [
    '--cs-accent:', '--cs-accent-strong:', '--cs-accent-deep:', '--cs-accent-soft:',
    '--cs-canvas-bg:', '--cs-canvas-bg-l1:', '--cs-canvas-grid:', '--cs-canvas-grid-major:',
    '--cs-gold:', '--cs-teal:', '--cs-radius-sm:', '--cs-radius-lg:', '--cs-shadow-1:', '--cs-shadow-3:',
    '--cs-duration-fast:', '--cs-duration-slow:', '--cs-ease:',
  ]
  for (const id of Object.keys(BRAND_PRESETS)) {
    const css = brandCssText(id)
    for (const token of required) {
      assert.ok(css.includes(token), `${id} 缺少 ${token}`)
    }
  }
})

test('brandCssText：未知预设回退默认选择器（设置文档损坏兜底）', () => {
  const css = brandCssText('bogus-preset')
  assert.ok(css.includes(`[data-cs-brand="${DEFAULT_BRAND_PRESET}"]`))
  assert.ok(!css.includes('bogus-preset'))
})

test('FAVICON_DATA_URL：合法 data: URL 且含场记板关键图形', () => {
  assert.ok(FAVICON_DATA_URL.startsWith('data:image/svg+xml;charset=utf-8,'))
  assert.ok(FAVICON_DATA_URL.includes('%3Csvg'))
  const decoded = decodeURIComponent(FAVICON_DATA_URL.split(',')[1] ?? '')
  assert.ok(decoded.includes('viewBox="0 0 32 32"'))
  assert.ok(decoded.includes('#7C6CFF'))
})
