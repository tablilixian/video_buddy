/**
 * Verify every production dependency shipped inside the desktop installers
 * carries a permissive license that allows redistribution.
 *
 * Walks the production dependency graph (dependencies + optionalDependencies,
 * excluding dev/peer) starting from this package manifest. Fails when a
 * package has no license field and no LICENSE file, or when its license is not
 * one the policy accepts. The policy itself, including how an `OR` expression
 * is read, lives in `license-policy.ts` so it can be unit tested.
 *
 * @module scripts/verify-licenses
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FFMPEG_STATIC_TAG, FFMPEG_STATIC_VERSION } from './ffmpeg-bundle.ts'
import { licenseAccepted, noticeRequired } from './license-policy.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const rootManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

/**
 * Locate one installed package manifest by walking node_modules directories
 * upward from the parent manifest. Reads the real package.json regardless of
 * the package's `exports` map, which often hides the `./package.json` subpath.
 */
function resolvePackageManifest(name, fromManifestPath) {
  const segments = name.split('/')
  const folder = name.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  const entry = name.startsWith('@') ? segments.slice(2).join('/') : segments.slice(1).join('/')
  let dir = dirname(fromManifestPath)
  for (;;) {
    const candidate = join(dir, 'node_modules', folder, entry, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** Normalize the license field of one package manifest. */
function licenseExpression(manifest) {
  const value = manifest.license
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && typeof value.type === 'string') return value.type
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses
      .map((item) => (typeof item === 'string' ? item : item.type))
      .filter(Boolean)
      .join(' OR ')
  }
  return undefined
}

const failures = []
const seen = new Set()
const manifests = []
const queue = [{ name: rootManifest.name ?? 'dsh-plugin-desktop', manifestPath: join(packageRoot, 'package.json') }]

for (let index = 0; index < queue.length; index += 1) {
  const current = queue[index]
  if (current === undefined || seen.has(current.name)) continue
  seen.add(current.name)
  const manifest = JSON.parse(readFileSync(current.manifestPath, 'utf8'))

  if (current.name !== rootManifest.name) {
    const license = licenseExpression(manifest)
    const hasLicenseFile = existsSync(join(dirname(current.manifestPath), 'LICENSE'))
      || existsSync(join(dirname(current.manifestPath), 'LICENSE.md'))
      || existsSync(join(dirname(current.manifestPath), 'LICENSE.txt'))
    if (license === undefined && !hasLicenseFile) {
      failures.push(`${current.name}: no license field and no LICENSE file`)
    } else if (license !== undefined && license.startsWith('SEE LICENSE IN ')) {
      if (!hasLicenseFile) {
        failures.push(`${current.name}: license refers to ${JSON.stringify(license)} but no LICENSE file is shipped`)
      }
    } else if (license !== undefined && !licenseAccepted(license)) {
      failures.push(`${current.name}: license ${JSON.stringify(license)} is not on the redistribution allowlist`)
    }
    manifests.push({ name: current.name, version: manifest.version, license: license ?? 'SEE LICENSE FILE' })
  }

  const requireFrom = createRequire(current.manifestPath)
  void requireFrom
  for (const section of ['dependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      const resolved = resolvePackageManifest(name, current.manifestPath)
      if (resolved === undefined) {
        // Optional dependencies may legitimately be absent on this platform.
        if (section === 'optionalDependencies') continue
        failures.push(`${current.name} -> ${name}: could not locate its manifest`)
        continue
      }
      queue.push({ name, manifestPath: resolved })
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`verify-licenses: ${failures.length} production package(s) need attention\n`)
  for (const failure of failures) process.stderr.write(`- ${failure}\n`)
  process.exit(1)
}

const noticeOnly = manifests.filter(entry => noticeRequired(entry.license))

/**
 * Notice lines for the prebuilt executables shipped outside the npm dependency graph.
 *
 * The bundled ffmpeg binaries are redistributed as files rather than installed
 * packages, so the dependency walk above never sees them. The release tag and the
 * npm version come from `scripts/ffmpeg-bundle.ts`, which is also what pins their
 * checksums, so this notice cannot drift from what the installers actually carry.
 */
function bundledBinaryNoticeLines() {
  return [
    '## Bundled executables',
    '',
    'One executable ships outside the npm dependency graph: the ffmpeg command-line tool that',
    'Canvas Studio uses for final-cut composition, frame extraction, and waveform rendering.',
    'Every platform-architecture copy is pinned by SHA-256 in `scripts/ffmpeg-bundle.ts` and ships',
    'with the upstream license text beside it.',
    '',
    '| Component | Version | License | Location in the application |',
    '| --- | --- | --- | --- |',
    `| ffmpeg (prebuilt from ffmpeg-static ${FFMPEG_STATIC_VERSION}, release ${FFMPEG_STATIC_TAG}) | 6.0 | GPL-3.0-or-later | ffmpeg/<platform>-<arch>/ in the application resources |`,
    '',
    'These are unmodified upstream builds invoked as a separate process; their configure flags are',
    'printed by `ffmpeg -version`. The GPL requires that recipients can obtain the corresponding',
    'source of the covered work:',
    '',
    '- FFmpeg release sources: https://ffmpeg.org/download.html',
    `- Prebuilt binaries and the matching build configuration: https://github.com/eugeneware/ffmpeg-static/releases/tag/${FFMPEG_STATIC_TAG}`,
    '',
  ]
}
const noticesArg = process.argv.indexOf('--notices')
if (noticesArg !== -1) {
  const target = process.argv[noticesArg + 1]
  if (target === undefined) {
    process.stderr.write('verify-licenses: --notices requires a file path\n')
    process.exit(1)
  }
  const lines = [
    '# Third-Party Notices',
    '',
    'DSH Desktop distributes the following third-party packages inside its installers.',
    'Each package ships with its own license text in the application files; this list records',
    'the package names, versions, and licenses for transparency.',
    '',
    '| Package | Version | License |',
    '| --- | --- | --- |',
    ...manifests
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(entry => `| ${entry.name} | ${entry.version ?? ''} | ${entry.license} |`),
    '',
    noticeOnly.length === 0
      ? ''
      : `> Notice-required licenses in use: ${[...new Set(noticeOnly.map(entry => entry.license))].join(', ')}. Their license texts ship inside node_modules; see the package LICENSE files for the full terms.`,
    '',
    ...bundledBinaryNoticeLines(),
    '',
  ].filter(line => line !== '')
  writeFileSync(join(packageRoot, target), lines.join('\n'))
}

const total = seen.size - 1
const summary = noticeOnly.length === 0
  ? `verify-licenses: ${total} production packages carry redistribution-safe licenses`
  : `verify-licenses: ${total} production packages checked; ${noticeOnly.length} use notice-required licenses (${[...new Set(noticeOnly.map(entry => entry.license))].join(', ')})`
process.stdout.write(`${summary}\n`)
