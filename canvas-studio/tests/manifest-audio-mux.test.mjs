/**
 * P0-2 · **分镜路径整轨混音**（`muxManifestAudio`）行为测试。
 *
 * 这条能力是「带旁白的片子能不能走分镜」的全部依据：段渲染恒静音 + concat `-c copy`
 * ⇒ 合并片没有音轨，拼接后必须有人把 `manifest.audio` 装配上去。没有这一步，
 * 放开 `allowShots` 就是拿「成片没声音」换「渲染快」。
 *
 * 因此这里断言的全是**行为**，不是「源码里有这行字」：
 * - 装配顺序（先音轨、再合流）与合流参数（`-c:v copy` 零重编码）；
 * - 任一步失败 ⇒ 不抛、`mixed:false`、带可读 note（成片已渲好，不允许陪葬）；
 * - 无 audio / 只有原生声 ⇒ 不做无用功。
 *
 * 定向跑：node --test tests/manifest-audio-mux.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { muxManifestAudio, audioCompatibleWithShots } from '../lib/manifest-audio-mux.js'

/** 造一个最小 manifest（30fps / 90 帧 = 3s）。 */
function manifest({ audio, tracks = [] } = {}) {
  return {
    id: 'm',
    meta: { title: 'x', width: 1920, height: 1080, fps: 30, durationInFrames: 90, backgroundColor: '#000' },
    tracks,
    ...(audio === undefined ? {} : { audio }),
  }
}

/** 假 ffmpeg：记录每次调用，按 `code` 决定成败。 */
function fakeFfmpeg(code = 0) {
  const calls = []
  return {
    calls,
    run: async (path, args) => {
      calls.push({ path, args: [...args] })
      return { code, stdout: '', stderr: code === 0 ? '' : 'boom: filter failed' }
    },
  }
}

const base = { videoPath: '/p/build/shot-cache/merged.mp4', outputPath: '/p/build/shot-cache/out.mp4', assetsDir: '/p/assets' }

test('无 audio ⇒ 不做任何事（mixed:false，路径原样）', async () => {
  const fake = fakeFfmpeg()
  const result = await muxManifestAudio({ ...base, manifest: manifest(), run: fake.run, resolvePath: () => 'ffmpeg' })
  assert.equal(result.mixed, false)
  assert.equal(result.videoPath, base.videoPath)
  assert.equal(fake.calls.length, 0)
})

test('有 bgm ⇒ 先装配音轨、再 -c:v copy 合流（两步，顺序固定）', async () => {
  const fake = fakeFfmpeg()
  const result = await muxManifestAudio({
    ...base,
    manifest: manifest({ audio: { bgmUrl: '/assets/p/bgm.mp3' } }),
    run: fake.run,
    resolvePath: () => 'ffmpeg',
  })

  assert.equal(result.mixed, true)
  assert.equal(result.videoPath, base.outputPath)
  assert.equal(fake.calls.length, 2, '应当是「音轨 + 合流」两次 ffmpeg')

  const [track, mux] = fake.calls
  // ① 音轨：素材走 -i、滤镜走 -filter_complex、钉片长 3s
  assert.ok(track.args.includes('-filter_complex'))
  assert.ok(track.args.includes('/p/assets/bgm.mp3'), 'bgm 的 URL 必须换成项目内本地路径再喂 ffmpeg')
  assert.match(track.args.join(' '), /-t 3\.000/)
  // ② 合流：画面零重编码，音频替换母版
  assert.ok(mux.args.includes('-c:v') && mux.args.includes('copy'), '画面必须 -c:v copy（分镜的增量收益全靠零重编码）')
  assert.ok(mux.args.includes(base.videoPath) && mux.args.includes(base.outputPath))
  assert.equal(result.audioComposition, 'bgm')
})

test('ffmpeg 失败 ⇒ 不抛、降级为无声母版、note 说明原因', async () => {
  const fake = fakeFfmpeg(1)
  const result = await muxManifestAudio({
    ...base,
    manifest: manifest({ audio: { bgmUrl: '/assets/p/bgm.mp3' } }),
    run: fake.run,
    resolvePath: () => 'ffmpeg',
  })
  assert.equal(result.mixed, false)
  assert.equal(result.videoPath, base.videoPath)
  assert.match(result.note, /混音跳过/)
  assert.match(result.note, /boom/)
})

test('音频源全部不可混（只有 video 轨原生声）⇒ 跳过并说明，不假装混了', async () => {
  const fake = fakeFfmpeg()
  const result = await muxManifestAudio({
    ...base,
    // 有 video 轨 ⇒ timelineFromManifestAudio 会登记 native 段（url 为空），但没有可混的源
    manifest: manifest({
      tracks: [{ id: 'clip', type: 'video', src: '/assets/p/a.mp4', box: { x: 0, y: 0, w: 100, h: 100 }, startFrame: 0, durationInFrames: 90 }],
      audio: { fadeInSeconds: 0.5 },
    }),
    run: fake.run,
    resolvePath: () => 'ffmpeg',
  })
  assert.equal(result.mixed, false)
  assert.equal(fake.calls.length, 0)
  assert.match(result.note, /原生声/)
})

test('audioCompatibleWithShots：唯一例外是 video 轨，不是 audio 本身', () => {
  assert.equal(audioCompatibleWithShots(manifest({ audio: { bgmUrl: '/a.mp3' } })), true)
  assert.equal(audioCompatibleWithShots(manifest()), true)
  assert.equal(audioCompatibleWithShots(manifest({
    audio: { bgmUrl: '/a.mp3' },
    tracks: [{ id: 'clip', type: 'video', src: '/assets/p/a.mp4', box: { x: 0, y: 0, w: 100, h: 100 } }],
  })), false)
})
