/**
 * 分辨率三档分级（CV-187）—— 表-码对齐、像素映射、历史值归一。
 *
 * 本文件的定位：**`OUTPUT_SIZE` 是「声明的分辨率 = 真实产物」这条不变式的唯一落点**。
 * 把它改成 `1920×1080`（看起来更「标准」）或 `1280×720`（回到旧值）之后，全仓其余
 * 测试照样全绿，只有画布上多看几 px、详情面板的数字变假 —— 这类静默失败只有断言拦得住。
 * 故期望值**硬编码自 H3 推荐分辨率表，不引用实现**（防「两边一起错」的空绿）。
 *
 * 直连 Host 侧编译产物 lib/*.js。运行：node --test "tests/*.test.mjs"
 *
 * 反向验证（改了实现必须让它红，改完恢复）：
 *   - 把 `fal.ts` 的 `LEGACY_RESOLUTION` 置空 → 「历史值归一」组必须红
 *   - 把 `OUTPUT_SIZE['2k']` 改成 1920×1080 → 「表-码对齐」组必须红
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OUTPUT_SIZE, DEFAULT_RESOLUTION, isVideoResolution, sizeForAspectRatio } from '../lib/config.js'
import { createFalProvider, normalizeResolution } from '../lib/providers/fal.js'
import { runVideo } from '../lib/providers/executor.js'

/**
 * H3 推荐分辨率表（megapixels → 输出像素），**硬编码、不引用实现**。
 * 来源：用户 2026-09-15 提供的 H3 视频生成推荐分辨率表，0.4 / 1.0 / 2.0 三行。
 */
const H3_TABLE = {
  '480p': { megapixels: 0.4, width: 864, height: 480 },
  '768p': { megapixels: 1.0, width: 1376, height: 768 },
  '2k': { megapixels: 2.0, width: 1920, height: 1088 },
}

// —— 打桩 fetch（与 tests/video-provider-fal.test.mjs 同一方式）——
function stubFetch(handlers) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body }
    calls.push(call)
    const handler = handlers[0]
    if (handler === undefined) throw new Error(`stub fetch 序号越界: ${calls.length} ${call.method} ${call.url}`)
    const res = typeof handler === 'function' ? await handler(call, calls.length) : handlers.shift()
    return { ok: (res.status ?? 200) >= 200 && (res.status ?? 200) < 300, status: res.status ?? 200, text: async () => res.text ?? JSON.stringify(res.json ?? {}) }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}
const KEY_CTX = { falApiKey: async () => 'sk-test' }
const baseReq = (over) => ({ prompt: '一只白猫追蝴蝶', duration: 5, aspectRatio: '16:9', references: [], ...over })
const t2vHandlers = () => [
  { json: { request_id: 'req-1', response_url: 'https://queue.fal.run/minimax/h3/text-to-video/requests/req-1' } },
  { json: { status: 'IN_QUEUE' } },
  { json: { status: 'IN_PROGRESS' } },
  { json: { status: 'COMPLETED' } },
  { json: { video: { url: 'https://media.example/h3.mp4' } } },
]

let restoreFetch = () => {}
afterEach(() => { restoreFetch() })

// ——————————————————————————————————————————————————————————————
// H 组 · 表-码对齐（本方案最该有的一条）
// ——————————————————————————————————————————————————————————————
test('H 表-码对齐：OUTPUT_SIZE 必须逐字节等于 H3 推荐表，且宽高均为 32 的倍数', () => {
  assert.deepEqual(Object.keys(OUTPUT_SIZE).sort(), ['2k', '480p', '768p'], '档位恰好三档')
  for (const [tier, row] of Object.entries(H3_TABLE)) {
    assert.deepEqual(
      OUTPUT_SIZE[tier],
      { width: row.width, height: row.height },
      `${tier} 必须等于 H3 表输出 ${row.width}×${row.height}（H3 的 multiple=32 规则）`,
    )
    // 视频端点只收 megapixels、不收像素；像素只能由这张表反推。
    // 非 32 倍数会被引擎重采样或补边 ⇒ 首帧与产物规格不一致。
    assert.equal(row.width % 32, 0, `${tier} 宽 ${row.width} 不是 32 的倍数`)
    assert.equal(row.height % 32, 0, `${tier} 高 ${row.height} 不是 32 的倍数`)
  }
})

test('H 默认档与设置项默认值同源（DEFAULT_RESOLUTION 在三档之内）', () => {
  assert.equal(isVideoResolution(DEFAULT_RESOLUTION), true, 'DEFAULT_RESOLUTION 必须是合法档位')
  assert.equal(DEFAULT_RESOLUTION, '768p', '默认档 = 768p（唯一不降低视频/图片任一侧画质的档）')
})

// ——————————————————————————————————————————————————————————————
// D 组 · 画幅 × 档位 的像素映射（图片与视频共用这一份实现）
// ——————————————————————————————————————————————————————————————
test('D sizeForAspectRatio：3 画幅 × 3 档', () => {
  for (const [tier, row] of Object.entries(H3_TABLE)) {
    // 16:9 直给基准表
    assert.deepEqual(sizeForAspectRatio('16:9', tier), { width: row.width, height: row.height }, `16:9 + ${tier}`)
    // 9:16 反宽高
    assert.deepEqual(sizeForAspectRatio('9:16', tier), { width: row.height, height: row.width }, `9:16 + ${tier}`)
    // 1:1 三档共用 1024×1024（方形不是 H3 输出规格，无档位意义）
    assert.deepEqual(sizeForAspectRatio('1:1', tier), { width: 1024, height: 1024 }, `1:1 + ${tier}`)
  }
})

test('E 缺省同源：不传档位 === 显式传 DEFAULT_RESOLUTION；未知画幅落 16:9', () => {
  for (const aspect of ['16:9', '9:16', '1:1', undefined, '4:3']) {
    assert.deepEqual(
      sizeForAspectRatio(aspect),
      sizeForAspectRatio(aspect, DEFAULT_RESOLUTION),
      `画幅 ${String(aspect)} 的缺省档必须等于 DEFAULT_RESOLUTION`,
    )
  }
  assert.deepEqual(sizeForAspectRatio(undefined), sizeForAspectRatio('16:9'), '未知/缺省画幅落 16:9')
})

// ——————————————————————————————————————————————————————————————
// F 组 · 归一函数纯度
// ——————————————————————————————————————————————————————————————
test('F normalizeResolution：三档直通、undefined 不传、脏值不抛', () => {
  for (const tier of Object.keys(H3_TABLE)) assert.equal(normalizeResolution(tier), tier, `${tier} 直通`)
  assert.equal(normalizeResolution(undefined), undefined, 'undefined → undefined（不传，走供应商默认）')
  for (const junk of ['4k', '1080P', '720P', '480P', '', 'giant', '2K']) {
    assert.equal(normalizeResolution(junk), undefined, `未知值 ${junk} 应返回 undefined 而非抛错`)
  }
})

test('B 历史值归一：旧 720p/1080p 就地归一（与旧「升档」行为等义）', () => {
  // 画布节点里的 generationPrompt 是历史数据的真实来源：删掉这两个键后若直接查表，
  // 老节点重试会在 fal.ts 的取值处撞上 undefined 抛 TypeError（整次生成崩掉）。
  assert.equal(normalizeResolution('720p'), '768p', '旧 720p 等价于 768P（旧行为就是升到 768P）')
  assert.equal(normalizeResolution('1080p'), '2k', '旧 1080p 等价于 2K')
})

// ——————————————————————————————————————————————————————————————
// A/B/C 组 · fal 端到端（走 runVideo，验真实请求体 + warnings）
// ——————————————————————————————————————————————————————————————
test('A fal 三档直通：请求体落 fal 原生枚举，且零 warning（不再有隐式升档）', async () => {
  const cases = [['480p', '480P'], ['768p', '768P'], ['2k', '2K']]
  for (const [tier, native] of cases) {
    const { calls, restore } = stubFetch(t2vHandlers())
    restoreFetch = restore
    const outcome = await runVideo(createFalProvider(), baseReq({ capability: 'text-to-video', resolution: tier }), { ...KEY_CTX, pollIntervalMs: 1 })
    assert.equal(calls[0].body.input.resolution, native, `${tier} → ${native}`)
    assert.equal(outcome.warnings, undefined, `${tier} 不应产生 warning`)
  }
})

// ——————————————————————————————————————————————————————————————
// 两处工具参数不许漂移（同一规则只准一份实现）
// ——————————————————————————————————————————————————————————————
test('工具参数守卫：video_generate / video_composite 的 resolution 必须共用同一份 enum 与描述', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '..', 'src', 'host-tools.ts'), 'utf8')
  // 同一 enum 抄两遍是这类参数最典型的漂移路径：改了 video_generate 忘了 video_composite。
  assert.equal(
    (src.match(/resolution: \{ type: 'string' as const, enum: RESOLUTION_ENUM, description: RESOLUTION_PARAM_DESC \}/g) ?? []).length,
    2,
    '两处 resolution 参数必须共用 RESOLUTION_ENUM / RESOLUTION_PARAM_DESC',
  )
  // 旧枚举不得残留在工具参数里（历史值只在 fal.ts 的 LEGACY_RESOLUTION 里承认）。
  assert.equal(/enum: \['768p', '1080p', '720p', '2k'\]/.test(src), false, 'host-tools.ts 不应残留旧四档 enum')
})
