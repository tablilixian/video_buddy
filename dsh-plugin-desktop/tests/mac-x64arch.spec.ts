/**
 * Guard `build.mac.x64ArchFiles` against every architecture-specific file the
 * macOS application ships.
 *
 * `@electron/universal` aborts the universal merge when a Mach-O file is
 * byte-identical in the x64 and arm64 slices and no `x64ArchFiles` alternative
 * covers it. That happened twice: `@esbuild/darwin-*` arrived with a newer
 * production dependency, and the bundled ffmpeg tree is copied into both slices
 * by design. Both surfaced as an unexplained macOS CI failure ten minutes into
 * packaging, so this spec fails in seconds instead and names the alternative to
 * add.
 *
 * The matcher is the exact `minimatch` instance `@electron/universal` imports,
 * resolved through it, because a lookalike matcher could disagree about the very
 * pattern it is meant to check.
 */

import { closeSync, openSync, readFileSync, readdirSync, readSync } from 'node:fs'
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
  collectArchSpecificNodeModulesFiles,
  describeUncoveredArchSpecificFiles,
  isArchitectureSpecificPackageName,
  isMachOBytes,
  uncoveredArchSpecificFiles,
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

function listDirectories(directory: string): readonly string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
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

function isMachO(file: string): boolean {
  let descriptor: number
  try {
    descriptor = openSync(file, 'r')
  } catch {
    return false
  }
  try {
    const header = Buffer.alloc(4)
    const bytes = readSync(descriptor, header, 0, 4, 0)
    return isMachOBytes(header.subarray(0, bytes))
  } catch {
    return false
  } finally {
    closeSync(descriptor)
  }
}

const closure = productionClosure(join(desktopRoot, 'package.json'))
const nodeModulesFiles = collectArchSpecificNodeModulesFiles({
  packages: closure.packages,
  isMachO,
  listDirectories,
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
const uncovered = uncoveredArchSpecificFiles({
  files: shippedFiles,
  pattern: macPattern,
  matches: matchesAsUniversal,
})

describe('macOS x64ArchFiles coverage', () => {
  it('declares every architecture-specific file the application ships', () => {
    // The message names the alternative to add, so a failure is self-explanatory.
    expect(describeUncoveredArchSpecificFiles(uncovered)).toEqual([])
  })

  it('collects the architecture-specific packages it claims to check', () => {
    const archPackages = closure.packages
      .filter(pkg => isArchitectureSpecificPackageName(pkg.name))
      .map(pkg => pkg.name)

    if (process.platform === 'darwin') {
      // supportedArchitectures installs both Darwin CPUs on macOS; an empty scan
      // would make this guard pass without checking anything.
      expect(archPackages.length).toBeGreaterThan(0)
    }
    if (archPackages.length === 0) {
      expect(nodeModulesFiles).toEqual([])
      return
    }
    expect(nodeModulesFiles.length).toBeGreaterThan(0)
    expect(new Set(nodeModulesFiles.map(file => file.scope)).size).toBeGreaterThan(0)
  })

  it('requires both Darwin slices of the bundled ffmpeg tree to be declared', () => {
    // extraResources copies the whole build/ffmpeg tree into each slice, so the
    // two per-architecture binaries are byte-identical across slices by design.
    expect(bundledFiles.map(file => file.appRelativePath)).toEqual([
      'Contents/Resources/ffmpeg/darwin-arm64/ffmpeg',
      'Contents/Resources/ffmpeg/darwin-x64/ffmpeg',
    ])
    expect(uncoveredArchSpecificFiles({
      files: bundledFiles,
      pattern: macPattern,
      matches: matchesAsUniversal,
    })).toEqual([])
  })

  it('rejects an architecture-specific file that no alternative covers', () => {
    // Proves the guard discriminates instead of accepting everything: a new
    // per-architecture sibling package must fail this spec until it is declared.
    const undeclared = {
      scope: '@newthing/darwin-arm64',
      appRelativePath: 'Contents/Resources/app.asar.unpacked/node_modules/@newthing/darwin-arm64/build/newthing.node',
    }

    const result = uncoveredArchSpecificFiles({
      files: [...shippedFiles, undeclared],
      pattern: macPattern,
      matches: matchesAsUniversal,
    })

    expect(result).toEqual([undeclared])
    expect(describeUncoveredArchSpecificFiles(result)[0])
      .toContain('@newthing/darwin-arm64/build/newthing.node')
  })

  it('reports every file as uncovered when the pattern is absent', () => {
    expect(uncoveredArchSpecificFiles({
      files: shippedFiles,
      pattern: null,
      matches: matchesAsUniversal,
    })).toEqual(shippedFiles)
  })
})

describe('architecture-specific file detection', () => {
  it('recognises Mach-O headers and rejects other content', () => {
    expect(isMachOBytes(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))).toBe(true)
    expect(isMachOBytes(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))).toBe(true)
    // A shebang-driven ripgrep build or a JSON file must never look like Mach-O.
    expect(isMachOBytes(Buffer.from('#!/bin/sh\n', 'utf8'))).toBe(false)
    expect(isMachOBytes(Buffer.from('{\n', 'utf8'))).toBe(false)
    expect(isMachOBytes(Buffer.alloc(0))).toBe(false)
    expect(isMachOBytes(Buffer.from([0xcf, 0xfa]))).toBe(false)
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
