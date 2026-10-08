/**
 * REQ-031（CV-282 Step 1）video 形态托盘接线守卫。
 *
 * 口径（tracking.md REQ-031 条目「拍板」两段 + 方案 §四/§七 Step 1）：
 *   - 模式 Tab「首尾帧/全能参考」→ 写 `channel`（fl2va/ref2va）；两模式参数键不互删；
 *   - fl = filename（首帧）/ filenameTail（尾帧）双单值槽；omni = filenames(9)/
 *     videoRefs(3)/audioRefs(3) 三分类（官方分路上限），合计 ≤12；
 *   - 头部「音频」chip = 原生音频开关（generateAudio 布尔参数）——不是槽位显隐；
 *   - 发送前校验：音频不能唯一（官方硬规则）+ 合计 12；
 *   - 托盘上沿 = 节点下沿 + CHROME_GAP(12)×z（CV-283 再修正：此前「紧贴无间隙」
 *     是 loose 文案；演示 placeChrome 原式 pTop = r.bottom + gap，gap 随画布缩放）。
 *
 * 源码级字符串断言（与 canvas-prompt-edit.test.mjs 同款手法）。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-031 托盘：form 按节点 kind 判定，image 路径零改动', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  assert.match(surface, /form=\{cardNode\.kind === 'video' \? 'video' : 'image'\}/, '形态必须按节点 kind 判定传入')
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /export type InputCardForm = 'image' \| 'video'/, '必须声明两形态类型')
  // image 形态既有通路不动：withReferenceNames 写回 + slot.max 上限仍在。
  assert.match(card, /withReferenceNames\(node\.generationPrompt, slot, next\)/, 'image 参考位写回契约不变')
  assert.match(card, /const refCap = slot\?\.max \?\? 4/, 'image 上限仍走槽位表')
})

test('REQ-031 模式 Tab：写 channel 参数（fl2va/ref2va），两模式参数键不互删', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /commitRaw\('channel', next === 'fl' \? 'fl2va' : 'ref2va'\)/, '模式切换必须写 channel 参数')
  // 不互删：fl 键（filename/filenameTail）与 omni 键（filenames/videoRefs/audioRefs）各自独立定义。
  assert.match(card, /\{ key: 'filename', label: '首帧', kind: 'image', multi: false, cap: 1 \}/, '首帧单值槽')
  assert.match(card, /\{ key: 'filenameTail', label: '尾帧', kind: 'image', multi: false, cap: 1 \}/, '尾帧单值槽')
  assert.match(card, /\{ key: 'filenames', label: '图片', kind: 'image', multi: true, cap: VIDEO_CAPS\.images \}/, '图片分类 ≤9')
  assert.match(card, /\{ key: 'videoRefs', label: '视频', kind: 'video', multi: true, cap: VIDEO_CAPS\.videos \}/, '视频分类 ≤3')
  assert.match(card, /\{ key: 'audioRefs', label: '音频', kind: 'audio', multi: true, cap: VIDEO_CAPS\.audios \}/, '音频分类 ≤3')
})

test('REQ-031 音频开关：generateAudio 布尔参数（开=写 true，关=删键），不是槽位显隐', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /commitRaw\('generateAudio', next \? true : undefined\)/, '开关必须写布尔参数（关=删键，缺省不发字段纪律）')
  assert.match(card, /generationParamOf\(node\.generationPrompt, 'generateAudio'\) === true/, '初值必须从参数读布尔')
  // 原生音频（头部 chip）与音频参考槽（audioRefs 分类）是两回事：两者并存。
  assert.match(card, /\{ key: 'audioRefs', label: '音频'/, '音频参考槽仍独立存在')
})

test('REQ-031 写回助手：withGenerationParam 支持删键（空值不许「已定义」透传）', async () => {
  const helper = await read('src/node-params.ts')
  assert.match(helper, /export function withGenerationParam\(/, '必须有原始参数写回助手')
  assert.match(helper, /delete rest\[key\]/, 'value === undefined 必须删键（空串会被「已定义」判据透传）')
  assert.match(helper, /export function generationParamOf\(/, '必须有原始参数读取助手（promptValueOf 只服务字符串键）')
})

test('REQ-031 发送校验：音频不能唯一 + 合计 12（官方硬规则，UI 层拦截）', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /音频不能作为唯一参考：H3 要求同时提供至少一张图或一段视频（官方硬规则）/, '音频唯一必须拦截（与 audio-reference.ts 同文案）')
  assert.match(card, /超过官方合计上限 \$\{VIDEO_CAPS\.total\} 个/, '合计超 12 必须拦截')
  assert.match(card, /const VIDEO_CAPS = \{ images: 9, videos: 3, audios: 3, total: 12 \}/, '分路上限必须与 H3 官方口径同源')
})

test('REQ-031 托盘放置：上沿 = 节点下沿 + CHROME_GAP(12)×视觉比例（CV-285 比例补偿后）', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // 演示 placeChrome：pTop = r.bottom + gap（gap = CHROME_GAP × 视觉比例；演示 k≡1
  // 故其式为 ×z）—— 间隙与工具条共用 canvas-view 的 CHROME_GAP，写回无间隙 / +10 即回归。
  assert.match(card, /const top = nodeBottom \+ CHROME_GAP \* effScale/, '托盘上沿必须 = 节点下沿 + 12×视觉比例')
  assert.match(card, /import \{ CHROME_GAP, chromeScaleOf \} from '\.\.\/\.\.\/canvas-view\.js'/, '间隙必须与工具条同源（canvas-view.CHROME_GAP）')
  assert.equal(/\+ 10\)/.test(card), false, '不得残留旧间隙常量')
})

test('REQ-031 候选池：按模态过滤（画布 kind / 资产库 media.kind）', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /const build = \(kind: 'image' \| 'video' \| 'audio'\)/, '候选池必须按三模态构建')
  assert.match(card, /candidate\.kind === kind/, '画布候选必须按节点 kind 过滤')
  assert.match(card, /entry\.kind === kind/, '资产库候选必须按媒体 kind 过滤')
})
