/**
 * AR-06 守卫：**Host 工具注册面**（数量 + 名单 + 唯一性）。
 *
 * ## 为什么需要
 *
 * 修复前这个数字**三处三种口径**，且唯一的守卫形同虚设：
 *   - `STATUS.md §3.4` 写「26 个（24 真实 + 2 占位）」，清单里还列着 4 个**已下线**的名字
 *     （`prompt_enhance` / `write_screenplay` / `submit_screenplay_for_approval` /
 *     `submit_storyboard_for_approval`）；
 *   - `docs/README.md` 写「26（25 真实 + 1 占位）」；
 *   - **实测 24**（`host-tools.ts` 23 + `placeholder-tools.ts` 1）；
 *   - `tests/tool-presentation.test.mjs` 的断言是 `names.length >= 23`，而且用**正则扫源码文本**
 *     采名字（任何位置的 `name: 'xxx'` 都会被算进来）⇒ **增删/改名都不会红**。
 *
 * 本文件改用**真实注册面**（直接调 `createStudioTools`）并把名单**钉死**：
 *
 *   1. 数量必须等于 {@link EXPECTED_TOOL_COUNT}；
 *   2. 名字集合必须**逐个相等**（改名、删工具、加工具都会红，并在报错里点名差异）；
 *   3. 不得重名（注册面里重名会在宿主侧表现为后注册者覆盖前者）。
 *
 * ## 为什么可以安全调用 `createStudioTools`
 *
 * 它有一步副作用：装配处会 `startDramaJobResumeWatcher({ registry })` 扫描各项目的
 * `jobs.json`。这里传一个 `list()` 返回空数组的桩 ⇒ 扫不到任何任务 ⇒ **不启动任何
 * 轮询循环、不发任何请求**。构造工具定义本身是纯的（`execute` 里的 registry 访问都是惰性的）。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。**加/删/改工具名时，请同时更新本文件与
 * `docs/canvas-studio-tools.md`、`STATUS.md §3.4`、`docs/README.md` 的计数**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudioTools } from '../lib/host-tools.js'
import { createPlaceholderTools } from '../lib/skills/placeholder-tools.js'
import { templateChannelEnabled } from '../lib/template-channel.js'

/** 实测 33 = `host-tools.ts` 32 + `placeholder-tools.ts` 1。改这里 = 改产品面，请同步文档。 */
// CV-394（2026-11-02）：+image_matting（纯色底抠透明底），35 → 36。
// B3（2026-11-02）：+verify_teardown（拆解回核），36 → 37。
// 批四（2026-11-02）：+teardown_store（拆解成果跨项目落库），37 → 38。
// 复刻提效批二/三（2026-11-02）：+image_crop（拼贴裁切）、+write_note（过程便签），38 → 40。
// REQ-036 复刻客户端能力批（2026-11-03）：+media_probe（媒体探针），40 → 41；+evidence_grid（证据网格），41 → 42；
// +download_video（视频页链接落盘），42 → 43。
// 六大体裁路线 4.2（2026-11-04）：+import_csv（CSV → chart 数据卡），43 → 44。
// 六大体裁路线 3.1（2026-11-04）：+series_manage / +episode_brief（短剧 episodic），44 → 46。
// CV-445 S3（2026-11-05，rea-video A4 吸收）：+plan_generation_units（生成单元规划），46 → 47。
// CV-445 S4（2026-11-05，rea-video A6 吸收）：+make_compare（原片｜复刻并排对比片），47 → 48。
// CV-448（2026-11-06，后端 0.9.0）：+asr2txt（语音识别：文本 + 词级/句段时间戳 + 转写 JSON），49 → 50。
// 2026-11-10 香水样本 P0-2：+attach_canvas_asset（本地现成产物 → 画布节点，经 canvas.json 唯一写口），50 → 51。
// 1（CV-463，视频模板化）：+list_templates（模板清单：体裁 / 需求筛选 + 五判据适配判定），51 → 52。
// 2026-11-12 模板通道临时下线：关闭态该工具不注册 ⇒ 基线 51；开关打开自动回到 52。
const TEMPLATE_CHANNEL_ON = templateChannelEnabled()
// RQ-R9/P1-10（2026-11-14）：+validate_manifest（离线体检，复盘 #10）—— 53 / 关模板 52
const EXPECTED_TOOL_COUNT = TEMPLATE_CHANNEL_ON ? 53 : 52

/** 钉死的全量名单（升序）—— 顺序无关，比对前会排序。 */
const EXPECTED_TOOL_NAMES = [
  'add_to_library',
  'adopt_canvas_as_storyboard',
  'ask_user_choice',
  // 2026-11-10 香水样本 P0-2：本地现成产物 → 画布节点（补上「缺工具」这个越权根因）。
  'attach_canvas_asset',
  // CV-448（2026-11-06）：后端 asr2txt 上线 —— 语音 → 整篇文本 + 词级/句段时间戳。
  'asr2txt',
  'character_generate',
  'character_sheet',
  // 2026-11-05：阶段一一次性意图卡（提速方案 B1），48 → 49。
  'confirm_intent_card',
  'compose_video',
  'cut_audio',
  'extract_last_frame',
  'image2vl',
  // 复刻提效批二：拼贴/精灵图裁切（把「模型自写 52 次 PIL 脚本」收回平台）。
  'image_crop',
  'image_fix',
  'image_generate',
  // 六大体裁路线 4.2：CSV → chart 数据卡（纯文本解析，零后端槽位）。
  'import_csv',
  // 六大体裁路线 3.1：短剧 episodic（剧集登记 / 前情上下文装配）。
  'series_manage',
  'episode_brief',
  'image_generate_withtxt',
  // CV-394（REQ-036 复刻复盘批）：纯色底抠透明底（内置 ffmpeg colorkey）。
  'image_matting',
  'inspect_image',
  'layout_table',
  'list_library_assets',
  'list_references',
  'list_shots',
  // 1（CV-463）：模板清单（只读）。临时下线时随开关从基线移除，恢复时自动回来。
  ...(TEMPLATE_CHANNEL_ON ? ['list_templates'] : []),
  'look_card',
  'music_generation',
  // REQ-036 C3（2026-11-03）：媒体探针（时长/分辨率/fps/音轨/容器/响度统一入口）。
  'media_probe',
  // REQ-036 C2（2026-11-03）：证据网格（时间标注网格 + 结构化清单 + 实测切点）。
  'evidence_grid',
  // REQ-036 C1（2026-11-03）：视频页链接 → 参考视频落盘（抖音/B站/YouTube 白名单）。
  'download_video',
  // CV-445 S3（2026-11-05，rea-video A4）：生成单元规划（拆解表 → 最少调用次数的单元计划）。
  'plan_generation_units',
  // CV-445 S4（2026-11-05，rea-video A6）：原片｜复刻并排对比片（验收产物）。
  'make_compare',
  // S5（2026-10-28）：节拍分析 / 卡点吸附（CV-040 收口）。
  'analyze_beats',
  'snap_cuts_to_beats',
  'qc_shot',
  'render_composition',
  'scaffold_manifest',
  'submit_keyframes_for_approval',
  'subtitle_burn',
  // B3（REQ-036 复刻提效批三）：拆解回核（参考视频实测切换点 ↔ 拆解表边界机器比对）。
  'verify_teardown',
  // 批四（C4 后半）：拆解成果跨项目落库（save / load / list，参考视频指纹存取）。
  'teardown_store',
  'tts_narration',
  'tts_voiceover',
  'upload_image',
  // RQ-R9/P1-10（2026-11-14 复盘 #10）：离线 manifest 体检（schema/编排/文字容量一次列全）
  'validate_manifest',
  'video2vl',
  'video_composite',
  'video_generate',
  'video_rerender',
  'write_script',
  // 复刻提效批三：过程便签（拆解检查点 / 阶段收尾，kind=sticky，可被 list_references 读回）。
  'write_note',
  'write_storyboard',
]

/**
 * 取真实注册面（见文件头：`list()` 返回空数组的桩让恢复轮询无事可做）。
 *
 * 刻意**不 export** —— 从别的 `.test.mjs` import 本文件会把本文件的用例也一并执行。
 * 「展示表覆盖」那条守卫在 `tool-presentation.test.mjs` 里**内联同一段调用**（三行），
 * 重复三行优于测试文件互相 import。
 *
 * @returns 工具名数组（保持注册顺序）。
 */
function registeredToolNames() {
  const stubRegistry = { list: async () => [] }
  const definitions = [
    ...createStudioTools(stubRegistry, 0),
    ...createPlaceholderTools(),
  ]
  return definitions.map((definition) => definition.name)
}

test('AR-06①：Host 工具总数必须等于基线（唯一口径，防文档再次漂移）', () => {
  const names = registeredToolNames()
  assert.equal(
    names.length,
    EXPECTED_TOOL_COUNT,
    `实测 ${String(names.length)} 个工具，基线 ${String(EXPECTED_TOOL_COUNT)} 个。`
    + '若这是有意增删：请同步更新本文件的 EXPECTED_TOOL_COUNT / EXPECTED_TOOL_NAMES，'
    + '以及 docs/canvas-studio-tools.md、STATUS.md §3.4、docs/README.md 的计数。',
  )
})

test('AR-06②：工具名单逐个相等（改名 / 新增 / 删除都必须在这里显式更新）', () => {
  const actual = [...registeredToolNames()].sort()
  const expected = [...EXPECTED_TOOL_NAMES].sort()
  assert.deepEqual(
    actual,
    expected,
    '工具名单与基线不一致 —— 这是**有意变更**的信号：请复核新名字是否已在 '
    + 'tool-presentation 三档表登记（否则对话流会回落英文通用行），并同步四处文档计数。',
  )
})

test('AR-06③：注册面不得重名（宿主侧重名会静默覆盖）', () => {
  const names = registeredToolNames()
  const seen = new Set()
  const duplicates = names.filter((name) => (seen.has(name) ? true : (seen.add(name), false)))
  assert.deepEqual(duplicates, [], `以下工具名被注册了多次：${duplicates.join(', ')}`)
})
