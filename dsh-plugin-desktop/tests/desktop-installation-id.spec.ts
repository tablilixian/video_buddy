import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DESKTOP_INSTALLATION_ID_HEADER,
  MAX_DESKTOP_INSTALLATION_ID_BYTES,
  assertDesktopInstallationId,
  desktopInstallationIdPath,
  getOrCreateDesktopInstallationId,
  parseDesktopInstallationId,
  reclaimAbandonedWriterLock,
} from '../src/desktop-installation-id.ts'

const roots: string[] = []
const FIRST = '01234567-89ab-4cde-8f01-23456789abcd'
const SECOND = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

async function userData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-installation-id-'))
  roots.push(root)
  return root
}

/** A pid the OS has already reaped, so a signal probe answers ESRCH. */
async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const pid = child.pid
  await new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
  if (pid === undefined) throw new Error('child process did not report a pid')
  return pid
}

/** Reproduce the claim name the shared atomic-write package derives from a record. */
function takeoverClaimPath(lockPath: string, recordPid: number): string {
  const digest = createHash('sha256').update(`${recordPid}\n`).digest('hex').slice(0, 16)
  return `${lockPath}.takeover-${digest}`
}

async function missing(path: string): Promise<void> {
  await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Desktop installation identity', () => {
  it('parses only canonical lowercase UUID v4 values', () => {
    expect(parseDesktopInstallationId(FIRST)).toBe(FIRST)
    expect(parseDesktopInstallationId('01234567-89AB-4CDE-8F01-23456789ABCD')).toBeUndefined()
    expect(parseDesktopInstallationId('01234567-89ab-1cde-8f01-23456789abcd')).toBeUndefined()
    expect(parseDesktopInstallationId(` ${FIRST}`)).toBeUndefined()
    expect(() => assertDesktopInstallationId('not-a-uuid')).toThrow('canonical lowercase UUID v4')
    expect(DESKTOP_INSTALLATION_ID_HEADER).toBe('X-DSH-Desktop-Installation-Id')
  })

  it('creates one private stable identity below userData', async () => {
    const root = await userData()
    const first = await getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST })
    const second = await getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND })
    const statePath = desktopInstallationIdPath(root)

    expect(first).toBe(FIRST)
    expect(second).toBe(FIRST)
    expect(statePath).toBe(join(root, 'identity', 'installation-id'))
    expect(await readFile(statePath, 'utf8')).toBe(`${FIRST}\n`)
    if (process.platform !== 'win32') {
      expect((await lstat(join(root, 'identity'))).mode & 0o777).toBe(0o700)
      expect((await lstat(statePath)).mode & 0o777).toBe(0o600)
    }
  })

  it('narrows existing private state permissions', async () => {
    const root = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(directory, { mode: 0o777 })
    await writeFile(statePath, `${FIRST}\n`, { mode: 0o666 })
    await chmod(directory, 0o777)
    await chmod(statePath, 0o666)

    await expect(getOrCreateDesktopInstallationId(root)).resolves.toBe(FIRST)
    if (process.platform !== 'win32') {
      expect((await lstat(directory)).mode & 0o777).toBe(0o700)
      expect((await lstat(statePath)).mode & 0o777).toBe(0o600)
    }
  })

  it.each([
    ['malformed contents', async (path: string) => { await writeFile(path, 'not-a-uuid\n') }],
    ['oversized contents', async (path: string) => { await writeFile(path, 'x'.repeat(MAX_DESKTOP_INSTALLATION_ID_BYTES + 1)) }],
    ['non-UTF-8 contents', async (path: string) => { await writeFile(path, Buffer.from([0xff, 0xfe])) }],
  ] as const)('atomically rebuilds an ordinary file with %s', async (_label, prepare) => {
    const root = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(directory)
    await prepare(statePath)

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND })).resolves.toBe(SECOND)
    expect(await readFile(statePath, 'utf8')).toBe(`${SECOND}\n`)
  })

  it('rejects a linked identity directory without writing through it', async () => {
    const root = await userData()
    const outside = await userData()
    await symlink(outside, join(root, 'identity'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST }))
      .rejects.toThrow('must be an ordinary directory')
    await expect(readFile(join(outside, 'installation-id'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')('rejects a symlink at the identity file path', async () => {
    const root = await userData()
    const outside = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(directory)
    const target = join(outside, 'target')
    await writeFile(target, `${FIRST}\n`)
    await symlink(target, statePath)

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }))
      .rejects.toThrow('must be an ordinary file')
  })

  it('rejects a directory at the identity file path', async () => {
    const root = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(statePath, { recursive: true })

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }))
      .rejects.toThrow('must be an ordinary file')
  })

  it('serializes concurrent first use onto one persisted identity', async () => {
    const root = await userData()
    const values = await Promise.all([
      getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST }),
      getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }),
    ])

    expect(new Set(values)).toEqual(new Set([values[0]]))
    expect(await readFile(desktopInstallationIdPath(root), 'utf8')).toBe(`${values[0]}\n`)
  })

  it.each(['', 'relative/path', `/tmp/bad\0path`])('rejects unsafe userData path %j', async (root) => {
    await expect(getOrCreateDesktopInstallationId(root)).rejects.toThrow('must be an absolute path')
  })

  it('reclaims the lock and takeover claim a killed writer left behind', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'))
    const deadHolder = await exitedPid()
    // Writer created its lock, then was killed before it could release it.
    await writeFile(`${statePath}.lock`, `${deadHolder}\n`)
    // A claimant killed between creating its claim and releasing the lock: the
    // shared package then answers every further takeover with `return false` and
    // waits out the whole deadline, which is what bricks startup.
    const claimPath = takeoverClaimPath(`${statePath}.lock`, deadHolder)
    await writeFile(claimPath, `${deadHolder}\n`)

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST })).resolves.toBe(FIRST)
    await missing(`${statePath}.lock`)
    await missing(claimPath)
  })

  it('reports the abandoned artifacts it reclaims', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'))
    await writeFile(`${statePath}.lock`, `${await exitedPid()}\n`)

    await expect(reclaimAbandonedWriterLock(statePath)).resolves.toBe(true)
    await missing(`${statePath}.lock`)
    await expect(reclaimAbandonedWriterLock(statePath)).resolves.toBe(false)
  })

  it('keeps a lock whose recorded holder is still running', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'))
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
    try {
      await writeFile(`${statePath}.lock`, `${String(holder.pid)}\n`)

      await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST }))
        .rejects.toThrow(/could not be persisted safely/u)
      // A live writer keeps its lock, and the message now names the file to inspect.
      await expect(readFile(`${statePath}.lock`, 'utf8')).resolves.toBe(`${String(holder.pid)}\n`)
      await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST }))
        .rejects.toThrow(/writer lock at/u)
    } finally {
      holder.kill('SIGKILL')
    }
  }, 20000)

  it('leaves a lock whose record is not a pid untouched', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'))
    await writeFile(`${statePath}.lock`, 'not-a-pid\n')

    await expect(reclaimAbandonedWriterLock(statePath)).resolves.toBe(false)
    await expect(readFile(`${statePath}.lock`, 'utf8')).resolves.toBe('not-a-pid\n')
  })
})
