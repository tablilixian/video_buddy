/**
 * Redistribution license policy for the desktop installers.
 *
 * `verify-licenses.mjs` walks the production dependency graph and asks this
 * module whether each declared license may ship. The policy lives apart from
 * the walk so it can be unit tested: a gate that cannot fail is not a gate, and
 * a false failure here costs a full CI round trip.
 *
 * @module scripts/license-policy
 */

/** Licenses accepted for redistribution inside the desktop installers. */
export const ALLOWED_LICENSES = new Set<string>([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  // parse-cache-control declares the deprecated pre-SPDX "BSD" id; its LICENSE
  // file carries the standard 3-clause text. All BSD variants are permissive.
  'BSD',
  'ISC',
  '0BSD',
  'Unlicense',
  'MPL-2.0',
  'CC0-1.0',
  'Zlib',
  'Python-2.0',
])

/**
 * Licenses that permit redistribution only when their obligations are honored.
 * Sharp ships libvips as a separate @img/sharp-libvips-* package on macOS and
 * inside the @img/sharp-win32-* package on Windows. Their license texts ship
 * inside node_modules in the installer.
 *
 * GPL-3.0-or-later (ffmpeg-static's prebuilt GPL ffmpeg binary) additionally
 * requires offering the corresponding source; the upstream ffmpeg-static
 * project publishes the matching source revisions for its released binaries,
 * and the license text ships inside node_modules. Keep this list minimal and
 * review any addition.
 */
export const NOTICE_LICENSES = new Set<string>([
  'LGPL-3.0-or-later',
  'Apache-2.0 AND LGPL-3.0-or-later',
  'GPL-3.0-or-later',
])

/**
 * One unit of a license expression, without the grouping parentheses that npm
 * manifests write around a disjunction. `(MIT OR WTFPL)` splits into `MIT` and
 * `WTFPL`, so both ends of a segment are trimmed of parentheses and whitespace.
 */
function unit(segment: string): string {
  return segment.replace(/^[\s(]+/, '').replace(/[\s)]+$/, '')
}

/**
 * Whether a license expression permits redistribution.
 *
 * An `OR` expression is exactly as safe as its best branch: `(MIT OR WTFPL)`
 * lets the redistributor take MIT, and the parentheses are part of the string
 * npm publishes. An `AND` expression carries no `OR` separator, so it still
 * needs its own allowlist entry.
 */
export function licenseAccepted(license: string): boolean {
  return license.split(' OR ').some((segment) => {
    const candidate = unit(segment)
    return ALLOWED_LICENSES.has(candidate) || NOTICE_LICENSES.has(candidate)
  })
}

/**
 * Whether the license the redistributor would actually rely on requires a
 * shipped notice. Grouping parentheses are stripped first, so a manifest that
 * writes `(GPL-3.0-or-later)` is still counted in the notices.
 */
export function noticeRequired(license: string): boolean {
  return NOTICE_LICENSES.has(unit(license))
}
