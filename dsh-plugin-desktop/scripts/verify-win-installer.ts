/** Verify the unsigned Windows x64 NSIS installer and unpacked executable. */

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * COFF machine types the Windows packaging gates reason about. The NSIS stub is
 * a 32-bit image, so installer verification accepts x86 or x64. Every unpacked
 * or portable application executable must be x64: the shipped Electron runtime
 * is `--x64` only, and an Intel host rejects an arm64 image with
 * ERROR_BAD_EXE_FORMAT even though the file is a structurally valid PE.
 */
export const WINDOWS_PE_MACHINE_I386 = 0x14c
/** x64, the architecture of every Windows build this package ships. */
export const WINDOWS_PE_MACHINE_AMD64 = 0x8664
/** The architecture an Intel Windows host cannot execute. */
export const WINDOWS_PE_MACHINE_ARM64 = 0xaa64

/** Machine types a 64-bit Windows host loads, used for installer stubs. */
export const WINDOWS_X64_HOST_EXECUTABLES: readonly number[] = [
  WINDOWS_PE_MACHINE_I386,
  WINDOWS_PE_MACHINE_AMD64,
]

/** Machine types every application executable in this package must declare. */
export const WINDOWS_APPLICATION_EXECUTABLES: readonly number[] = [WINDOWS_PE_MACHINE_AMD64]

const WINDOWS_PE_MACHINE_NAMES = new Map<number, string>([
  [WINDOWS_PE_MACHINE_I386, 'x86'],
  [0x1c0, 'arm'],
  [0x1c4, 'armv7'],
  [WINDOWS_PE_MACHINE_AMD64, 'x64'],
  [WINDOWS_PE_MACHINE_ARM64, 'arm64'],
])

/** Describe a COFF machine type for packaging diagnostics. */
export function describeWindowsPeMachine(machine: number): string {
  const name = WINDOWS_PE_MACHINE_NAMES.get(machine)
  return `${name ?? 'unknown'} (0x${machine.toString(16).padStart(4, '0')})`
}

/** Read the offset of the COFF header inside a complete in-memory PE image. */
function readPortableExecutableOffset(data: Buffer): number | undefined {
  if (data.byteLength < 68 || data.subarray(0, 2).toString('ascii') !== 'MZ') return undefined
  const peOffset = data.readUInt32LE(0x3c)
  if (peOffset > data.byteLength - 4) return undefined
  if (!data.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0'))) return undefined
  return peOffset
}

/**
 * Read the COFF machine type from a complete in-memory Windows PE image.
 * @param data - Candidate executable bytes.
 * @returns The machine type, or undefined when the image is not a readable PE.
 */
export function readWindowsPeMachine(data: Buffer): number | undefined {
  const peOffset = readPortableExecutableOffset(data)
  if (peOffset === undefined || peOffset + 6 > data.byteLength) return undefined
  return data.readUInt16LE(peOffset + 4)
}

function assertAllowedMachine(
  machine: number,
  allowed: readonly number[],
  label: string,
  source: string,
): void {
  if (allowed.includes(machine)) return
  const expected = allowed.map(describeWindowsPeMachine).join(' or ')
  throw new Error(
    `${label} is ${describeWindowsPeMachine(machine)}, expected ${expected}: ${source}`,
  )
}

/**
 * Verify a complete in-memory Windows PE image and its declared machine type.
 * @param data - Candidate executable bytes.
 * @param label - Human readable artifact role used in failures.
 * @param source - Artifact location used in failures.
 * @param allowed - Machine types the artifact is allowed to declare.
 */
export function assertPortableExecutableBuffer(
  data: Buffer,
  label: string,
  source: string,
  allowed: readonly number[] = WINDOWS_APPLICATION_EXECUTABLES,
): void {
  if (data.byteLength < 68 || data.subarray(0, 2).toString('ascii') !== 'MZ') {
    throw new Error(`${label} does not have a Windows PE header: ${source}`)
  }
  const peOffset = data.readUInt32LE(0x3c)
  if (peOffset > data.byteLength - 4) {
    throw new Error(`${label} has an invalid Windows PE offset: ${source}`)
  }
  if (!data.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0'))) {
    throw new Error(`${label} does not have a Windows PE signature: ${source}`)
  }
  if (peOffset + 6 > data.byteLength) {
    throw new Error(`${label} does not have a complete COFF header: ${source}`)
  }
  assertAllowedMachine(data.readUInt16LE(peOffset + 4), allowed, label, source)
}

/** Paths returned after Windows installer verification succeeds. */
export interface WindowsInstallerArtifacts {
  /** NSIS installer path. */
  readonly installerPath: string
  /** Unpacked application executable path. */
  readonly applicationPath: string
}

/** Injectable Windows installer verification boundary. */
export interface WindowsInstallerVerificationOptions {
  /** Desktop package root containing package.json and dist. */
  readonly desktopRoot: string
  /** Product version embedded in the expected artifact name. */
  readonly version: string
}

function readVersion(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid version`)
  }
  return manifest.version
}

/**
 * Verify that a generated Windows artifact is a PE image with an expected
 * machine type.
 * @param path - Artifact path.
 * @param label - Human readable artifact role used in failures.
 * @param allowed - Machine types the artifact is allowed to declare.
 */
export function assertPortableExecutable(
  path: string,
  label: string,
  allowed: readonly number[] = WINDOWS_APPLICATION_EXECUTABLES,
): void {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size < 68) {
    throw new Error(`${label} is not a non-empty regular file: ${path}`)
  }
  const descriptor = openSync(path, 'r')
  const dosHeader = Buffer.alloc(64)
  try {
    const dosBytesRead = readSync(descriptor, dosHeader, 0, dosHeader.byteLength, 0)
    if (dosBytesRead !== dosHeader.byteLength || dosHeader.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error(`${label} does not have a Windows PE header: ${path}`)
    }
    const peOffset = dosHeader.readUInt32LE(0x3c)
    if (peOffset > stat.size - 4) {
      throw new Error(`${label} has an invalid Windows PE offset: ${path}`)
    }
    const peHeader = Buffer.alloc(6)
    const peBytesRead = readSync(descriptor, peHeader, 0, peHeader.byteLength, peOffset)
    if (peBytesRead < 4 || !peHeader.subarray(0, 4).equals(Buffer.from('PE\0\0'))) {
      throw new Error(`${label} does not have a Windows PE signature: ${path}`)
    }
    if (peBytesRead < 6) {
      throw new Error(`${label} does not have a complete COFF header: ${path}`)
    }
    assertAllowedMachine(peHeader.readUInt16LE(4), allowed, label, path)
  } finally {
    closeSync(descriptor)
  }
}

function defaultOptions(): WindowsInstallerVerificationOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    desktopRoot,
    version: readVersion(desktopRoot),
  }
}

/**
 * Verify the exact NSIS installer and unpacked application executable.
 * @param options - Artifact root and expected product version.
 * @returns The verified artifact paths.
 */
export function verifyWindowsInstaller(
  options: WindowsInstallerVerificationOptions = defaultOptions(),
): WindowsInstallerArtifacts {
  const distDir = join(options.desktopRoot, 'dist')
  const installerPath = join(
    distDir,
    `VideoBuddy-${options.version}-x64-Setup.exe`,
  )
  const applicationPath = join(distDir, 'win-unpacked', 'VideoBuddy.exe')

  assertPortableExecutable(installerPath, 'Windows NSIS installer', WINDOWS_X64_HOST_EXECUTABLES)
  assertPortableExecutable(applicationPath, 'unpacked Windows application', WINDOWS_APPLICATION_EXECUTABLES)
  return { installerPath, applicationPath }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const verified = verifyWindowsInstaller()
    console.log(`Windows installer verification passed: ${verified.installerPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
