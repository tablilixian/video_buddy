/**
 * 拆解成果落库（复刻提效批四 · C4 后半，2026-11-02）。
 *
 * 根因：拆解表 / 缓动拟合 / 精灵脚本随 project dir 蒸发 —— 换会话（新 project dir）
 * 后同一条参考片全部重拆，还拆出与上一轮不一致的归段（甜品会话实测：v1 拆对了的
 * 段落 v2 拆错，整片返工）。本模块把「拆解表」按**参考视频指纹**存进跨项目目录
 * `dshHomePath('canvas-studio')/teardowns/`，会话 / 项目怎么换都在。
 *
 * 指纹 = sha1(文件名 | 字节数) 前 12 位 —— 同一份文件拷到任何项目目录指纹不变；
 * 重编码 / 换码率算新条目（拆解随素材版本走，语义正确）。
 *
 * 复用不等于盲用：取回的拆解仍要过 `verify_teardown` 回核对版（素材可能换版），
 * 对得上再进映射 —— 这个纪律在 skill 层，本模块只管存取。
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
// AR-03：JSON 状态档一律原子写（裸 writeFile 中断会留半截 JSON）。
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { throwError } from './error-system.js'
import type { TeardownSegment } from './teardown-verify.js'

/** 落库记录（磁盘 JSON 形态，version 只升不降）。 */
export interface TeardownRecord {
  version: 1
  key: string
  videoName: string
  videoBytes: number
  /** ISO 时间戳。 */
  savedAt: string
  segments: TeardownSegment[]
  note?: string
}

/** list 模式的压缩条目。 */
export interface TeardownListEntry {
  key: string
  videoName: string
  savedAt: string
  segmentCount: number
  note?: string
}

/** load 结果：found=false 时也带回 key（模型可在回复里引用 / 指引 save）。 */
export interface TeardownLoadResult {
  found: boolean
  key: string
  videoName?: string
  savedAt?: string
  segments?: TeardownSegment[]
  note?: string
  /** 库文件存在但解析失败（损坏）—— 如实告知，不静默当没有。 */
  corrupt?: boolean
}

const LIST_LIMIT = 20

function teardownRoot(root?: string): string {
  return root ?? dshHomePath('canvas-studio')
}

function teardownDir(root: string): string {
  return join(root, 'teardowns')
}

/** 指纹与基础信息：videoPath 必须是已落盘的普通文件（CS-USER-ERR 显式拒收）。 */
async function fingerprintOf(videoPath: string): Promise<{ key: string; videoName: string; videoBytes: number }> {
  let statResult: Awaited<ReturnType<typeof stat>>
  try {
    statResult = await stat(videoPath)
  } catch {
    throwError('CS-USER-ERR', { message: `videoPath 不可读：${videoPath} —— 参考视频要先落盘（画布上传产物路径即可）。` })
  }
  if (!statResult.isFile()) {
    throwError('CS-USER-ERR', { message: `videoPath 不是普通文件：${videoPath}` })
  }
  const videoName = basename(videoPath)
  const key = createHash('sha1').update(`${videoName}|${statResult.size}`).digest('hex').slice(0, 12)
  return { key, videoName, videoBytes: statResult.size }
}

function recordFile(root: string, key: string): string {
  return join(teardownDir(root), `${key}.json`)
}

/**
 * 落库（save）：同 key 旧档覆盖（updated=true + priorSavedAt 带回上一版时间）。
 * <2 段的拆解拒收 —— 没有可复用边界，落了也是噪声。
 */
export async function saveTeardown(input: {
  videoPath: string
  segments: readonly TeardownSegment[]
  note?: string
  /** 测试注入：覆盖存储根（缺省 dshHomePath('canvas-studio')）。 */
  root?: string
}): Promise<TeardownRecord & { file: string; updated: boolean; priorSavedAt?: string }> {
  if (input.segments.length < 2) {
    throwError('CS-USER-ERR', { message: 'segments 至少要 2 段 —— 少于 2 段的拆解没有可复用边界，不必落库。' })
  }
  const root = teardownRoot(input.root)
  const { key, videoName, videoBytes } = await fingerprintOf(input.videoPath)
  const file = recordFile(root, key)
  let updated = false
  let priorSavedAt: string | undefined
  try {
    const prior = JSON.parse(await readFile(file, 'utf8')) as { savedAt?: unknown }
    if (typeof prior.savedAt === 'string') {
      updated = true
      priorSavedAt = prior.savedAt
    }
  } catch {
    // 无旧档 / 旧档损坏都按新建处理（save 本来就是修复手段）
  }
  const record: TeardownRecord = {
    version: 1,
    key,
    videoName,
    videoBytes,
    savedAt: new Date().toISOString(),
    segments: input.segments.map((s) => ({ label: s.label, startSec: s.startSec, endSec: s.endSec })),
    ...(input.note !== undefined && input.note.trim() !== '' ? { note: input.note.trim() } : {}),
  }
  await mkdir(teardownDir(root), { recursive: true, mode: 0o700 })
  await writeFileAtomic(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  return {
    ...record,
    file,
    updated,
    ...(priorSavedAt !== undefined ? { priorSavedAt } : {}),
  }
}

/** 取回（load）：无档 / 损坏都返回 found=false（损坏带 corrupt=true），不抛错。 */
export async function loadTeardown(videoPath: string, root?: string): Promise<TeardownLoadResult> {
  const { key, videoName } = await fingerprintOf(videoPath)
  let raw: string
  try {
    raw = await readFile(recordFile(teardownRoot(root), key), 'utf8')
  } catch {
    return { found: false, key, videoName }
  }
  try {
    const parsed = JSON.parse(raw) as TeardownRecord
    if (!Array.isArray(parsed.segments)) return { found: false, key, videoName, corrupt: true }
    return {
      found: true,
      key,
      videoName: parsed.videoName,
      savedAt: parsed.savedAt,
      segments: parsed.segments,
      ...(typeof parsed.note === 'string' && parsed.note !== '' ? { note: parsed.note } : {}),
    }
  } catch {
    return { found: false, key, videoName, corrupt: true }
  }
}

/** 列库存（list）：损坏条目跳过；按落库时间倒序，缺省最多 20 条。 */
export async function listTeardowns(root?: string, limit = LIST_LIMIT): Promise<TeardownListEntry[]> {
  const dir = teardownDir(teardownRoot(root))
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const entries: TeardownListEntry[] = []
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    if (entries.length >= limit) break
    try {
      const parsed = JSON.parse(await readFile(join(dir, name), 'utf8')) as TeardownRecord
      if (!Array.isArray(parsed.segments)) continue
      entries.push({
        key: typeof parsed.key === 'string' ? parsed.key : name.replace(/\.json$/, ''),
        videoName: typeof parsed.videoName === 'string' ? parsed.videoName : name,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
        segmentCount: parsed.segments.length,
        ...(typeof parsed.note === 'string' && parsed.note !== '' ? { note: parsed.note } : {}),
      })
    } catch {
      continue
    }
  }
  return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}
