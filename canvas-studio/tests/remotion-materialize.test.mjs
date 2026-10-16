/**
 * REQ-034 · R3/R4 守卫：素材物化（本地路径 → 同源 URL）+ 缺素材硬失败。
 *
 * 覆盖 `src/remotion/materialize.ts` 与 `src/remotion/asset-check.ts`：
 *   · 物化：全同源零拷贝（引用相等）/ 域内绝对路径三类字段物化 / 域外拒收 /
 *     `..` 穿越拒收 / **兄弟目录前缀陷阱拒收**；
 *   · 核对：缺失记 `missing`（调用方据此硬失败）；**未经物化的非同源值也记 missing**
 *     （fail-closed —— 若改回「跳过」，静默 404 会重新出现）。
 *
 * 从 `../lib/*.js` 导入 —— 先 build（`yarn workspace canvas-studio build`）再跑。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ASSET_URL_PREFIX } from '../lib/remotion/manifest.js'
import { materializeManifestSources } from '../lib/remotion/materialize.js'
import { checkManifestAssets } from '../lib/remotion/asset-check.js'

const PROJECT = 'p1'

/** 最小合法 Manifest（`src` 默认同源）。 */
function manifest(over = {}) {
  return {
    meta: { title: 't', width: 1280, height: 736, fps: 30, durationInFrames: 90 },
    tracks: [
      { id: 'n1', type: 'video', src: `${ASSET_URL_PREFIX}${PROJECT}/clip.mp4`, startFrame: 0, durationInFrames: 90 },
      { id: 'n2', type: 'image', src: `${ASSET_URL_PREFIX}${PROJECT}/still.png`, startFrame: 0, durationInFrames: 30 },
      { id: 'c1', type: 'textCard', variant: 'subtitle', text: '你好', startFrame: 0, durationInFrames: 30 },
    ],
    ...over,
  }
}

async function withAssetsDir(fn) {
  const root = await mkdtemp(join(tmpdir(), 'cs-mat-'))
  const assetsDir = join(root, PROJECT)
  await mkdir(assetsDir, { recursive: true })
  try {
    return await fn({ root, assetsDir })
  } finally {
    // 仅清理测试自建的临时目录；`rm` 失败不影响断言结论。
    await import('node:fs/promises').then((m) => m.rm(root, { recursive: true, force: true })).catch(() => {})
  }
}

// ---------------------------------------------------------------- 物化

test('物化：全同源 URL ⇒ 零改动且**保持原对象引用**（不重建、无副作用）', () => {
  const m = manifest()
  const r = materializeManifestSources(m, '/tmp/whatever/p1', PROJECT)
  assert.equal(r.remapped, 0)
  assert.deepEqual(r.rejected, [])
  assert.equal(r.manifest, m, '无改动时不应重建对象')
})

test('物化：域内绝对路径（tracks[].src）⇒ 转同源 URL 且计数为 1', async () => {
  await withAssetsDir(async ({ assetsDir }) => {
    const abs = join(assetsDir, 'clip.mp4')
    const m = manifest()
    m.tracks[0].src = abs
    const r = materializeManifestSources(m, assetsDir, PROJECT)
    assert.deepEqual(r.rejected, [])
    assert.equal(r.remapped, 1)
    assert.equal(r.manifest.tracks[0].src, `${ASSET_URL_PREFIX}${PROJECT}/clip.mp4`)
    // 非素材轨不受影响
    assert.equal(r.manifest.tracks[1].src, `${ASSET_URL_PREFIX}${PROJECT}/still.png`)
    // 入参未被就地修改（纯函数）
    assert.equal(m.tracks[0].src, abs)
  })
})

test('物化：audio.bgmUrl / voiceOverUrl 与 global.fonts[].src 同类字段一并覆盖', async () => {
  await withAssetsDir(async ({ assetsDir }) => {
    const m = manifest({
      audio: { bgmUrl: join(assetsDir, 'bgm.mp3'), voiceOverUrl: join(assetsDir, 'vo.mp3') },
      global: { fontFamily: 'Noto Sans SC', fonts: [{ family: 'X', weight: 700, src: join(assetsDir, 'x.woff2') }] },
    })
    const r = materializeManifestSources(m, assetsDir, PROJECT)
    assert.deepEqual(r.rejected, [])
    assert.equal(r.remapped, 3)
    assert.equal(r.manifest.audio.bgmUrl, `${ASSET_URL_PREFIX}${PROJECT}/bgm.mp3`)
    assert.equal(r.manifest.audio.voiceOverUrl, `${ASSET_URL_PREFIX}${PROJECT}/vo.mp3`)
    assert.equal(r.manifest.global.fonts[0].src, `${ASSET_URL_PREFIX}${PROJECT}/x.woff2`)
    assert.equal(r.manifest.global.fontFamily, 'Noto Sans SC', '未涉及的字段原样保留')
  })
})

test('物化：域外绝对路径 ⇒ 记入 rejected，且不放行也不篡改原值', async () => {
  await withAssetsDir(async ({ root, assetsDir }) => {
    await mkdir(join(root, 'other'), { recursive: true })
    const outside = join(root, 'other', 'clip.mp4')
    const m = manifest()
    m.tracks[0].src = outside
    const r = materializeManifestSources(m, assetsDir, PROJECT)
    assert.equal(r.rejected.length, 1)
    assert.match(r.rejected[0], /tracks\[n1\]\.src/)
    assert.match(r.rejected[0], /other\/clip\.mp4$/)
    assert.equal(r.remapped, 0)
    assert.equal(r.manifest.tracks[0].src, outside)
  })
})

test('物化：`..` 穿越（归一化后落到资产目录之外）⇒ rejected', async () => {
  await withAssetsDir(async ({ assetsDir }) => {
    const m = manifest()
    m.tracks[0].src = join(assetsDir, '..', '..', 'etc', 'passwd')
    const r = materializeManifestSources(m, assetsDir, PROJECT)
    assert.equal(r.rejected.length, 1, '归一化后不在 assetsDir 下，必须拒收')
    assert.equal(r.remapped, 0)
  })
})

test('物化：**兄弟目录前缀陷阱**（`<assetsDir>-evil`）⇒ rejected（前缀比较必须带路径分隔符）', async () => {
  await withAssetsDir(async ({ assetsDir }) => {
    const sibling = `${assetsDir}-evil`
    await mkdir(sibling, { recursive: true })
    const m = manifest()
    m.tracks[0].src = join(sibling, 'clip.mp4')
    const r = materializeManifestSources(m, assetsDir, PROJECT)
    assert.equal(r.rejected.length, 1, '同前缀兄弟目录不是子路径，必须拒收')
    assert.equal(r.remapped, 0)
  })
})

test('物化：资产目录**自身**（非文件）⇒ rejected —— 只有其下的文件路径才算素材', async () => {
  await withAssetsDir(async ({ assetsDir }) => {
    const m = manifest()
    m.tracks[0].src = assetsDir
    const r = materializeManifestSources(m, assetsDir, PROJECT)
    assert.equal(r.rejected.length, 1, '目录不是素材文件，必须拒收')
    assert.equal(r.remapped, 0)
  })
})

// ---------------------------------------------------------------- 核对（Z-8 硬失败）

test('核对：素材不存在的同源 URL ⇒ 记入 missing（调用方据此硬失败）', async () => {
  await withAssetsDir(async ({ assetsDir }) => {
    const r = await checkManifestAssets(manifest(), assetsDir)
    assert.equal(r.missing.length, 2, 'clip.mp4 与 still.png 都不存在')
    assert.match(r.missing[0], /n1/)
    assert.match(r.missing[1], /n2/)
    assert.deepEqual(r.realDurations, {})
  })
})

test('核对：素材存在 ⇒ missing 为空', async () => {
  await withAssetsDir(async ({ assetsDir }) => {
    await writeFile(join(assetsDir, 'clip.mp4'), Buffer.from([0, 0, 0, 0]))
    await writeFile(join(assetsDir, 'still.png'), Buffer.from([0, 0, 0, 0]))
    const r = await checkManifestAssets(manifest(), assetsDir)
    assert.deepEqual(r.missing, [])
  })
})

test('核对：**未经物化的非同源值也记 missing**（fail-closed，不得回退成「跳过」）', async () => {
  await withAssetsDir(async ({ assetsDir, root }) => {
    const m = manifest()
    m.tracks[0].src = join(root, 'elsewhere.mp4')
    const r = await checkManifestAssets(m, assetsDir)
    assert.equal(r.missing.length, 2, '域外路径 + 不存在的 still.png')
    assert.match(r.missing[0], /未经物化/)
  })
})
