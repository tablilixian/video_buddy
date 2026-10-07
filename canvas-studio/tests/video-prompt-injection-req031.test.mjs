/**
 * REQ-031（CV-282 Step 4）host 侧前缀注入泛化守卫。
 *
 * 口径（方案 §四 H1~H6 + 拍板第二批①）：
 *   - `composeImagePrompt` 泛化为图像/视频通用：节奏（pacingPrefix，Step 4 新增）
 *     → 摄像机（cameraPrefix）→ 风格（stylePrefix），「，」连接——导演层→摄影层→
 *     美术层；空白前缀跳过；无前缀 = 原文逐字节；
 *   - video 车道（video_generate / video_composite）接线消费；image_fix 不注入；
 *   - 图像节点不写 pacingPrefix ⇒ 泛化对图像车道逐字节零影响；
 *   - 三校验调用点（音频同行 / 视频时长 / 合计 12）在 video 分支保持就位（H6）；
 *   - video 车道不消费 modelOverride（H5：H3 唯一真模型，模型 chip 展示+置灰）。
 *
 * 真值部分直连 lib/generate.js；接线部分源码级字符串断言。
 * 运行：corepack yarn test:smoke（真值部分需要 build 后的 lib/ 产物）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { composeImagePrompt } from '../lib/generate.js'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-031 注入顺序与分隔：节奏 → 摄像机 → 风格，「，」连接', () => {
  const out = composeImagePrompt({
    pacingPrefix: '节奏 一镜到底：单镜头到底，全程不切',
    cameraPrefix: '潘那维申 DXL2 · 阿莱大师定焦 · 35mm · f/4',
    stylePrefix: '电影感构图，宽银幕质感',
    prompt: '夜色中的便利店门口，猫穿过斑马线',
  })
  assert.equal(
    out,
    '节奏 一镜到底：单镜头到底，全程不切，潘那维申 DXL2 · 阿莱大师定焦 · 35mm · f/4，电影感构图，宽银幕质感，夜色中的便利店门口，猫穿过斑马线',
  )
})

test('REQ-031 注入泛化对图像车道零影响：无 pacing 时仍为摄像机→风格旧序，无前缀 = 原文', () => {
  const withTwo = composeImagePrompt({
    cameraPrefix: '潘那维申 DXL2 · 阿莱大师定焦 · 35mm · f/4',
    stylePrefix: '电影感构图，宽银幕质感',
    prompt: '主体画面',
  })
  assert.equal(withTwo, '潘那维申 DXL2 · 阿莱大师定焦 · 35mm · f/4，电影感构图，宽银幕质感，主体画面',
    '无 pacingPrefix（图像节点的实际形态）必须保持 CV-281 的 camera→style 旧序')
  assert.equal(composeImagePrompt({ prompt: '纯文本' }), '纯文本', '无前缀必须逐字节返回原文')
  // 空白前缀跳过（undefined / 空串 / 纯空白同义）。
  assert.equal(
    composeImagePrompt({ pacingPrefix: '  ', cameraPrefix: ' ', prompt: '纯文本' }),
    '纯文本',
  )
})

test('REQ-031 video 车道接线：videoRequestOf 收到注入后的 prompt（错误路径保持原参数）', async () => {
  const generate = await read('src/generate.ts')
  assert.match(
    generate,
    /const req = videoRequestOf\(\s*tool,\s*\{ \.\.\.params, prompt: composeImagePrompt\(params\) \},\s*perShotFallback/,
    'video 请求体必须使用注入后的 prompt，且 params 其余字段原样透传',
  )
  // 三校验调用点（H6）：官方硬规则三件套在 video 分支保持就位。
  assert.match(generate, /validateH3AudioReferences\(audioInputs, visualCount\)/, '音频「必须有视觉素材同行」校验')
  assert.match(generate, /validateH3VideoReferences\(videoInputs\)/, '视频参考时长 ≤15s 校验')
  assert.match(generate, /validateH3ReferenceBudget\(\{/, '跨模态合计 ≤12 校验')
})

test('REQ-031 H5：video 车道不消费 modelOverride（路由表注记 + 卡不写 model 参数）', async () => {
  const route = await read('src/model-route.ts')
  assert.match(route, /video 车道\*\*不消费\*\* `modelOverride`/, 'model-route 必须注记 video 车道豁免')
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.equal(card.includes("commitRaw('model'"), false, 'video 卡不得写 model 路由参数（与 Step 2 守卫同口径）')
})
