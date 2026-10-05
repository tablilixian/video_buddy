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

test('C-5：多段旁白音色一致性纪律必须落在 voiceover skill 与 tts_voiceover 工具描述里', () => {
  const skill = read('skills/voiceover-writing/SKILL.md')
  assert.match(skill, /多段旁白音色一致性（C-5 铁律）/, '拆段节必须带音色一致性铁律')
  assert.match(skill, /每段都传\s+同一个 refaudio/, '有参考音时每段必须传同一个 refaudio')
  assert.match(skill, /逐字复用第一段的 instruct_prompt/, '无参考音时各段七维逐字一致')
  assert.match(skill, /逐段核对音频节点都已真实落卡/, '首段旁白丢失的规避（生成完数节点）')
  assert.match(skill, /回退时音色一致性不放松/, '克隆失败回退路径不得放松一致性')
  const hostTools = read('src/host-tools.ts')
  assert.match(hostTools, /多段旁白必须同音色/, 'tts_voiceover 工具描述必须带同音色纪律')
})

test('C-11：叠加型标注「只在一处加」纪律落在 krea2 / h3 / shot-format 三处', () => {
  const krea = read('skills/krea2-turbo-writing/SKILL.md')
  assert.match(krea, /二选一（C-11）/, 'krea2 文字渲染节必须带二选一纪律')
  const h3 = read('skills/h3-prompt-writing/references/format-base.md')
  assert.match(h3, /只写这一处（C-11）/, 'h3 画面内文字节必须带单处纪律')
  const shot = read('skills/canvas-studio-creation/references/shot-format.md')
  assert.match(shot, /只在一处加（C-11）/, 'shot-format CV-213 节必须带单处纪律')
})

test('C-6/C-7：BGM 提示词自相矛盾条款清除 + 纯器乐人声规范落地', () => {
  const music = read('skills/music-prompt-writing/SKILL.md')
  assert.ok(!music.includes('禁止在 Caption 写 BPM'), 'C-6：「禁止写 BPM——走专门参数」与 §2.1 矛盾，必须清除')
  assert.ok(!music.includes('language="unknown"'), 'language 参数已退役，残留示例必须清除')
  assert.match(music, /禁写人声正向词（C-7）/, '纯器乐人声规范必须落地')
  assert.match(music, /instrumental, no vocals/, '负向词写法必须给出')
  assert.match(music, /Yue2 \/ txt2audio/, '标题不得再写 ACE Step')
  const rules = read('skills/music-prompt-writing/references/caption-lyrics-rules.md')
  assert.ok(!rules.includes('ACE-Step'), '分册标题不得再写 ACE-Step')
})

test('REQ-016：门禁死符号 GATED_TOOLS 在两份文档零命中，门禁口径指向 approval-gate 两张表', () => {
  const tools = read('docs/canvas-studio-tools.md')
  const api = read('docs/api.md')
  assert.ok(!tools.includes('GATED_TOOLS'), 'canvas-studio-tools.md 不得再出现 GATED_TOOLS（实体已删，判定在 approval-gate.ts）')
  assert.ok(!api.includes('GATED_TOOLS'), 'api.md 同上')
  assert.match(tools, /FORMAL_TOOLS/, '门禁口径必须指向 FORMAL_TOOLS 真实机制')
})

test('REQ-017：tts_voiceover 反判据（角色对白走 <d>）落在工具描述 / skill / toolchain 三处', () => {
  const hostTools = read('src/host-tools.ts')
  assert.match(hostTools, /反判据（REQ-017）/, 'tts 工具描述必须带反判据（模型每回合都读）')
  const skill = read('skills/voiceover-writing/SKILL.md')
  assert.match(skill, /反向判据（REQ-017）/, 'voiceover-writing 必须有第 0 条反向判据')
  const toolchain = read('skills/canvas-studio-creation/references/toolchain.md')
  assert.match(toolchain, /角色对白不用它/, 'toolchain tts 行必须补对白边界短句')
})

test('R-P1-03（2026-10-04 拍板）：withtxt 判据收编进模型路由，三处口径一致', () => {
  const hostTools = read('src/host-tools.ts')
  // 一处事实两处消费：image_generate 与 image_generate_withtxt 描述都插值路由摘要。
  const summaryHits = hostTools.split('ROUTE_SUMMARY').length - 1
  assert.ok(summaryHits >= 2, `两个图像工具描述必须插值 ROUTE_SUMMARY（当前 ${summaryHits} 处）`)
  assert.match(hostTools, /import \{ routeImageModel, ROUTE_SUMMARY \} from '\.\/model-route\.js'/)
  // 旧判据（REQ-019「装饰性不算要读的文字」）随路由收编退役：描述/文档不得残留
  // 第二套判据——判据唯一事实源是 src/model-route.ts 的 routeImageModel。
  assert.ok(!/装饰性.*不算「要读的文字」/s.test(hostTools), '工具描述不得残留 REQ-019 旧判据（路由已按提示词现算）')
  const toolsDoc = read('docs/canvas-studio-tools.md')
  assert.match(toolsDoc, /Host 逐次现算/, 'canvas-studio-tools.md 路由句必须反映现算口径')
  assert.match(toolsDoc, /选工具 ≠ 选端点/, 'A1b 判据段必须改为路由现算口径')
  assert.ok(!toolsDoc.includes('不要求逐字可读的装饰性文字'), '工具文档不得残留 REQ-019 装饰性排除旧判据')
  const toolchain = read('skills/canvas-studio-creation/references/toolchain.md')
  assert.match(toolchain, /Host 逐次现算端点/, 'toolchain 必须反映路由现算口径')
  assert.ok(!toolchain.includes('drama 暂不消费') && !toolsDoc.includes('仅 `fal` 生效'), 'REQ-015：drama 按档生效口径不得回退（C-8/CV-190a）')
})

test('批D：C-9 标签区分 / C-14 描述反例 / B-3 视频禁入 / E-3 目录到秒 / A-11 播放定高', () => {
  // C-9：video_composite 不得再叫「成片合成」（compose_video 保留）
  const presentation = read('src/tool-presentation.ts')
  assert.match(presentation, /video_composite: \{ tier: 'A', title: '多参考生成视频', icon: '▶' \}/)
  assert.match(presentation, /compose_video: \{ tier: 'A', title: '成片合成', icon: '合' \}/)
  const shotFormat = read('skills/canvas-studio-creation/references/shot-format.md')
  assert.match(shotFormat, /用户计划优先（C-9）/, '第 9 步必须带「不得擅自升级工具」条款')
  // C-14：character_sheet filename 描述必须含节点 id 反例
  const hostTools = read('src/host-tools.ts')
  assert.match(hostTools, /不能传画布节点 id（形如 `6511xxxx-…` 的 UUID，会被 CS-USER-002 拒绝）/)
  // B-3：视频禁入资产库（服务端单点 + 入口隐藏）
  const library = read('src/asset-library.ts')
  assert.match(library, /视频不支持加入资产库/)
  const menu = read('src/client/canvas/CanvasContextMenu.tsx')
  assert.match(menu, /node\.kind !== 'video' && item\('加入资产库'/)
  // E-3：落点目录按秒铸造（保留月份基名，实例内幂等）
  const projects = read('src/projects.ts')
  assert.ok(projects.includes('draftDirName()}-${stamp}'), '落点名必须 = 月份基名 + 秒级时间戳')
  // 2026-10-04：实例缓存由 activeDraftDir 改为 activeDraft 并**连 root 一起记** ——
  // 只记目录时「资产库位置」热切换后会继续返回旧根路径（落点永远建回旧根）。
  assert.match(projects, /private activeDraft: \{ root: string; dir: string \} \| undefined/,
    '实例内幂等复用必须存在，且必须与铸造时的 root 绑定')
  // A-11：播放 stage 定高（高度链修复）
  const styles = read('src/client/styles.ts')
  assert.match(styles, /\.csVideoStage \{[\s\S]*?height: min\(calc\(100vh - 200px\), 56\.25vw\)/, 'stage 必须有确定高度（A-11 高度链修复）')
})

test('CV-278：带字图路由纪律——Qwen 一步直出为首选，自动 image_fix 只能写成带边界条件的兜底', () => {
  const promptWriting = read('skills/canvas-studio-creation/references/prompt-writing.md')
  const turbo = read('skills/krea2-turbo-writing/SKILL.md')
  const edit = read('skills/krea2-edit-writing/SKILL.md')
  // 正向：三处必须写明 withtxt 直出首选与路由现算口径（CV-270 + R-P1-03）
  assert.match(promptWriting, /Qwen 一步直出为首选/, 'prompt-writing 节标题必须写明直出首选')
  assert.match(promptWriting, /image_generate_withtxt/, '必须写明 withtxt 工具名（调 image_generate 等价）')
  assert.match(promptWriting, /不会也不会触发 image_fix 兜底/, 'Qwen 直出路径必须写明不触发修复')
  assert.match(promptWriting, /不要看到没挂修复就再手动补一次 image_fix/, '必须阻断「直出后又补一次修复」的回归行为')
  assert.match(promptWriting, /设计内行为/, '图生图带字两段式必须写明是设计内行为')
  assert.match(turbo, /image_generate_withtxt/, 'krea2-turbo 必须写明 withtxt 直出首选')
  assert.match(turbo, /不会再触发 image_fix 自动修复/, 'krea2-turbo 必须写明直出无修复段')
  assert.match(edit, /设计内行为，不是故障/, 'krea2-edit 必须写明图生图带字两段式属设计内')
  // 反向：旧无条件触发口径（R-P1-03 之前「凡带字必挂修复」的写法）不得回潮
  assert.ok(!promptWriting.includes('完成后**自动**挂一次'), 'prompt-writing 旧无条件口径必须清除')
  assert.ok(!turbo.includes('出图后自动挂一次 `image_fix`**'), 'krea2-turbo 旧无条件口径必须清除')
  assert.ok(!edit.includes('是则自动挂 `image_fix`**'), 'krea2-edit 旧无条件口径必须清除')
  // 修复 prompt 工程教训必须保留——兜底与手动修复仍是现役纪律（CV-218）
  assert.match(promptWriting, /buildTextFixPrompt/, 'CV-218 修复 prompt 形态必须保留')
  assert.match(promptWriting, /武仔[\s\S]*武传/, '位置锚点教训必须保留（清单形态修成武传的实证）')
})
