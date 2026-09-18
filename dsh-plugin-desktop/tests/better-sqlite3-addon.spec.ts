/**
 * Focused tests for the universal `better-sqlite3` addon step.
 *
 * `@electron/universal` aborts the macOS merge when both slices carry the same
 * single-CPU Mach-O, which is exactly what a host-only addon at one fixed path
 * produces. These tests pin the three outcomes and the failure messages without
 * touching the network, `lipo`, or the installed tree.
 */

import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BETTER_SQLITE3_ADDON,
  BETTER_SQLITE3_PACKAGE,
  ensureUniversalAddon,
  UNIVERSAL_ADDON_ARCHES,
  type UniversalAddonOptions,
} from '../scripts/better-sqlite3-addon.ts'

const desktopRoot = '/app'
const nodeExecutable = '/usr/bin/node'
const addonPath = join(desktopRoot, BETTER_SQLITE3_ADDON)
const addonRelativeToPackage = join('build', 'Release', 'better_sqlite3.node')
const seedDirectory = `/scratch/${BETTER_SQLITE3_PACKAGE}`
const fetchedAddon = join(seedDirectory, addonRelativeToPackage)
const lipoArches = UNIVERSAL_ADDON_ARCHES.map(arch => arch.lipoArch)

interface Harness {
  readonly options: UniversalAddonOptions
  readonly calls: readonly string[]
  readonly removed: readonly string[]
  readonly files: Map<string, readonly string[]>
  readonly scratchCreations: { count: number }
}

/**
 * Build one injectable run whose "filesystem" is a path-to-CPU map.
 * @param installed - CPUs the installed addon already carries.
 * @param produceUniversal - Whether `lipo` writes a universal result.
 * @returns The options, the recorded commands, and the simulated files.
 */
function harness(installed: readonly string[], produceUniversal = true): Harness {
  const files = new Map<string, readonly string[]>([[addonPath, installed]])
  const calls: string[] = []
  const removed: string[] = []
  const scratchCreations = { count: 0 }

  const run: UniversalAddonOptions['run'] = (file, args, cwd) => {
    calls.push(`${basename(file)} ${args.join(' ')}`)
    if (args[0]?.endsWith('bin.js') === true) {
      // `prebuild-install` unpacks the requested CPU into the seeded package it
      // runs in, which is the path the module then copies from.
      const arch = args.find(arg => arg.startsWith('--arch='))?.slice('--arch='.length) ?? ''
      const named = UNIVERSAL_ADDON_ARCHES.find(candidate => candidate.nodeArch === arch)
      if (named !== undefined) {
        files.set(join(cwd, addonRelativeToPackage), [named.lipoArch])
      }
      return
    }
    if (basename(file) === 'lipo' && produceUniversal) {
      const output = args[args.indexOf('-output') + 1]
      if (output !== undefined) files.set(output, [...lipoArches])
    }
  }

  return {
    calls,
    removed,
    files,
    scratchCreations,
    options: {
      desktopRoot,
      nodeExecutable,
      archesOf: file => files.get(file) ?? [],
      makeDirectory: () => {},
      copyFile: (from, to) => {
        const value = files.get(from)
        if (value !== undefined) files.set(to, value)
      },
      makeScratchDirectory: () => {
        scratchCreations.count += 1
        return '/scratch'
      },
      removeDirectory: path => removed.push(path),
      run,
      log: message => calls.push(`log ${message}`),
    },
  }
}

describe('universal better-sqlite3 addon', () => {
  it('joins the installed slice with the fetched one and proves it loads', () => {
    const value = harness(['arm64'])

    expect(ensureUniversalAddon(value.options)).toBe('universalized')
    // One fetch, for the CPU the installed build lacks, in the seeded package.
    expect(value.calls.filter(call => call.includes('prebuild-install/bin.js'))).toEqual([
      'node /app/node_modules/prebuild-install/bin.js --platform=darwin --arch=x64 --force',
    ])
    // The fetch lands at the path the module copies the x86_64 slice from.
    expect(value.files.get(fetchedAddon)).toEqual(['x86_64'])
    // Both slices reach lipo, and the merged file replaces the installed addon.
    const lipo = value.calls.find(call => call.startsWith('lipo '))
    expect(lipo).toContain('-create /scratch/better_sqlite3.arm64.node /scratch/better_sqlite3.x86_64.node')
    expect(lipo).toContain('-output /scratch/better_sqlite3.universal.node')
    expect(value.files.get(addonPath)).toEqual([...lipoArches])
    // The load probe runs after the replacement: a merged file that cannot be
    // opened would otherwise reach the merge and fail ten minutes later.
    const probe = value.calls.findIndex(call => call.startsWith('node -e require'))
    expect(probe).toBeGreaterThan(value.calls.findIndex(call => call.startsWith('lipo ')))
    expect(value.calls[probe]).toContain(addonPath)
    expect(value.removed).toEqual(['/scratch'])
  })

  it('stays offline when the addon already carries both CPUs', () => {
    const value = harness([...lipoArches])

    expect(ensureUniversalAddon(value.options)).toBe('already-universal')
    expect(value.calls.filter(call => !call.startsWith('log '))).toEqual([])
    expect(value.scratchCreations.count).toBe(0)
  })

  it('skips a tree without a readable addon instead of failing the build', () => {
    const value = harness([])
    value.files.clear()

    expect(ensureUniversalAddon(value.options)).toBe('absent')
    expect(value.scratchCreations.count).toBe(0)
  })

  it('fails when lipo does not produce both CPUs', () => {
    const value = harness(['arm64'], false)

    expect(() => ensureUniversalAddon(value.options)).toThrow(
      `${addonPath} is missing x86_64 after lipo; received arm64`,
    )
    expect(value.removed).toEqual(['/scratch'])
  })

  it('fails when a fetched slice is not a readable Mach-O', () => {
    const value = harness(['arm64'])
    // A download that produced nothing usable must fail before lipo runs.
    const silentRun: UniversalAddonOptions['run'] = () => {}

    expect(() => ensureUniversalAddon({ ...value.options, run: silentRun })).toThrow(
      'the x86_64 slice is not a readable Mach-O',
    )
    expect(value.removed).toEqual(['/scratch'])
    expect(value.calls.filter(call => call.startsWith('lipo'))).toEqual([])
  })
})
