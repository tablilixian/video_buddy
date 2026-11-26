/**
 * 重编 manifest 时**丢掉的手工轨**要说出来（REQ-041 §5.4 / F6 的前置护栏）。
 *
 * 真机事故（2026-11-25 超级月亮）：模型为了做出「椭圆轨道」手改了 `build/manifest.json`
 * 的轨（spec 的 section 字段表达不了沿路径运动），随后为了拆屏又跑了一次
 * `scaffold_from_spec({ writeTo: "build/manifest.json" })` —— **整份覆盖**，手工轨静默消失。
 * 会话里模型自己都知道要「重编后恢复第 2 屏的椭圆轨道和音频」，说明这层丢失从来没有被
 * 工具说出来过，全靠它记性。
 *
 * 这里只做一件事：把「旧文件里有、新产物里没有」的轨名点出来（纯函数，无 IO）。
 * 产品侧的根治（让 spec 能携带手工轨）是另一期需求，见 F6。
 */

/** 一条轨的最小投影（只要 id / type / children；其余字段与本判定无关）。 */
type TrackLike = { id?: unknown; type?: unknown; children?: unknown }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** 深度收集轨 id（group 容器的子轨也算 —— 它们才是真正会渲染的那些）。 */
function collectIds(value: unknown): string[] {
  const document = asRecord(value)
  const tracks = document?.tracks
  if (!Array.isArray(tracks)) return []
  const ids: string[] = []
  const visit = (list: readonly unknown[]): void => {
    for (const raw of list) {
      const track = raw as TrackLike
      if (typeof track?.id === 'string' && track.id !== '') ids.push(track.id)
      if (track?.type === 'group' && Array.isArray(track.children)) visit(track.children)
    }
  }
  visit(tracks)
  return ids
}

function parse(json: string | undefined): unknown {
  if (json === undefined) return undefined
  try {
    return JSON.parse(json) as unknown
  } catch {
    return undefined
  }
}

export interface OverwriteTrackDiff {
  previousTrackIds: string[]
  nextTrackIds: string[]
  /** 旧文件里有、新产物里没有的 id（按旧文件顺序，去掉重复）。 */
  dropped: string[]
}

/**
 * @param previousJson 目标路径上**已存在**的 manifest 原文（不存在传 undefined）
 * @param nextJson 即将写下去的 manifest 原文
 * @returns 无法解析任一侧时返回 null（判不了就不说话，别造假告警）
 */
export function diffOverwrittenTracks(
  previousJson: string | undefined,
  nextJson: string,
): OverwriteTrackDiff | null {
  const previous = parse(previousJson)
  const next = parse(nextJson)
  if (previous === undefined || next === undefined) return null
  const previousTrackIds = collectIds(previous)
  const nextIds = new Set(collectIds(next))
  const dropped: string[] = []
  for (const id of previousTrackIds) {
    if (nextIds.has(id) || dropped.includes(id)) continue
    dropped.push(id)
  }
  return { previousTrackIds, nextTrackIds: [...nextIds], dropped }
}

/**
 * 回执那一行（没有丢失时返回空串）。
 *
 * 文案必须点出「为什么丢」和「怎么办」：模型看到 `V2-orbit` 这类 id 会立刻明白
 * 那是自己手写的轨，而不是模板产出的。
 *
 * `exempt` = **不算丢失**的轨 id（F6：`build/overrides/` 里的手工轨会被重编冲掉，
 * 但它们本来就有独立住所，下次渲染自动并回来）。不过滤的话每次重编都会假报
 * 「手工轨丢了」—— 告警一旦常亮，真丢失就再也没人看。
 */
export function droppedTracksNote(
  diff: OverwriteTrackDiff | null,
  options: { shown?: number; exempt?: ReadonlySet<string> } = {},
): string {
  if (diff === null) return ''
  const shown = options.shown ?? 6
  const exempt = options.exempt
  const dropped = exempt === undefined ? diff.dropped : diff.dropped.filter((id) => !exempt.has(id))
  if (dropped.length === 0) return ''
  const named = dropped.slice(0, shown).join('、')
  const rest = dropped.length > shown ? ` 等 ${String(dropped.length)} 条` : ''
  return `⚠️ 旧 manifest 里有 ${String(dropped.length)} 条轨不在本次产物中，已被覆盖：${named}${rest}。`
    + '这些是 spec 表达不了的**手工轨**（沿路径运动 / 分段停顿 / 引线之类）——'
    + '要它们活过重编，用 `patch_segment_tracks` 存进 `build/overrides/`（那里不会被 scaffold 碰）；'
    + '临时加回 manifest 的话，下次重编还会丢。'
}
