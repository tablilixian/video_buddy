/**
 * REQ-021 应用内一键测试模式的**场景定义**（固定脚本，版本化）。
 *
 * 与检查点库同住 src/ 根（node:test 直连；理由见 auto-test-checkpoints.ts 头注）。
 * 场景是**纯数据**：剧本逐字内嵌（拍板③：一期一个场景 = 《山谷晨光》15s 版，
 * 原文取自设计文档 §五，不改写），执行器只负责照本宣科。
 *
 * `scriptTurns[0]` = 创意剧本（整段一次发送）；其后每条 = 追加指令（逐条发送、
 * 逐条等回合空闲）。`checkpointGroups[turn]` = 该轮回合结束**后**要跑的检查点 id
 * 集合（全部必须在 AUTO_TEST_CHECKPOINTS 注册表内 —— tests/auto-test-checkpoints.test.mjs
 * 钉住这一点）。
 */
import type { AutoTestCheckpointDef } from './auto-test-checkpoints.js'

/** 一个场景的检查点分组：第 `turn` 条回合结束后跑 `checkpointIds`。 */
export interface AutoTestScenarioCheckpointGroup {
  turn: number
  checkpointIds: readonly string[]
}

/** 一个固定场景（版本化；改剧本 = 新 id，绝不覆写旧场景的语义）。 */
export interface AutoTestScenario {
  /** 稳定 id（浮窗/报告用；v1 = shangu-chenguang-15s）。 */
  id: string
  /** 显示名。 */
  label: string
  /** 项目命名后缀（拍板①：`效果验证-R<n>-<shortName>`，如 效果验证-R001-山谷晨光）。 */
  shortName: string
  /** 场景版本（报告落盘，回归对账用）。 */
  version: 1
  /** 逐条发送的固定文本：第一条 = 创意剧本，其后 = 追加指令。 */
  scriptTurns: readonly [string, ...readonly string[]]
  /** 按回合分组的检查点断言。 */
  checkpointGroups: readonly AutoTestScenarioCheckpointGroup[]
}

/**
 * 《山谷晨光》15s 版（拍板③）。剧本与追加指令逐字来自设计文档 §五（2026-10-05
 * 用户确认），执行器不做任何拼接改写。
 */
export const SHANGU_CHENGGUANG_15S: AutoTestScenario = {
  id: 'shangu-chenguang-15s',
  label: '《山谷晨光》15s 全链',
  shortName: '山谷晨光',
  version: 1,
  scriptTurns: [
    [
      '拍一条 15 秒、16:9 的品牌短片《山谷晨光》：高山茶园的木屋咖啡馆，爷爷和',
      '孙女两代人守着这家店。',
      '- 角色：爷爷（65 岁上下，灰白胡茬，深色粗布围裙）、孙女（8 岁，羊角辫，',
      '  围裙偏大）——形象全片严格一致，先出定稿再开拍。',
      '- 节奏：晨雾茶园舒缓起手，中段孙女骑车下山送咖啡是快节奏运动镜头，黄昏',
      '  店内收束。',
      '- 每个分镜先出关键帧定构图，再出视频。',
      '- 旁白 3 句，全程同一个温暖沉稳的男声，中途不许换音色。',
      '- 成片不要叠加任何字幕。',
      '- 另外：单独出一张竖版宣传海报，片名《山谷晨光》四个字大而醒目排在画面',
      '  中，中文必须逐字正确。',
    ].join('\n'),
    '把孙女的形象改一下：换成齐刘海短发，重出四视图，后面的镜头都用新形象。',
  ],
  checkpointGroups: [
    {
      turn: 0,
      checkpointIds: [
        'project-created',
        'storyboard-cards',
        'keyframes-linked',
        'videos-active',
        'poster-route-qwen',
        'concept-route-krea2',
        'resolution-tier',
        'queue-settled',
        'history-volume',
        'voiceover-consistent',
        'compose-final',
      ],
    },
    {
      turn: 1,
      // 追加指令（改孙女形象）后：全量重跑（回归口径不变）+ 取代串链断言。
      checkpointIds: [
        'project-created',
        'storyboard-cards',
        'keyframes-linked',
        'videos-active',
        'poster-route-qwen',
        'concept-route-krea2',
        'resolution-tier',
        'queue-settled',
        'history-volume',
        'voiceover-consistent',
        'compose-final',
        'supersede-chain',
      ],
    },
  ],
}

/** 一期场景清单（浮窗按此渲染；运行期同一时刻只允许一个场景在跑）。 */
export const AUTO_TEST_SCENARIOS: readonly AutoTestScenario[] = [SHANGU_CHENGGUANG_15S]

/**
 * 场景完整性守卫：引用的检查点 id 必须都在注册表里（执行器开场跑一次，
 * 注册表/场景任何一侧漂移都当场 fail-fast，而不是跑到一半才红）。
 * 纯函数 —— 单测直连（tests/auto-test-checkpoints.test.mjs）。
 */
export function scenarioCheckpointErrors(
  scenario: AutoTestScenario,
  registry: readonly AutoTestCheckpointDef[],
): readonly string[] {
  const known = new Set(registry.map(entry => entry.id))
  const errors: string[] = []
  for (const group of scenario.checkpointGroups) {
    for (const id of group.checkpointIds) {
      if (!known.has(id)) errors.push(`${scenario.id} turn ${group.turn} 引用了未注册的检查点：${id}`)
    }
  }
  // 每条回合都要有断言（空组 = 该轮没有守卫，多半是漏配）。
  for (let turn = 0; turn < scenario.scriptTurns.length; turn += 1) {
    const group = scenario.checkpointGroups.find(entry => entry.turn === turn)
    if (group === undefined || group.checkpointIds.length === 0) {
      errors.push(`${scenario.id} 的第 ${turn} 条回合没有配置任何检查点`)
    }
  }
  return errors
}
