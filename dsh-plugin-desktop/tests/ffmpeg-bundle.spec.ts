import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FFMPEG_MIN_EXECUTION_MS,
  FFMPEG_TARGETS,
  binaryArchitecture,
  fetchFfmpegBundle,
  ffmpegTarget,
  ffmpegTargetsForPlatform,
  ffmpegTargetsForSelection,
  sha256Buffer,
  verifyBundledFfmpeg,
  type FfmpegRunOutcome,
  type FfmpegTarget,
  type FfmpegVerificationOptions,
} from '../scripts/ffmpeg-bundle.ts'

const tempDirs: string[] = []

function useTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ffmpeg-bundle-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Build a minimal, structurally valid executable header for one architecture. */
function binaryFixture(architecture: string, size = 2048): Buffer {
  const bytes = Buffer.alloc(size)
  if (architecture.startsWith('mach-o')) {
    bytes.writeUInt32LE(0xfeed_facf, 0)
    bytes.writeUInt32LE(architecture === 'mach-o:arm64' ? 0x0100_000c : 0x0100_0007, 4)
    return bytes
  }
  if (architecture.startsWith('pe')) {
    bytes.write('MZ', 0, 'latin1')
    bytes.writeUInt32LE(0x40, 0x3c)
    bytes.write('PE\u0000\u0000', 0x40, 'latin1')
    bytes.writeUInt16LE(architecture === 'pe:arm64' ? 0xaa64 : 0x8664, 0x44)
    return bytes
  }
  if (architecture.startsWith('elf')) {
    bytes.write('\u007fELF', 0, 'latin1')
    bytes.writeUInt16LE(architecture === 'elf:arm64' ? 0xb7 : 0x3e, 0x12)
    return bytes
  }
  throw new Error(`unsupported fixture architecture ${architecture}`)
}

/** Pinned metadata for one tiny fixture, so gates can be exercised without 44MB files. */
function fixtureTarget(architecture = 'mach-o:arm64', key = 'darwin-arm64'): FfmpegTarget {
  const binary = binaryFixture(architecture, 2048)
  const license = Buffer.from('license fixture\n')
  return {
    key,
    binary: key.startsWith('win32') ? 'ffmpeg.exe' : 'ffmpeg',
    architecture,
    archive: `ffmpeg-${key}.gz`,
    archiveSha256: sha256Buffer(Buffer.from('archive fixture')),
    license: `${key}.LICENSE`,
    licenseSha256: sha256Buffer(license),
    binaryBytes: binary.byteLength,
    binarySha256: sha256Buffer(binary),
  }
}

interface Fixture {
  readonly bundleDir: string
  readonly target: FfmpegTarget
  readonly binaryPath: string
}

/** Materialize one bundle key with tiny fixtures and matching pinned metadata. */
function makeFixture(architecture = 'mach-o:arm64', key = 'darwin-arm64'): Fixture {
  const bundleDir = useTempDir()
  const target = fixtureTarget(architecture, key)
  const dir = join(bundleDir, key)
  mkdirSync(dir, { recursive: true })
  const binaryPath = join(dir, target.binary)
  writeFileSync(binaryPath, binaryFixture(architecture, 2048))
  chmodSync(binaryPath, 0o755)
  writeFileSync(join(dir, target.license), 'license fixture\n')
  return { bundleDir, target, binaryPath }
}

/** One executing binary; the seam focused tests replace with a mock. */
type RunSeam = (binary: string, args: readonly string[]) => FfmpegRunOutcome

/** Overrides a single test may apply on top of the passing baseline. */
interface VerifyOverrides {
  readonly keys?: readonly string[]
  readonly arch?: string
  readonly targets?: Readonly<Record<string, FfmpegTarget>>
  readonly log?: (message: string) => void
  readonly run?: RunSeam
}

/** Verification inputs that pass unless a test overrides them. */
function verifyOptions(
  fixture: Fixture,
  overrides: VerifyOverrides = {},
): FfmpegVerificationOptions & { readonly run: ReturnType<typeof vi.fn<RunSeam>> } {
  return {
    bundleDir: fixture.bundleDir,
    keys: overrides.keys ?? [fixture.target.key],
    platform: 'darwin',
    arch: overrides.arch ?? 'arm64',
    targets: overrides.targets ?? { [fixture.target.key]: fixture.target },
    log: overrides.log ?? (() => undefined),
    run: vi.fn<RunSeam>(overrides.run ?? (() => ({
      status: 0,
      stdout: 'ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers\n',
      stderr: '',
      elapsedMs: 42,
    }))),
  }
}

describe('bundled ffmpeg target selection', () => {
  it('covers both macOS architectures for a universal package', () => {
    expect(ffmpegTargetsForPlatform('darwin', 'universal')).toEqual(['darwin-arm64', 'darwin-x64'])
    expect(ffmpegTargetsForPlatform('darwin', 'arm64')).toEqual(['darwin-arm64'])
    expect(ffmpegTargetsForPlatform('darwin', 'x64')).toEqual(['darwin-x64'])
    expect(ffmpegTargetsForPlatform('win32', 'x64')).toEqual(['win32-x64'])
  })

  it('rejects a platform it cannot cover instead of shipping a package without ffmpeg', () => {
    expect(() => ffmpegTargetsForPlatform('darwin', 'ia32')).toThrow('no prebuilt binary is shipped')
    expect(() => ffmpegTargetsForPlatform('win32', 'arm64')).toThrow('no prebuilt binary is shipped')
  })

  it('maps packaging selections onto the pinned table', () => {
    expect(ffmpegTargetsForSelection('host', 'darwin', 'arm64')).toEqual(['darwin-arm64'])
    expect(ffmpegTargetsForSelection('mac', 'win32', 'x64')).toEqual(['darwin-arm64', 'darwin-x64'])
    expect(ffmpegTargetsForSelection('win', 'darwin', 'arm64')).toEqual(['win32-x64'])
    expect(ffmpegTargetsForSelection('all', 'darwin', 'arm64')).toEqual(Object.keys(FFMPEG_TARGETS))
  })

  it('pins every shipped binary by content hash', () => {
    for (const [key, target] of Object.entries(FFMPEG_TARGETS)) {
      expect(target.key).toBe(key)
      expect(target.archiveSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(target.binarySha256).toMatch(/^[0-9a-f]{64}$/)
      expect(target.licenseSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(target.binaryBytes).toBeGreaterThan(1_000_000)
      expect(ffmpegTarget(key)).toBe(target)
    }
    expect(ffmpegTarget('darwin-mips')).toBeUndefined()
  })
})

describe('binary architecture sniffing', () => {
  it.each([
    'mach-o:arm64',
    'mach-o:x64',
    'pe:x64',
    'elf:x64',
  ])('identifies a %s header without executing it', (architecture) => {
    const path = join(useTempDir(), 'fixture.bin')
    writeFileSync(path, binaryFixture(architecture))
    expect(binaryArchitecture(path)).toBe(architecture)
  })

  it('reports undefined for a file that is not an executable image', () => {
    const path = join(useTempDir(), 'fixture.bin')
    writeFileSync(path, 'not an executable at all\n')
    expect(binaryArchitecture(path)).toBeUndefined()
  })
})

describe('bundled ffmpeg packaging gate', () => {
  it('verifies an intact bundle and executes the host binary exactly once', () => {
    const fixture = makeFixture()
    const logs: string[] = []
    const options = verifyOptions(fixture, { log: (message: string) => logs.push(message) })

    verifyBundledFfmpeg(options)

    expect(options.run).toHaveBeenCalledTimes(1)
    expect(options.run.mock.calls[0]?.[0]).toBe(fixture.binaryPath)
    expect(options.run.mock.calls[0]?.[1]).toEqual(['-version'])
    expect(logs.some(line => line.includes('ffmpeg version 6.0'))).toBe(true)
  })

  it('rejects an instant "-version" that proves the binary never ran', () => {
    const fixture = makeFixture()
    const run = vi.fn(() => ({
      status: 0,
      stdout: 'ffmpeg version 6.0\n',
      stderr: '',
      elapsedMs: FFMPEG_MIN_EXECUTION_MS / 10,
    }))

    expect(() => verifyBundledFfmpeg(verifyOptions(fixture, { run })))
      .toThrow('did not exercise the binary')
  })

  it('rejects a binary that cannot print its version', () => {
    const fixture = makeFixture()
    const run = vi.fn(() => ({ status: 1, stdout: '', stderr: 'bad CPU type', elapsedMs: 20 }))

    expect(() => verifyBundledFfmpeg(verifyOptions(fixture, { run })))
      .toThrow('-version exited with 1: bad CPU type')
  })

  it('rejects a missing bundled binary and names the fetch script', () => {
    const fixture = makeFixture()
    rmSync(join(fixture.bundleDir, fixture.target.key), { recursive: true, force: true })

    expect(() => verifyBundledFfmpeg(verifyOptions(fixture))).toThrow('ffmpeg:fetch')
  })

  it('rejects a truncated binary by size', () => {
    const fixture = makeFixture()
    writeFileSync(fixture.binaryPath, binaryFixture('mach-o:arm64', 1024))

    expect(() => verifyBundledFfmpeg(verifyOptions(fixture))).toThrow('bytes; expected')
  })

  it('rejects a tampered binary whose size still matches', () => {
    const fixture = makeFixture()
    const tampered = Buffer.from(readFileSync(fixture.binaryPath))
    tampered.writeUInt8(0xff, tampered.length - 1)
    writeFileSync(fixture.binaryPath, tampered)

    expect(() => verifyBundledFfmpeg(verifyOptions(fixture))).toThrow('checksum mismatch')
  })

  it('rejects a bundled binary whose architecture is not the pinned one', () => {
    const fixture = makeFixture()
    const declared: FfmpegTarget = { ...fixture.target, architecture: 'mach-o:x64' }

    expect(() => verifyBundledFfmpeg(verifyOptions(fixture, {
      targets: { [fixture.target.key]: declared },
    }))).toThrow('expected mach-o:x64')
  })

  it('rejects a missing license file beside the binary', () => {
    const fixture = makeFixture()
    rmSync(join(fixture.bundleDir, fixture.target.key, fixture.target.license))

    expect(() => verifyBundledFfmpeg(verifyOptions(fixture))).toThrow(fixture.target.license)
  })

  it('skips the execution smoke for a binary this host cannot run', () => {
    const fixture = makeFixture('mach-o:x64', 'darwin-x64')
    const logs: string[] = []
    const options = verifyOptions(fixture, {
      arch: 'arm64',
      log: (message: string) => logs.push(message),
    })

    verifyBundledFfmpeg(options)

    expect(options.run).not.toHaveBeenCalled()
    expect(logs.some(line => line.includes('structurally'))).toBe(true)
  })

  it('refuses to verify an empty target list', () => {
    expect(() => verifyBundledFfmpeg(verifyOptions(makeFixture(), { keys: [] })))
      .toThrow('refusing to guess')
  })

  it('rejects an unpinned target key', () => {
    expect(() => verifyBundledFfmpeg(verifyOptions(makeFixture(), {
      keys: ['plan9-mips'],
      targets: {},
    }))).toThrow('unknown target "plan9-mips"')
  })
})

describe('bundled ffmpeg fetching', () => {
  interface FetchFixture {
    readonly bundleDir: string
    readonly target: FfmpegTarget
    readonly download: ReturnType<typeof vi.fn<(url: string) => Promise<Buffer>>>
  }

  function fetchFixture(overrides: Partial<FfmpegTarget> = {}): FetchFixture {
    const bundleDir = useTempDir()
    const binary = binaryFixture('mach-o:arm64', 2048)
    const archive = gzipSync(binary)
    const license = Buffer.from('license fixture\n')
    const target: FfmpegTarget = {
      key: 'darwin-arm64',
      binary: 'ffmpeg',
      architecture: 'mach-o:arm64',
      archive: 'ffmpeg-darwin-arm64.gz',
      archiveSha256: sha256Buffer(archive),
      license: 'darwin-arm64.LICENSE',
      licenseSha256: sha256Buffer(license),
      binaryBytes: binary.byteLength,
      binarySha256: sha256Buffer(binary),
      ...overrides,
    }
    const download = vi.fn((url: string): Promise<Buffer> => {
      if (url.endsWith('.gz')) return Promise.resolve(archive)
      if (url.endsWith('.LICENSE')) return Promise.resolve(license)
      return Promise.reject(new Error(`unexpected URL ${url}`))
    })
    return { bundleDir, target, download }
  }

  it('installs an executable binary and its license, then reuses the cache', async () => {
    const { bundleDir, target, download } = fetchFixture()
    const logs: string[] = []
    const options = {
      bundleDir,
      keys: [target.key],
      baseUrl: 'https://example.test/ffmpeg',
      targets: { [target.key]: target },
      download,
      log: (message: string) => logs.push(message),
    }

    await fetchFfmpegBundle(options)

    const binaryPath = join(bundleDir, target.key, target.binary)
    expect(sha256Buffer(readFileSync(binaryPath))).toBe(target.binarySha256)
    expect(statSync(binaryPath).mode & 0o111).not.toBe(0)
    expect(existsSync(join(bundleDir, target.key, target.license))).toBe(true)
    expect(download.mock.calls.map(([url]) => url)).toEqual([
      'https://example.test/ffmpeg/ffmpeg-darwin-arm64.gz',
      'https://example.test/ffmpeg/darwin-arm64.LICENSE',
    ])

    await fetchFfmpegBundle(options)

    expect(download).toHaveBeenCalledTimes(2)
    expect(logs.some(line => line.includes('already pinned'))).toBe(true)
  })

  it('aborts when the downloaded archive is not the pinned release', async () => {
    const { bundleDir, target, download } = fetchFixture({ archiveSha256: 'f'.repeat(64) })

    await expect(fetchFfmpegBundle({
      bundleDir,
      keys: [target.key],
      targets: { [target.key]: target },
      download,
      log: () => undefined,
    })).rejects.toThrow('checksum mismatch')
    expect(readdirSync(bundleDir)).toEqual([])
  })

  it('aborts when the extracted binary is not the pinned size', async () => {
    const { bundleDir, target, download } = fetchFixture()
    const mismatched: FfmpegTarget = { ...target, binaryBytes: target.binaryBytes + 1 }

    await expect(fetchFfmpegBundle({
      bundleDir,
      keys: [target.key],
      targets: { [target.key]: mismatched },
      download,
      log: () => undefined,
    })).rejects.toThrow('extracted to')
    expect(existsSync(join(bundleDir, target.key, target.binary))).toBe(false)
  })

  it('rejects an unpinned target key before touching the network', async () => {
    const download = vi.fn<(url: string) => Promise<Buffer>>()

    await expect(fetchFfmpegBundle({
      bundleDir: useTempDir(),
      keys: ['plan9-mips'],
      targets: {},
      download,
      log: () => undefined,
    })).rejects.toThrow('unknown target "plan9-mips"')
    expect(download).not.toHaveBeenCalled()
  })
})
