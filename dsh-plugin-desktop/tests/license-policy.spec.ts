import { describe, expect, it } from 'vitest'
import {
  ALLOWED_LICENSES,
  NOTICE_LICENSES,
  licenseAccepted,
  noticeRequired,
} from '../scripts/license-policy.ts'

describe('redistribution license policy', () => {
  it('accepts every license the allowlist names', () => {
    for (const license of ALLOWED_LICENSES) expect(licenseAccepted(license)).toBe(true)
    for (const license of NOTICE_LICENSES) expect(licenseAccepted(license)).toBe(true)
  })

  it('accepts an OR expression when any branch is allowed, parentheses included', () => {
    // These three shapes are what the production graph actually declares.
    expect(licenseAccepted('(MIT OR WTFPL)')).toBe(true)
    expect(licenseAccepted('(BSD-2-Clause OR MIT OR Apache-2.0)')).toBe(true)
    expect(licenseAccepted('(MIT OR CC0-1.0)')).toBe(true)
  })

  it('rejects an OR expression whose every branch is disallowed', () => {
    expect(licenseAccepted('(WTFPL OR Beerware)')).toBe(false)
  })

  it('rejects a copyleft license that is neither allowlisted nor notice-listed', () => {
    expect(licenseAccepted('GPL-2.0-only')).toBe(false)
    expect(licenseAccepted('AGPL-3.0-or-later')).toBe(false)
  })

  it('still requires an exact entry for an AND expression', () => {
    expect(licenseAccepted('Apache-2.0 AND LGPL-3.0-or-later')).toBe(true)
    expect(licenseAccepted('MIT AND LGPL-3.0-or-later')).toBe(false)
  })

  it('reads a parenthesized single license the same as a bare one', () => {
    expect(licenseAccepted('(MIT)')).toBe(true)
    expect(licenseAccepted(' (GPL-2.0-only) ')).toBe(false)
  })

  it('flags notice-required licenses regardless of grouping parentheses', () => {
    expect(noticeRequired('GPL-3.0-or-later')).toBe(true)
    expect(noticeRequired('(GPL-3.0-or-later)')).toBe(true)
    expect(noticeRequired('LGPL-3.0-or-later')).toBe(true)
    expect(noticeRequired('(MIT OR WTFPL)')).toBe(false)
    expect(noticeRequired('MIT')).toBe(false)
  })
})
