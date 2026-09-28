/**
 * Canvas Studio 全局资产库（REQ-001）：跨项目的 角色/场景/物件/群像 注册表。
 *
 * 磁盘布局（方案 §3.1）：
 * ```
 * <registryRoot>/assets-library.json   # 唯一索引（本文件的读改写对象）
 * <registryRoot>/library/<assetId>/    # 库媒体（m_0.png …）
 * ```
 *
 * 三条纪律与 `ProjectRegistry` 同源（方案 §8-A/B）：
 *  1. **root 是 provider**：设置页「资产库位置」可热切换，静态 root 会指向旧根；
 *  2. **写盘前与磁盘合流 + 墓碑**：共享同一 DSH home 的两个实例不能互相整表覆盖
 *     （`writeCanvas` 的合并保护是节点级，对根级 JSON 不适用）；
 *  3. **文档损坏时拒绝写入**（抛错）而非静默当空表——否则紧随其后的写盘会把用户
 *     还能手工修复的坏文件改写成空库。
 *
 * 库媒体不在任何项目 `assets/` 下，生成链路引用时需先物化到当前项目再 promote
 * （方案 §3.4，Step 3 落地）；本模块只负责「存、取、拷入、usage 回写」。
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ProjectRegistry } from './projects.js'
import type { StudioCanvasNode } from './contracts/canvas.js'
import type { AssetLibraryDocument, LibAnchorRef, LibCategory, LibMedia, LibraryAsset, LibraryUsageRef } from './contracts/asset-library.js'
import { LIBRARY_SCHEMA_VERSION, isLibCategory, isLibraryAsset } from './contracts/asset-library.js'
import { classifyFile } from './media-extension.js'
import { throwError } from './error-system.js'
import './errors/catalog.js'

/** 墓碑（已删除资产 id）上限：与 projects.json 同数，删除低频、窗口足够。 */
const TOMBSTONE_LIMIT = 200

/** 库内媒体文件名字符集（与项目资产同一判据；不以 `.` 开头防隐藏文件）。 */
const LIB_FILE_RE = /^[A-Za-z0-9._-]+$/u

/** 主名称上限（与项目名同限：注册表 / 路径 / prompt 清单都吃它）。 */
const MAX_NAME_LENGTH = 80

/** URL → 磁盘文件名（与 asset-gc 同判据；非本地资产 url 返回 null）。 */
function basenameOfUrl(url: string): string | null {
  const name = url.split('/').pop() ?? ''
  return name.length > 0 && LIB_FILE_RE.test(name) && !name.startsWith('.') ? name : null
}

/**
 * url 是否指向**本项目**的落盘资产，是则返回其文件名（与 `generate.ts` 的
 * `assetKeyFromUrl` 同一形态正则，内联避免 asset-library → generate 的重依赖引入）。
 */
function projectAssetBasename(url: string, projectId: string): string | null {
  const match = /^\/canvas-studio\/assets\/([^/]+)\/([A-Za-z0-9._-]+)$/u.exec(url)
  if (match === null || match[1] !== projectId) return null
  return match[2] ?? null
}

/** 从 `lib:<id>` 句柄取出库资产 id；非 `lib:` 前缀返回 undefined（交回调用方走画布节点解析）。 */
export function libraryIdOfHandle(handle: string): string | undefined {
  const trimmed = handle.trim()
  return trimmed.startsWith('lib:') && trimmed.length > 'lib:'.length ? trimmed.slice('lib:'.length) : undefined
}

/** 一份待拷入库的媒体来源（调用方从项目 assets/ 解析出的源文件）。 */
export interface LibraryMediaSource {
  /** 源文件**绝对路径**（项目 `assets/` 内）。 */
  sourcePath: string
  /** 视图标签（「正视图」…），详情抽屉多图切换用。 */
  label?: string
}

/** `create` 入参（手工新建与「画布入库」共用一条路径：anchors 非空即入库）。 */
export interface LibraryCreateInput {
  category: LibCategory
  name: string
  aliases?: readonly string[]
  description?: string
  tags?: readonly string[]
  lockedPrompt?: string
  negativePrompt?: string
  sourceProjectId?: string
  anchors?: readonly LibAnchorRef[]
  /** 从画布节点拷入的媒体源；缺省 = 纯手工条目（后补媒体）。 */
  media?: readonly LibraryMediaSource[]
}

/** `update` 允许修改的字段（id/createdAt/usage 不可改）。 */
export interface LibraryUpdatePatch {
  category?: LibCategory
  name?: string
  aliases?: readonly string[]
  description?: string
  tags?: readonly string[]
  lockedPrompt?: string
  negativePrompt?: string
  coverFile?: string
  /** 媒体元数据（顺序 / label / 封面选择）；文件本身已在盘上，不在此增删。 */
  media?: readonly LibMedia[]
}

/** `list` 过滤条件（q 覆盖 name/aliases/tags/description，大小写不敏感）。 */
export interface LibraryListFilter {
  category?: LibCategory
  q?: string
}

/** 字符串字段清洗：trim + 去空项（别名/标签数组共用）。 */
function cleanEntries(values: readonly string[] | undefined): string[] {
  if (values === undefined) return []
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) out.push(trimmed)
  }
  return [...new Set(out)]
}

/** 文件内容 SHA-256（hex）：物化去重的比对键（方案 §3.4-3）。 */
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * 全局资产库 owner。与 `ProjectRegistry` 一样「常驻内存 + 原子写」，
 * 缓存按 root 键控（设置切换资产库位置后下个读操作自动重载）。
 */
export class AssetLibrary {
  private readonly rootProvider: () => string
  private cached: { root: string; assets: LibraryAsset[] } | null = null

  /**
   * @param root - 库根目录；接受静态串或 provider（`index.ts` 的 `assetsRoot` 同款
   *   live 读取），root 变更后读写自动落到新位置（旧根文件不迁移，与
   *   ProjectRegistry 的「资产库位置」语义一致）。
   */
  constructor(root: string | (() => string) = dshHomePath('canvas-studio')) {
    this.rootProvider = typeof root === 'function' ? root : () => root
  }

  /** 当前 root（provider 最新值）。 */
  get root(): string {
    return this.rootProvider()
  }

  /** 注册表文件路径。 */
  private get file(): string {
    return join(this.root, 'assets-library.json')
  }

  /** 库媒体根目录。 */
  private get libraryRoot(): string {
    return join(this.root, 'library')
  }

  /**
   * 某资产的媒体目录。assetId 由路由/句柄传入，可为穿越片段——先按字符集拒绝，
   * 再 resolve 前缀断言（与 `dirOf` 的 CR-003 同纪律）。
   */
  assetDir(assetId: string): string {
    if (!/^[A-Za-z0-9_-]+$/u.test(assetId)) {
      throwError('CS-DEV-ERR', { detail: `非法库资产 id: ${assetId}` })
    }
    const base = resolve(this.libraryRoot)
    const target = resolve(join(base, assetId))
    if (!target.startsWith(base + sep)) {
      throwError('CS-DEV-ERR', { detail: `库资产目录越界: ${assetId}` })
    }
    return target
  }

  /**
   * 解析库媒体文件的绝对路径（媒体路由用）。文件名必须过 `LIB_FILE_RE` 且不以
   * `.` 开头，最终路径再断言落在该资产目录内（双保险防穿越）。
   */
  mediaFile(assetId: string, file: string): string {
    if (!LIB_FILE_RE.test(file) || file.startsWith('.')) {
      throwError('CS-DEV-ERR', { detail: `非法库媒体文件名: ${file}` })
    }
    const base = this.assetDir(assetId)
    const target = resolve(join(base, file))
    if (!target.startsWith(resolve(base) + sep)) {
      throwError('CS-DEV-ERR', { detail: `库媒体路径越界: ${file}` })
    }
    return target
  }

  /**
   * 读注册表文档。文件不存在 = 空库；损坏 / 版本不符 **抛错**（不静默当空表，
   * 否则下一次写盘就把坏文件抹成空库——projects.json 同纪律）。
   */
  private async readDocument(): Promise<AssetLibraryDocument | null> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let document: unknown
    try {
      document = JSON.parse(text) as unknown
    } catch {
      throwError('CS-DEV-ERR', { detail: `asset library corrupt: ${this.file}` })
    }
    if (
      document === null
      || typeof document !== 'object'
      || Array.isArray(document)
      || (document as { version?: unknown }).version !== LIBRARY_SCHEMA_VERSION
      || !Array.isArray((document as { assets?: unknown }).assets)
    ) {
      throwError('CS-DEV-ERR', { detail: `asset library not a library document: ${this.file}` })
    }
    for (const entry of (document as AssetLibraryDocument).assets) {
      if (!isLibraryAsset(entry)) {
        throwError('CS-DEV-ERR', { detail: `asset library invalid record: ${this.file}` })
      }
    }
    // 墓碑必须随文档一起读回来 —— 丢掉的话 commit 的合流就成了「旧快照复活器」
    // （测试 REQ-001 tombstone 一格锁的就是这个）。形状坏的条目直接丢，不整档拒读。
    const rawDeleted = (document as AssetLibraryDocument).deleted
    const deleted = Array.isArray(rawDeleted)
      ? rawDeleted.filter((entry): entry is string => typeof entry === 'string')
      : []
    return {
      version: LIBRARY_SCHEMA_VERSION,
      assets: (document as AssetLibraryDocument).assets.map((entry) => ({ ...entry })),
      ...(deleted.length > 0 ? { deleted } : {}),
    }
  }

  /** 保证缓存就位（按 root 键控）；返回当前内存清单。 */
  private async ensureLoaded(): Promise<LibraryAsset[]> {
    const currentRoot = this.root
    if (this.cached === null || this.cached.root !== currentRoot) {
      this.cached = { root: currentRoot, assets: (await this.readDocument())?.assets ?? [] }
    }
    return this.cached.assets
  }

  /**
   * 写库 —— **先与磁盘合流，再落盘**（照 `commitRegistry`，方案 §8-B）：
   * 磁盘 ∪ 内存（同 id 以内存为准），再减墓碑。别的实例新建的条目不会被这次
   * 写盘抹掉；本实例删除的条目靠墓碑不被对方的旧快照复活。
   */
  private async commit(memory: readonly LibraryAsset[], removed: readonly string[] = []): Promise<void> {
    let document: AssetLibraryDocument | null = null
    try {
      document = await this.readDocument()
    } catch {
      // 读盘失败退化为照写内存态（纵深防御；正常路径 ensureLoaded 已先报错）。
      document = null
    }
    const tombstones = new Set<string>([...(document?.deleted ?? []), ...removed])
    const merged = new Map<string, LibraryAsset>()
    for (const entry of document?.assets ?? []) {
      if (!tombstones.has(entry.id)) merged.set(entry.id, entry)
    }
    for (const entry of memory) {
      if (!tombstones.has(entry.id)) merged.set(entry.id, entry)
    }
    const assets = [...merged.values()]
    // 墓碑只留最近 N 条：删除是低频动作，超出的部分早已不在任何实例的内存里。
    const deleted = [...tombstones].slice(-TOMBSTONE_LIMIT)
    const next: AssetLibraryDocument = {
      version: LIBRARY_SCHEMA_VERSION,
      assets,
      ...(deleted.length > 0 ? { deleted } : {}),
    }
    await writeFileAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
    this.cached = { root: this.root, assets }
  }

  /** 列表（默认按 updatedAt 倒序；`q` 覆盖 name/aliases/tags/description）。 */
  async list(filter?: LibraryListFilter): Promise<readonly LibraryAsset[]> {
    const assets = [...await this.ensureLoaded()]
    const category = filter?.category
    const query = (filter?.q ?? '').trim().toLowerCase()
    const filtered = assets.filter((asset) => {
      if (category !== undefined && asset.category !== category) return false
      if (query.length === 0) return true
      const haystack = `${asset.name}${asset.aliases.join('')}${asset.tags.join('')}${asset.description}`.toLowerCase()
      return haystack.includes(query)
    })
    return filtered.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  /** 取一条；未知 id 返回 undefined（调用方决定报 CS-LIB-001 还是降级）。 */
  async get(id: string): Promise<LibraryAsset | undefined> {
    return (await this.ensureLoaded()).find((asset) => asset.id === id)
  }

  /** 取一条；未知 id 抛 `CS-LIB-001`（路由详情 / 句柄解析用）。 */
  async require(id: string): Promise<LibraryAsset> {
    const asset = await this.get(id)
    if (asset === undefined) throwError('CS-LIB-001', { id })
    return asset
  }

  /**
   * 新建一条（手工条目或「画布入库」：anchors/media 非空即入库）。
   *
   * 顺序：校验 → 拷媒体进 `library/<id>/` → 合流写注册表；写失败回滚已拷文件
   * （与 ProjectRegistry.create 的目录回滚同纪律）。
   */
  async create(input: LibraryCreateInput): Promise<LibraryAsset> {
    if (!isLibCategory(input.category)) {
      throwError('CS-USER-ERR', { message: `无效的资产分类：${String(input.category)}` })
    }
    const name = (input.name ?? '').trim()
    if (name.length === 0) throwError('CS-USER-ERR', { message: '资产名称不能为空' })
    if (name.length > MAX_NAME_LENGTH) {
      throwError('CS-USER-ERR', { message: `资产名称不能超过 ${MAX_NAME_LENGTH} 个字符` })
    }
    const assets = [...await this.ensureLoaded()]
    if (assets.some((asset) => asset.name.toLowerCase() === name.toLowerCase())) {
      throwError('CS-LIB-002', { name })
    }
    const id = randomUUID()
    const now = Date.now()
    const dir = this.assetDir(id)
    try {
      const media = await this.copyMediaSources(dir, input.media)
      const anchors = (input.anchors ?? []).map((anchor) => ({ ...anchor }))
      const asset: LibraryAsset = {
        id,
        schema: LIBRARY_SCHEMA_VERSION,
        category: input.category,
        name,
        aliases: cleanEntries(input.aliases),
        description: (input.description ?? '').trim(),
        tags: cleanEntries(input.tags),
        media,
        anchors,
        lockedPrompt: (input.lockedPrompt ?? '').trim(),
        ...(input.negativePrompt !== undefined && input.negativePrompt.trim().length > 0 ? { negativePrompt: input.negativePrompt.trim() } : {}),
        ...(input.sourceProjectId !== undefined ? { sourceProjectId: input.sourceProjectId } : {}),
        usage: [],
        createdAt: now,
        updatedAt: now,
      }
      await this.commit([...assets, asset])
      return asset
    } catch (cause) {
      // 媒体拷贝 / 注册表写任一失败：回滚已建目录，不留半截媒体孤儿。
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      throw cause
    }
  }

  /**
   * 追加一个画布锚点（POST `/library/:id/anchors`）：锚点去重后挂上，媒体源同步
   * 拷入（`m_<n>` 续接现有 media 长度）。锚点重复且无新媒体时原样返回（幂等）。
   */
  async addAnchor(id: string, anchor: LibAnchorRef, sources: readonly LibraryMediaSource[] = []): Promise<LibraryAsset> {
    const assets = [...await this.ensureLoaded()]
    const index = assets.findIndex((asset) => asset.id === id)
    if (index === -1) throwError('CS-LIB-001', { id })
    const current = assets[index]!
    const anchors = current.anchors.some((entry) => entry.projectId === anchor.projectId && entry.nodeId === anchor.nodeId)
      ? current.anchors
      : [...current.anchors, { ...anchor }]
    const media = [...current.media]
    if (sources.length > 0) {
      const added = await this.copyMediaSources(this.assetDir(id), sources, media.length)
      media.push(...added)
    }
    if (anchors === current.anchors && media.length === current.media.length) return current
    const updated: LibraryAsset = { ...current, anchors, media, updatedAt: Date.now() }
    assets[index] = updated
    await this.commit(assets)
    return updated
  }

  /**
   * 上传一份媒体进已有条目（`POST /library/:id/media`，octet-stream 原始字节）：
   * 文件名落 `m_<n>.<ext>`（n 取现有媒体序号最大值 +1，PATCH 删过条目也不会覆写
   * 旧文件），SHA-256 落 contentHash。资产库不收 text（方案 §8-I：LibMedia 只覆盖
   * image/video/audio），未知扩展同样拒绝。写文件失败 / 注册表写失败都不留半截
   * 媒体：新文件路径只在两者都成功后才对内存可见，失败即清。
   */
  async addMedia(id: string, name: string, bytes: Uint8Array, label?: string): Promise<LibraryAsset> {
    const kind = classifyFile(name)
    if (kind === null || kind === 'text') {
      throwError('CS-USER-ERR', { message: `不支持的文件类型：${name}（资产库仅收图片 / 视频 / 音频）` })
    }
    const ext = extname(name).toLowerCase()
    if (!LIB_FILE_RE.test(`m_0${ext}`) || ext.length === 0) {
      throwError('CS-USER-ERR', { message: `不支持的文件扩展名：${name}` })
    }
    const assets = [...await this.ensureLoaded()]
    const index = assets.findIndex((asset) => asset.id === id)
    if (index === -1) throwError('CS-LIB-001', { id })
    const current = assets[index]!
    const nextIndex = current.media.reduce((max, entry) => {
      const match = /^m_(\d+)\./u.exec(entry.file)
      return match === null ? max : Math.max(max, Number(match[1]) + 1)
    }, 0)
    const file = `m_${nextIndex}${ext}`
    const dir = this.assetDir(id)
    const target = join(dir, file)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      await writeFile(target, bytes, { mode: 0o600 })
      const media: LibMedia[] = [
        ...current.media,
        { file, kind, ...(label !== undefined ? { label } : {}), contentHash: sha256(bytes) },
      ]
      const updated: LibraryAsset = { ...current, media, updatedAt: Date.now() }
      assets[index] = updated
      await this.commit(assets)
      return updated
    } catch (cause) {
      // 注册表写失败：清掉刚落的字节（m_<n> 是本次新取的序号，删除不影响存量）。
      await rm(target, { force: true }).catch(() => {})
      throw cause
    }
  }

  /** 更新元数据/分类/media 元数据（文件不在此增删）。 */
  async update(id: string, patch: LibraryUpdatePatch): Promise<LibraryAsset> {
    const assets = [...await this.ensureLoaded()]
    const index = assets.findIndex((asset) => asset.id === id)
    if (index === -1) throwError('CS-LIB-001', { id })
    const current = assets[index]!
    if (patch.category !== undefined && !isLibCategory(patch.category)) {
      throwError('CS-USER-ERR', { message: `无效的资产分类：${String(patch.category)}` })
    }
    let name = current.name
    if (patch.name !== undefined) {
      name = patch.name.trim()
      if (name.length === 0) throwError('CS-USER-ERR', { message: '资产名称不能为空' })
      if (name.length > MAX_NAME_LENGTH) {
        throwError('CS-USER-ERR', { message: `资产名称不能超过 ${MAX_NAME_LENGTH} 个字符` })
      }
      if (assets.some((asset) => asset.id !== id && asset.name.toLowerCase() === name.toLowerCase())) {
        throwError('CS-LIB-002', { name })
      }
    }
    let media = current.media
    if (patch.media !== undefined) media = patch.media.map((entry) => ({ ...entry }))
    let coverFile = current.coverFile
    if (patch.coverFile !== undefined) {
      if (media.some((entry) => entry.file === patch.coverFile)) coverFile = patch.coverFile
      else throwError('CS-USER-ERR', { message: '封面必须是该资产已有的媒体文件' })
    }
    const updated: LibraryAsset = {
      ...current,
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      name,
      ...(patch.aliases !== undefined ? { aliases: cleanEntries(patch.aliases) } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.tags !== undefined ? { tags: cleanEntries(patch.tags) } : {}),
      ...(patch.lockedPrompt !== undefined ? { lockedPrompt: patch.lockedPrompt.trim() } : {}),
      ...(patch.negativePrompt !== undefined ? { negativePrompt: patch.negativePrompt.trim() } : {}),
      media,
      ...(coverFile !== undefined ? { coverFile } : {}),
      updatedAt: Date.now(),
    }
    assets[index] = updated
    await this.commit(assets)
    return updated
  }

  /**
   * 删除一条：先合流写注册表（落墓碑），再清媒体目录——顺序反过来的话，注册表
   * 写失败会留下「条目还在、文件已没了」的断链。目录清理失败不阻塞（孤儿目录
   * 由后续 GC 兜底，方案 §8-L 的 gcLibraryAssets 范围）。
   */
  async remove(id: string): Promise<void> {
    const assets = [...await this.ensureLoaded()]
    if (!assets.some((asset) => asset.id === id)) throwError('CS-LIB-001', { id })
    await this.commit(assets.filter((asset) => asset.id !== id), [id])
    await rm(this.assetDir(id), { recursive: true, force: true }).catch(() => {})
  }

  /**
   * 引用回写（方案 §3.4-4）：解析成功后记一笔 `{projectId, nodeId?}`，供详情抽屉
   * 「被 N 处引用」与删除二次确认。幂等——同键不重复追加，也就不重复写盘。
   */
  async recordUsage(id: string, usage: LibraryUsageRef): Promise<LibraryAsset> {
    const assets = [...await this.ensureLoaded()]
    const index = assets.findIndex((asset) => asset.id === id)
    if (index === -1) throwError('CS-LIB-001', { id })
    const current = assets[index]!
    const key = (entry: LibraryUsageRef): string => `${entry.projectId}\n${entry.nodeId ?? ''}`
    const seen = new Set(current.usage.map(key))
    const nextKey = key(usage)
    if (seen.has(nextKey)) return current
    const updated: LibraryAsset = {
      ...current,
      usage: [...current.usage, { ...usage, ...(usage.nodeId !== undefined ? { nodeId: usage.nodeId } : {}) }],
      updatedAt: Date.now(),
    }
    assets[index] = updated
    await this.commit(assets)
    return updated
  }

  /** 拷入媒体源到 `dir`（`m_<startIndex+n>` 命名，SHA-256 落 contentHash；text/未知类型跳过）。 */
  private async copyMediaSources(
    dir: string,
    sources: readonly LibraryMediaSource[] | undefined,
    startIndex = 0,
  ): Promise<LibMedia[]> {
    if (sources === undefined || sources.length === 0) return []
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const media: LibMedia[] = []
    for (const source of sources) {
      const base = source.sourcePath.split('/').pop() ?? ''
      const kind = classifyFile(base)
      // LibMedia 只覆盖 image/video/audio；文本等非视觉媒体不进库（方案 §8-I）。
      if (kind === null || kind === 'text') continue
      let bytes: Buffer
      try {
        bytes = await readFile(source.sourcePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throwError('CS-LIB-003', { detail: `media source missing: ${base}` })
        }
        throw error
      }
      const ext = extname(base).toLowerCase()
      const file = `m_${startIndex + media.length}${ext}`
      await writeFile(join(dir, file), bytes, { mode: 0o600 })
      media.push({
        file,
        kind,
        ...(source.label !== undefined ? { label: source.label } : {}),
        contentHash: sha256(bytes),
      })
    }
    return media
  }
}

/**
 * 从画布节点解析可入库的媒体源（F1「加入资产库」的取数入口）。
 *
 * - 节点不存在 → `CS-LIB-003`；
 * - `node.url` basename = 项目 `assets/` 内的磁盘文件（与 asset-gc 同判据）；
 * - 文件缺失（已进 `.trash` / 被 GC）→ `CS-LIB-003`（宁可拒绝入库，也不产出
 *   一条媒体悬空的库条目）；
 * - 无 `url` 的节点（文本/便签）→ 空数组，允许入库为纯元数据条目。
 */
export async function collectNodeMediaSources(
  registry: ProjectRegistry,
  projectId: string,
  nodeId: string,
): Promise<{ node: StudioCanvasNode; sources: LibraryMediaSource[] }> {
  const document = await registry.readCanvas(projectId)
  const node = document.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throwError('CS-LIB-003', { detail: `node not found: ${projectId}/${nodeId}` })
  if (node.url === undefined || node.url.length === 0) return { node, sources: [] }
  const base = basenameOfUrl(node.url)
  if (base === null) throwError('CS-LIB-003', { detail: `node url is not a local asset: ${node.url}` })
  const sourcePath = join(registry.assetsDir(projectId), base)
  try {
    const info = await stat(sourcePath)
    if (!info.isFile()) throwError('CS-LIB-003', { detail: `media source not a file: ${base}` })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throwError('CS-LIB-003', { detail: `media file missing: ${base}` })
    }
    throw error
  }
  return { node, sources: [{ sourcePath }] }
}

/** `materializeLibraryMedia` 的返回：项目内可 promote 的文件名 + 内容哈希。 */
export interface MaterializedLibraryMedia {
  /** 项目 `assets/` 内的相对文件名（可直接交 `promoteAssetFile`）。 */
  file: string
  /** 内容 SHA-256（hex）。 */
  contentHash: string
}

/**
 * 库媒体**物化**（方案 §3.4-2 前半段 / §8-C）：把 `library/<assetId>/<file>` 的字节
 * 落进当前项目 `assets/`，返回项目内相对文件名。`promoteAssetFile` 只从项目
 * `assetsDir` 读盘，够不着库目录 —— 所以「库文件 → 项目 assets 拷贝」是必经一步，
 * 之后才走既有的 Drama 注册 + reference-manifest 记账。
 *
 * 三档取名（去重在前，拷贝在后）：
 *  1. **contentHash 命中画布已有素材节点**：同字节曾在本项目落过盘（上传去重同款
 *     字段），直接复用该节点的本地文件，不重复占盘；
 *  2. **确定性名 `lib-<assetId>-<file>` 已在盘上**：本资产此前物化过（幂等，
 *     多次解析 / 多工具引用不产生第二份拷贝）；
 *  3. 都不中 → 拷贝为确定性名。
 *
 * 目标名只由 assetId 与库文件名拼成，恒过 `LIB_FILE_RE`（promote 的同款判据）。
 */
export async function materializeLibraryMedia(
  library: AssetLibrary,
  registry: ProjectRegistry,
  projectId: string,
  assetId: string,
  media: LibMedia,
): Promise<MaterializedLibraryMedia> {
  const source = library.mediaFile(assetId, media.file)
  let bytes: Buffer
  try {
    bytes = await readFile(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throwError('CS-LIB-003', { detail: `library media missing: ${assetId}/${media.file}` })
    }
    throw error
  }
  const contentHash = sha256(bytes)

  // 档 1：contentHash 命中本项目已有素材节点（url 必须指向本项目 assets 且文件在盘）。
  const document = await registry.readCanvas(projectId)
  for (const node of document.nodes) {
    if (node.contentHash !== contentHash || node.url === undefined) continue
    const base = projectAssetBasename(node.url, projectId)
    if (base === null) continue
    try {
      const info = await stat(join(registry.assetsDir(projectId), base))
      if (info.isFile()) return { file: base, contentHash }
    } catch {
      // 文件已被 GC / 进回收站：这一路复用不成立，落到档 2/3 重新物化。
      // （promote 自有 .trash 回源兜底，但那要以我们给出的文件名为准，这里不猜。）
    }
  }

  // 档 2/3：确定性名；已在盘（此前物化过）直接复用，否则拷贝。
  const targetName = `lib-${assetId}-${media.file}`
  if (!LIB_FILE_RE.test(targetName) || targetName.startsWith('.')) {
    throwError('CS-DEV-ERR', { detail: `materialized name invalid: ${targetName}` })
  }
  const targetPath = join(registry.assetsDir(projectId), targetName)
  try {
    const info = await stat(targetPath)
    if (info.isFile()) return { file: targetName, contentHash }
  } catch {
    // 不存在，继续拷贝。
  }
  await mkdir(registry.assetsDir(projectId), { recursive: true, mode: 0o700 })
  await writeFile(targetPath, bytes, { mode: 0o600 })
  return { file: targetName, contentHash }
}
