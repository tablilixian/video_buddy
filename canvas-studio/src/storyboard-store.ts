/**
 * REQ-022（CV-293）· `storyboard.json` 的落盘层 —— 读写 + 损坏隔离 + 串行队列。
 *
 * 设计与判据见 `docs/plans/REQ-022-storyboard数据契约.md` §7.8 / §4；形状与纯判定在
 * `contracts/storyboard.ts`。本模块只回答「怎么安全地读写这个文件」。
 *
 * ## 三条刻意的与 canvas 不同
 *
 * 1. **损坏不静默重置**。`readCanvas` 读坏时降级空文档是**对的**——画布是「可抛弃的
 *    UI 状态」。storyboard 是**用户创作资产**：静默重置等于毁稿。这里读坏时把原文件
 *    改名成 `<file>.corrupt` 留证，再向上报 `corrupt`，由调用方显式报错、拒绝继续。
 * 2. **所有写者收口本模块的串行队列**。agent 工具（write/revise）、存档/回退/落地路由、
 *    L 类回写 diff、A 类 actuals 结算 —— 四条通道都会做「读 → 改 → 写」，并发即撕档。
 *    统一走 `enqueue`，先例 `asset-history.ts:50`（同进程内绝不并发写同一档）。
 * 3. **读也进队列**。故事版是「读改写」密集的文件（改一镜 → 立刻回读渲染 overlay），
 *    读不排队会读到写一半的状态。读代价可忽略（<100KB）。
 *
 * ## 谁都不许绕过本模块直接碰文件
 *
 * 路由与工具层一律调 `loadStoryboard` / `saveStoryboard` / `updateStoryboard`，
 * 不 `readFile(registry.storyboardFile(id))`。唯一例外是「只回答路径」的
 * `ProjectRegistry.storyboardFile()`。
 */
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { throwError } from './error-system.js'
// CV-305：本模块的 `loadStoryboardOrFail` / `updateStoryboardOrFail` 抛用户可见错误码，
// 故按仓库惯例在使用方注册 catalog（不依赖入口的先手注册，见 `storyboard-land.ts`）。
import './errors/catalog.js'
import type { StudioProjectPlan } from './contracts/project.js'
import { quarantineFile } from './file-quarantine.js'
import {
  createStoryboard,
  emptyStoryboardSections,
  normalizeStoryboard,
  STORYBOARD_SCHEMA_VERSION,
  type StoryboardDocument,
} from './contracts/storyboard.js'

/**
 * 本模块真正需要的 registry 面 —— **只有「故事板文件在哪」**。
 *
 * CV-305：原先这里写死 `ProjectRegistry`（那个类有 40+ 方法），于是任何想复用
 * 读写层的模块都得先造一个完整 registry 才能测试。收窄成结构类型后，落地执行体
 * （`storyboard-land.ts`）与测试都能只提供 `storyboardFile` 一个方法就驱动真实的
 * 读写/损坏隔离/串行队列 —— 真实实例天然满足本接口（结构化类型，零改动）。
 */
export interface StoryboardFileRegistry {
  /** 项目 `storyboard.json` 的绝对路径（唯一被本模块接触的 registry 面）。 */
  storyboardFile(projectId: string): string
}

/**
 * 读结果：**四态**显式区分 —— 「没有」「坏了」「是旧格式」对策完全不同，不能混。
 *
 * - `missing`：还没写过（正常）
 * - `corrupt`：读不懂，**原文件已被改名留证**（严禁继续）
 * - `stale`：能读懂，但 `schemaVersion` 不是当前值 ⇒ **不静默迁移、不静默丢弃、
 *   也不留证改名**（文件是好的，只是旧）。调用方给出「让 agent 重写故事板」的明确提示。
 */
export type StoryboardLoad =
  | { readonly status: 'ok'; readonly document: StoryboardDocument }
  | { readonly status: 'missing' }
  | { readonly status: 'corrupt'; readonly reason: string; readonly backup: string }
  | { readonly status: 'stale'; readonly found: number; readonly expected: number }

/** 顶层是不是普通对象（非数组、非 null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 同进程内 storyboard 读改写串行链（先例 `asset-history.ts:50`）。 */
let storyboardQueue: Promise<unknown> = Promise.resolve()

/**
 * 把一段「读改写」排进串行链。
 *
 * 前序任务失败**不阻断**后续（`then(task, task)`）——一档写失败不该让该项目的所有
 * 后续编辑永久卡死；失败本身由各自 `run` 的 Promise 抛给调用方。
 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = storyboardQueue.then(task, task)
  storyboardQueue = run.then(() => undefined, () => undefined)
  return run
}

/**
 * 把损坏文件改名留证，返回备份绝对路径。
 *
 * AR-02：实现已抽到共享件 `file-quarantine.ts`（同一动作现在 `canvas.json` 也要用，
 * 两份实现必然漂移）。语义逐字节不变：覆盖同名旧备份，只保留「最近一次损坏」。
 */
const quarantine = (file: string): Promise<string> => quarantineFile(file)

/** 队列内实现：读 + 归一化，不做排队（调用方已持有队列）。 */
async function readInQueue(registry: StoryboardFileRegistry, projectId: string): Promise<StoryboardLoad> {
  const file = registry.storyboardFile(projectId)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    return { status: 'corrupt', reason: `不是合法 JSON：${String(cause)}`, backup: await quarantine(file) }
  }

  // schema 版本闸门放在归一化**之前**：旧形状的字段可能已被本轮重构改名，
  // 先归一化会把「旧格式」伪装成「新格式的空值」，用户看到的就是一份被清空的稿子。
  if (!isRecord(parsed)) {
    return { status: 'corrupt', reason: '顶层不是对象（不被识别为 storyboard 文档）', backup: await quarantine(file) }
  }
  const foundVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0
  if (foundVersion !== STORYBOARD_SCHEMA_VERSION) {
    return { status: 'stale', found: foundVersion, expected: STORYBOARD_SCHEMA_VERSION }
  }

  const document = normalizeStoryboard(parsed)
  if (document === undefined) {
    return { status: 'corrupt', reason: '顶层不是对象（不被识别为 storyboard 文档）', backup: await quarantine(file) }
  }
  return { status: 'ok', document }
}

/** 队列内实现：原子写。 */
async function writeInQueue(
  registry: StoryboardFileRegistry,
  projectId: string,
  document: StoryboardDocument,
): Promise<void> {
  await writeFileAtomic(registry.storyboardFile(projectId), `${JSON.stringify(document, null, 2)}\n`, {
    mode: 0o600,
    dirMode: 0o700,
  })
}

/**
 * 读一份 storyboard。
 *
 * `status: 'missing'` = 该项目还没有故事版（正常，未开工）；
 * `status: 'corrupt'` = 有文件但读不懂，**原文件已被改名成 `<file>.corrupt`**，
 * 调用方应显式报错并停手，绝不拿空文档继续（那会在下一次保存时把损坏内容彻底覆盖）。
 */
export function loadStoryboard(registry: StoryboardFileRegistry, projectId: string): Promise<StoryboardLoad> {
  return enqueue(() => readInQueue(registry, projectId))
}

/** 整体覆盖写一份 storyboard（首稿 / 落地冻结 / 存档都走这里）。 */
export function saveStoryboard(
  registry: StoryboardFileRegistry,
  projectId: string,
  document: StoryboardDocument,
): Promise<void> {
  return enqueue(() => writeInQueue(registry, projectId, document))
}

/**
 * 读改写原子操作 —— **所有局部修改的唯一入口**（版本存档、回退、L 类回写、
 * A 类 actuals 结算）。`mutate` 拿到的是当前盘上的文档（已归一化）。
 *
 * 返回 `undefined` 表示「盘上没有可用的 storyboard」（missing 或 corrupt）：
 * 调用方据此拒绝该次修改，而不是凭空造一份——局部修改的前提是已有全貌。
 */
export function updateStoryboard(
  registry: StoryboardFileRegistry,
  projectId: string,
  mutate: (current: StoryboardDocument) => StoryboardDocument,
): Promise<StoryboardDocument | undefined> {
  return enqueue(async () => {
    const load = await readInQueue(registry, projectId)
    if (load.status !== 'ok') return undefined
    const next = mutate(load.document)
    await writeInQueue(registry, projectId, next)
    return next
  })
}

/** 导出给测试用：等待队列排空（断言「写完再读」的时序，不放进生产路径）。 */
export function storyboardQueueIdle(): Promise<void> {
  return storyboardQueue.then(() => undefined, () => undefined)
}

/**
 * REQ-022（创意先行）：项目创建/认领时预建一份**仅含 meta 的故事板骨架 v1**。
 *
 * 中栏「拍摄定稿」覆盖层的空态判据是「storyboard.json 存不存在」——不存在就永远
 * 是「还没有拍摄定稿」占位页，与 agent 是否已聊出创意无关。预建骨架后：
 * 中栏从项目诞生起就有壳，完成度从 0/9 起随 agent 分次写**逐节涨上去**（「创意
 * 先上板、内容随对话补齐」的载体）。
 *
 * - **幂等**：文件已存在（ok / corrupt / stale）一律不动 —— corrupt/stale 有各自
 *   的处置通道，骨架预建绝不碰它们；ok 说明 agent 已写过，尊重既有内容。
 * - **meta 取自项目预置规格**：画幅 / 目标时长在创建弹窗上已锁定时直接带入，
 *   免得 agent 首笔还要重问；genre 留空由创意讨论填充。
 * - 失败**不阻断项目创建**：骨架只是体验增强，写不进去时项目照常可用
 *   （agent 的 write_storyboard 首稿路径原样兜底）。
 */
export async function ensureStoryboardSkeleton(
  registry: StoryboardFileRegistry,
  projectId: string,
  title: string,
  plan?: StudioProjectPlan,
): Promise<void> {
  const load = await loadStoryboard(registry, projectId)
  if (load.status !== 'missing') return
  const aspect = plan?.aspectRatio ?? '16:9'
  const targetDuration = plan?.targetDuration ?? 0
  await saveStoryboard(registry, projectId, createStoryboard({
    projectId,
    title,
    meta: { genre: '', targetDuration, aspect },
    sections: emptyStoryboardSections(),
  }))
}

/**
 * 读一份故事板，**四态各自给可操作的报错**（不返回四态让每个调用点自己拼文案）。
 *
 * CV-305：从 `routes.ts` 搬到本模块 —— 落地执行体（`storyboard-land.ts`）也需要
 * 同一套报错，两边各写一份必然漂移（同一规则只准一份实现）。搬的是原实现，
 * 文案逐字节不变。
 */
export async function loadStoryboardOrFail(
  registry: StoryboardFileRegistry,
  projectId: string,
): Promise<StoryboardDocument> {
  const load = await loadStoryboard(registry, projectId)
  if (load.status === 'missing') {
    throwError('CS-USER-ERR', { message: '这个项目还没有拍摄定稿（storyboard.json 不存在）。' })
  }
  if (load.status === 'corrupt') {
    throwError('CS-USER-ERR', {
      message: `故事板文件读不出来（已留证为 ${load.backup}），为免覆盖损坏内容已中止本次操作。`,
    })
  }
  if (load.status === 'stale') {
    throwError('CS-USER-ERR', {
      message: `这个项目的故事板是旧格式（schemaVersion ${String(load.found)}，当前需要 ${String(load.expected)}）。`
        + '本轮数据结构已升级，不静默迁移：请让 agent 用 write_storyboard 重新写一份。',
    })
  }
  return load.document
}

/**
 * 读改写：`updateStoryboard` 返回 `undefined`（盘上不可读）时给可操作报错，不静默成功。
 *
 * ⚠️ `mutate` 内**不得**再调本模块的读函数 —— 同一个串行链上等自己 = 死锁。
 * 要用当前文档就用 `mutate` 的入参（那已是盘上归一化后的最新值）。
 */
export async function updateStoryboardOrFail(
  registry: StoryboardFileRegistry,
  projectId: string,
  mutate: (current: StoryboardDocument) => StoryboardDocument,
): Promise<StoryboardDocument> {
  const next = await updateStoryboard(registry, projectId, mutate)
  if (next === undefined) {
    throwError('CS-USER-ERR', { message: '故事板当前不可读（可能已被删除或损坏），本次操作未执行。' })
  }
  return next
}
