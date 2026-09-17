/**
 * Verify every production dependency shipped inside the desktop installers
 * carries a permissive license that allows redistribution.
 *
 * Walks the production dependency graph (dependencies + optionalDependencies,
 * excluding dev/peer) starting from this package manifest. Fails when a
 * package has no license field and no LICENSE file, or when its license is not
 * one the policy accepts. The policy itself, including how an `OR` expression
 * is read, lives in `license-policy.ts` so it can be unit tested; the walk
 * lives in `production-graph.ts` so the macOS universal guard checks the same
 * set of packages this gate permits.
 *
 * @module scripts/verify-licenses
 */

import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FFMPEG_STATIC_TAG, FFMPEG_STATIC_VERSION } from './ffmpeg-bundle.ts'
import { licenseAccepted, noticeRequired } from './license-policy.ts'
import { productionClosure } from './production-graph.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

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

const closure = productionClosure(join(packageRoot, 'package.json'))
const failures = closure.unresolved.map(
  entry => `${entry.from} -> ${entry.name}: could not locate its manifest`,
)
const manifests = []

for (const entry of closure.packages) {
  const license = licenseExpression(entry.manifest)
  const hasLicenseFile = existsSync(join(entry.directory, 'LICENSE'))
    || existsSync(join(entry.directory, 'LICENSE.md'))
    || existsSync(join(entry.directory, 'LICENSE.txt'))
  if (license === undefined && !hasLicenseFile) {
    failures.push(`${entry.name}: no license field and no LICENSE file`)
  } else if (license !== undefined && license.startsWith('SEE LICENSE IN ')) {
    if (!hasLicenseFile) {
      failures.push(`${entry.name}: license refers to ${JSON.stringify(license)} but no LICENSE file is shipped`)
    }
  } else if (license !== undefined && !licenseAccepted(license)) {
    failures.push(`${entry.name}: license ${JSON.stringify(license)} is not on the redistribution allowlist`)
  }
  manifests.push({ name: entry.name, version: entry.manifest.version, license: license ?? 'SEE LICENSE FILE' })
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

const total = closure.packages.length
const summary = noticeOnly.length === 0
  ? `verify-licenses: ${total} production packages carry redistribution-safe licenses`
  : `verify-licenses: ${total} production packages checked; ${noticeOnly.length} use notice-required licenses (${[...new Set(noticeOnly.map(entry => entry.license))].join(', ')})`
process.stdout.write(`${summary}\n`)
