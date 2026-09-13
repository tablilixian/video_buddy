/**
 * C3 波形统一出口测试。
 *
 * 1. 纯函数（src/waveform.ts）：确定性降级 / 真包络重采样 / 条数收口；
 * 2. Host 探测（src/waveform-host.ts）：假 ffmpeg 替身输出正弦 PCM ——
 *    包络峰值形态必须与输入正弦一致（本机无 ffmpeg，走替身先例，见
 *    tests/video-style.test.mjs 的 FAKE_FFMPEG）；
 * 3. 守卫：三处音频消费方必须共用 use-waveform（防再分叉出第二套公式），
 *    旧伪随机公式禁入。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { clampWaveBars, waveBarsDeterministic, waveBarsFromEnvelope, WAVE_BARS_MAX } from '../lib/waveform.js'
import { probeWaveformEnvelope, resolveAudioAssetPath, WAVEFORM_ENVELOPE_BUCKETS } from '../lib/waveform-host.js'

// ---------------------------------------------------------------------------
// 1. 纯函数
// ---------------------------------------------------------------------------

test('waveBarsDeterministic：同 seedText 每次一致，不同 seedText 大概率不同', () => {
  const a1 = waveBarsDeterministic('/canvas-studio/assets/p1/bgm.mp3', 28)
  const a2 = waveBarsDeterministic('/canvas-studio/assets/p1/bgm.mp3', 28)
  assert.deepEqual(a1, a2)
  const b = waveBarsDeterministic('/canvas-studio/assets/p1/other.mp3', 28)
  assert.notDeepEqual(a1, b)
  for (const height of a1) {
    assert.ok(height >= 22 && height <= 92, `降级条高必须落在 22–92：${height}`)
  }
})

test('clampWaveBars：条数收口到 [8, 96]，非法输入回 28', () => {
  assert.equal(clampWaveBars(4), 8)
  assert.equal(clampWaveBars(1000), WAVE_BARS_MAX)
  assert.equal(clampWaveBars(32.4), 32)
  assert.equal(clampWaveBars(Number.NaN), 28)
})

test('waveBarsFromEnvelope：分桶取峰、归一化保底，空包络退平线', () => {
  // 96 桶三角波：峰值 0→1→0，重采样 12 根应首尾低、中段高。
  const envelope = Array.from({ length: 96 }, (_, i) => 1 - Math.abs(i - 48) / 48)
  const bars = waveBarsFromEnvelope(envelope, 12)
  assert.equal(bars.length, 12)
  assert.ok(bars[0] < bars[5] && bars[5] < bars[6], `中段必须高于两端：${bars.join(',')}`)
  assert.ok(Math.max(...bars) <= 100 && Math.min(...bars) >= 4)
  // 全 0 包络（真静音）→ 全保底 4，不是 NaN。
  assert.deepEqual(waveBarsFromEnvelope(new Array(96).fill(0), 8), new Array(8).fill(4))
  // 空包络 → 平线，不抛错。
  assert.deepEqual(waveBarsFromEnvelope([], 8), new Array(8).fill(4))
  // 越界/NaN 样本当 0 处理，不污染峰值（NaN 桶退保底 4，仍在合法区间）。
  assert.ok(
    waveBarsFromEnvelope([0.5, Number.NaN, 0.5], 8).every((h) => Number.isFinite(h) && h >= 4 && h <= 100),
    'NaN 样本只能让所在桶退保底，不得产生非法条高',
  )
})

// ---------------------------------------------------------------------------
// 2. Host 探测（假 ffmpeg：输出 1s 正弦 s16le PCM）
// ---------------------------------------------------------------------------

const FAKE_FFMPEG = `#!/usr/bin/env node
// 测试替身 ffmpeg：忽略参数，输出 8000Hz 1s 正弦 s16le PCM 到 stdout。
const n = 8000
const buf = Buffer.alloc(n * 2)
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(20000 * Math.sin(i / 40)), i * 2)
process.stdout.write(buf)
`

function mockRegistry(assetsDir) {
  return {
    async list() { return [{ id: 'p1' }, { id: 'p2' }] },
    assetsDir(projectId) { return assetsDir(projectId) },
  }
}

test('probeWaveformEnvelope：假 ffmpeg 正弦 PCM → 包络峰值形态与输入一致', { skip: process.platform === 'win32' && '依赖 POSIX 可执行位' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'waveform-test-'))
  const fakeFfmpeg = join(dir, 'fake-ffmpeg.mjs')
  await writeFile(fakeFfmpeg, FAKE_FFMPEG)
  await chmod(fakeFfmpeg, 0o755)
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'assets', 'bgm.mp3'), 'not-really-audio') // 替身不真读
  const registry = mockRegistry((projectId) => join(dir, 'assets'))
  const envelope = await probeWaveformEnvelope(registry, 'p1', 'bgm.mp3', undefined, fakeFfmpeg)
  assert.equal(envelope.length, WAVEFORM_ENVELOPE_BUCKETS)
  // 正弦周期 40 样本 < 单桶样本数（8000/96≈83），每桶峰值≈恒定 → 包络接近平线且非零。
  const min = Math.min(...envelope)
  const max = Math.max(...envelope)
  assert.ok(max <= 1 && min > 0.5, `恒幅正弦的包络应接近平线且非零：min=${min} max=${max}`)
})

test('probeWaveformEnvelope：防穿越 / 扩展名白名单 / 项目不存在', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'waveform-test-'))
  const registry = mockRegistry((projectId) => join(dir, projectId))
  for (const bad of ['../etc/passwd', 'a/b.mp3', 'bgm.txt', 'noext']) {
    assert.equal(await resolveAudioAssetPath(registry, 'p1', bad), null, `非法文件名必须拒：${bad}`)
  }
  assert.equal(await resolveAudioAssetPath(registry, 'missing', 'bgm.mp3'), null)
})

// ---------------------------------------------------------------------------
// 3. 守卫：三处消费方共用一份波形出口
// ---------------------------------------------------------------------------

const readSrc = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const NODE_SRC = readSrc('../src/client/canvas/CanvasNode.tsx')
const PLAYER_SRC = readSrc('../src/client/canvas/AudioPlayerModal.tsx')
const TIMELINE_SRC = readSrc('../src/client/canvas/CanvasTimeline.tsx')
const ROUTES_SRC = readSrc('../src/routes.ts')
const WAVEFORM_HOST_SRC = readSrc('../src/waveform-host.ts')

test('C3 守卫：三处音频消费方共用 use-waveform，旧伪随机公式禁入', () => {
  for (const [name, src] of [['CanvasNode', NODE_SRC], ['AudioPlayerModal', PLAYER_SRC], ['CanvasTimeline', TIMELINE_SRC]]) {
    assert.match(src, /use-waveform\.js/, `${name} 必须从 use-waveform 引波形（防再长出第二套公式）`)
  }
  // 旧公式特征：seed 初始化后 *31/*33 累加再 (x % 61|%83) 派生条高 —— 任何
  // 消费方再出现即分叉回归。
  for (const [name, src] of [['CanvasNode', NODE_SRC], ['AudioPlayerModal', PLAYER_SRC]]) {
    assert.ok(!/seed \* \(index \+ [57]\)\) % (61|83)/.test(src), `${name} 不得再内联旧伪随机公式`)
  }
  assert.match(TIMELINE_SRC, /<WaveBars\b/, '时间轴 BGM 轨必须渲染 WaveBars 条带')
  assert.match(ROUTES_SRC, /ROUTE_WAVEFORM = '\/canvas-studio\/waveform'/, 'Host 必须注册 /canvas-studio/waveform 端点')
  // waveform.ts 禁 node 内建（tsdown client bundle 会炸）。
  assert.ok(!/from 'node:/.test(readSrc('../src/waveform.ts')), 'waveform.ts 不得 import node 内建模块')
  assert.match(WAVEFORM_HOST_SRC, /resolveFfmpegPath/, 'Host 探测必须走统一 ffmpeg 解析链')
})
