/**
 * 视频下载（REQ-036 C1，CV-399）—— 参考视频「链接 → 落盘」的第一步。
 *
 * 背景：viral-remake 前置自检明确「链接 → 让用户给文件，不承诺抓取」，用户拿着
 * 抖音/B站链接说「复刻这条」，第一步就断。本模块用 **yt-dlp 二进制**（单文件可执行）
 * 补上这一步：运行时按需下载到用户数据目录（带版本号 + sha256 校验），不进安装包
 * （体积 + 合规）。
 *
 * v1 边界（REQ §6 定死）：
 * - 站点白名单：抖音 / B站 / YouTube；白名单外明确报错「暂不支持该站点」。
 * - 不做 cookie/登录态（会员、仅登录可见内容直接报「视频需登录」）。
 * - 不做直播流、合集批量下载。
 * - 版权：仅用于用户自备参考素材的拆解复刻，复刻产出默认替换原素材（工具描述同步）。
 *
 * 纯函数（URL 白名单 / 错误分类 / argv 构造）与 IO（二进制下载、yt-dlp 执行）分离；
 * 二进制路径可注入（同 ffmpegPath 先例），测试用桩脚本跑通全链路。
 */
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
// runFfmpeg 是通用的「子进程 + 超时强杀 + 信号中断 + stdout/stderr 收集」runner
//（ffmpeg-run.ts 头注口径），yt-dlp 复用同一份实现，不另写一份。
import { resolveFfmpegPath, runFfmpeg } from './ffmpeg-run.js'
import { probeMedia } from './media-probe.js'
import { throwError } from './error-system.js'
import './errors/catalog.js'

// ───────────────────────────── 版本与校验和 ─────────────────────────────

/** 钉死的 yt-dlp 版本（升级 = 改这里 + 三平台 checksum，见 YT_DLP_CHECKSUMS）。 */
export const YT_DLP_VERSION = '2026.10.26'

/**
 * 官方 SHA2-256SUMS（release 2026.10.26，随版本钉死）。
 * `yt-dlp_macos` 是 universal2（x64 + arm64 一份），其余按平台架构分发。
 */
export const YT_DLP_CHECKSUMS: Readonly<Record<string, string>> = {
  'yt-dlp_macos': '0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa',
  'yt-dlp_linux': '767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795',
  'yt-dlp_linux_aarch64': 'e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483',
  'yt-dlp.exe': 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d',
  'yt-dlp_arm64.exe': '0066dbac3c124028e2dcae2a197fccee33cd91f456313d24f7af89fd54590e98',
}

/** 单条视频下载超时（REQ 定死默认 120s）。 */
export const DOWNLOAD_TIMEOUT_MS = 120_000
/** yt-dlp 二进制下载超时（30MB 级，给宽些）。 */
export const BINARY_DOWNLOAD_TIMEOUT_MS = 300_000

/** 产物时长校验容差：max(2s, 20%)——H3/供应商实测「请求 5s 出 5.167s」同源量化偏差。 */
export function durationToleranceSec(expected: number): number {
  return Math.max(2, Math.abs(expected) * 0.2)
}

/** 平台 → yt-dlp 二进制名（未知平台返回 null → 显式报错，不静默回退）。 */
export function ytDlpBinaryNameFor(platform: string, arch: string): string | null {
  if (platform === 'darwin') return 'yt-dlp_macos'
  if (platform === 'linux') return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
  if (platform === 'win32') return arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe'
  return null
}

export function ytDlpReleaseUrl(binaryName: string, version = YT_DLP_VERSION): string {
  return `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${binaryName}`
}

// ───────────────────────────── URL 白名单（纯函数）─────────────────────────────

export type SupportedSite = 'douyin' | 'bilibili' | 'youtube'

/** 站点 → 展示名（错误文案 / 返回 source 用）。 */
export const SITE_LABELS: Readonly<Record<SupportedSite, string>> = {
  douyin: '抖音',
  bilibili: 'B站',
  youtube: 'YouTube',
}

const SITE_HOSTS: Readonly<Record<SupportedSite, readonly string[]>> = {
  douyin: ['douyin.com', 'iesdouyin.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
}

export interface ClassifiedVideoUrl {
  site: SupportedSite
  /** 规范化后的链接（trim；协议小写归一交给 yt-dlp）。 */
  url: string
}

/**
 * 链接白名单校验（纯函数）：http/https + 主机后缀匹配。不合法 / 不支持都以
 * CS-USER-ERR 抛出（可读文案，供 Agent 直接转述）。
 */
export function classifyVideoUrl(raw: string): ClassifiedVideoUrl {
  const trimmed = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throwError('CS-USER-ERR', { message: `链接无效：${trimmed.slice(0, 120)} —— 请给完整的视频页 http/https 链接。` })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throwError('CS-USER-ERR', { message: `链接无效：只支持 http/https（实得 ${parsed.protocol}）。` })
  }
  const host = parsed.hostname.toLowerCase()
  for (const [site, domains] of Object.entries(SITE_HOSTS) as [SupportedSite, readonly string[]][]) {
    if (domains.some((d) => host === d || host.endsWith(`.${d}`))) {
      return { site, url: trimmed }
    }
  }
  throwError('CS-USER-ERR', {
    message: `暂不支持该站点（${host}）。v1 白名单：抖音（douyin.com / v.douyin.com）、B站（bilibili.com / b23.tv）、YouTube（youtube.com / youtu.be）。`
      + '其他站点请让用户自备视频文件（画布上传）。',
    detail: `unsupported host ${host}`,
  })
}

// ───────────────────────────── 错误分类（纯函数）─────────────────────────────

export type DownloadErrorKind =
  | 'login-required'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'unknown'

export interface DownloadFailure {
  kind: DownloadErrorKind
  /** 面向用户的可读文案（Agent 直接转述）。 */
  message: string
}

/**
 * yt-dlp stderr → 分类错误（纯函数，模式来自官方退出文案）。
 * 「链接无效 / 站点不支持 / 产物校验失败」在进入 yt-dlp 前后由调用方直接判，
 * 这里只管 yt-dlp 跑起来之后的失败。
 */
export function classifyDownloadFailure(stderr: string): DownloadFailure {
  const tail = stderr.trim().split('\n').filter((l) => l.trim() !== '').slice(-3).join(' ').slice(0, 300)
  if (/sign in to confirm|login required|log in|cookies|需要登录|登录/i.test(stderr)) {
    return {
      kind: 'login-required',
      message: '视频需要登录后才能访问（会员 / 仅登录可见）。v1 不带登录态下载 —— 请让用户自备该视频文件（画布上传后继续拆解）。',
    }
  }
  if (/video unavailable|private video|has been removed|does not exist|不存在|已被删除|404/i.test(stderr)) {
    return { kind: 'unavailable', message: `视频不可用（已删除 / 私密 / 链接失效）。${tail}` }
  }
  if (/timed? ?out|timeout/i.test(stderr)) {
    return { kind: 'timeout', message: `下载超时（默认 ${Math.round(DOWNLOAD_TIMEOUT_MS / 1000)}s）—— 网络不稳定可重试一次，长视频请换更短的参考片段。` }
  }
  if (/http error 5\d\d|connection reset|network|unable to download|getaddrinfo/i.test(stderr)) {
    return { kind: 'network', message: `网络错误 —— 检查网络后重试。${tail}` }
  }
  return { kind: 'unknown', message: `下载失败：${tail || 'yt-dlp 无错误输出'}` }
}

// ───────────────────────────── argv 构造（纯函数）─────────────────────────────

/**
 * yt-dlp 下载参数（纯函数，argv 可断言）：
 * mp4 优先（bv*+ba 合并），`--print after_move:filepath` 从 stdout 拿最终产物路径。
 */
export function buildYtDlpArgs(options: {
  url: string
  outTemplate: string
  ffmpegPath: string
}): string[] {
  return [
    '--no-playlist',       // 合集/多P只取单条（v1 不做合集批量）
    '--no-progress',       // 进度条只污染 stderr
    '--no-warnings',
    '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
    '--merge-output-format', 'mp4',
    '--ffmpeg-location', options.ffmpegPath,
    '--socket-timeout', '30',
    '-o', options.outTemplate,
    '--print', 'after_move:filepath',
    options.url,
  ]
}

// ───────────────────────────── 二进制获取 ─────────────────────────────

function ytDlpBinDir(root: string, platform: string, arch: string): { dir: string; binaryName: string } {
  const binaryName = ytDlpBinaryNameFor(platform, arch)
  if (binaryName === null) {
    throwError('CS-USER-ERR', { message: `当前平台（${platform}/${arch}）没有预编译的 yt-dlp 二进制 —— 请手动安装 yt-dlp 并把可执行文件放到用户数据目录后重试。` })
  }
  return { dir: join(root, 'bin', 'yt-dlp', YT_DLP_VERSION), binaryName }
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * 解析本机可用的 yt-dlp 可执行文件：先看缓存（checksum 校验通过才复用），缺了就
 * 按需下载（版本钉死 + sha256 校验 + chmod）。下载失败给出**手动放置路径指引**。
 */
export async function resolveYtDlpPath(options: {
  root?: string
  platform?: string
  arch?: string
  signal?: AbortSignal
}): Promise<string> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const root = options.root ?? dshHomePath('canvas-studio')
  const { dir, binaryName } = ytDlpBinDir(root, platform, arch)
  const binaryPath = join(dir, binaryName)
  const expectedSha = YT_DLP_CHECKSUMS[binaryName]
  if (expectedSha === undefined) {
    throwError('CS-DEV-ERR', { message: `yt-dlp 版本表缺 ${binaryName} 的 sha256 —— 版本钉死了但校验和没配齐（产品缺陷，请报给开发）。` })
  }
  if (existsSync(binaryPath)) {
    // 缓存命中也要过 checksum：半截/被篡改的缓存文件不能进执行路径。
    const cached = await readFile(binaryPath)
    if (sha256Hex(cached) === expectedSha) return binaryPath
  }
  const url = ytDlpReleaseUrl(binaryName)
  let bytes: Uint8Array
  try {
    // exactOptionalPropertyTypes：signal 仅在传入时带上（undefined 不能赋给 AbortSignal | null）。
    const response = await fetch(url, { redirect: 'follow', ...(options.signal !== undefined ? { signal: options.signal } : {}) })
    if (!response.ok) {
      throwError('CS-USER-ERR', { message: `yt-dlp 组件下载失败（HTTP ${response.status}）—— 请检查网络后重试；或手动下载 ${url} 放到 ${binaryPath}（sha256=${expectedSha}）。` })
    }
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (error instanceof Error && error.message.includes('yt-dlp 组件下载失败')) throw error
    throwError('CS-USER-ERR', { message: `yt-dlp 组件下载失败（${error instanceof Error ? error.message : String(error)}）—— 请检查网络后重试；或手动下载 ${url} 放到 ${binaryPath}（sha256=${expectedSha}）。` })
  }
  if (sha256Hex(bytes) !== expectedSha) {
    throwError('CS-USER-ERR', { message: `yt-dlp 组件校验失败（sha256 不符）—— 下载源被污染或网络劫持，已放弃执行。可手动下载 ${url} 放到 ${binaryPath}（sha256=${expectedSha}）。` })
  }
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(binaryPath, bytes, { mode: 0o600 })
  if (platform !== 'win32') await chmod(binaryPath, 0o755)
  return binaryPath
}

// ───────────────────────────── 执行器 ─────────────────────────────

export interface DownloadVideoResult {
  /** 产物绝对路径（项目资产目录内，可直接喂 inspect_image / 抽帧 / evidence_grid）。 */
  assetPath: string
  /** 画布资产 URL。 */
  url: string
  /** 探测的产物时长（秒；探测失败 0）。 */
  durationSec: number
  width?: number
  height?: number
  hasAudio: boolean
  source: SupportedSite
  /** 落盘画布节点 id。 */
  nodeId: string
}

export interface DownloadVideoOptions {
  url: string
  expectedDurationSec?: number
  /** 测试注入：直接指定 yt-dlp 可执行文件（桩脚本），跳过按需下载。 */
  ytDlpPath?: string
  /** 测试注入：二进制缓存根（缺省 dshHomePath('canvas-studio')）。 */
  root?: string
  ffmpegPath?: string
  signal?: AbortSignal
}

/**
 * 下载入口：链接 → yt-dlp → 探测 → 校验 → 落项目资产 + 画布视频节点。
 * 产物形态与 upload_image 一致（saveLocalAssetBytes 唯一入口，进资产历史）。
 */
export async function downloadVideo(
  options: DownloadVideoOptions,
  io: {
    saveAsset(name: string, bytes: Uint8Array): Promise<{ url: string; assetFile: string }>
    assetsDir(): string
    appendNode(node: {
      url: string
      title: string
      duration?: number
      width?: number
      height?: number
      toolName: string
      sourceSite: string
    }): Promise<string>
  },
): Promise<DownloadVideoResult> {
  const { site, url } = classifyVideoUrl(options.url)
  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath)
  const ytDlp = options.ytDlpPath ?? await resolveYtDlpPath({
    ...(options.root !== undefined ? { root: options.root } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  })

  const workDir = join(tmpdir(), 'video-download-')
  const tempDir = await mkdtemp(workDir)
  try {
    const args = buildYtDlpArgs({ url, outTemplate: join(tempDir, 'source.%(ext)s'), ffmpegPath })
    const run = await runFfmpeg(ytDlp, args, DOWNLOAD_TIMEOUT_MS, options.signal)
    if (run.code !== 0) {
      throwError('CS-USER-ERR', { message: classifyDownloadFailure(run.stderr).message, detail: `yt-dlp exit ${run.code}` })
    }
    // `--print after_move:filepath` 的输出在 stdout 最后一行；兜底扫临时目录。
    const printed = run.stdout.trim().split('\n').filter((l) => l.trim() !== '').at(-1) ?? ''
    let producedPath = printed
    if (producedPath === '' || !existsSync(producedPath)) {
      const names = (await readdir(tempDir)).filter((n) => !n.endsWith('.part'))
      if (names.length === 0) {
        throwError('CS-USER-ERR', { message: 'yt-dlp 正常退出但没有产物 —— 链接可能指向图集或空内容，请确认是单条视频页。' })
      }
      producedPath = join(tempDir, names[0]!)
    }

    // 产物探测 + 可选时长校验（防错下成图集 / 短预告）
    const probe = await probeMedia({
      path: producedPath,
      ffmpegPath,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    })
    if (options.expectedDurationSec !== undefined && Number.isFinite(options.expectedDurationSec) && options.expectedDurationSec > 0) {
      const tolerance = durationToleranceSec(options.expectedDurationSec)
      if (probe.durationSec > 0 && Math.abs(probe.durationSec - options.expectedDurationSec) > tolerance) {
        throwError('CS-USER-ERR', {
          message: `产物校验失败：下载到 ${probe.durationSec.toFixed(1)}s，与期望 ${options.expectedDurationSec.toFixed(1)}s 相差超过容差 ±${tolerance.toFixed(1)}s —— 链接可能指向合集 / 预告 / 图集，请确认是单条视频页后重试。`,
          detail: 'duration validation failed',
        })
      }
    }

    const bytes = await readFile(producedPath)
    const saved = await io.saveAsset(`download-${site}.mp4`, bytes)
    const assetPath = join(io.assetsDir(), saved.assetFile)
    const nodeId = await io.appendNode({
      url: saved.url,
      title: `参考视频 · ${SITE_LABELS[site]}`,
      duration: probe.durationSec,
      ...(probe.width !== undefined ? { width: probe.width } : {}),
      ...(probe.height !== undefined ? { height: probe.height } : {}),
      toolName: 'download_video',
      sourceSite: site,
    })
    return {
      assetPath,
      url: saved.url,
      durationSec: probe.durationSec,
      ...(probe.width !== undefined ? { width: probe.width } : {}),
      ...(probe.height !== undefined ? { height: probe.height } : {}),
      hasAudio: probe.hasAudio,
      source: site,
      nodeId,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
