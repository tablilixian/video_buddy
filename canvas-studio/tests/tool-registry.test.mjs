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

/** 实测 27 = `host-tools.ts` 26 + `placeholder-tools.ts` 1。改这里 = 改产品面，请同步文档。 */
const EXPECTED_TOOL_COUNT = 27

/** 钉死的全量名单（升序）—— 顺序无关，比对前会排序。 */
const EXPECTED_TOOL_NAMES = [
  'ask_user_choice',
  'character_generate',
  'character_sheet',
  'compose_video',
  'cut_audio',
  'extract_last_frame',
  'image2vl',
  'image_fix',
  'image_generate',
  'image_generate_withtxt',
  'inspect_image',
  'list_references',
  'list_shots',
  'look_card',
  'music_generation',
  'qc_shot',
  'render_composition',
  'scaffold_manifest',
  'submit_keyframes_for_approval',
  'subtitle_burn',
  'tts_voiceover',
  'upload_image',
  'video2vl',
  'video_composite',
  'video_generate',
  'write_script',
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

test('AR-06①：Host 工具总数必须等于 26（唯一口径，防文档再次漂移）', () => {
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
