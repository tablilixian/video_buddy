import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WINDOWS_PE_MACHINE_AMD64,
  WINDOWS_PE_MACHINE_ARM64,
  WINDOWS_PE_MACHINE_I386,
  verifyWindowsInstaller,
} from '../scripts/verify-win-installer.ts'

const temporaryRoots: string[] = []

function portableExecutable(machine: number): Buffer {
  const executable = Buffer.alloc(140)
  executable.write('MZ', 0, 'ascii')
  executable.writeUInt32LE(128, 0x3c)
  executable.write('PE\0\0', 128, 'binary')
  executable.writeUInt16LE(machine, 132)
  return executable
}

function fixture(
  version = '2.0.0',
  installerMachine: number = WINDOWS_PE_MACHINE_I386,
  applicationMachine: number = WINDOWS_PE_MACHINE_AMD64,
): {
  readonly root: string
  readonly installer: string
  readonly application: string
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-win-installer-'))
  temporaryRoots.push(root)
  const dist = join(root, 'dist')
  const unpacked = join(dist, 'win-unpacked')
  mkdirSync(unpacked, { recursive: true })
  const installer = join(dist, `VideoBuddy-${version}-x64-Setup.exe`)
  const application = join(unpacked, 'VideoBuddy.exe')
  writeFileSync(installer, portableExecutable(installerMachine))
  writeFileSync(application, portableExecutable(applicationMachine))
  return { root, installer, application }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Windows installer artifact verification', () => {
  it('accepts the exact versioned NSIS installer and unpacked application', () => {
    const value = fixture()

    expect(verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' })).toEqual({
      installerPath: value.installer,
      applicationPath: value.application,
    })
  })

  it('rejects a stale installer from a different version', () => {
    const value = fixture('1.9.0')

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('VideoBuddy-2.0.0-x64-Setup.exe')
  })

  it('rejects an artifact without a Windows PE header', () => {
    const value = fixture()
    const invalid = portableExecutable(WINDOWS_PE_MACHINE_AMD64)
    invalid.write('NO', 0, 'ascii')
    writeFileSync(value.installer, invalid)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have a Windows PE header')
  })

  it('rejects an unpacked application without a Windows PE signature', () => {
    const value = fixture()
    const invalid = portableExecutable(WINDOWS_PE_MACHINE_AMD64)
    invalid.fill(0, 128, 132)
    writeFileSync(value.application, invalid)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have a Windows PE signature')
  })

  it('rejects an arm64 unpacked application that an Intel host cannot execute', () => {
    const value = fixture('2.0.0', WINDOWS_PE_MACHINE_I386, WINDOWS_PE_MACHINE_ARM64)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('unpacked Windows application is arm64 (0xaa64), expected x64 (0x8664)')
  })

  it('rejects an arm64 NSIS installer stub', () => {
    const value = fixture('2.0.0', WINDOWS_PE_MACHINE_ARM64, WINDOWS_PE_MACHINE_AMD64)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('Windows NSIS installer is arm64 (0xaa64), expected x86 (0x014c) or x64 (0x8664)')
  })

  it('rejects a 32-bit unpacked application inside the x64 package', () => {
    const value = fixture('2.0.0', WINDOWS_PE_MACHINE_I386, WINDOWS_PE_MACHINE_I386)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('unpacked Windows application is x86 (0x014c), expected x64 (0x8664)')
  })

  it('rejects a truncated application without a complete COFF header', () => {
    const value = fixture()
    const truncated = Buffer.alloc(132)
    truncated.write('MZ', 0, 'ascii')
    truncated.writeUInt32LE(128, 0x3c)
    truncated.write('PE\0\0', 128, 'binary')
    writeFileSync(value.application, truncated)

    expect(() => verifyWindowsInstaller({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have a complete COFF header')
  })
})
