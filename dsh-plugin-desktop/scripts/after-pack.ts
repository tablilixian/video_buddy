/**
 * Electron Builder `afterPack` entry: verify the sealed runtime, then verify that
 * the bundled ffmpeg binaries actually shipped and can run.
 *
 * Kept separate from `verify-packaged-runtime.ts` so each gate owns one concern and
 * its own focused tests: the runtime closure lives in `app.asar(.unpacked)`, while
 * the bundled ffmpeg lives beside it in the platform resources root.
 *
 * @module scripts/after-pack
 */

import { dirname, join } from 'node:path'
import {
  afterPack as verifyPackagedRuntime,
  resolvePackagedAsarPath,
  type PackagedRuntimeContext,
} from './verify-packaged-runtime.ts'
import { ffmpegTargetsForPlatform, verifyBundledFfmpeg } from './ffmpeg-bundle.ts'

/** Electron Builder's `Arch` enum values, mapped to Node architecture names. */
const ELECTRON_ARCH_NAMES: Readonly<Record<number, string>> = {
  0: 'ia32',
  1: 'x64',
  2: 'arm',
  3: 'arm64',
  4: 'universal',
}

/**
 * Resolve the architecture one package is being built for.
 * @param context - Electron Builder's afterPack context.
 * @returns Node architecture name, including `universal` for a merged macOS app.
 */
export function packagedArchName(context: PackagedRuntimeContext): string {
  const arch = context.arch
  const name = arch === undefined ? undefined : ELECTRON_ARCH_NAMES[arch]
  if (name === undefined) {
    throw new Error(
      `dsh-plugin-desktop: unsupported Electron pack architecture ${String(arch)}`,
    )
  }
  return name
}

/**
 * Resolve the platform resources root that also receives `extraResources`.
 * @param context - Electron Builder's afterPack context.
 * @returns `Contents/Resources` on macOS, `resources` on Windows and Linux.
 */
export function resolvePackagedResourcesRoot(context: PackagedRuntimeContext): string {
  return dirname(resolvePackagedAsarPath(context))
}

/**
 * Run every packaged-artifact gate before signing begins.
 * @param context - Electron Builder's afterPack context.
 * @returns A promise that rejects when the artifact is incomplete or unpinned.
 */
export async function afterPack(context: PackagedRuntimeContext): Promise<void> {
  await verifyPackagedRuntime(context)
  verifyBundledFfmpeg({
    bundleDir: join(resolvePackagedResourcesRoot(context), 'ffmpeg'),
    keys: ffmpegTargetsForPlatform(context.electronPlatformName, packagedArchName(context)),
    platform: process.platform,
    arch: process.arch,
  })
}

export default afterPack
