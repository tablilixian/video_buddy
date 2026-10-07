/**
 * REQ-031（CV-282 Step 2）video 底栏 chips 接线守卫。
 *
 * 口径（tracking.md REQ-031 条目「拍板」两段 + 方案 §四 C 组）：
 *   - 模型弹层三行逐字取演示：H3 可选（唯一真模型，不写路由参数），SeedDance 2.0/2.5
 *     置灰标「即将上线」（后端无端点）；
 *   - spec chip = 画幅两选（16:9/9:16，演示 ARS 与 Host CV-136 枚举一致）+ 时长六档
 *     （拍板④，写 duration 数字参数走 clampDuration）+ 清晰度三档（内部键）；
 *   - 积分明细 = 演示 costRows 公式逐行（模型基准 20 / 时长加长 (dur−5)×2 / 清晰度
 *     RES_COST 0/6/14 / 图×2 视频×6 音频×3 首帧2 尾帧3 / 原生音频 8）+「本次消耗」+
 *     脚注，标「预估」（拍板⑦）；
 *   - 摄像机标记 chip（cam-chip）：开启后挂输入框上方，× 移除；
 *   - image 形态 chips 分支零改动。
 *
 * 源码级字符串断言（与 canvas-prompt-edit.test.mjs 同款手法）。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-031 模型弹层：三行逐字取演示，H3 可选、SeedDance 置灰「即将上线」', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /name: 'MiniMax H3', cost: 20, cap: '首尾帧 \/ 全能参考 · 支持音频 · 最长 15s', maxDur: 15, enabled: true/, 'H3 行必须逐字（cap+基准积分）')
  assert.match(card, /name: 'SeedDance 2.0', cost: 16, cap: '稳定叙事 · 支持音频 · 最长 10s'[\s\S]*?enabled: false/, 'SeedDance 2.0 必须置灰')
  assert.match(card, /name: 'SeedDance 2.5', cost: 24, cap: '旗舰画质 · 支持音频 · 最长 15s'[\s\S]*?enabled: false/, 'SeedDance 2.5 必须置灰')
  assert.match(card, /即将上线/, '置灰行必须标「即将上线」')
  // H3 是唯一真模型：不写模型路由参数（model 为 Host 占坑参数，写了会触发「尚未接入」假警告）。
  assert.equal(card.includes("commitRaw('model'"), false, 'video 模型选择不得写 model 参数（H3 唯一可选，chip 为展示+置灰）')
})

test('REQ-031 spec chip：画幅两选 + 时长六档写数字 + 清晰度内部键', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // 画幅：演示 ARS 只有 16:9/9:16（与 Host CV-136 枚举一致）——不得出现 1:1。
  assert.match(card, /\{ value: '16:9', label: '16:9 横屏' \}/, '画幅必须含 16:9 横屏（演示 ARS 逐字）')
  assert.match(card, /\{ value: '9:16', label: '9:16 竖屏' \}/, '画幅必须含 9:16 竖屏')
  const ratioBlock = card.slice(card.indexOf('const VIDEO_RATIOS'), card.indexOf('const VIDEO_DURATIONS'))
  assert.equal(ratioBlock.includes('1:1'), false, 'video 画幅不得出现 1:1（Host 会静默落回 16:9，显示即撒谎）')
  // 时长：六档数字参数（拍板④）。
  assert.match(card, /const VIDEO_DURATIONS = \[4, 6, 8, 10, 12, 15\] as const/, '时长必须为预设六档')
  assert.match(card, /commitRaw\('duration', d\)/, '时长必须写 duration 数字参数（clampDuration 消费）')
  assert.match(card, /typeof durationRaw === 'number' \? durationRaw : 5/, '时长缺省读数必须落 5s（video_generate fallback 同值）')
  // 清晰度：内部键直写。
  assert.match(card, /commitRaw\('resolution', value\)/, '清晰度必须写内部键参数')
})

test('REQ-031 积分明细：演示 costRows 公式逐行 + 脚注 + 预估', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /\['模型基准 · MiniMax H3', 20\]/, '基准行必须 = H3 20')
  assert.match(card, /Math\.max\(0, duration - 5\) \* 2/, '时长加长必须 = (dur−5)×2（演示公式）')
  assert.match(card, /VIDEO_RES_COST: Readonly<Record<string, number>> = \{ '480p': 0, '736p': 6, '2k': 14 \}/, '清晰度计价必须 = 演示 RES_COST 逐值')
  assert.match(card, /图片参考 ×\$\{images\}/, '图片参考计价行必须存在')
  assert.match(card, /images \* 2/, '图片参考单价 = 2')
  assert.match(card, /videos \* 6/, '视频参考单价 = 6')
  assert.match(card, /audios \* 3/, '音频参考单价 = 3')
  assert.match(card, /\['首帧参考', 2\]/, '首帧参考计价 = 2')
  assert.match(card, /\['尾帧参考', 3\]/, '尾帧参考计价 = 3')
  assert.match(card, /\['原生音频', 8\]/, '原生音频计价 = 8')
  assert.match(card, /本次消耗/, '明细必须有「本次消耗」合计行')
  assert.match(card, /数字为基准积分；时长、清晰度、参考素材与音频会另行结算。/, '脚注必须逐字取演示')
  assert.match(card, /· 预估/, '读数必须标「预估」（拍板⑦）')
})

test('REQ-031 摄像机标记 chip：开启后挂输入框上方，× 移除', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /\{isVideo && cameraOn && \(\n\s*<div className="csCamMarkerRow">/, '标记 chip 必须 video 形态且摄像机开启时渲染')
  assert.match(card, /commitPrompt\('cameraPrefix', ''\)/, '× 必须清 cameraPrefix 参数')
  // 两形态共用面板（抽取复用），副文案按形态区分。
  assert.match(card, /cameraPopNode\('参数已作为标记挂在输入框，与预设风格叠加生效'\)/, 'image 副文案不变')
  assert.match(card, /cameraPopNode\('为整条视频设置机型、镜头、焦段与光圈'\)/, 'video 副文案逐字取演示')
})

test('REQ-031 运镜 chip：Step 3 转真（影片设置面板接入，占位禁用退役）', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /togglePop\('film'\)/, '运镜 chip 必须激活并打开影片设置面板')
  assert.equal(card.includes('Step 3 接入（CV-282）'), false, 'Step 2 的占位禁用注记必须退役')
  assert.match(card, /csChipPop csFilmPop/, '影片设置弹层必须挂 csFilmPop（688px 居中形态）')
})

test('REQ-031 image 形态零改动：既有 chips 分支原样保留', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /MODEL_OPTIONS: readonly \{ value: string; label: string; hint: string \}\[\]/, 'image 模型高级三选仍在')
  assert.match(card, /commitPrompt\('modelOverride', option\.value\)/, 'image 模型覆盖通路不变')
  assert.match(card, /CREDIT_ESTIMATE: Readonly<Record<string, number>> = \{ '480p': 15, '736p': 25, '2k': 40 \}/, 'image 积分估算表不变')
  // 双分支结构：image 走条件分支，video 走新分支。
  assert.match(card, /\{form === 'image' \? \(/, '底栏必须按形态双分支')
})
