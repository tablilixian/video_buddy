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
import { deflateSync } from 'node:zlib'
import {
  alphaDestPath,
  auditMattingFile,
  auditMattingPng,
  auditVerdict,
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
    // 2026-11-02 复刻真机复盘：真实产物的数值自检必须判「通过」——
    // 旧版把自查写成「叠深色卡上目视边缘」，而创作模型没有图像输入，这句指引
    // 永远执行不了；它转而用「四角 alpha=255 ⇒ 没抠掉」判失败（圆角白卡误判）。
    const audit = auditMattingFile(dest, 'white')
    assert.ok(audit !== null, '自检应能解出产物 PNG')
    assert.equal(audit.colorType, 6)
    assert.ok(audit.alphaPct > 10, `白底 64×64 抠出 32×32 方块后透明率应 > 10%，实测 ${audit.alphaPct}`)
    assert.ok(audit.keyResiduePct < 8, `不透明区不应残留底色，实测 ${audit.keyResiduePct}%`)
    assert.equal(auditVerdict(audit).ok, true, `真实抠图产物应判通过，实测：${auditVerdict(audit).note}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── 数值自检纯函数层：用最小 PNG 编码器造已知 alpha 的图 ──

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** RGBA8 / colorType 6 / filter 0 —— 只为自检测试服务。 */
function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** 造一张 w×h 的图：`paint(x,y)` 返回 [r,g,b,a]。 */
function makePng(w, h, paint) {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = paint(x, y)
      const at = (y * w + x) * 4
      rgba[at] = r
      rgba[at + 1] = g
      rgba[at + 2] = b
      rgba[at + 3] = a
    }
  }
  return encodeRgbaPng(w, h, rgba)
}

test('auditMattingPng：圆角白卡（四角不透明）不该被判失败', () => {
  // 20×20 白卡，中间 10×10 已抠成透明；**四角仍是白的、alpha=255** —— 这正是甜品
  // 复刻里那几张产品图的形态。旧判据「corner alpha=255 ⇒ 白底没被 key 掉」会把它
  // 判死，而正确判据（残留底色）是 0。
  const png = makePng(20, 20, (x, y) => {
    const inCenter = x >= 5 && x < 15 && y >= 5 && y < 15
    return inCenter ? [0, 0, 0, 0] : [255, 255, 255, 255]
  })
  const audit = auditMattingPng(png, 'white')
  assert.ok(audit !== null)
  assert.equal(audit.corners[0], 255, '圆角卡四角本来就该不透明')
  assert.ok(Math.abs(audit.alphaPct - 25) < 1, `透明率应 ≈25%（100/400），实测 ${audit.alphaPct}`)
  assert.ok(audit.keyResiduePct > 90, '不透明区全是白 ⇒ 残留底色高（这张图确实没抠干净，但判据是真残留）')
  // 换一张真抠干净的：不透明区是纯黑主体，四角 255 但主体非底色。
  const clean = makePng(20, 20, (x, y) => {
    const inCenter = x >= 5 && x < 15 && y >= 5 && y < 15
    return inCenter ? [20, 20, 20, 255] : [255, 255, 255, 0]
  })
  const cleanAudit = auditMattingPng(clean, 'white')
  assert.ok(cleanAudit !== null)
  assert.equal(cleanAudit.corners[0], 0)
  assert.equal(auditVerdict(cleanAudit).ok, true, auditVerdict(cleanAudit).note)
})

test('auditVerdict：三类失败各自给出可执行的调参建议', () => {
  const noKey = auditVerdict({ width: 10, height: 10, colorType: 6, alphaPct: 0.5, keyResiduePct: 90, corners: [255, 255, 255, 255] })
  assert.equal(noKey.ok, false)
  assert.match(noKey.note, /similarity/u, '底色没抠掉应指向 similarity')

  const overKey = auditVerdict({ width: 10, height: 10, colorType: 6, alphaPct: 99.5, keyResiduePct: 0, corners: [0, 0, 0, 0] })
  assert.equal(overKey.ok, false)
  assert.match(overKey.note, /相似|similarity/u, '整张被吃掉应指向调小 similarity')

  const residue = auditVerdict({ width: 10, height: 10, colorType: 6, alphaPct: 30, keyResiduePct: 20, corners: [255, 255, 0, 0] })
  assert.equal(residue.ok, false)
  assert.match(residue.note, /残留/u)

  const clean = auditVerdict({ width: 10, height: 10, colorType: 6, alphaPct: 30, keyResiduePct: 1, corners: [255, 255, 0, 0] })
  assert.equal(clean.ok, true)
})

test('auditMattingPng：非 PNG / 空数据返回 null，绝不抛', () => {
  assert.equal(auditMattingPng(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'white'), null)
  assert.equal(auditMattingPng(Buffer.alloc(0), 'white'), null)
  assert.equal(auditMattingFile('/no/such/file.png', 'white'), null)
})
