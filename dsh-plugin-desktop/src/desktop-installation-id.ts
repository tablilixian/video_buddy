/** Private installation identity used only by DSH Desktop update checks. */

import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readdir, readFile, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Header carrying the pseudonymous Desktop installation identity. */
export const DESKTOP_INSTALLATION_ID_HEADER = 'X-DSH-Desktop-Installation-Id'

/** Relative state location below Electron's userData directory. */
export const DESKTOP_INSTALLATION_ID_RELATIVE_PATH = join('identity', 'installation-id')

/** Maximum state bytes read before treating an ordinary file as corrupt. */
export const MAX_DESKTOP_INSTALLATION_ID_BYTES = 128

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Writer-lock sibling the shared atomic-write package derives from the target. */
const WRITER_LOCK_SUFFIX = '.lock'

/** Infix of the takeover claim the shared package names after a lock record. */
const TAKEOVER_CLAIM_INFIX = '.takeover-'

/** Shape of one `wx`-written lock or claim record: the holder's pid. */
const WRITER_RECORD_PATTERN = /^\d+\n$/u

/** Maximum bytes read from a lock or claim record. */
const MAX_WRITER_RECORD_BYTES = 32

const LOCK_TIMEOUT_MESSAGE = 'timed out waiting for the writer lock'

/** Locally generated, pseudonymous UUID v4 scoped to one Desktop userData tree. */
export type DesktopInstallationId = string & { readonly __desktopInstallationId: unique symbol }

/** Injectable UUID source used only by focused tests. */
export interface DesktopInstallationIdOptions {
  readonly randomUUID?: () => string
}

/** Failure raised when the identity state path is unsafe or cannot be persisted. */
export class DesktopInstallationIdError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DesktopInstallationIdError'
  }
}

/** Return the exact private state path for one Electron userData directory. */
export function desktopInstallationIdPath(userDataDirectory: string): string {
  if (userDataDirectory.length === 0
    || /[\0\r\n]/u.test(userDataDirectory)
    || !isAbsolute(userDataDirectory)) {
    throw new DesktopInstallationIdError('Desktop userData must be an absolute path without control characters.')
  }
  return join(resolve(userDataDirectory), DESKTOP_INSTALLATION_ID_RELATIVE_PATH)
}

/** Parse one canonical lowercase UUID v4 without accepting surrounding text. */
export function parseDesktopInstallationId(value: unknown): DesktopInstallationId | undefined {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value)
    ? value as DesktopInstallationId
    : undefined
}

/** Require one canonical UUID v4 before it can enter an outbound header. */
export function assertDesktopInstallationId(value: string): DesktopInstallationId {
  const parsed = parseDesktopInstallationId(value)
  if (parsed === undefined) {
    throw new DesktopInstallationIdError('Desktop installation identity must be a canonical lowercase UUID v4.')
  }
  return parsed
}

/**
 * Whether the process named by one `<pid>\n` record has provably exited.
 *
 * Mirrors the shared takeover rule rather than inventing a weaker one: only a
 * signal probe answering `ESRCH` proves the holder gone. A live holder, an
 * unreadable record, or our own pid (which another process may have reused)
 * never qualifies, so a held lock is never reclaimed.
 */
function recordedHolderExited(record: string): boolean {
  if (!WRITER_RECORD_PATTERN.test(record)) return false
  const pid = Number(record.trim())
  if (pid === 0 || pid > 2147483647 || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/** Read one short record file, or undefined when it is absent or not a plain file. */
async function readWriterRecord(recordPath: string): Promise<string | undefined> {
  try {
    const stat = await lstat(recordPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_WRITER_RECORD_BYTES) return undefined
    return await readFile(recordPath, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Remove the writer-lock artifacts a killed process could not release.
 *
 * The shared atomic-write package reclaims a lock whose recorded holder exited,
 * but it serializes that reclaim through a claim file named after the record and
 * gives up — `return false`, no retry — as soon as the claim already exists. A
 * claimant killed between creating its claim and releasing the lock therefore
 * leaves a claim nothing ever removes, and every later writer waits out the full
 * lock deadline and fails. Startup then reports a persistence failure that names
 * nothing an operator could act on.
 *
 * Only a lock whose recorded holder is provably gone is touched; a live holder,
 * an unreadable record, or a record naming our own pid leaves every file in
 * place so the shared package keeps its normal waiting behavior. Claims are only
 * meaningful while a stale lock exists, and removing one can at worst let two
 * contenders each try the `wx` create again, where the kernel still picks a
 * single winner.
 *
 * @param statePath - target file whose `<statePath>.lock` siblings are reclaimed.
 * @returns whether any artifact was removed.
 */
export async function reclaimAbandonedWriterLock(statePath: string): Promise<boolean> {
  const lockPath = `${statePath}${WRITER_LOCK_SUFFIX}`
  const record = await readWriterRecord(lockPath)
  if (record === undefined || !recordedHolderExited(record)) return false

  const directory = dirname(lockPath)
  const claimPrefix = `${basename(lockPath)}${TAKEOVER_CLAIM_INFIX}`
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return false
  }

  let removed = false
  for (const entry of entries) {
    if (!entry.startsWith(claimPrefix)) continue
    const claimPath = join(directory, entry)
    const claim = await readWriterRecord(claimPath)
    if (claim !== undefined && !recordedHolderExited(claim)) continue
    try {
      await rm(claimPath, { force: true })
      removed = true
    } catch {
      // Leave the rest for the shared package to resolve; a remaining claim only
      // costs the deadline we already paid before this change.
    }
  }

  try {
    await rm(lockPath, { force: true })
    removed = true
  } catch {
    // The lock stays; the shared package reports its timeout as it did before.
  }
  return removed
}

/** Reclaim abandoned lock artifacts without letting cleanup failures block startup. */
async function reclaimAbandonedWriterLockQuietly(statePath: string): Promise<void> {
  try {
    await reclaimAbandonedWriterLock(statePath)
  } catch {
    // Best effort: the write below still reports the real failure.
  }
}

/**
 * Return the installation UUID for one Desktop userData tree.
 *
 * A missing or corrupt ordinary file is rebuilt atomically. Symbolic links,
 * directories, and other special entries are rejected rather than followed or
 * removed. Persistence failures are explicit: callers must not silently emit a
 * fresh, process-local identifier on every update check.
 */
export async function getOrCreateDesktopInstallationId(
  userDataDirectory: string,
  options: DesktopInstallationIdOptions = {},
): Promise<DesktopInstallationId> {
  const statePath = desktopInstallationIdPath(userDataDirectory)
  const identityDirectory = dirname(statePath)
  await prepareIdentityDirectory(identityDirectory)
  await reclaimAbandonedWriterLockQuietly(statePath)

  try {
    return await withFileLock(statePath, async () => {
      const persisted = await readPersistedInstallationId(statePath)
      if (persisted !== undefined) return persisted

      const generated = assertDesktopInstallationId((options.randomUUID ?? randomUUID)())
      await writeFileAtomic(statePath, `${generated}\n`, {
        mode: PRIVATE_FILE_MODE,
        dirMode: PRIVATE_DIRECTORY_MODE,
      })
      return generated
    })
  } catch (cause) {
    if (cause instanceof DesktopInstallationIdError) throw cause
    throw new DesktopInstallationIdError(
      `Desktop installation identity could not be persisted safely${describeLockTimeout(cause, statePath)}.`,
      { cause },
    )
  }
}

/**
 * Point an operator at the only file that can block a writer for the whole
 * deadline. The generic message alone sends them hunting for a permissions
 * problem that does not exist.
 */
function describeLockTimeout(cause: unknown, statePath: string): string {
  const message = cause instanceof Error ? cause.message : ''
  if (!message.includes(LOCK_TIMEOUT_MESSAGE)) return ''
  return ` (the writer lock at ${statePath}${WRITER_LOCK_SUFFIX} stayed held for the whole deadline; `
    + `delete it and any ${basename(statePath)}${WRITER_LOCK_SUFFIX}${TAKEOVER_CLAIM_INFIX}* siblings if no Desktop process is running)`
}

async function prepareIdentityDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new DesktopInstallationIdError('Desktop identity state directory must be an ordinary directory.')
    }
    await chmod(directory, PRIVATE_DIRECTORY_MODE)
  } catch (cause) {
    if (cause instanceof DesktopInstallationIdError) throw cause
    throw new DesktopInstallationIdError('Desktop identity state directory is unavailable.', { cause })
  }
}

async function readPersistedInstallationId(statePath: string): Promise<DesktopInstallationId | undefined> {
  let stat: Awaited<ReturnType<typeof lstat>>
  try {
    stat = await lstat(statePath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new DesktopInstallationIdError('Desktop installation identity state could not be inspected.', { cause })
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new DesktopInstallationIdError('Desktop installation identity state must be an ordinary file.')
  }
  if (stat.size > MAX_DESKTOP_INSTALLATION_ID_BYTES) return undefined

  const handle = await open(statePath, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_DESKTOP_INSTALLATION_ID_BYTES) return undefined
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new DesktopInstallationIdError('Desktop installation identity state changed while it was being opened.')
    }
    const buffer = Buffer.alloc(MAX_DESKTOP_INSTALLATION_ID_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > MAX_DESKTOP_INSTALLATION_ID_BYTES) return undefined
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
    const match = /^([0-9a-f-]+)\n?$/u.exec(text)
    const parsed = match === null ? undefined : parseDesktopInstallationId(match[1])
    if (parsed === undefined) return undefined
    await handle.chmod(PRIVATE_FILE_MODE)
    return parsed
  } catch (cause) {
    if (cause instanceof TypeError) return undefined
    if (cause instanceof DesktopInstallationIdError) throw cause
    throw new DesktopInstallationIdError('Desktop installation identity state could not be read safely.', { cause })
  } finally {
    await handle.close()
  }
}
