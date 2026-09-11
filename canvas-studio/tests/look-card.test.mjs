/**
 * CV-157（Look Phase 2）Look 卡契约测试。
 *
 * Look 卡把澄清第 ② 步的 5 项 tokens 冻结成 `role=style` 资产卡，逐镜逐字节注入。
 * 本文件守护四条不变式：
 * 1. 卡名归一（`Look · ` 前缀）——注册表按名字覆盖，撞名会换掉角色卡；
 * 2. tokens 归一 —— 5 项齐全才改写（归一成权威行序），缺项**原样保留 + 告警**；
 * 3. 锚点是**既有画布节点**（样张在 ②-2 已落画布），不新建、不重下载；
 * 4. 锚点缺失只告警不阻断（主路径是文字注入）。
 *
 * 直连 Host 侧编译产物 lib/generate.js（纯注册表操作，无 fetch）。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalizeLookCardName, registerLookCard, LOOK_CARD_PREFIX } from '../lib/generate.js'
import { parseLookTokens, formatLookTokens, missingLookTokenKeys, LOOK_TOKEN_KEYS } from '../lib/style-tokens.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 5 项齐全但**故意打乱行序**，用于验证落卡时会被归一成权威顺序。 */
const SCRAMBLED = [
  '节奏：慢、留白、长镜头呼吸',
  '色彩：低饱和青灰打底 + 钨丝灯暖黄点缀',
  '镜头语汇：中长焦、浅景深、固定机位',
  '光线：单一实用光源，大光比',
  '材质：湿青砖、木质窗框',
].join('\n')

/** 只写了两项 —— 缺项分支。 */
const PARTIAL = '色彩：低饱和青灰\n光线：单一实用光源'

function stubNode(overrides = {}) {
  return {
    id: 'n1',
    kind: 'image',
    url: '/canvas-studio/assets/p1/sample.png',
    filename: 'img_00042_.png',
    title: '基调样张',
    x: 0, y: 0, width: 100, height: 100,
    createdAt: 1,
    origin: 'agent',
    sourceIds: [],
    operationType: 'text-to-image',
    generationPrompt: '{}',
    ...overrides,
  }
}

/**
 * 项目注册表打桩：注册表是**有状态**的（同名覆盖依赖读取到上一张卡），
 * 所以这里维护一份内存 canvas，而不是每次返回常量。
 */
function stubRegistry(nodes, assets = []) {
  const state = { nodes, assets }
  const releases = []
  const writes = []
  return {
    readCanvas: async () => ({ version: 3, nodes: state.nodes, assets: state.assets }),
    writeCanvas: async () => {},
    upsertAsset: async (_projectId, asset) => {
      const hit = state.assets.findIndex((entry) => entry.id === asset.id)
      if (hit === -1) state.assets.push(asset)
      else state.assets[hit] = asset
      writes.push(asset)
    },
    releaseAssetNodes: async (_projectId, assetId, keep) => { releases.push([assetId, keep]) },
    getAssets: () => state.assets,
    getReleases: () => releases,
    getWrites: () => writes,
  }
}

// ---------------- 1. 卡名归一 ----------------

test('CV-157：卡名归一 —— 缺 `Look · ` 前缀自动补，已带前缀幂等不重复加', () => {
  assert.equal(normalizeLookCardName('雨夜霓虹'), `${LOOK_CARD_PREFIX}雨夜霓虹`)
  assert.equal(normalizeLookCardName('  雨夜霓虹  '), `${LOOK_CARD_PREFIX}雨夜霓虹`)
  assert.equal(normalizeLookCardName(`${LOOK_CARD_PREFIX}雨夜霓虹`), `${LOOK_CARD_PREFIX}雨夜霓虹`)
  // 前缀存在的唯一理由：注册表按名字覆盖，撞名会静默换掉另一张卡。
  assert.equal(normalizeLookCardName('女主'), `${LOOK_CARD_PREFIX}女主`)
})

// ---------------- 2. tokens 归一（能完全理解才改写） ----------------

test('CV-157：5 项齐全 → 落卡时归一成权威行序（防逐镜注入时字节序漂移）', async () => {
  const registry = stubRegistry([stubNode()])
  const result = await registerLookCard(registry, 'p1', { name: '雨夜霓虹', lockedPrompt: SCRAMBLED })
  assert.equal(result.name, `${LOOK_CARD_PREFIX}雨夜霓虹`)
  assert.equal(result.lockedPrompt, formatLookTokens(parseLookTokens(SCRAMBLED)))
  // 行序 = LOOK_TOKEN_KEYS 的顺序，而不是输入顺序
  const keys = result.lockedPrompt.split('\n').map((line) => line.split('：')[0])
  assert.deepEqual(keys, [...LOOK_TOKEN_KEYS])
  assert.equal(result.warnings, undefined, '5 项齐全不应有告警')
  assert.equal(registry.getAssets()[0].role, 'style')
  assert.equal(registry.getAssets()[0].lockedPrompt, result.lockedPrompt)
})

test('CV-157：缺项 → 原样保留 + 告警列出缺失字段（不改写看不懂的输入）', async () => {
  const registry = stubRegistry([stubNode()])
  const result = await registerLookCard(registry, 'p1', { name: '雨夜霓虹', lockedPrompt: PARTIAL })
  assert.equal(result.lockedPrompt, PARTIAL, '缺项时不得改写输入')
  const missing = missingLookTokenKeys(parseLookTokens(PARTIAL))
  assert.deepEqual(missing, ['材质', '镜头语汇', '节奏'])
  assert.ok(result.warnings?.[0]?.includes('材质'), '告警应点名缺哪些字段')
  assert.ok(result.warnings?.[0]?.includes('同名重调'), '告警应给出补齐路径')
  assert.equal(registry.getAssets().length, 1, '缺项照常落卡，不阻断')
})

// ---------------- 3. 锚点 = 既有画布节点 ----------------

test('CV-157：锚点复用既有样张节点（不新建节点），摘要含 title/url/产物名', async () => {
  const registry = stubRegistry([stubNode()])
  const result = await registerLookCard(registry, 'p1', { name: '雨夜霓虹', lockedPrompt: SCRAMBLED, anchorNodeId: 'n1' })
  assert.deepEqual(registry.getAssets()[0].anchorNodeIds, ['n1'])
  assert.equal(result.anchors.length, 1)
  assert.equal(result.anchors[0].title, '基调样张')
  assert.equal(result.anchors[0].url, '/canvas-studio/assets/p1/sample.png')
  assert.equal(result.anchors[0].filename, 'img_00042_.png')
  assert.equal(result.warnings, undefined)
})

test('CV-157：锚点节点不在画布上 → 告警但照常落卡（主路径是文字注入）', async () => {
  const registry = stubRegistry([stubNode()])
  const result = await registerLookCard(registry, 'p1', { name: '雨夜霓虹', lockedPrompt: SCRAMBLED, anchorNodeId: 'ghost' })
  assert.deepEqual(registry.getAssets()[0].anchorNodeIds, [])
  assert.deepEqual(result.anchors, [])
  assert.ok(result.warnings?.[0]?.includes('ghost'))
})

test('CV-157：锚点引用解析失败 → 用 anchorRef 出可操作告警（含 @ref 建议）', async () => {
  const registry = stubRegistry([stubNode()])
  const result = await registerLookCard(registry, 'p1', {
    name: '雨夜霓虹', lockedPrompt: SCRAMBLED, anchorRef: '不存在的样张.png',
  })
  assert.ok(result.warnings?.[0]?.includes('不存在的样张.png'))
  assert.ok(result.warnings?.[0]?.includes('@ref'), '应推荐 @ref 这条路径')
})

test('CV-157：不传锚点 → 无告警、anchors 为空（Look 默认不占参考图席位）', async () => {
  const registry = stubRegistry([stubNode()])
  const result = await registerLookCard(registry, 'p1', { name: '雨夜霓虹', lockedPrompt: SCRAMBLED })
  assert.deepEqual(result.anchors, [])
  assert.equal(result.warnings, undefined)
})

// ---------------- 4. 同名整体覆盖 ----------------

test('CV-157：同名重调 → 复用原 id 整体覆盖，并摘掉旧锚点归属', async () => {
  const registry = stubRegistry([stubNode()])
  const first = await registerLookCard(registry, 'p1', { name: '雨夜霓虹', lockedPrompt: SCRAMBLED, anchorNodeId: 'n1' })
  const second = await registerLookCard(registry, 'p1', { name: 'Look · 雨夜霓虹', lockedPrompt: PARTIAL, anchorNodeId: 'n1' })
  assert.equal(second.assetId, first.assetId, '同名必须复用同一张卡，不新建第二张')
  assert.equal(registry.getAssets().length, 1)
  assert.equal(registry.getAssets()[0].lockedPrompt, PARTIAL, '锁定文案应被覆盖')
  // 覆盖路径先释放旧锚点（keep = 本次锚点），再写卡 —— 与 character_sheet 同一语义。
  assert.deepEqual(registry.getReleases(), [[first.assetId, ['n1']]])
})

test('CV-157：不同名 → 新建第二张卡（id 不同，互不覆盖）', async () => {
  const registry = stubRegistry([stubNode()])
  const a = await registerLookCard(registry, 'p1', { name: '雨夜霓虹', lockedPrompt: SCRAMBLED })
  const b = await registerLookCard(registry, 'p1', { name: '晨雾', lockedPrompt: SCRAMBLED })
  assert.notEqual(a.assetId, b.assetId)
  assert.equal(registry.getAssets().length, 2)
  assert.deepEqual(registry.getReleases(), [], '不覆盖时不应触发锚点释放')
})

test('CV-157：negativePrompt 透传落卡，未传则不出现在卡上', async () => {
  const registry = stubRegistry([stubNode()])
  await registerLookCard(registry, 'p1', { name: '雨夜霓虹', lockedPrompt: SCRAMBLED, negativePrompt: '不要高饱和' })
  assert.equal(registry.getAssets()[0].negativePrompt, '不要高饱和')
  await registerLookCard(registry, 'p1', { name: '晨雾', lockedPrompt: SCRAMBLED })
  assert.equal(registry.getAssets()[1].negativePrompt, undefined)
})

// ---------------- 5. 正向护栏：工具注册了，skill 也必须提到它 ----------------

test('CV-157：look_card 已注册，且 skill 侧有落卡与注入说明（防 CV-130「工具在但没人用」）', () => {
  const tools = readFileSync(join(HERE, '..', 'lib', 'host-tools.js'), 'utf8')
  assert.ok(tools.includes("name: 'look_card'"), 'lib/host-tools.js 里应有 look_card 的 defineTool')
  assert.ok(tools.includes('LookCardSchemaCoverage') || tools.includes('lookCardSchema'), 'output schema 应独立声明（受编译期覆盖守卫约束）')
  const SKILLS = join(HERE, '..', 'skills-local', 'canvas-studio-creation')
  const look = readFileSync(join(SKILLS, 'references', 'look.md'), 'utf8')
  const consistency = readFileSync(join(SKILLS, 'references', 'consistency.md'), 'utf8')
  const workflow = readFileSync(join(SKILLS, 'SKILL.md'), 'utf8')
  const toolchain = readFileSync(join(SKILLS, 'references', 'toolchain.md'), 'utf8')
  assert.ok(look.includes('look_card'), 'look.md 应写清何时落卡怎么落卡')
  assert.ok(look.includes('§9.1'), 'look.md 应给出落卡小节（骨架引用它）')
  assert.ok(workflow.includes('look_card'), 'SKILL.md 工作流应提到落卡（否则 agent 不会调用）')
  assert.ok(consistency.includes('Look 卡注入纪律'), 'consistency.md 应有注入纪律节')
  assert.ok(toolchain.includes('| look_card |'), 'toolchain.md 工具表应列出 look_card')
})
