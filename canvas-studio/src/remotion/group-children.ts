/**
 * ≥95% 对齐 S1-B（2026-11-11）：`group` 3D 容器子轨的**深遍历**工具。
 *
 * 为什么存在：容器子轨是「真正会渲染的轨」，宿主/客户端里所有「扫 video/image 轨」的
 * 链路（物化、素材在盘校验、时长回核、原生音频判定、分辨率告警、alpha 回写）漏掉
 * 子轨的后果都是**契约过了、成片黑屏/静音** —— 与 prefetch 漏子轨同类。
 * 用一个工具收敛，六处接线共用一份语义（顶层在前、深度优先、容器自身也在序列里）。
 *
 * 泛型而非绑定 `CompositionTrack`：调用方（audio-compose 等）用的是结构化的
 * `ManifestTracksLike`，比 manifest 的联合类型更宽 —— 工具按 `{type, children}` 结构
 * 判定，不要求调用方先做类型断言。
 */

type DeepTrack = {
  type?: unknown
  children?: unknown
}

/** 判定一条轨是 group 容器且 children 是数组（结构判定，不做类型断言）。 */
function isGroupWithChildren(track: DeepTrack): track is DeepTrack & { children: DeepTrack[] } {
  return track.type === 'group' && Array.isArray(track.children)
}

/** 深度展开（容器自身也在序列里）：`[group{a,b}, c]` → `[group, a, b, c]`。 */
export function flattenTracksDeep<T extends DeepTrack>(tracks: readonly T[]): T[] {
  const out: T[] = []
  const visit = (list: readonly T[]): void => {
    for (const track of list) {
      out.push(track)
      if (isGroupWithChildren(track)) visit(track.children as T[])
    }
  }
  visit(tracks)
  return out
}

/**
 * 深度映射（不增删轨）：对每条轨（含容器自身）应用 `map`；容器的 children 逐条映射，
 * 有变化才新建容器对象 —— **没有任何子轨变化时返回原数组/原对象**，老 manifest 逐字节不变。
 */
export function mapTracksDeep<T extends DeepTrack>(tracks: readonly T[], map: (track: T) => T): T[] {
  return tracks.map((track) => {
    const mapped = map(track)
    if (!isGroupWithChildren(mapped)) return mapped
    const originalChildren = mapped.children as T[]
    const children = originalChildren.map(map)
    return children.some((child, index) => child !== originalChildren[index])
      ? { ...mapped, children }
      : mapped
  })
}
