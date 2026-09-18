/**
 * Guard `build.mac.x64ArchFiles` against the Mach-O files the macOS merge compares.
 *
 * `@electron/universal` aborts when a Mach-O file has the same SHA in the x64 and
 * the arm64 slice and no `x64ArchFiles` alternative covers it. Four binaries
 * arrived that way, each surfacing as an unexplained macOS CI failure ten minutes
 * into packaging: `@esbuild/darwin-*` with a newer production dependency, the
 * bundled ffmpeg tree `extraResources` copies into both slices by design,
 * `onnxruntime-node` nesting one directory per platform, and `better-sqlite3`,
 * whose addon has no CPU in its path at all and is instead turned universal by
 * the packaging prepare step. This spec fails in seconds and names the
 * alternative to add.
 *
 * The matcher and the Mach-O classification are the ones `@electron/universal`
 * itself uses, because a lookalike could disagree about the very rule it checks.
 */

import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ffmpegTarget,
  ffmpegTargetsForPlatform,
} from '../scripts/ffmpeg-bundle.ts'
import {
  collectArchSpecificBundledFiles,
  collectCrossSliceFiles,
  describeUncoveredCrossSliceFiles,
  isArchitectureSpecificPackageName,
  isMachOBytes,
  isUniversalMachOBytes,
  PREPARED_UNIVERSAL_FILES,
  UNPACKED_RUNTIME_PREFIX,
  uncoveredCrossSliceFiles,
} from '../scripts/mac-x64arch.ts'
import { productionClosure } from '../scripts/production-graph.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

interface DesktopBuildManifest {
  readonly build: {
    readonly mac: { readonly x64ArchFiles?: string | null }
    readonly extraResources: readonly { readonly from: string; readonly to: string }[]
  }
}

const manifest = JSON.parse(
  readFileSync(join(desktopRoot, 'package.json'), 'utf8'),
) as DesktopBuildManifest
const macPattern = manifest.build.mac.x64ArchFiles
const bundleTo = manifest.build.extraResources[0]?.to ?? 'ffmpeg'

const requireFromUniversal = createRequire(
  createRequire(import.meta.url).resolve('@electron/universal'),
)
const universalMatcher = requireFromUniversal('minimatch') as {
  minimatch: (path: string, pattern: string, options: { matchBase: boolean }) => boolean
}

/** Apply the pattern exactly as `@electron/universal` applies it. */
function matchesAsUniversal(path: string, pattern: string): boolean {
  return universalMatcher.minimatch(path, pattern, { matchBase: true })
}

function listFilesRecursively(directory: string): readonly string[] {
  const found: string[] = []
  const pending: string[] = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) found.push(path)
    }
  }
  return found
}

/** Read the leading bytes of a file, or nothing when it cannot be read. */
function leadingBytes(file: string): Buffer {
  let descriptor: number
  try {
    descriptor = openSync(file, 'r')
  } catch {
    return Buffer.alloc(0)
  }
  try {
    const header = Buffer.alloc(4)
    const bytes = readSync(descriptor, header, 0, 4, 0)
    return header.subarray(0, bytes)
  } catch {
    return Buffer.alloc(0)
  } finally {
    closeSync(descriptor)
  }
}

/** Exactly the classification universal applies before it compares SHAs. */
function isThinMachO(file: string): boolean {
  const bytes = leadingBytes(file)
  return isMachOBytes(bytes) && !isUniversalMachOBytes(bytes)
}

const closure = productionClosure(join(desktopRoot, 'package.json'))
const nodeModulesFiles = collectCrossSliceFiles({
  packages: closure.packages,
  isThinMachO,
  listFilesRecursively,
})
const bundledFiles = collectArchSpecificBundledFiles({
  bundleTo,
  targets: ffmpegTargetsForPlatform('darwin', 'universal').map(key => {
    const target = ffmpegTarget(key)
    if (target === undefined) throw new Error(`no pinned ffmpeg target is declared for ${key}`)
    return target
  }),
})
const shippedFiles = [...nodeModulesFiles, ...bundledFiles]
const coverageOptions = {
  files: shippedFiles,
  pattern: macPattern,
  matches: matchesAsUniversal,
  prepared: PREPARED_UNIVERSAL_FILES,
}
const uncovered = uncoveredCrossSliceFiles(coverageOptions)

describe('macOS x64ArchFiles coverage', () => {
  it('gives every shipped Mach-O file a declaration or a preparation', () => {
    // The message names the alternative to add, so a failure is self-explanatory.
    expect(describeUncoveredCrossSliceFiles(uncovered)).toEqual([])
  })

  it('collects the files it claims to check', () => {
    if (process.platform === 'darwin') {
      // supportedArchitectures installs both Darwin CPUs on macOS; an empty scan
      // would make this guard pass without checking anything.
      const archPackages = closure.packages
        .filter(pkg => isArchitectureSpecificPackageName(pkg.name))
      expect(archPackages.length).toBeGreaterThan(0)
    }
    // A package that nests its own per-CPU trees — node-pty's `prebuilds/`,
    // onnxruntime-node's platform directories — ships them on every host, so the
    // scan never depends on which siblings Yarn happened to install here.
    expect(nodeModulesFiles.length).toBeGreaterThan(0)
    expect(nodeModulesFiles.some(file => file.appRelativePath.includes('/prebuilds/darwin-')))
      .toBe(true)
  })

  it('points every prepared exemption at a real Darwin addon', () => {
    // An exemption for a path nothing installs would silently excuse the next
    // single-CPU binary that lands there.
    if (process.platform !== 'darwin') return
    for (const appRelativePath of PREPARED_UNIVERSAL_FILES) {
      const installed = join(
        desktopRoot,
        appRelativePath.slice(`${UNPACKED_RUNTIME_PREFIX}/`.length),
      )
      expect(existsSync(installed)).toBe(true)
      expect(isMachOBytes(leadingBytes(installed))).toBe(true)
    }
  })

  it('collects a package that nests one directory per platform', () => {
    const nested = nodeModulesFiles
      .filter(file => file.owner === 'onnxruntime-node')
    if (!closure.packages.some(pkg => pkg.name === 'onnxruntime-node')) return
    // onnxruntime-node publishes one package for every platform and separates them
    // by directory, so no package name carries the CPU.
    expect(nested.length).toBeGreaterThan(0)
    expect(nested.every(file => file.appRelativePath.includes('/bin/napi-v6/darwin/arm64/')))
      .toBe(true)
    expect(uncoveredCrossSliceFiles({ ...coverageOptions, files: nested })).toEqual([])
  })

  it('requires both Darwin slices of the bundled ffmpeg tree to be declared', () => {
    // extraResources copies the whole build/ffmpeg tree into each slice, so the
    // two per-architecture binaries are byte-identical across slices by design.
    expect(bundledFiles.map(file => file.appRelativePath)).toEqual([
      'Contents/Resources/ffmpeg/darwin-arm64/ffmpeg',
      'Contents/Resources/ffmpeg/darwin-x64/ffmpeg',
    ])
    expect(uncoveredCrossSliceFiles({ ...coverageOptions, files: bundledFiles })).toEqual([])
  })

  it('rejects a Mach-O file that neither an alternative nor a preparation covers', () => {
    // Proves the guard discriminates instead of accepting everything: a new native
    // dependency must fail this spec until it is declared or prepared.
    const undeclared = {
      owner: '@newthing/darwin-arm64',
      appRelativePath: 'Contents/Resources/app.asar.unpacked/node_modules/@newthing/darwin-arm64/build/newthing.node',
    }

    const result = uncoveredCrossSliceFiles({
      ...coverageOptions,
      files: [...shippedFiles, undeclared],
    })

    expect(result).toEqual([undeclared])
    expect(describeUncoveredCrossSliceFiles(result)[0])
      .toContain('@newthing/darwin-arm64/build/newthing.node')
  })

  it('exempts prepared files even when no alternative is configured', () => {
    const prepared = new Set<string>(PREPARED_UNIVERSAL_FILES)
    const result = uncoveredCrossSliceFiles({ ...coverageOptions, pattern: null })

    // Without a pattern every other shipped Mach-O has to be reported...
    expect(result).toEqual(shippedFiles.filter(file => !prepared.has(file.appRelativePath)))
    // ...while a prepared path stays exempt by design, not merely because the
    // installed addon happens to be universal already.
    const synthetic = { owner: 'better-sqlite3', appRelativePath: PREPARED_UNIVERSAL_FILES[0] }
    expect(uncoveredCrossSliceFiles({
      ...coverageOptions,
      pattern: null,
      files: [synthetic],
    })).toEqual([])
  })
})

describe('Mach-O header detection', () => {
  it('recognises thin and universal headers and rejects other content', () => {
    expect(isMachOBytes(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe(true)
    expect(isMachOBytes(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))).toBe(true)
    // A shebang-driven ripgrep build or a JSON file must never look like Mach-O.
    expect(isMachOBytes(Buffer.from('#!/bin/sh\n', 'utf8'))).toBe(false)
    expect(isMachOBytes(Buffer.from('{\n', 'utf8'))).toBe(false)
    expect(isMachOBytes(Buffer.alloc(0))).toBe(false)
    expect(isMachOBytes(Buffer.from([0xcf, 0xfa]))).toBe(false)
  })

  it('separates an already universal binary from a thin one', () => {
    // Universal skips a file that already carries both CPUs, so it needs no
    // declaration; treating it as thin would demand one for the serialized fsevents
    // prebuild alone.
    expect(isUniversalMachOBytes(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))).toBe(true)
    expect(isUniversalMachOBytes(Buffer.from([0xbe, 0xba, 0xfe, 0xca]))).toBe(true)
    expect(isUniversalMachOBytes(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe(false)
    expect(isUniversalMachOBytes(Buffer.from('MZ', 'ascii'))).toBe(false)
  })

  it('only treats Darwin CPU variants as slice-specific names', () => {
    expect(isArchitectureSpecificPackageName('darwin-arm64')).toBe(true)
    expect(isArchitectureSpecificPackageName('@esbuild/darwin-x64')).toBe(true)
    expect(isArchitectureSpecificPackageName('@img/sharp-libvips-darwin-arm64')).toBe(true)
    expect(isArchitectureSpecificPackageName('darwin-arm64-extra')).toBe(false)
    expect(isArchitectureSpecificPackageName('node-pty')).toBe(false)
    expect(isArchitectureSpecificPackageName('win32-x64')).toBe(false)
  })
})
