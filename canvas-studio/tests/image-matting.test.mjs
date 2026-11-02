/**
 * CV-394（REQ-036 复刻复盘批）：`image_matting` 纯色底抠透明底契约单测。
 *
 * 覆盖：key 色归一化（别名/hex/非法）/ 钳制 / ffmpeg 参数构造（无注入面）/ 假执行器
 * 注入 / 源文件校验；**真 ffmpeg E2E**：lavfi 生成白底红方块 → colorkey → decodePng
 * 断言 colorType=6（RGBA）+ 角落 alpha=0 + 中心不透明（真透明，不是假 PNG 壳）。
 * 直连 Host tsc 编译产物 `lib/image-matting.js` 与 `lib/inspect-image.js`。
 * 定向跑：corepack yarn build && node --test tests/image-matting.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  alphaDestPath,
  buildMattingArgs,
  clampUnit,
  normalizeKeyColor,
  runImageMatting,
} from '../lib/image-matting.js'
import { decodePng } from '../lib/inspect-image.js'

test('key 色归一化：别名 / 6 位 hex / 3 位 hex / 非法', () => {
  assert.equal(normalizeKeyColor('white'), '0xFFFFFF')
  assert.equal(normalizeKeyColor('WHITE'), '0xFFFFFF')
  assert.equal(normalizeKeyColor('green'), '0x00B140')
  assert.equal(normalizeKeyColor('magenta'), '0xFF00FF')
  assert.equal(normalizeKeyColor('#FF00AA'), '0xFF00AA')
  assert.equal(normalizeKeyColor('#f0a'), '0xFF00AA')
  assert.equal(normalizeKeyColor('0x12abef'), '0x12ABEF')
  assert.equal(normalizeKeyColor('transparent'), null)
  assert.equal(normalizeKeyColor(''), null)
  assert.equal(normalizeKeyColor('#12345'), null)
})

test('clampUnit：NaN/越界取缺省，合法钳在 0–1', () => {
  assert.equal(clampUnit(undefined, 0.28), 0.28)
  assert.equal(clampUnit(Number.NaN, 0.12), 0.12)
  assert.equal(clampUnit(-1, 0.12), 0)
  assert.equal(clampUnit(7, 0.12), 1)
  assert.equal(clampUnit(0.4, 0.12), 0.4)
})

test('buildMattingArgs：colorkey 滤镜 + 单帧 PNG 输出；非法 key 抛错', () => {
  const args = buildMattingArgs({ srcPath: '/a/in.png', destPath: '/a/in-alpha.png', key: '#ff00aa', similarity: 0.4, blend: 0 })
  assert.deepEqual(args, [
    '-hide_banner', '-v', 'error', '-y',
    '-i', '/a/in.png',
    '-vf', 'colorkey=0xFF00AA:0.4000:0.0000',
    '-frames:v', '1',
    '/a/in-alpha.png',
  ])
  assert.throws(() => buildMattingArgs({ srcPath: '/a/in.png', destPath: '/a/o.png', key: '透明' }), /非法 key/)
})

test('alphaDestPath：去扩展名同目录加 -alpha.png', () => {
  assert.equal(alphaDestPath('/p/x/photo.jpg'), '/p/x/photo-alpha.png')
  assert.equal(alphaDestPath('/p/x/logo.PNG'), '/p/x/logo-alpha.png')
})

test('runImageMatting：假执行器注入 + 源不存在报错', async () => {
  let seen = null
  const fakeRun = async (_ffmpeg, args) => {
    seen = args
    return { stdout: '', stderr: '' }
  }
  // 源不存在 → 先报错（不进 ffmpeg）
  await assert.rejects(
    () => runImageMatting({ srcPath: '/no/such.png', destPath: '/no/such-alpha.png', key: 'white' }, fakeRun),
    /源图不存在/,
  )
  assert.equal(seen, null)
})

test('真 ffmpeg E2E：白底红方块 → colorkey → 角落透明 + 中心不透明', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'matting-'))
  try {
    const src = join(dir, 'sheet.png')
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=white:s=64x64:d=0.1',
      '-vf', 'drawbox=x=16:y=16:w=32:h=32:color=red:t=fill',
      '-frames:v', '1', src,
    ])
    const dest = alphaDestPath(src)
    const r = await runImageMatting({ srcPath: src, destPath: dest, key: 'white' })
    assert.ok(r.bytes > 0, '产物为空')
    const img = decodePng(readFileSync(dest))
    assert.equal(img.colorType, 6, `期望 RGBA（colorType 6），实测 ${img.colorType}`)
    const px = (x, y) => {
      const i = (y * img.width + x) * 4
      return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]]
    }
    const [cr, cg, cb, ca] = px(2, 2)
    assert.equal(ca, 0, `角落应为全透明，实测 alpha=${ca}`)
    const [rr, rg, rb, ra] = px(32, 32)
    assert.equal(ra, 255, `中心应不透明，实测 alpha=${ra}`)
    // colorkey 对保留色有 ±3 级的内部处理，断「红主导」不断具体值
    assert.ok(rr >= 240 && rr > rg + 100 && rr > rb + 100, `中心应为红色主导，实测 ${rr},${rg},${rb},${ra}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
