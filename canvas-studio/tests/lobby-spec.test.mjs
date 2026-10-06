/**
 * REQ-028：首页规格草稿域（src/lobby-spec.ts）的真值测试。
 *
 * 与源码文本守卫（lobby-claim / lobby-stash）不同，这里**真 import** 编译产物：
 * 分辨率「展示口径 ↔ 真值档位」映射是拍板钉死的口径（2026-10-06：展示跟演示
 * 480P/720P/1080P，内部映射 480p/736p/2k，不新增 1080P 实体档位），写错一个
 * 字面量就是「界面说 1080P、出图按 736p」这类只有生成之后才暴露的错位 ——
 * 必须用直连断言钉住，读源码文本守不住。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke（先 build 再测，
 * import 的是 lib/lobby-spec.js）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RESOLUTION_DISPLAY,
  DEFAULT_LOBBY_RESOLUTION,
  resolutionDisplay,
  LOBBY_ASPECTS,
  LOBBY_MODELS,
  DEFAULT_LOBBY_MODEL,
  lobbyModelLabel,
  LOBBY_DURATION_PRESETS,
  LOBBY_DURATION_CUSTOM,
  defaultLobbySpec,
  buildLobbyPlan,
  durationChipLabel,
  formatChipLabel,
  LOBBY_MODE_COPY,
} from '../lib/lobby-spec.js'

test('REQ-028 拍板②：分辨率展示口径 ↔ 真值档位映射（720P→736p、1080P→2k）', () => {
  // 三档展示名与倍数 meta 逐字对齐演示 HTML（480P 0.4× / 720P 推荐 / 1080P 2.0×）。
  assert.deepEqual(
    RESOLUTION_DISPLAY.map(item => [item.label, item.meta]),
    [['480P', '0.4×'], ['720P', '推荐'], ['1080P', '2.0×']],
  )
  // 内部映射真值：不新增 1080P 实体档位 —— 1080P 就是 2k，720P 就是 736p。
  assert.deepEqual(
    RESOLUTION_DISPLAY.map(item => item.value),
    ['480p', '736p', '2k'],
  )
  // 菜单顺序即数组顺序（480P → 720P → 1080P），默认档 = 736p（演示默认 720P）。
  assert.equal(DEFAULT_LOBBY_RESOLUTION, '736p')
  // 真值 → 展示往返一致；未知值回落默认档而不是 undefined（脏数据不炸 chip）。
  for (const item of RESOLUTION_DISPLAY) {
    assert.equal(resolutionDisplay(item.value).value, item.value)
  }
  assert.equal(resolutionDisplay('whatever').value, '736p')
})

test('REQ-028 模型三选：MiniMax H3（推荐）/ SeedDance 2.0 / SeedDance 2.5', () => {
  assert.deepEqual(
    LOBBY_MODELS.map(model => [model.id, model.label, model.meta ?? null]),
    [
      ['h3', 'MiniMax H3', '推荐'],
      ['seeddance-2.0', 'SeedDance 2.0', null],
      ['seeddance-2.5', 'SeedDance 2.5', null],
    ],
  )
  assert.equal(DEFAULT_LOBBY_MODEL, 'h3')
  assert.equal(lobbyModelLabel('seeddance-2.0'), 'SeedDance 2.0')
  // 未知 id 回落默认展示名（脏数据不渲染成 undefined）。
  assert.equal(lobbyModelLabel('nope'), 'MiniMax H3')
})

test('REQ-028 画幅两卡 + 时长三态：预设 10/15/30/60、自定义哨兵、不锁定', () => {
  assert.deepEqual(LOBBY_ASPECTS.map(item => item.value), ['16:9', '9:16'])
  assert.deepEqual([...LOBBY_DURATION_PRESETS], [10, 15, 30, 60])
  assert.equal(LOBBY_DURATION_CUSTOM, 'custom')
})

test('buildLobbyPlan：画幅恒写、时长夹取 300 上限、自定义非法丢弃', () => {
  // 演示初始态：16:9 · 720P(736p) · 15s —— 画幅/时长都落 plan。
  const plan = buildLobbyPlan(defaultLobbySpec('auto'))
  assert.deepEqual(plan, { aspectRatio: '16:9', targetDuration: 15 })
  // 自定义秒数照落；超上限按 MAX_TARGET_DURATION=300 夹取（分镜预算既有约束，
  // 演示的 600 不跟进 —— 见 lobby-spec.ts 文件头）。
  assert.deepEqual(
    buildLobbyPlan({ ...defaultLobbySpec('auto'), duration: 'custom', durationCustom: '45' }),
    { aspectRatio: '16:9', targetDuration: 45 },
  )
  assert.equal(
    buildLobbyPlan({ ...defaultLobbySpec('auto'), duration: 'custom', durationCustom: '600' })?.targetDuration,
    300,
  )
  // 自定义非法（空串 / 非数字 / 0 / 负数）→ 时长项被丢弃，画幅仍写（规格是伴随
  // 参数，不拦开工）。
  for (const bad of ['', 'abc', '0', '-3']) {
    const result = buildLobbyPlan({ ...defaultLobbySpec('auto'), duration: 'custom', durationCustom: bad })
    assert.deepEqual(result, { aspectRatio: '16:9' }, `durationCustom=${JSON.stringify(bad)}`)
  }
  // 分辨率与模型**不落 plan**（StudioProjectPlan 无字段；路由消费属后续 CV）。
  const withModel = buildLobbyPlan({ ...defaultLobbySpec('auto'), model: 'seeddance-2.5' })
  assert.equal('model' in (withModel ?? {}), false)
  assert.equal('resolution' in (withModel ?? {}), false)
})

test('chip 读数：时长三态随动（15s / 自定义 45s / 不锁定）、画幅·分辨率合并读数', () => {
  const base = defaultLobbySpec('auto')
  assert.equal(durationChipLabel(base), '15s')
  assert.equal(durationChipLabel({ duration: '', durationCustom: '' }), '不锁定')
  assert.equal(durationChipLabel({ duration: 'custom', durationCustom: '45' }), '自定义 45s')
  // 自定义未填秒数时只写「自定义」（不渲染 "自定义 NaNs" 这类残句）。
  assert.equal(durationChipLabel({ duration: 'custom', durationCustom: '' }), '自定义')
  assert.equal(formatChipLabel({ aspect: '16:9', resolution: '736p' }), '16:9 · 720P')
  assert.equal(formatChipLabel({ aspect: '9:16', resolution: '2k' }), '9:16 · 1080P')
})

test('执行模式口径：演示命名（自动执行/询问执行）+ 诚实脚注（不照抄 REQ-022 演示句）', () => {
  // 两项只写模式名（菜单行不带副标题，差异在脚注与 hover 气泡）。
  assert.equal(LOBBY_MODE_COPY.auto.name, '自动执行')
  assert.equal(LOBBY_MODE_COPY.confirm.name, '询问执行')
  // 脚注描述的是今天的真实行为；「先出分镜表，确认后才渲染」是 REQ-022 的
  // 未来语义（仅设计），照抄等于把没做的功能说成已有 —— 守住不回归。
  assert.doesNotMatch(LOBBY_MODE_COPY.auto.foot, /分镜表/)
  assert.match(LOBBY_MODE_COPY.auto.foot, /不再询问/)
  assert.match(LOBBY_MODE_COPY.confirm.foot, /停下来等你确认/)
})
