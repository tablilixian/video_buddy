/**
 * REQ-034（Remotion 集成）· B3 route B 素材核对（宿主侧，**无浏览器**）。
 *
 * 技术事实源 = 仓根 `remotion-integration-devdoc-2026-10-14.md` §8.2（v1.5）。
 *
 * route B 下渲染发生在 Electron 渲染进程、页面与素材**同源**，因此宿主**不拷素材**
 * （route A 的 `renderDir` / `staticFile()` / `link` / 临时目录一整套作废）。宿主只做：
 * 1. 用 `urlToAssetPath`（`compose.ts` 复用）把同源资产 URL 反查为本地文件，核对存在性；
 * 2. 对 `video` 轨用 `probeMediaDuration`（ffmpeg）探**真值时长**，供
 *    `reconcileManifestVideoDurations`（`timing.ts`）校正「声明帧数 vs 真值」。
 *
 * 素材缺失在宿主侧即可判定（`existsSync`），故**硬失败**：`missing` 非空由调用方抛
 * `CS-USER-ERR` —— 对齐 `compose_video`「片段文件不存在，请重新生成后再导出」的口径。
 * 若放行到渲染，用户拿到的是一条没有上下文的客户端渲染失败。
 *
 * @see materialize.ts —— 本核对**的前置**：它先把域内绝对路径物化成同源 URL。
 */
import { existsSync } from 'node:fs'
import { urlToAssetPath } from '../compose.js'
import { probeMediaDuration } from '../ffmpeg-run.js'
import { ASSET_URL_PREFIX, type CompositionManifest } from './manifest.js'

/** 素材核对结论。 */
export interface AssetCheck {
  /**
   * 缺失 / 不可用的素材（形如 `<trackId> → <src>`）。**非空 ⇒ 调用方硬失败**
   * （对齐 `compose_video`「片段文件不存在」的口径，不静默出片）。
   */
  missing: string[]
  /**
   * `video` 轨 `src` → 真值时长（秒）。探不到真值的项**不出现**（区别于「真值 = 0」），
   * 调用方据此决定是否做时长核对（`reconcileManifestVideoDurations` 读不到键即原样返回）。
   */
  realDurations: Record<string, number>
}

/**
 * 核对 Manifest 引用的素材（只核对、不拷贝，devdoc §8.2）。
 *
 * @param manifest - 待渲染的 `CompositionManifest`。
 * @param assetsDir - 目标项目资产目录（`registry.assetsDir(projectId)`）。
 * @param ffmpegPath - 可选：显式 ffmpeg 路径（测试注入；缺省走 `resolveFfmpegPath`）。
 */
export async function checkManifestAssets(
  manifest: CompositionManifest,
  assetsDir: string,
  ffmpegPath?: string,
): Promise<AssetCheck> {
  const missing: string[] = []
  const realDurations: Record<string, number> = {}
  for (const track of manifest.tracks) {
    if (track.type !== 'video' && track.type !== 'image') continue
    const src = track.src
    // 物化层（`materializeManifestSources`）已把**本项目资产目录内**的本地绝对路径转成同源
    // URL ⇒ 此处理论上只剩同源 URL。非前缀值按**上游漏物化**处理并记缺失（fail-closed）：
    // 跳过它会重新引入「放行但不核对」的静默 404。
    if (!src.startsWith(ASSET_URL_PREFIX)) {
      missing.push(`${track.id} → ${src}（非同源资产 URL，未经物化）`)
      continue
    }
    const local = urlToAssetPath(assetsDir, src)
    if (!existsSync(local)) {
      missing.push(`${track.id} → ${src}`)
      continue
    }
    if (track.type === 'video') {
      const real = await probeMediaDuration(local, ffmpegPath)
      if (real > 0) realDurations[src] = real
    }
  }
  return { missing, realDurations }
}
