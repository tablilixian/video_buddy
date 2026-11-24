/**
 * 预估报价的参数推导（`src/credit-quote.ts`）。
 *
 * 这一层是「界面参数 → 后端 quote 请求体」的唯一实现，所以它错了就是**报出来的价
 * 不是实际要扣的那笔钱**。三条断言对齐实测口径
 * （`docs/plans/积分预估与实扣展示方案-20261124.md` §1.1，逐点采样 quote 反推）：
 *
 * 1. 图片按**面积**：720P 16:9 = 1376×768（21.1354 分），9:16 同面积同价，
 *    1:1 = 1024²（另价）；带参考图 ⇒ `image2image`（×1.25）。
 * 2. 视频只看**时长**：`megapixels` 照发但不影响单价；`fl` / `omni` 只是 operation。
 * 3. 音频：`music` 传时长（秒 × 1），`voice` / `design` 走固定价的 `txt2speech`。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuoteParams, quoteFingerprint, quoteRequestFor } from '../lib/credit-quote.js'

test('图片报价：720P 16:9 → 1376×768，走默认 Krea2 文生图', () => {
  const req = quoteRequestFor({ kind: 'image', prompt: '一只猫' })
  assert.equal(req.model, 'image.krea2')
  assert.equal(req.operation, 'txt2image')
  assert.deepEqual([req.input.width, req.input.height], [1376, 768])
})

test('图片报价：9:16 与 16:9 同面积（同价），1:1 走 1024²', () => {
  const wide = quoteRequestFor({ kind: 'image', resolution: '720p', aspectRatio: '16:9' })
  const tall = quoteRequestFor({ kind: 'image', resolution: '720p', aspectRatio: '9:16' })
  assert.equal(wide.input.width * wide.input.height, tall.input.width * tall.input.height, '9:16 必须与 16:9 等面积（否则报价会差一笔）')
  const square = quoteRequestFor({ kind: 'image', resolution: '720p', aspectRatio: '1:1' })
  assert.deepEqual([square.input.width, square.input.height], [1024, 1024])
})

test('图片报价：档位换挡改面积（1080P 面积是 720P 的 1.98 倍）', () => {
  const p720 = quoteRequestFor({ kind: 'image', resolution: '720p' })
  const p1080 = quoteRequestFor({ kind: 'image', resolution: '1080p' })
  assert.equal(p1080.input.width, 1920)
  assert.equal(p1080.input.height, 1088)
  const ratio = (p1080.input.width * p1080.input.height) / (p720.input.width * p720.input.height)
  assert.ok(Math.abs(ratio - 1.98) < 0.02, `实测 1080P/720P 报价比 ≈1.98，实际 ${ratio.toFixed(4)}`)
})

test('图片报价：带参考图改走 image2image（同尺寸 ×1.25，不能报成文生图价）', () => {
  const text = quoteRequestFor({ kind: 'image', hasImages: false })
  const ref = quoteRequestFor({ kind: 'image', hasImages: true })
  assert.equal(text.operation, 'txt2image')
  assert.equal(ref.operation, 'image2image')
  assert.equal(ref.model, 'image.qwen-image-2.1')
  assert.deepEqual([ref.input.width, ref.input.height], [text.input.width, text.input.height], '参考不影响尺寸，只改 operation')
})

test('报价 prompt：空则发占位串（报价不吃 prompt，但空串会被入参校验拒）', () => {
  assert.equal(quoteRequestFor({ kind: 'image' }).input.prompt, 'pricing')
  assert.equal(quoteRequestFor({ kind: 'image', prompt: '一只猫' }).input.prompt, '一只猫', '有提示词时原样发（图片路由要它判有没有可显示文字）')
  assert.equal(quoteRequestFor({ kind: 'image', prompt: '   ' }).input.prompt, 'pricing', '纯空白等同没写')
})

test('图片报价：角色四视图走 image2character（固定价、空 input，不能按面积报）', () => {
  const req = quoteRequestFor({ kind: 'image', imageTool: 'character_generate', hasImages: true, resolution: '1080p' })
  assert.equal(req.model, 'image.krea2')
  assert.equal(req.operation, 'image2character')
  assert.deepEqual(req.input, {}, '生成链发的就是空 input（不吃尺寸/prompt）；按面积报会差 3.58')
})

test('图片报价：节点级 modelOverride 生效（预估与生成必须同一条路由）', () => {
  assert.equal(quoteRequestFor({ kind: 'image', modelOverride: 'krea2' }).model, 'image.krea2')
  assert.equal(quoteRequestFor({ kind: 'image', modelOverride: 'textRender' }).model, 'image.qwen-image-2.1')
})

test('图片报价：历史脏档位按出厂档报（不抛错，也不报 0）', () => {
  const weird = quoteRequestFor({ kind: 'image', resolution: '736p' })
  assert.equal(weird.input.width, 1376, '旧键 736p 必须归一到 720P 的像素')
  assert.equal(weird.input.height, 768)
})

test('视频报价：时长是唯一计价维度，清晰度只改 megapixels 不改价', () => {
  const five = quoteRequestFor({ kind: 'video', duration: 5, resolution: '480p' })
  const fifteen = quoteRequestFor({ kind: 'video', duration: 15, resolution: '1080p' })
  assert.equal(five.model, 'video.minimax_h3')
  assert.equal(five.input.duration, 5)
  assert.equal(fifteen.input.duration, 15)
  // megapixels 照发（与生成请求同形），但不是计价维度（实测 0.4/1.0/2.0 同价）。
  assert.equal(five.input.megapixels, 0.4)
  assert.equal(fifteen.input.megapixels, 2.0)
})

test('视频报价：fl / omni 是不同 operation，缺省按 fl（首尾帧）', () => {
  assert.equal(quoteRequestFor({ kind: 'video' }).operation, 'image2videofl2va')
  assert.equal(quoteRequestFor({ kind: 'video', videoMode: 'fl' }).operation, 'image2videofl2va')
  assert.equal(quoteRequestFor({ kind: 'video', videoMode: 'omni' }).operation, 'image2videoref2va')
})

test('视频报价：时长缺省 5s、非有限值不落到请求体', () => {
  assert.equal(quoteRequestFor({ kind: 'video' }).input.duration, 5)
  assert.equal(quoteRequestFor({ kind: 'video', duration: Number.NaN }).input.duration, 5)
  assert.equal(quoteRequestFor({ kind: 'video', duration: 0 }).input.duration, 1, '0 秒不是合法请求，至少 1s')
})

test('音频报价：music 传时长 + 纯器乐兜底歌词；voice/design 走固定价 txt2speech', () => {
  const music = quoteRequestFor({ kind: 'audio', audioFn: 'music', duration: 12 })
  assert.equal(music.model, 'audio.yue2')
  assert.equal(music.operation, 'txt2audio')
  assert.equal(music.input.duration, 12)
  assert.equal(music.input.lyrics, '[Instrumental]', '没填歌词必须与生成链一样发纯器乐标记')
  const tts = quoteRequestFor({ kind: 'audio', audioFn: 'voice', prompt: '你好' })
  assert.equal(tts.model, 'audio.voxcpm2')
  assert.equal(tts.operation, 'txt2speech')
  assert.equal(tts.input.prompt, '你好')
  const design = quoteRequestFor({ kind: 'audio', audioFn: 'design' })
  assert.equal(design.operation, 'txt2speech', '音色设计与语音合成同价同 operation')
})

test('报价指纹：只认真计价参数（改 prompt 不重报，改时长/档位才重报）', () => {
  const base = { kind: 'video', duration: 5, resolution: '720p' }
  assert.equal(
    quoteFingerprint({ ...base, prompt: '一个镜头' }),
    quoteFingerprint({ ...base, prompt: '完全不同的另一个镜头' }),
    'prompt 不影响价格，改一个字不该重新报价',
  )
  assert.notEqual(quoteFingerprint(base), quoteFingerprint({ ...base, duration: 10 }), '时长变了必须重报')
  assert.notEqual(quoteFingerprint(base), quoteFingerprint({ ...base, resolution: '1080p' }), '档位变了必须重报')
  assert.notEqual(
    quoteFingerprint({ kind: 'image' }),
    quoteFingerprint({ kind: 'image', hasImages: true }),
    '有没有参考图是计价维度（文生图/图生图差 25%）',
  )
})

test('parseQuoteParams：只认三种 kind，其余字段做形状校验（不猜）', () => {
  assert.equal(parseQuoteParams(null), null)
  assert.equal(parseQuoteParams('image'), null)
  assert.equal(parseQuoteParams({}), null, '缺 kind 是调用方搞错接口，不能静默给兜底价')
  assert.equal(parseQuoteParams({ kind: 'text' }), null)
  const parsed = parseQuoteParams({
    kind: 'video',
    duration: '15',
    resolution: '1080p',
    videoMode: 'omni',
    hasImages: 'true',
    bogus: 1,
  })
  assert.equal(parsed.kind, 'video')
  assert.equal(parsed.duration, undefined, '字符串时长不是数字，必须丢掉（不能 String→Number 猜）')
  assert.equal(parsed.resolution, '1080p')
  assert.equal(parsed.videoMode, 'omni')
  assert.equal(parsed.hasImages, undefined, '只认 true（字符串 "true" 不算）')
})
