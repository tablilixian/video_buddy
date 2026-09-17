/**
 * Bundled ffmpeg: pinned upstream release, checksums, fetch, and packaging gates.
 *
 * Canvas Studio shells out to ffmpeg for final-cut composition, frame grabs, and
 * real waveforms. Nothing on a user's machine guarantees an ffmpeg binary, so the
 * product ships one: `fetchFfmpegBundle` downloads the pinned prebuilt binary for
 * every architecture the package must cover into `build/ffmpeg/<platform>-<arch>/`,
 * electron-builder copies that tree to `<resources>/ffmpeg/`, and
 * `verifyBundledFfmpeg` refuses to ship an artifact whose binaries are missing,
 * truncated, unpinned, or unable to run.
 *
 * Yarn disables lifecycle scripts in this repository, so ffmpeg-static's own
 * postinstall download never runs; this module is the single source of the binary.
 *
 * @module scripts/ffmpeg-bundle
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/** ffmpeg-static npm version whose prebuilt binaries this product redistributes. */
export const FFMPEG_STATIC_VERSION = '5.3.0'

/** Pinned ffmpeg-static release tag; every checksum below belongs to this tag. */
export const FFMPEG_STATIC_TAG = 'b6.1.1'

/** Default binary host. Override with `FFMPEG_BINARIES_URL` for mirrors or air-gapped builds. */
export const FFMPEG_DEFAULT_BASE_URL
  = `https://registry.npmmirror.com/-/binary/ffmpeg-static/${FFMPEG_STATIC_TAG}`

/**
 * Minimum wall-clock time a real `<binary> -version` run must take.
 *
 * A stub, a skipped call, or a "resolved path is null" shortcut returns in well
 * under a millisecond; the real binary prints its full configuration in tens of
 * milliseconds. A guard that only checks a return value cannot tell the two apart.
 */
export const FFMPEG_MIN_EXECUTION_MS = 5

/** One prebuilt binary, its upstream archive, and the pinned integrity metadata. */
export interface FfmpegTarget {
  /** Bundle directory key; the runtime resolves `ffmpeg/<key>/<binary>`. */
  readonly key: string
  /** Executable file name inside the bundle directory. */
  readonly binary: string
  /** Container/architecture signature the extracted binary must carry. */
  readonly architecture: string
  /** Upstream compressed archive name. */
  readonly archive: string
  /** SHA-256 of the upstream compressed archive. */
  readonly archiveSha256: string
  /** Upstream license file name, shipped beside the binary. */
  readonly license: string
  /** SHA-256 of the upstream license file. */
  readonly licenseSha256: string
  /** Exact size of the extracted executable in bytes. */
  readonly binaryBytes: number
  /** SHA-256 of the extracted executable. */
  readonly binarySha256: string
}

/**
 * Every redistributed binary, pinned by content hash.
 *
 * Sizes and hashes were taken from the mirror listed in `FFMPEG_DEFAULT_BASE_URL`
 * for tag `b6.1.1`. Re-pinning (a new tag) means updating all four columns at once;
 * `fetchFfmpegBundle` fails loud on any mismatch instead of shipping unknown bytes.
 */
export const FFMPEG_TARGETS = {
  'darwin-arm64': {
    key: 'darwin-arm64',
    binary: 'ffmpeg',
    architecture: 'mach-o:arm64',
    archive: 'ffmpeg-darwin-arm64.gz',
    archiveSha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
    license: 'darwin-arm64.LICENSE',
    licenseSha256: 'cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2',
    binaryBytes: 45_568_216,
    binarySha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
  },
  'darwin-x64': {
    key: 'darwin-x64',
    binary: 'ffmpeg',
    architecture: 'mach-o:x64',
    archive: 'ffmpeg-darwin-x64.gz',
    archiveSha256: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
    license: 'darwin-x64.LICENSE',
    licenseSha256: '2e1d16c72fd74e12063776371da757322f8b77589386532f4fd8634bde7de1af',
    binaryBytes: 78_862_176,
    binarySha256: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
  },
  'win32-x64': {
    key: 'win32-x64',
    binary: 'ffmpeg.exe',
    architecture: 'pe:x64',
    archive: 'ffmpeg-win32-x64.gz',
    archiveSha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
    license: 'win32-x64.LICENSE',
    licenseSha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
    binaryBytes: 82_797_568,
    binarySha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
  },
  'linux-x64': {
    key: 'linux-x64',
    binary: 'ffmpeg',
    architecture: 'elf:x64',
    archive: 'ffmpeg-linux-x64.gz',
    archiveSha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
    license: 'linux-x64.LICENSE',
    licenseSha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
    binaryBytes: 79_826_272,
    binarySha256: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99',
  },
} as const satisfies Readonly<Record<string, FfmpegTarget>>

/** Bundle keys shipped by this product. */
export type FfmpegTargetKey = keyof typeof FFMPEG_TARGETS

/** Lookup table view so callers can index by an arbitrary string key. */
const TARGET_TABLE: Readonly<Record<string, FfmpegTarget>> = FFMPEG_TARGETS

/** Resolve one pinned target, or `undefined` when the key is not shipped. */
export function ffmpegTarget(key: string): FfmpegTarget | undefined {
  return TARGET_TABLE[key]
}

/** Every shipped bundle key, in table order. */
export function ffmpegTargetKeys(): readonly string[] {
  return Object.keys(FFMPEG_TARGETS)
}

/**
 * Resolve the bundle keys a package for one Electron platform/architecture needs.
 * @param platform - Electron platform name (`darwin`, `win32`, `linux`).
 * @param arch - Architecture name, including Electron Builder's `universal`.
 * @returns Required bundle keys in deterministic order.
 */
export function ffmpegTargetsForPlatform(platform: string, arch: string): readonly string[] {
  if (platform === 'darwin' && arch === 'universal') return ['darwin-arm64', 'darwin-x64']
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return [`darwin-${arch}`]
  if (platform === 'win32' && arch === 'x64') return ['win32-x64']
  if (platform === 'linux' && arch === 'x64') return ['linux-x64']
  throw new Error(
    `bundled ffmpeg: no prebuilt binary is shipped for ${platform}/${arch};`
    + ` available targets are ${ffmpegTargetKeys().join(', ')}`,
  )
}

/** Packaging intent used by the fetch CLI and the package scripts. */
export type FfmpegTargetSelection = 'mac' | 'win' | 'host' | 'all'

/**
 * Map a packaging selection to bundle keys.
 * @param selection - Packaging intent; `host` means the machine running the build.
 * @param platform - Host platform used by `host`.
 * @param arch - Host architecture used by `host`.
 * @returns Required bundle keys.
 */
export function ffmpegTargetsForSelection(
  selection: FfmpegTargetSelection,
  platform: string,
  arch: string,
): readonly string[] {
  if (selection === 'mac') return ffmpegTargetsForPlatform('darwin', 'universal')
  if (selection === 'win') return ffmpegTargetsForPlatform('win32', 'x64')
  if (selection === 'host') return ffmpegTargetsForPlatform(platform, arch)
  return ffmpegTargetKeys()
}

/** Bundle root for one desktop package (`build/ffmpeg`). */
export function ffmpegBundleDir(desktopRoot: string): string {
  return join(desktopRoot, 'build', 'ffmpeg')
}

/** SHA-256 of one file, read in bounded chunks so large binaries stay off the heap. */
export function sha256File(path: string): string {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.alloc(4 * 1024 * 1024)
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null)
      if (read <= 0) break
      hash.update(chunk.subarray(0, read))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

/** SHA-256 of an in-memory buffer. */
export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Identify a binary's container and architecture from its header bytes.
 *
 * Structural rather than executable: a universal macOS package holds both an
 * arm64 and an x64 binary, and only one of them can be executed on the build host.
 * @param path - Absolute path to the executable.
 * @returns A signature such as `mach-o:arm64`, `pe:x64`, or `elf:x64`; `undefined` when unknown.
 */
export function binaryArchitecture(path: string): string | undefined {
  const fd = openSync(path, 'r')
  let header: Buffer
  try {
    header = Buffer.alloc(4096)
    const read = readSync(fd, header, 0, header.length, 0)
    header = header.subarray(0, read)
  } finally {
    closeSync(fd)
  }
  if (header.length >= 8 && header.readUInt32LE(0) === 0xfeed_facf) {
    const cpuType = header.readUInt32LE(4)
    if (cpuType === 0x0100_000c) return 'mach-o:arm64'
    if (cpuType === 0x0100_0007) return 'mach-o:x64'
    return 'mach-o:unknown'
  }
  if (header.length >= 0x40 && header.toString('latin1', 0, 2) === 'MZ') {
    const peOffset = header.readUInt32LE(0x3c)
    if (peOffset + 6 <= header.length && header.toString('latin1', peOffset, peOffset + 4) === 'PE\u0000\u0000') {
      const machine = header.readUInt16LE(peOffset + 4)
      if (machine === 0x8664) return 'pe:x64'
      if (machine === 0xaa64) return 'pe:arm64'
      return 'pe:unknown'
    }
    return 'pe:unknown'
  }
  if (header.length >= 0x14 && header.toString('latin1', 0, 4) === '\u007fELF') {
    const machine = header.readUInt16LE(0x12)
    if (machine === 0x3e) return 'elf:x64'
    if (machine === 0xb7) return 'elf:arm64'
    return 'elf:unknown'
  }
  return undefined
}

/** Options accepted by {@link fetchFfmpegBundle}. */
export interface FfmpegFetchOptions {
  /** Destination root; one subdirectory per bundle key is created inside. */
  readonly bundleDir: string
  /** Bundle keys to materialize. */
  readonly keys: readonly string[]
  /** Binary host override; defaults to `FFMPEG_BINARIES_URL` or the pinned mirror. */
  readonly baseUrl?: string
  /** Progress sink. */
  readonly log?: (message: string) => void
  /** Fetch one URL into memory; injectable so focused tests never touch the network. */
  readonly download?: (url: string) => Promise<Buffer>
  /** Target table override; focused tests pin tiny fixtures instead of 44MB binaries. */
  readonly targets?: Readonly<Record<string, FfmpegTarget>>
}

/** Download one URL into memory, rejecting any non-success response. */
async function downloadWithFetch(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `bundled ffmpeg: ${url} responded with ${String(response.status)} ${response.statusText}`,
    )
  }
  return Buffer.from(await response.arrayBuffer())
}

/** Whether one bundle directory already holds the pinned binary and license. */
function isCached(target: FfmpegTarget, dir: string): boolean {
  const binaryPath = join(dir, target.binary)
  const licensePath = join(dir, target.license)
  if (!existsSync(binaryPath) || !existsSync(licensePath)) return false
  if (statSync(binaryPath).size !== target.binaryBytes) return false
  return sha256File(binaryPath) === target.binarySha256
    && sha256File(licensePath) === target.licenseSha256
}

/**
 * Materialize the pinned ffmpeg binaries for the requested targets.
 *
 * Idempotent: an intact, hash-matching directory is reused, so repeated packaging
 * runs and offline rebuilds do not re-download. Any checksum mismatch aborts the
 * build instead of shipping bytes nobody pinned.
 * @param options - Destination, targets, and injectable network boundary.
 */
export async function fetchFfmpegBundle(options: FfmpegFetchOptions): Promise<void> {
  const baseUrl = options.baseUrl ?? process.env.FFMPEG_BINARIES_URL ?? FFMPEG_DEFAULT_BASE_URL
  const download = options.download ?? downloadWithFetch
  const log = options.log ?? ((message: string) => console.log(message))
  const table = options.targets ?? TARGET_TABLE
  for (const key of options.keys) {
    const target = table[key]
    if (target === undefined) {
      throw new Error(`bundled ffmpeg: unknown target ${JSON.stringify(key)}`)
    }
    const dir = join(options.bundleDir, key)
    if (isCached(target, dir)) {
      log(`bundled ffmpeg: ${key} already pinned in ${dir}`)
      continue
    }
    const archiveUrl = `${baseUrl}/${target.archive}`
    log(`bundled ffmpeg: fetching ${key} from ${archiveUrl}`)
    const archive = await download(archiveUrl)
    const archiveDigest = sha256Buffer(archive)
    if (archiveDigest !== target.archiveSha256) {
      throw new Error(
        `bundled ffmpeg: ${target.archive} checksum mismatch;`
        + ` expected ${target.archiveSha256}, received ${archiveDigest}`,
      )
    }
    const binary = gunzipSync(archive)
    if (binary.byteLength !== target.binaryBytes) {
      throw new Error(
        `bundled ffmpeg: ${target.archive} extracted to ${String(binary.byteLength)} bytes;`
        + ` expected ${String(target.binaryBytes)}`,
      )
    }
    const binaryDigest = sha256Buffer(binary)
    if (binaryDigest !== target.binarySha256) {
      throw new Error(
        `bundled ffmpeg: ${target.binary} checksum mismatch;`
        + ` expected ${target.binarySha256}, received ${binaryDigest}`,
      )
    }
    // 目录在**校验通过之后**才创建：失败的下载不留半个空缓存目录，
    // 下次运行必然重新走完整校验，不会把未知字节当成已缓存。
    mkdirSync(dir, { recursive: true })
    const binaryPath = join(dir, target.binary)
    const pendingPath = `${binaryPath}.pending`
    writeFileSync(pendingPath, binary)
    chmodSync(pendingPath, 0o755)
    renameSync(pendingPath, binaryPath)

    const license = await download(`${baseUrl}/${target.license}`)
    const licenseDigest = sha256Buffer(license)
    if (licenseDigest !== target.licenseSha256) {
      throw new Error(
        `bundled ffmpeg: ${target.license} checksum mismatch;`
        + ` expected ${target.licenseSha256}, received ${licenseDigest}`,
      )
    }
    writeFileSync(join(dir, target.license), license)
    log(`bundled ffmpeg: ${key} installed (${String(target.binaryBytes)} bytes)`)
  }
}

/** Result of one executed binary. */
export interface FfmpegRunOutcome {
  /** Process exit code, or `null` when the process was killed by a signal. */
  readonly status: number | null
  /** Captured standard output. */
  readonly stdout: string
  /** Captured standard error. */
  readonly stderr: string
  /** Wall-clock duration in milliseconds. */
  readonly elapsedMs: number
}

/** Options accepted by {@link verifyBundledFfmpeg}. */
export interface FfmpegVerificationOptions {
  /** Directory that must contain one subdirectory per required key. */
  readonly bundleDir: string
  /** Bundle keys the packaged artifact promises to carry. */
  readonly keys: readonly string[]
  /** Host platform, used to decide which binary can actually be executed. */
  readonly platform: string
  /** Host architecture, used to decide which binary can actually be executed. */
  readonly arch: string
  /** Report progress and the reported ffmpeg version. */
  readonly log?: (message: string) => void
  /** Execute one binary; injectable so focused tests never spawn a process. */
  readonly run?: (binary: string, args: readonly string[]) => FfmpegRunOutcome
  /** Target table override; focused tests pin tiny fixtures instead of 44MB binaries. */
  readonly targets?: Readonly<Record<string, FfmpegTarget>>
}

/** Run one executable and capture its output and duration. */
function runBinary(binary: string, args: readonly string[]): FfmpegRunOutcome {
  const startedAt = performance.now()
  const result = spawnSync(binary, [...args], { encoding: 'utf8' })
  const elapsedMs = performance.now() - startedAt
  if (result.error !== undefined) throw result.error
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    elapsedMs,
  }
}

/**
 * Refuse to ship a bundle that is missing, unpinned, truncated, or unrunnable.
 *
 * Every required key is checked for size, content hash, structural architecture,
 * and shipped license text. The host-native binary is additionally executed with
 * `-version`, because a file that exists but cannot run is exactly the failure a
 * file-existence check misses.
 * @param options - Bundle root, required keys, and injectable execution boundary.
 */
export function verifyBundledFfmpeg(options: FfmpegVerificationOptions): void {
  const log = options.log ?? ((message: string) => console.log(message))
  const run = options.run ?? runBinary
  const table = options.targets ?? TARGET_TABLE
  if (options.keys.length === 0) {
    throw new Error('bundled ffmpeg: no target is required for this package; refusing to guess')
  }
  const missing: string[] = []
  for (const key of options.keys) {
    const target = table[key]
    if (target === undefined) {
      throw new Error(`bundled ffmpeg: unknown target ${JSON.stringify(key)}`)
    }
    const dir = join(options.bundleDir, key)
    const binaryPath = join(dir, target.binary)
    const licensePath = join(dir, target.license)
    if (!existsSync(binaryPath)) {
      missing.push(binaryPath)
      continue
    }
    if (!existsSync(licensePath)) {
      missing.push(licensePath)
      continue
    }
    const bytes = statSync(binaryPath).size
    if (bytes !== target.binaryBytes) {
      throw new Error(
        `bundled ffmpeg: ${binaryPath} is ${String(bytes)} bytes; expected ${String(target.binaryBytes)}`,
      )
    }
    const digest = sha256File(binaryPath)
    if (digest !== target.binarySha256) {
      throw new Error(
        `bundled ffmpeg: ${binaryPath} checksum mismatch; expected ${target.binarySha256}, received ${digest}`,
      )
    }
    const licenseDigest = sha256File(licensePath)
    if (licenseDigest !== target.licenseSha256) {
      throw new Error(
        `bundled ffmpeg: ${licensePath} checksum mismatch;`
        + ` expected ${target.licenseSha256}, received ${licenseDigest}`,
      )
    }
    const architecture = binaryArchitecture(binaryPath)
    if (architecture !== target.architecture) {
      throw new Error(
        `bundled ffmpeg: ${binaryPath} is ${String(architecture)}; expected ${target.architecture}`,
      )
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `bundled ffmpeg: packaged resources are missing ${String(missing.length)} file(s): ${missing.join(', ')};`
      + ' run `yarn workspace dsh-plugin-desktop ffmpeg:fetch` before packaging',
    )
  }

  const nativeKey = `${options.platform}-${options.arch}`
  if (!options.keys.includes(nativeKey)) {
    log(`bundled ffmpeg: no executability smoke for this host; verified ${options.keys.join(', ')} structurally`)
    return
  }
  const target = table[nativeKey]
  if (target === undefined) return
  const binaryPath = join(options.bundleDir, nativeKey, target.binary)
  const outcome = run(binaryPath, ['-version'])
  if (outcome.status !== 0) {
    throw new Error(
      `bundled ffmpeg: ${binaryPath} -version exited with ${String(outcome.status)}:`
      + ` ${outcome.stderr.trim().slice(0, 400)}`,
    )
  }
  const reported = /ffmpeg version \S+/u.exec(`${outcome.stdout}${outcome.stderr}`)
  if (reported === null) {
    throw new Error(`bundled ffmpeg: ${binaryPath} -version printed no ffmpeg version banner`)
  }
  if (outcome.elapsedMs < FFMPEG_MIN_EXECUTION_MS) {
    throw new Error(
      `bundled ffmpeg: ${binaryPath} -version finished in ${outcome.elapsedMs.toFixed(2)}ms,`
      + ` faster than a real ffmpeg can start; the smoke did not exercise the binary`,
    )
  }
  log(`bundled ffmpeg: ${nativeKey} reported "${reported[0]}" in ${outcome.elapsedMs.toFixed(0)}ms`)
}
