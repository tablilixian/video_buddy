/**
 * skill 纪律源码闸（2026-10-02 对账批次）：把「分镜→条数」「音色一致性」「文字
 * 单处标注」「BGM 提示词」四类会话级教训钉在 skill 文档与工具描述的原文上。
 *
 * 为什么用源码闸：这些纪律没有类型系统可拦，agent 行为回归只能靠真机才能发现
 * （C-16 / C-5 / C-11 / C-6 / C-7 都是资料库实测缺陷）——文案一改错，闸直接红。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

test('C-16/R-P0-11：分镜↔视频条数映射铁律必须在分镜与剧本两处文档里（一个分镜=一条视频，shot 是节拍）', () => {
  const shotFormat = read('skills/canvas-studio-creation/references/shot-format.md')
  assert.match(shotFormat, /一个分镜 = 一条视频/, 'shot-format.md 必须写明映射铁律')
  assert.match(shotFormat, /严禁按 shot 数逐条生成/, '必须明确禁止按 shot 数出片')
  assert.match(shotFormat, /文戏约 2\.5s 一个 shot、武戏约 1\.3s 一个 shot/, 'R-P0-11 节拍密度必须落到 shot-format.md')
  assert.ok(!shotFormat.includes('video_generate 建议 8–10s'), '「建议 8–10s」会推高一镜一条的倾向，已退役（C-16）')
  assert.match(shotFormat, /时长取自分镜表的「时长」列.*不自定/, '逐镜时长必须锚定分镜表时长列')

  const screenplay = read('skills/canvas-studio-creation/references/screenplay.md')
  assert.match(screenplay, /不按时长反推/, 'screenplay.md 不得再用「总时长 ÷ 单镜时长」反推条数')
  assert.ok(!screenplay.includes('单镜 8–10s'), '「单镜 8–10s」口径已退役（C-16）')

  const skill = read('skills/canvas-studio-creation/SKILL.md')
  assert.match(skill, /一个分镜 = 一条视频/, '工作流第 9 步必须带条数纪律')
})
