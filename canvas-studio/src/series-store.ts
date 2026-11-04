/**
 * 阶段 3.1（2026-11-04）：短剧 episodic 剧集管理的**注册表级状态层**。
 *
 * 方案正本 = `docs/plans/短剧episodic方案-20261104.md`（三问口径：集 = 项目 /
 * recap 由 agent 撰写 / 上下文经工具注入）。存储照 `groups.json` 同款独立文件模式：
 * 独立 version、损坏降级空态（软状态不致命）、`sharedWriteQueue` 串写。
 *
 * 刻意不做的：集的画布 / 故事板 / 成片全在普通项目里（**集 = 项目**，零迁移）；
 * 本模块只存「有序索引 + 每集 recap」一张目录卡；不上模型自动摘要。
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { sharedWriteQueue } from './keyed-queue.js'
import { throwError } from './error-system.js'
import { validateProjectName } from './projects.js'

/** schema 版本；结构变化时 bump 并在读侧迁移。 */
export const SERIES_VERSION = 1

/** 单集 recap 上限（字符；前情提要是给下一集 agent 的上下文，不是存档全文）。 */
export const MAX_RECAP_LENGTH = 2000

/** 集号上限（999 集足够短剧生命周期；episodeNo 是排序与引用键）。 */
export const MAX_EPISODE_NO = 999

/** 一条剧集登记。 */
export interface SeriesRecord {
  id: string
  /** 系列名（全局唯一，大小写不敏感——与项目名同判据）。 */
  title: string
  /** 有序集索引；按 episodeNo 升序使用。 */
  episodes: SeriesEpisode[]
  createdAt: number
}

/** 一集的登记（projectId 在 upsert 时绑定当前项目，读取侧再解析项目名）。 */
export interface SeriesEpisode {
  episodeNo: number
  projectId: string
  /** 集标题（可选；缺省用项目名）。 */
  title?: string
  /** 前情提要（本集收尾时由 agent 撰写，供下一集开工注入；≤2000 字）。 */
  recap?: string
}

/** `series.json` 文档形状。 */
export interface SeriesDocument {
  version: typeof SERIES_VERSION
  series: SeriesRecord[]
}

/** 校验一条集登记（读侧过滤；非法条目直接丢弃——软状态不致命）。 */
export function isSeriesEpisode(value: unknown): value is SeriesEpisode {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const e = value as Record<string, unknown>
  return Number.isInteger(e.episodeNo) && (e.episodeNo as number) >= 1 && (e.episodeNo as number) <= MAX_EPISODE_NO
    && typeof e.projectId === 'string' && e.projectId.length > 0
    && (e.title === undefined || typeof e.title === 'string')
    && (e.recap === undefined || typeof e.recap === 'string')
}

function isSeriesRecord(value: unknown): value is SeriesRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  return typeof s.id === 'string' && s.id.length > 0
    && typeof s.title === 'string' && s.title.length > 0
    && Array.isArray(s.episodes) && s.episodes.every(isSeriesEpisode)
    && typeof s.createdAt === 'number'
}

/**
 * 剧集存储（registry root 下 `series.json`）。方法粒度与 ProjectRegistry 分组段一致：
 * 读-改-写整体入 `sharedWriteQueue`，两个并发写者不互覆。
 */
export class SeriesStore {
  private readonly file: string

  constructor(rootDir: string) {
    this.file = join(rootDir, 'series.json')
  }

  private async readAll(): Promise<SeriesRecord[]> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    let document: unknown
    try {
      document = JSON.parse(text) as unknown
    } catch {
      return [] // 损坏按空降级（软状态，绝不致命——与 groups.json 同口径）
    }
    if (
      document === null
      || typeof document !== 'object'
      || Array.isArray(document)
      || (document as { version?: unknown }).version !== SERIES_VERSION
      || !Array.isArray((document as { series?: unknown }).series)
    ) {
      return []
    }
    return (document as SeriesDocument).series.filter(isSeriesRecord).map((entry) => ({
      ...entry,
      episodes: [...entry.episodes],
    }))
  }

  private async writeAll(series: readonly SeriesRecord[]): Promise<void> {
    const document: SeriesDocument = { version: SERIES_VERSION, series: [...series] }
    await writeFileAtomic(this.file, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  }

  /** 列出全部系列（集按 episodeNo 升序）。 */
  async list(): Promise<readonly SeriesRecord[]> {
    const all = await this.readAll()
    return all.map((s) => ({ ...s, episodes: [...s.episodes].sort((a, b) => a.episodeNo - b.episodeNo) }))
  }

  /** 按 id 取单系列（不存在抛 CS-USER-ERR，与分组同口径）。 */
  async require(seriesId: string): Promise<SeriesRecord> {
    const found = (await this.readAll()).find((s) => s.id === seriesId)
    if (found === undefined) {
      throwError('CS-USER-ERR', { message: `剧集系列不存在：${seriesId}（先 series_manage action=list 查看现有系列）` })
    }
    return { ...found!, episodes: [...found!.episodes].sort((a, b) => a.episodeNo - b.episodeNo) }
  }

  /** 新建系列（title 全局唯一，大小写不敏感）。 */
  async create(title: string): Promise<SeriesRecord> {
    const trimmed = title.trim()
    validateProjectName(trimmed)
    return sharedWriteQueue.run(this.file, async () => {
      const all = await this.readAll()
      if (all.some((s) => s.title.toLowerCase() === trimmed.toLowerCase())) {
        throwError('CS-USER-ERR', { message: `系列名已存在: ${trimmed}` })
      }
      const record: SeriesRecord = { id: randomUUID(), title: trimmed, episodes: [], createdAt: Date.now() }
      await this.writeAll([...all, record])
      return record
    })
  }

  /**
   * 登记一集：绑定 `projectId`（episodeNo 已绑同一项目时为改登记，否则追加）。
   * recap 超长截断到 2000 字并原样落（不报错——前情提要是笔记不是契约）。
   */
  async upsertEpisode(
    seriesId: string,
    episode: { episodeNo: number; projectId: string; title?: string; recap?: string },
  ): Promise<SeriesRecord> {
    const episodeNo = Math.round(episode.episodeNo)
    if (!Number.isInteger(episodeNo) || episodeNo < 1 || episodeNo > MAX_EPISODE_NO) {
      throwError('CS-USER-ERR', { message: `episodeNo 必须是 1-${MAX_EPISODE_NO} 的整数（当前：${String(episode.episodeNo)}）` })
    }
    const recap = episode.recap === undefined ? undefined : episode.recap.slice(0, MAX_RECAP_LENGTH)
    const title = episode.title?.trim() === '' ? undefined : episode.title?.trim()
    return sharedWriteQueue.run(this.file, async () => {
      const all = await this.readAll()
      const series = all.find((s) => s.id === seriesId)
      if (series === undefined) {
        throwError('CS-USER-ERR', { message: `剧集系列不存在：${seriesId}（先 series_manage action=list 查看现有系列）` })
      }
      const existing = series!.episodes.find((e) => e.episodeNo === episodeNo)
      if (existing !== undefined && existing.projectId !== episode.projectId) {
        throwError('CS-USER-ERR', {
          message: `第 ${episodeNo} 集已绑定其他项目（episodeNo 在系列内唯一；换集号或先在原项目改登记）`,
        })
      }
      // 缺省 = 不改：title / recap 未传时保留旧值（改登记语义）
      const next: SeriesEpisode = {
        episodeNo,
        projectId: episode.projectId,
        ...(title !== undefined ? { title } : existing?.title !== undefined ? { title: existing.title } : {}),
        ...(recap !== undefined ? { recap } : existing?.recap !== undefined ? { recap: existing.recap } : {}),
      }
      const episodes = existing !== undefined
        ? series!.episodes.map((e) => (e.episodeNo === episodeNo ? next : e))
        : [...series!.episodes, next]
      const updated: SeriesRecord = { ...series!, episodes }
      await this.writeAll(all.map((s) => (s.id === seriesId ? updated : s)))
      return { ...updated, episodes: [...episodes].sort((a, b) => a.episodeNo - b.episodeNo) }
    })
  }
}
