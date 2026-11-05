/**
 * UI 加固护栏（2026-11-05 · UI-01/04/09/10/12）。
 *
 * `tsconfig.json` 排除了 `src/client/**`（client 由 tsdown 打成 `lib/client.js`，
 * 只 emit 声明），内部模块没有可 import 的编译产物，所以这一层用**源码结构断言**，
 * 与 `skill-guardrail.test.mjs` 同一套路：守的是「唯一实现点 / 唯一接线点 /
 * 禁用原生阻塞 API」这类结构性不变量，内容被删或绕开就变红。
 *
 * 反向变异：删掉 `<ConfirmHost />`、把任一 `window.confirm(` 加回 client、
 * 或把 `fileCount` 改回字面量 50，本文件都应红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(PKG_ROOT, 'src', 'client')
const SRC = join(PKG_ROOT, 'src')

const read = (rel) => readFileSync(join(CLIENT, rel), 'utf8')
const readSrc = (rel) => readFileSync(join(SRC, rel), 'utf8')

function clientSources(dir = CLIENT, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) clientSources(path, out)
    else if (/\.(ts|tsx)$/u.test(name)) out.push(path)
  }
  return out
}

/** 去掉块注释与整行注释，避免把文件头「为什么不再用」的说明当成违规调用。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map(line => line.replace(/^\s*\/\/.*$/u, ''))
    .join('\n')
}

test('UI-01：client 不得再出现 window.confirm 调用（Electron 会阻塞渲染进程）', () => {
  const offenders = clientSources()
    .filter(path => /window\.confirm\s*\(/u.test(stripComments(readFileSync(path, 'utf8'))))
    .map(path => path.slice(PKG_ROOT.length + 1))
  assert.deepEqual(offenders, [], `原生确认弹窗回潮：${offenders.join(', ')}`)
})

test('UI-01：确认闸门有唯一渲染出口并挂在应用根', () => {
  assert.match(read('ConfirmDialog.tsx'), /export function ConfirmHost/u)
  assert.match(read('ConfirmDialog.tsx'), /useSyncExternalStore\(subscribeConfirm/u)
  assert.match(read('StudioFrame.tsx'), /<ConfirmHost\s*\/>/u)
  assert.match(read('confirm.ts'), /listeners\.size === 0/u, '无订阅者必须拒绝，不能静默放行删除')
})

test('UI-10：全局模态焦点陷阱挂一次，覆盖全部 aria-modal', () => {
  const frame = read('StudioFrame.tsx')
  assert.equal((frame.match(/useModalFocusTrap\(\)/gu) ?? []).length, 1)
  assert.match(read('modal-focus.ts'), /\[aria-modal="true"\]/u)
  assert.match(read('modal-focus.ts'), /MutationObserver/u)
})

test('UI-12：导入文件数上限两侧共用同一常量，前端不复制规则', () => {
  assert.match(readSrc('skill-upload-contract.ts'), /export const IMPORT_FILE_COUNT_LIMIT = 50/u)
  assert.match(readSrc('skill-import-validate.ts'), /fileCount: IMPORT_FILE_COUNT_LIMIT/u)
  const wizard = read('SkillImportWizard.tsx')
  assert.match(wizard, /IMPORT_FILE_COUNT_LIMIT/u)
  assert.doesNotMatch(wizard, /FILE_COUNT_HINT/u)
  assert.match(wizard, /pending\.length > IMPORT_FILE_COUNT_LIMIT/u, '超限时必须前置禁用导入')
})

test('UI-09 / UI-06：toast 层级接令牌且高于全屏覆盖层', () => {
  const styles = read('styles.ts')
  assert.match(styles, /--cs-z-toast:\s*210/u)
  assert.match(styles, /--cs-z-fullpage:\s*200/u)
  assert.match(styles, /z-index:\s*var\(--cs-z-toast, 210\)/u)
  assert.match(read('StudioFrame.tsx'), /zIndex:\s*200/u)
})

test('UI-04：强语义文本配置走 DraftField 失焦提交，不再即键即存', () => {
  for (const key of ['dramaApiBase', 'exportDir', 'assetDir']) {
    assert.match(read('SettingsModal.tsx'), new RegExp(`<DraftField[\\s\\S]{0,240}${key}`, 'u'), key)
  }
  assert.match(read('FirstRunSettings.tsx'), /<DraftField/u)
  assert.doesNotMatch(read('SettingsModal.tsx'), /const onBase =/u)
})

test('UI-14：role="menu" 已降级，名实相符', () => {
  const offenders = clientSources().filter(path => /role="menu"/u.test(readFileSync(path, 'utf8')))
  assert.deepEqual(offenders, [])
})
