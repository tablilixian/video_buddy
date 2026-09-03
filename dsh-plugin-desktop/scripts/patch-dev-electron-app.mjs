/** Patch the dev Electron.app bundle so macOS shows the VideoBuddy name and Dock icon. */

import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** User-visible product name shown in the macOS Dock and task switcher. */
export const DEV_APP_BUNDLE_NAME = 'VideoBuddy'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Run a command and resolve with stdout, rejecting on a non-zero exit code.
 * @param {string} file - executable to launch.
 * @param {readonly string[]} args - command arguments.
 * @returns {Promise<string>} command stdout.
 */
function run(file, args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolveExit(stdout)
      else reject(new Error(`patch-dev-electron-app: ${basename(file)} exited with code ${code}`))
    })
  })
}

/**
 * Check whether a path exists.
 * @param {string} target - absolute path to probe.
 * @returns {Promise<boolean>} true when the path exists.
 */
async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

/**
 * Locate the unpackaged Electron.app used for dev launches.
 * @returns {Promise<string|null>} absolute path to Electron.app, or null when electron is absent.
 */
async function locateElectronApp() {
  const candidates = [
    join(packageRoot, 'node_modules', 'electron', 'dist', 'Electron.app'),
    join(dirname(packageRoot), 'node_modules', 'electron', 'dist', 'Electron.app'),
  ]
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  return null
}

/**
 * Rewrite the bundle display name entries in the Electron.app Info.plist.
 * @param {string} appBundle - absolute path to Electron.app.
 * @returns {Promise<boolean>} true when the plist was modified.
 */
async function patchBundleName(appBundle) {
  const plistPath = join(appBundle, 'Contents', 'Info.plist')
  const raw = await run('plutil', ['-convert', 'json', '-o', '-', plistPath])
  const plist = JSON.parse(raw)
  if (plist.CFBundleName === DEV_APP_BUNDLE_NAME && plist.CFBundleDisplayName === DEV_APP_BUNDLE_NAME) {
    return false
  }
  await run('plutil', ['-replace', 'CFBundleName', '-string', DEV_APP_BUNDLE_NAME, plistPath])
  await run('plutil', ['-replace', 'CFBundleDisplayName', '-string', DEV_APP_BUNDLE_NAME, plistPath])
  return true
}

/**
 * Rebuild the bundle icon (electron.icns) from the generated macOS app icon.
 * @param {string} appBundle - absolute path to Electron.app.
 * @param {string} sourcePng - absolute path to the 1024px macOS icon PNG.
 * @returns {Promise<boolean>} true when a new icns was installed.
 */
async function patchBundleIcon(appBundle, sourcePng) {
  if (!(await exists(sourcePng))) return false
  const icnsPath = join(appBundle, 'Contents', 'Resources', 'electron.icns')
  if (await exists(icnsPath)) {
    const [iconTime, sourceTime] = await Promise.all([stat(icnsPath), stat(sourcePng)])
    if (iconTime.mtimeMs >= sourceTime.mtimeMs) return false
  }

  const workDir = await mkdtemp(join(tmpdir(), 'dsh-electron-icon-'))
  try {
    const iconsetDir = join(workDir, 'app.iconset')
    await mkdir(iconsetDir)
    const sizes = [16, 32, 64, 128, 256, 512, 1024]
    for (const size of sizes) {
      await run('sips', ['-s', 'format', 'png', '-z', String(size), String(size), sourcePng, '--out', join(iconsetDir, `icon_${size}x${size}.png`)])
      if (size <= 512) {
        await run('sips', ['-s', 'format', 'png', '-z', String(size), String(size), sourcePng, '--out', join(iconsetDir, `icon_${size / 2}x${size / 2}@2x.png`)])
      }
    }
    const builtPath = join(workDir, 'app.icns')
    await run('iconutil', ['-c', 'icns', iconsetDir, '-o', builtPath])
    await copyFile(builtPath, icnsPath)
    return true
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/**
 * Patch the local dev Electron bundle. No-op on non-macOS or when electron is not installed.
 * @returns {Promise<void>} resolves after the bundle has been patched.
 */
export async function patchDevElectronApp() {
  if (process.platform !== 'darwin') return
  const appBundle = await locateElectronApp()
  if (appBundle === null) {
    process.stdout.write('patch-dev-electron-app: electron is not installed; skipping bundle patch\n')
    return
  }
  const renamed = await patchBundleName(appBundle)
  const iconSource = join(packageRoot, 'build', 'app-icon-mac.png')
  const iconPatched = await patchBundleIcon(appBundle, iconSource)
  if (renamed || iconPatched) {
    process.stdout.write(`patch-dev-electron-app: patched dev Electron bundle (name renamed=${renamed}, icon updated=${iconPatched})\n`)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await patchDevElectronApp()
}
