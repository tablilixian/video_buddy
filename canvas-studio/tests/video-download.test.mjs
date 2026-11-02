/**
 * C1 视频下载测试（REQ-036，CV-399）—— 纯函数（白名单/错误分类/argv）+ 桩 yt-dlp 全链路。
 *
 * yt-dlp 二进制与网络都不进测试：执行器经 `ytDlpPath` 注入桩脚本（repo 的
 * ffmpegPath 同款先例），全链路（下载→探测→校验→落资产→节点）真跑，只把
 * 「远端视频」换成预生成的本地样本。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildYtDlpArgs,
  classifyDownloadFailure,
  classifyVideoUrl,
  downloadVideo,
  durationToleranceSec,
  resolveYtDlpPath,
  ytDlpBinaryNameFor,
  YT_DLP_CHECKSUMS,
  YT_DLP_VERSION,
} from '../lib/video-download.js'

function cleanupDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 受管 shell 可能拦测试临时目录清理 —— 断言已完，清理尽力而为 */
  }
}

function resolveSystemFfmpeg() {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'ffmpeg')
    if (existsSync(candidate)) return candidate
  }
  return null
}

// ───────────────── 纯函数：URL 白名单 ─────────────────

test('C1：classifyVideoUrl 白名单三站 + 短链域', () => {
  assert.equal(classifyVideoUrl('https://www.douyin.com/video/738xxx').site, 'douyin')
  assert.equal(classifyVideoUrl('https://v.douyin.com/iRxxx/').site, 'douyin')
  assert.equal(classifyVideoUrl('https://www.bilibili.com/video/BV1xxx').site, 'bilibili')
  assert.equal(classifyVideoUrl('https://b23.tv/BV1xxx').site, 'bilibili')
  assert.equal(classifyVideoUrl('https://www.youtube.com/watch?v=abc').site, 'youtube')
  assert.equal(classifyVideoUrl('https://youtu.be/abc').site, 'youtube')
  assert.equal(classifyVideoUrl('http://m.bilibili.com/video/BV1xxx').site, 'bilibili')
})

test('C1：classifyVideoUrl 非法链接 / 非白名单站点 显式报错（反向变异）', () => {
  assert.throws(() => classifyVideoUrl('not a url'), /链接无效/)
  assert.throws(() => classifyVideoUrl('ftp://youtu.be/abc'), /链接无效/)
  assert.throws(() => classifyVideoUrl('https://www.kuaishou.com/x'), /暂不支持该站点/)
  assert.throws(() => classifyVideoUrl('https://example.edu.ua/video'), /暂不支持该站点/)
})

// ───────────────── 纯函数：平台二进制 / argv / 错误分类 ─────────────────

test('C1：ytDlpBinaryNameFor 平台映射（macos universal2 / linux / win32）', () => {
  assert.equal(ytDlpBinaryNameFor('darwin', 'arm64'), 'yt-dlp_macos')
  assert.equal(ytDlpBinaryNameFor('darwin', 'x64'), 'yt-dlp_macos')
  assert.equal(ytDlpBinaryNameFor('linux', 'x64'), 'yt-dlp_linux')
  assert.equal(ytDlpBinaryNameFor('linux', 'arm64'), 'yt-dlp_linux_aarch64')
  assert.equal(ytDlpBinaryNameFor('win32', 'x64'), 'yt-dlp.exe')
  assert.equal(ytDlpBinaryNameFor('win32', 'arm64'), 'yt-dlp_arm64.exe')
  assert.equal(ytDlpBinaryNameFor('sunos', 'x64'), null)
})

test('C1：版本表三平台 checksum 配齐（防「钉版本忘配校验和」）', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const arch of ['x64', 'arm64']) {
      const name = ytDlpBinaryNameFor(platform, arch)
      assert.ok(name !== null && YT_DLP_CHECKSUMS[name] !== undefined, `${platform}/${arch} → ${name} 应有 sha256`)
    }
  }
  assert.match(YT_DLP_VERSION, /^\d{4}\.\d{2}\.\d{2}$/)
})

test('C1：buildYtDlpArgs argv 形态（单条 / mp4 优先 / ffmpeg 位置 / url 收尾）', () => {
  const args = buildYtDlpArgs({ url: 'https://youtu.be/abc', outTemplate: '/tmp/x/source.%(ext)s', ffmpegPath: '/ff/dir/ffmpeg' })
  assert.ok(args.includes('--no-playlist'), 'v1 不做合集批量')
  assert.ok(args.includes('-f'), '格式选择器')
  assert.ok(args.at(-1) === 'https://youtu.be/abc', 'url 必须是最后一个参数')
  assert.equal(args[args.indexOf('--merge-output-format') + 1], 'mp4')
  assert.equal(args[args.indexOf('--ffmpeg-location') + 1], '/ff/dir/ffmpeg')
  assert.equal(args[args.indexOf('-o') + 1], '/tmp/x/source.%(ext)s')
})

test('C1：classifyDownloadFailure 五类错误映射（登录/不可用/超时/网络/未知）', () => {
  assert.equal(classifyDownloadFailure('ERROR: Sign in to confirm you are not a bot').kind, 'login-required')
  assert.match(classifyDownloadFailure('ERROR: Sign in to confirm').message, /需要登录|登录/)
  assert.equal(classifyDownloadFailure('ERROR: [youtube] abc: Video unavailable').kind, 'unavailable')
  assert.equal(classifyDownloadFailure('ERROR: unable to download webpage: timed out').kind, 'timeout')
  assert.equal(classifyDownloadFailure('ERROR: unable to download video data: HTTP Error 500').kind, 'network')
  assert.equal(classifyDownloadFailure('').kind, 'unknown')
  assert.match(classifyDownloadFailure('ERROR: gaiji cache expired').message, /下载失败/)
})

test('C1：durationToleranceSec = max(2s, 20%)', () => {
  assert.equal(durationToleranceSec(5), 2)
  assert.equal(durationToleranceSec(30), 6)
  assert.equal(durationToleranceSec(0), 2)
})

// ───────────────── 执行器（桩 yt-dlp 全链路）─────────────────

/** 桩 yt-dlp：把预生成样本拷到 -o 模板解析出的路径，stdout 打印最终路径。 */
function writeStubYtDlp(dir, samplePath, mode) {
  const stub = join(dir, 'stub-yt-dlp.sh')
  const body = mode === 'login'
    ? '#!/bin/bash\necho "ERROR: Sign in to confirm you are not a bot" >&2\nexit 1\n'
    : `#!/bin/bash
prev=""
out=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then out="$a"; fi
  prev="$a"
done
dest=$(printf '%s' "$out" | sed 's/%(ext)s/mp4/')
cp "${samplePath}" "$dest"
echo "$dest"
`
  writeFileSync(stub, body)
  chmodSync(stub, 0o755)
  return stub
}

async function makeSample(dir) {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) return null
  const samplePath = join(dir, 'sample.mp4')
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=red:size=128x96:rate=10:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-y', samplePath,
  ], { timeout: 60_000 })
  return samplePath
}

function recordingIo(assetsDirPath) {
  mkdirSync(assetsDirPath, { recursive: true })
  const calls = { saved: [], node: null }
  return {
    calls,
    io: {
      saveAsset: async (name, bytes) => {
        const assetFile = `asset-${calls.saved.length + 1}.mp4`
        writeFileSync(join(assetsDirPath, assetFile), bytes)
        calls.saved.push({ name, bytes: bytes.length, assetFile })
        return { url: `/canvas-studio/assets/p1/${assetFile}`, assetFile }
      },
      assetsDir: () => assetsDirPath,
      appendNode: async (payload) => {
        calls.node = payload
        return 'node-1'
      },
    },
  }
}

test('C1 全链路：桩 yt-dlp 下载 → 探测 → 落资产 + 节点（无网络）', async () => {
  if (resolveSystemFfmpeg() === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'video-download-'))
  const assetsDirPath = join(dir, 'assets')
  try {
    const samplePath = await makeSample(dir)
    const stub = writeStubYtDlp(dir, samplePath)
    const { calls, io } = recordingIo(assetsDirPath)
    const result = await downloadVideo(
      { url: 'https://www.youtube.com/watch?v=abc', ytDlpPath: stub },
      io,
    )
    assert.equal(result.source, 'youtube')
    assert.ok(Math.abs(result.durationSec - 1) < 0.5, `样本 1s，实得 ${result.durationSec}`)
    assert.equal(result.hasAudio, false)
    assert.equal(result.nodeId, 'node-1')
    assert.equal(result.assetPath, join(assetsDirPath, 'asset-1.mp4'))
    assert.ok(existsSync(result.assetPath))
    assert.deepEqual(readFileSync(result.assetPath), readFileSync(samplePath), '落盘字节 = 样本字节')
    assert.equal(calls.node.title, '参考视频 · YouTube')
    assert.equal(calls.node.toolName, 'download_video')
    // 临时目录已清理（产物已拷进资产区）
    assert.ok(!existsSync(join(dir, 'video-download-')))
  } finally {
    cleanupDir(dir)
  }
})

test('C1 全链路：expectedDurationSec 校验失败显式报错（防错下成图集/预告）', async () => {
  if (resolveSystemFfmpeg() === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'video-download-'))
  const assetsDirPath = join(dir, 'assets')
  try {
    const samplePath = await makeSample(dir)
    const stub = writeStubYtDlp(dir, samplePath)
    const { io } = recordingIo(assetsDirPath)
    await assert.rejects(
      downloadVideo({ url: 'https://www.youtube.com/watch?v=abc', ytDlpPath: stub, expectedDurationSec: 60 }, io),
      /产物校验失败/,
    )
  } finally {
    cleanupDir(dir)
  }
})

test('C1 全链路：需登录视频报「登录」文案（桩 exit 1）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-download-'))
  try {
    const stub = writeStubYtDlp(dir, '/nonexistent', 'login')
    const { io } = recordingIo(dir)
    await assert.rejects(
      downloadVideo({ url: 'https://www.youtube.com/watch?v=abc', ytDlpPath: stub }, io),
      /登录/,
    )
  } finally {
    cleanupDir(dir)
  }
})

test('C1：resolveYtDlpPath 未知平台显式报错（不静默回退）', async () => {
  await assert.rejects(
    resolveYtDlpPath({ platform: 'sunos', arch: 'x64', root: tmpdir() }),
    /预编译|平台/,
  )
})
