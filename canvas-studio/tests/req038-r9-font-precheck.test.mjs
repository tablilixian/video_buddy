/**
 * REQ-038 R9-P2c（#8 上半，K5 限定）· **字体存在性预检**单测。
 *
 * 三条纪律必须同时成立：
 * ① **只报可验证的问题** —— 本地绝对路径必查；同源 URL 给了 assetsDir 才查；
 *    src 缺省走宿主解析表（合法，不报）；随包族不报；
 * ② **从不抛** —— 预检是辅助设施，内部错误降级为说明行（schema/渲染不受牵连）；
 * ③ **K5 边界钉死** —— 解析级预检做不了（预检自身会卡死），只查文件存在性。
 *
 * 直连 Host tsc 编译产物（临时目录造字体文件）。定向跑：node --test tests/req038-r9-font-precheck.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fontPresenceWarnings } from '../lib/font-precheck.js'
import { auditManifestFile, formatManifestAudit } from '../lib/manifest-audit.js'

function fixture(withFontFile = true) {
  const dir = mkdtempSync(join(tmpdir(), 'r9-font-'))
  const fontPath = join(dir, 'serif.ttf')
  if (withFontFile) writeFileSync(fontPath, 'fake-ttf', 'utf8')
  return { dir, fontPath }
}

test('本地绝对路径：文件缺失 → 警告带回落提示；文件在 → 无警告', () => {
  const { dir, fontPath } = fixture(false)
  const missing = fontPresenceWarnings({
    fontFamily: 'Noto Serif SC',
    fonts: [{ family: 'Noto Serif SC', src: fontPath }],
  })
  assert.equal(missing.length, 1)
  assert.match(missing[0], /字体文件不存在/)
  assert.match(missing[0], /回落随包族/)
  const okDir = fixture(true)
  const fine = fontPresenceWarnings({
    fontFamily: 'Noto Serif SC',
    fonts: [{ family: 'Noto Serif SC', src: okDir.fontPath }],
  })
  assert.deepEqual(fine, [], '文件存在不报')
})

test('同源 URL：剥 projectId 段取裸文件名，给了 assetsDir 才核对；没给则跳过', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r9-font-assets-'))
  // assetsDir = 该项目的资产目录；URL 的 <projectId>/<file> 段剥出 <file> 再解析
  writeFileSync(join(dir, 'serif.ttf'), 'fake-ttf', 'utf8')
  const globalObj = {
    fonts: [{ family: 'Noto Serif SC', src: '/canvas-studio/assets/p1/serif.ttf' }],
  }
  const hit = fontPresenceWarnings(globalObj, join(dir, 'none'))
  assert.equal(hit.length, 1, '项目资产目录里没有该文件 → 必报')
  const fine = fontPresenceWarnings(globalObj, dir)
  assert.deepEqual(fine, [], '文件存在不报')
  assert.deepEqual(fontPresenceWarnings(globalObj), [], '未给 assetsDir → 跳过不查（可验证性纪律）')
})

test('穿越 URL 被剥成裸文件名（构造上中和）+ 尾斜杠空名转警告行，都不炸体检', () => {
  // ../ 穿越在「剥段取 basename」的构造下被中和成 passwd.ttf —— 断言它只报「文件不存在」
  const traversal = fontPresenceWarnings({
    fonts: [{ family: 'Noto Serif SC', src: '/canvas-studio/assets/p1/../etc/passwd.ttf' }],
  }, '/tmp/r9-font-assets-any')
  assert.equal(traversal.length, 1)
  assert.match(traversal[0], /字体文件不存在/)
  assert.match(traversal[0], /passwd\.ttf/, '穿越被中和为裸文件名（不是原路径）')
  // 尾斜杠 → 空文件名 → resolveAssetPathIn 抛「非法资产文件名」→ 转警告行
  const illegal = fontPresenceWarnings({
    fonts: [{ family: 'Noto Serif SC', src: '/canvas-studio/assets/p1/' }],
  }, '/tmp/r9-font-assets-any')
  assert.equal(illegal.length, 1)
  assert.match(illegal[0], /非法资产文件名/)
})

test('src 缺省（走宿主解析表）与随包族：都不报', () => {
  const warnings = fontPresenceWarnings({
    fonts: [
      { family: '思源黑体' },
      { family: 'Noto Sans SC', src: '/canvas-studio/assets/p1/x.ttf' },
    ],
  })
  assert.deepEqual(warnings, [], 'src 缺省是合法路径，随包族零风险')
})

test('从不抛：fonts 形状怪异只忽略不炸', () => {
  assert.deepEqual(fontPresenceWarnings({ fonts: ['字符串', null, 42] }), [])
  assert.deepEqual(fontPresenceWarnings(undefined), [])
  assert.deepEqual(fontPresenceWarnings({ fonts: 'not-array' }), [])
})

test('manifest-audit 回执带字体预检段（仅在有问题时出现）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r9-font-audit-'))
  const manifest = {
    id: 'm',
    meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 60, backgroundColor: '#0B1220' },
    global: { fonts: [{ family: 'Noto Serif SC', src: join(dir, 'missing.ttf') }] },
    tracks: [],
  }
  const file = join(dir, 'm.json')
  writeFileSync(file, JSON.stringify(manifest), 'utf8')
  const result = auditManifestFile(file)
  assert.ok(result.fontLines.length > 0, '缺失字体必须进体检结果')
  const text = formatManifestAudit(result, file)
  assert.match(text, /字体预检/)
})
