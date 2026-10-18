/**
 * 覆盖层主题实时切换守卫（用户实测）：设置里切浅色/深色后，故事板覆盖层要**立刻**
 * 跟着换，不能等关闭再打开。
 *
 * 根因：`ThemeRuntime` 不暴露 subscribe，宿主只在 `theme/change` 上广播；而覆盖层
 * 的色板写在 iframe URL 上，组件拿不到重渲染信号就不会重新加载 ⇒ 停在旧色板。
 * 修法：注入面透出 `subscribeTheme`（宿主 `theme/change`），覆盖层用
 * `useSyncExternalStore` 订阅主题快照。源码字符串断言，照 `lobby-claim.test.mjs`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const INDEX = readSource('../src/client/index.ts')
const FRAME = readSource('../src/client/StudioFrame.tsx')
const CONTRACTS = readSource('../src/client/contracts.ts')

test('主题实时：注入面透出订阅（契约 + index 接线到 theme/change）', () => {
  assert.match(
    CONTRACTS,
    /subscribeTheme\(listener: \(\) => void\): \(\) => void/,
    '注入面必须声明 subscribeTheme（ThemeRuntime 自身没有 subscribe）',
  )
  assert.match(
    INDEX,
    /subscribeTheme: \(listener: \(\) => void\) => ctx\.on\('theme\/change'/,
    'index 必须把 subscribeTheme 接到宿主 theme/change 上',
  )
})

test('主题实时：覆盖层订阅快照并据它派生色板与 iframe URL', () => {
  assert.match(
    FRAME,
    /useSyncExternalStore\(\s*onChange => subscribeTheme\(onChange\),\s*\(\) => theme\.getTheme\(\),/,
    '覆盖层必须订阅主题快照（subscribeTheme + getTheme），否则切主题不重渲染',
  )
  assert.match(
    FRAME,
    /const sbLight = themeSnapshot\.active\.colorScheme === 'light'/,
    'sbLight 必须派生自订阅到的快照，而不是渲染时一次性的 getTheme()',
  )
  assert.match(
    FRAME,
    /&theme=\$\{sbLight \? 'light' : 'dark'\}/,
    'iframe URL 必须带当前色板 —— URL 变了才会重新加载换过来',
  )
})
