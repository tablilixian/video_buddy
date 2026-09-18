import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WINDOWS_PE_MACHINE_AMD64,
  WINDOWS_PE_MACHINE_ARM64,
  WINDOWS_PE_MACHINE_I386,
} from '../scripts/verify-win-installer.ts'
import { verifyWindowsPortable } from '../scripts/verify-win-portable.ts'

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
  applicationMachine: number = WINDOWS_PE_MACHINE_AMD64,
): { readonly root: string; readonly portable: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-win-portable-'))
  temporaryRoots.push(root)
  const dist = join(root, 'dist')
  mkdirSync(dist, { recursive: true })
  const portable = join(dist, `VideoBuddy-${version}-x64-Portable.zip`)
  const archive = new AdmZip()
  archive.addFile('VideoBuddy.exe', portableExecutable(applicationMachine))
  archive.addFile('resources/app.asar', Buffer.from('asar'))
  archive.writeZip(portable)
  return { root, portable }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Windows portable artifact verification', () => {
  it('accepts the exact versioned portable ZIP archive', () => {
    const value = fixture()

    expect(verifyWindowsPortable({ desktopRoot: value.root, version: '2.0.0' })).toBe(value.portable)
  })

  it('rejects a stale portable archive from a different version', () => {
    const value = fixture('1.9.0')

    expect(() => verifyWindowsPortable({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('VideoBuddy-2.0.0-x64-Portable.zip')
  })

  it('rejects an application entry without a Windows PE header', () => {
    const value = fixture()
    const invalid = portableExecutable(WINDOWS_PE_MACHINE_AMD64)
    invalid.write('NO', 0, 'ascii')
    const archive = new AdmZip()
    archive.addFile('VideoBuddy.exe', invalid)
    archive.addFile('resources/app.asar', Buffer.from('asar'))
    archive.writeZip(value.portable)

    expect(() => verifyWindowsPortable({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have a Windows PE header')
  })

  it('rejects an arm64 application entry that an Intel host cannot execute', () => {
    const value = fixture('2.0.0', WINDOWS_PE_MACHINE_ARM64)

    expect(() => verifyWindowsPortable({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('Windows portable application is arm64 (0xaa64), expected x64 (0x8664)')
  })

  it('rejects a 32-bit application entry inside the x64 archive', () => {
    const value = fixture('2.0.0', WINDOWS_PE_MACHINE_I386)

    expect(() => verifyWindowsPortable({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('Windows portable application is x86 (0x014c), expected x64 (0x8664)')
  })
})
