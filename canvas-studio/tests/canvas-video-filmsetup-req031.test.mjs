/**
 * REQ-031（CV-282 Step 3）影片设置面板守卫。
 *
 * 口径（方案 §四 F22~F27 + 拍板第二批①②）：
 *   - 运镜词库 = 一比一转录演示 33 条 Higgsfield 官方预设（id/中文名/官方英文名），
 *     静态常量模块 `src/camera-moves.ts`（`cinematic-moves` skill 是纪律文档非词库，
 *     改作 agent 侧纪律两者不打架）；真值测试直连 lib/camera-moves.js；
 *   - 节奏 5 档（名称/顺序/segs/tip 逐字）+ 前缀注入通道（拍板①：自动档 = 删键）；
 *   - 运镜插入 = 官方英文名追加进提示词文本（拍板②；退格可删），已选回显从
 *     提示词反向解析（F26：选择状态只体现在提示词上）；
 *   - 面板双 Tab 固定高度 / 荧光绿浮标 / 悬停演示视频置灰（偏差登记）。
 *
 * 运行：corepack yarn test:smoke（真值部分需要 build 后的 lib/ 产物）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CAMERA_MOVES, FILM_PACES, pacingPrefixOf, parseCameraMoves } from '../lib/camera-moves.js'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-031 运镜词库：33 条与演示逐条一致（id / 中文名 / 官方英文名 / 示意动画）', () => {
  assert.equal(CAMERA_MOVES.length, 33, '词库必须 = 演示全量 33 条')
  // 演示 MOTIONS 逐字转录（顺序即演示顺序）。
  const expected = [
    ['snorricam', '胸前斯坦尼康', 'Snorricam'], ['roboarm', '机械臂', 'Robot Arm'],
    ['tiltup', '上摇', 'Tilt Up'], ['rackfocus', '焦点转移', 'Rack Focus'],
    ['tiltdown', '下摇', 'Tilt Down'], ['pov', '主观视角', 'POV'],
    ['panleft', '左摇', 'Pan Left'], ['craneup', '摇臂上升', 'Crane Up'],
    ['panright', '右摇', 'Pan Right'], ['cranedown', '摇臂下降', 'Crane Down'],
    ['sidetrack', '侧向跟移', 'Side Tracking'], ['pedestalup', '垂直上升', 'Pedestal Up'],
    ['pedestaldown', '垂直下降', 'Pedestal Down'], ['handheld', '手持', 'Handheld'],
    ['tracking', '跟拍', 'Tracking'], ['droneorbit', '无人机环绕', 'Drone Orbit'],
    ['dollyzoom', '推拉变焦', 'Dolly Zoom'], ['aerialpull', '航拍拉远', 'Aerial Pullback'],
    ['staticshot', '固定机位', 'Static Shot'], ['bullettime', '子弹时间', 'Bullet Time'],
    ['whippan', '快速甩镜', 'Whip Pan'], ['slowzoomin', '缓慢推近', 'Slow Zoom In'],
    ['arcleft', '左弧线', 'Arc Left'], ['slowzoomout', '缓慢拉远', 'Slow Zoom Out'],
    ['arcright', '右弧线', 'Arc Right'], ['truckright', '右横移', 'Truck Right'],
    ['dollyin', '推进', 'Dolly In'], ['truckleft', '左横移', 'Truck Left'],
    ['dollyout', '拉远', 'Dolly Out'], ['sliderright', '滑轨右移', 'Slider Right'],
    ['crushzoom', '急推变焦', 'Crush Zoom'], ['sliderleft', '滑轨左移', 'Slider Left'],
    ['helishot', '直升机镜头', 'Helicopter Shot'],
  ]
  expected.forEach(([id, name, en], index) => {
    const move = CAMERA_MOVES[index]
    assert.ok(move, `第 ${index + 1} 条必须存在`)
    assert.equal(move.id, id, `第 ${index + 1} 条 id`)
    assert.equal(move.name, name, `第 ${index + 1} 条中文名`)
    assert.equal(move.en, en, `第 ${index + 1} 条官方英文名`)
  })
})

test('REQ-031 节奏五档：名称/顺序/segs/tip 逐字取演示', () => {
  assert.deepEqual(
    FILM_PACES.map(p => [p.name, p.en, p.segs, p.tip]),
    [
      ['自动', 'Auto', 0, '由画面内容自行决定剪辑点'],
      ['一镜到底', 'Single shot', 1, '单镜头到底，全程不切'],
      ['舒缓', 'Calm', 3, '长镜头为主，慢切留白'],
      ['动感', 'Dynamic', 8, '常规快切，节奏推进'],
      ['凌厉碎剪', 'Chaotic', 12, '极短镜头密集剪切'],
    ],
  )
})

test('REQ-031 节奏前缀：拍板①注入通道——自动档删键，其余档 = 档名+tip 组装', () => {
  assert.equal(pacingPrefixOf(FILM_PACES[0]), undefined, '自动档必须不注入（UI 删键）')
  assert.equal(pacingPrefixOf(FILM_PACES[1]), '节奏 一镜到底：单镜头到底，全程不切')
  assert.equal(pacingPrefixOf(FILM_PACES[4]), '节奏 凌厉碎剪：极短镜头密集剪切')
})

test('REQ-031 运镜解析回显：按文本出现顺序去重保序（F26）', () => {
  // 插入通路写的是官方英文名（拍板②），解析也只认英文名——中文卡名不算已选。
  const moves = parseCameraMoves('Aerial Pullback 开场，Pan Left 环绕，最后 Dolly In 收尾，再加一次 Pan Left')
  assert.deepEqual(
    moves.map(m => m.en),
    ['Aerial Pullback', 'Pan Left', 'Dolly In'],
    '回显顺序 = 文本出现顺序，重复出现的运镜只回显一次',
  )
  assert.equal(parseCameraMoves('航拍拉远，左摇，推进').length, 0, '中文卡名不是插入产物，不得误判已选')
  assert.equal(parseCameraMoves('没有运镜的提示词').length, 0)
})

test('REQ-031 面板结构：双 Tab 固定高度 + 荧光绿浮标 + 置灰偏差 + 轮播 segs', async () => {
  const panel = await read('src/client/canvas/FilmSetupPanel.tsx')
  const styles = await read('src/client/styles.ts')
  // 双 Tab（演示 film-seg 逐字标签 + 有选择时的圆点）。
  assert.match(panel, /role="tab"[\s\S]*?>运镜<span/, '运镜 Tab 必须存在')
  assert.match(panel, /role="tab"[\s\S]*?>节奏<span/, '节奏 Tab 必须存在')
  assert.match(panel, /csFilmDot/, 'Tab 圆点类必须存在（有选择时亮起）')
  // 运镜说明行（演示逐字）+ 荧光绿浮标（演示 .add 逐字文案）。
  assert.match(panel, /点击运镜添加到提示词，建议一Shot一运镜/, '说明行必须逐字取演示')
  assert.match(panel, /添加到提示词/, '悬停浮标文案必须逐字取演示')
  assert.match(styles, /\.csMvAdd \{[\s\S]*?background: #d8ff3e/, '浮标必须为演示荧光绿 #d8ff3e')
  // 悬停演示视频置灰（拍板②偏差登记：官方 CDN mp4 不复用）。
  assert.match(panel, /官方演示视频不复用（拍板②偏差登记）/, '必须登记演示视频置灰偏差')
  // 节奏轮播：5 卡全渲染 + segs 指示条（0 不渲染）+ 名称 pill + tip。
  assert.match(panel, /csPcTrack/, '轮播轨道必须存在')
  assert.match(panel, /entry\.segs > 0 && \(/, '自动档（segs=0）不得渲染指示条')
  assert.match(panel, /csPcVal">\{pace\.name\}/, '名称 pill 必须显示当前档名')
  assert.match(panel, /<em>\{pace\.name\}<\/em>\{pace\.tip\}/, 'tip 行必须 = 档名强调 + 提示文案')
  // 面板固定高度（演示注释：切换时弹层尺寸零变化）。
  assert.match(styles, /\.csFilmBody \{ height: 466px/, '双 Tab 必须共用固定高度')
  // 即时生效：无确定/重置钮（演示注释原文语义）。只查按钮文本节点，注释里的说明不误伤。
  assert.equal(/>\s*确定\s*</.test(panel), false, '面板不得出现确定钮（即时生效）')
  assert.equal(/>\s*重置\s*</.test(panel), false, '面板不得出现重置钮（节奏与运镜都无重置语义）')
})

test('REQ-031 接线：点卡插英文原名（只动草稿）+ 节奏写 pacingPrefix（自动删键）', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const editor = await read('src/client/canvas/PromptEditor.tsx')
  // 运镜插入 = 官方英文名追加（拍板②），走 PromptEditor.appendText 草稿通路。
  assert.match(card, /fieldRefs\.current\.get\('prompt'\)\?\.appendText\(move\.en\)/, '点卡必须把官方英文名追加进提示词草稿')
  assert.match(editor, /appendText\(text: string\): void/, 'PromptEditor 句柄必须暴露 appendText')
  assert.match(editor, /setDraft\(previous => \{[\s\S]*?trimmed\.length === 0 \? text : `\$\{trimmed\}，\$\{text\}`/, '追加必须用「，」连接且只动草稿')
  // 回显唯一事实源 = 提示词文本（草稿优先）。
  assert.match(card, /fieldDrafts\['prompt'\] \?\? promptValueOf\(node, 'prompt'\)/, '回显解析必须读草稿优先的提示词')
  assert.match(card, /parseCameraMoves\(promptDraftOrSaved\)/, '回显必须走 parseCameraMoves')
  // 节奏 = pacingPrefix 参数注入（拍板①）；undefined = 删键（自动档）。
  assert.match(card, /commitRaw\('pacingPrefix', pacingPrefixOf\(filmPaceAt\(index\)\)\)/, '选档必须写 pacingPrefix 参数')
  assert.match(card, /pacingRaw = generationParamOf\(rawRef\.current, 'pacingPrefix'\)/, '档位读数必须从已存前缀反解')
})
