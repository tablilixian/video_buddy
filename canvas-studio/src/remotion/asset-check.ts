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
 * 素材缺失在 route B **无法**在宿主侧阻止渲染失败（客户端 fetch 才暴露），故只作为
 * warning 回传（agent / 用户可见），不抛错。
 */
import { existsSync } from 'node:fs'
import { urlToAssetPath } from '../compose.js'
import { probeMediaDuration } from '../ffmpeg-run.js'
import type { CompositionManifest } from './manifest.js'

/** 同源资产 URL 前缀（与 `manifest.ts` 的校验锚点同源）。 */
const ASSET_URL_PREFIX = '/canvas-studio/assets/'

/** 素材核对结论。 */
export interface AssetCheck {
  /** 面向用户 / agent 的告警（素材缺失）。 */
  warnings: string[]
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
  const warnings: string[] = []
  const realDurations: Record<string, number> = {}
  for (const track of manifest.tracks) {
    if (track.type !== 'video' && track.type !== 'image') continue
    const src = track.src
    // 本地绝对路径形态（§4.3 允许）无法在**本项目**资产目录里反查；同源 URL 才核对。
    if (!src.startsWith(ASSET_URL_PREFIX)) continue
    const local = urlToAssetPath(assetsDir, src)
    if (!existsSync(local)) {
      warnings.push(`素材缺失：${track.id} → ${src}（渲染将失败）`)
      continue
    }
    if (track.type === 'video') {
      const real = await probeMediaDuration(local, ffmpegPath)
      if (real > 0) realDurations[src] = real
    }
  }
  return { warnings, realDurations }
}
