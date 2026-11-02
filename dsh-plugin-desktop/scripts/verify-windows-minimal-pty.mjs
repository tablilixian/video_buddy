/** Real Windows smoke for the official minimal pwsh stack over the Desktop ACL relay. */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, win32 } from 'node:path'
import { release, version as osVersion } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ENCODING_PREAMBLE, resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import * as TerminalBash from '@deepseek-ai/dsh-terminal-bash'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolPwshPersistent from '@deepseek-ai/dsh-tool-pwsh-persistent'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import { adaptWindowsAclTerminalSpawn } from '../lib/windows-subprocess.js'

const WORKER_FLAG = '--worker'
const EXECUTION_POLICY = 'PSEXECUTIONPOLICYPREFERENCE'
/** Raw bytes retained from the most recent real PTY, bounded so a chatty shell cannot grow it without limit. */
const REAL_PTY_RAW_MAX = 8_000
let realPtyRaw = ''

function deadline(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`${label} timed out after ${timeoutMs}ms`)) }, timeoutMs)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

function sameWindowsPath(left, right) {
  return win32.normalize(left).toUpperCase() === win32.normalize(right).toUpperCase()
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function toolText(result) {
  return result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Minimal inbox stub satisfying the 0.2.1 agent `Inbox` interface. The smoke
 * agent only carries tool-execution identity, so nothing consumes pending work;
 * the stub exists so registry and tool attribution see a well-formed agent.
 */
/**
 * Inbox stub matching the upstream `@deepseek-ai/dsh-agent` `Inbox` contract.
 *
 * ⚠️ The `target` argument of `append`/`prepend`/`splice` is the kebab-case
 * `InboxTarget` (`'next-turn'` / `'next-step'`), NOT camelCase. The pending
 * store must use the same kebab keys, otherwise `pending[target]` is `undefined`
 * and `append` throws `Cannot read properties of undefined (reading 'push')`
 * the moment the 0.2.1 agent loop delivers to the inbox. Shape copied from
 * `deepseek-harness/.../agent-loop-testkit/src/inbox.ts` `createInboxStub()`.
 */
function stubInbox() {
  const pending = { 'next-turn': [], 'next-step': [] }
  const locate = (messageId) => {
    for (const target of ['next-turn', 'next-step']) {
      const index = pending[target].findIndex(item => item.id === messageId)
      if (index >= 0) return { target, index }
    }
    return undefined
  }
  return {
    get nextTurn() { return pending['next-turn'] },
    get nextStep() { return pending['next-step'] },
    clear() {
      pending['next-step'].splice(0)
      pending['next-turn'].splice(0)
    },
    append(target, message) { pending[target].push(message) },
    prepend(target, message) { pending[target].unshift(message) },
    replace(messageId, newMessage) {
      const location = locate(messageId)
      if (location === undefined) return false
      pending[location.target].splice(location.index, 1, newMessage)
      return true
    },
    remove(messageId) {
      const location = locate(messageId)
      if (location === undefined) return false
      pending[location.target].splice(location.index, 1)
      return true
    },
    splice(target, start, deleteCount, inserted) {
      return pending[target].splice(start, deleteCount, ...inserted)
    },
  }
}

function owner(ctx, rawId, cwd) {
  const id = SessionId(rawId)
  const scope = ctx.plugin(() => {})
  const session = Session.create(id, [], { version: 4, id, createdAt: 0, cwd, isSeeded: false })
  const value = {
    id,
    options: {},
    session,
    inbox: stubInbox(),
    status: 'idle',
    ctx: scope.ctx,
    send() {},
    followup() {},
    steer() { return { outcome: Promise.resolve({ status: 'rejected' }) } },
    inject() {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

async function scenario(inputs) {
  realPtyRaw = ''
  const context = new Context()
  let callNumber = 0
  try {
    // 0.2.1 tool plugins inject a `workingDirectory` collaborator; production
    // provides it at boot. Without it the pwsh tool's fiber never applies and
    // every execute fails with `unknown tool "pwsh"`.
    context.provide('workingDirectory', {
      defaultDirectory: inputs.packageRoot,
      get: session => session.header.cwd ?? inputs.packageRoot,
      ensure: agent => Promise.resolve(agent.session.header.cwd ?? inputs.packageRoot),
    })
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRegistry)
    await context.plugin(AgentRegistry)
    await context.plugin(TerminalSessionService)
    await context.plugin(LocalSandbox, {})
    // A Node worker models the Electron Host by asking the official sandbox
    // provider to emit the same Electron + runner prefix used in production.
    context.sandbox.internals.windowsAclRunnerArgs = [inputs.electron, inputs.runner]
    await context.plugin(SandboxPolicyService, {
      mode: 'read-only',
      workspaceRoot: inputs.packageRoot,
    })

    class SmokeDesktopSubprocess extends LocalSubprocessRuntime {
      async spawnTerminal(spec) {
        const terminal = await super.spawnTerminal(adaptWindowsAclTerminalSpawn(spec, {
          platform: 'win32',
          electron: true,
          execPath: inputs.electron,
          upstreamRunner: inputs.runner,
          trampoline: inputs.trampoline,
          env: process.env,
        }))
        // The tool error carries none of the shell's output, and a startup
        // failure closes the session before anything is published. Retain the
        // real bytes so a readiness timeout can still say what the relay
        // delivered. The session subscribes in its constructor after this
        // await settles, so both listeners attach within one microtask drain
        // and neither loses data.
        terminal.output.on('data', chunk => {
          const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
          realPtyRaw = `${realPtyRaw}${text}`.slice(-REAL_PTY_RAW_MAX)
        })
        return terminal
      }
    }

    await context.plugin(SmokeDesktopSubprocess)
    // 0.2.1：TerminalBash 的 inject 含 `sessionProjections`，由 SessionProjectionRegistry
    // 提供（上游 testkit 的 mountAgentLoopTestDependencies 同样挂载它）。漏挂会导致
    // TerminalBash.apply 因依赖不满足而不执行 → `shell` PTY 后端未注册 →
    // pwsh 工具 spawn 报 "no PTY backend registered for \"shell\""。
    await context.plugin(SessionProjectionRegistry)
    await context.plugin(TerminalBash, {
      shellDialect: 'pwsh',
      shellPath: inputs.shellPath,
      timeoutMs: 20_000,
      idleSilenceMs: 1_000,
      handoffGraceMs: 500,
      disposeGraceMs: 1_000,
    })
    await context.plugin(ToolPwshPersistent, { timeoutMs: 30_000 })

    const agent = owner(context, `windows-minimal-${inputs.label}`, inputs.packageRoot)
    const execute = (command, signal = new AbortController().signal) => context.tools.execute({
      signal,
      callId: ToolCallId(`${inputs.label}-${++callNumber}`),
      name: 'pwsh',
      arguments: { command },
      agent,
    })

    const first = await execute('$global:DshDesktopRelayState = 41; Write-Output ([int]$global:DshDesktopRelayState + 1)')
    if (first.isError || toolText(first).trim() !== '42') {
      // A startup timeout publishes no output of its own. Capture what the real
      // session retained while the context is still alive: an empty scrollback
      // means the shell never produced anything, a scrollback without `dsh> `
      // means the setup line never ran, and one with it means only the prompt
      // marker or tail failed to match.
      throw new Error(`${inputs.label}: first persistent command failed: ${JSON.stringify(first)}\n${sessionEvidence(context, agent)}`)
    }

    const second = await execute('Write-Output ("中文 special=&|<>^ value=" + ([int]$global:DshDesktopRelayState * 2))')
    expect(
      !second.isError && toolText(second).trim() === '中文 special=&|<>^ value=82',
      `${inputs.label}: Unicode or persistent state failed: ${JSON.stringify(second)}`,
    )

    const policy = await execute("if (Test-Path Env:PSExecutionPolicyPreference) { Write-Output $env:PSExecutionPolicyPreference } else { Write-Output '<unset>' }")
    const expectedPolicy = inputs.expectsBypass ? 'Bypass' : '<unset>'
    expect(
      !policy.isError && toolText(policy).trim() === expectedPolicy,
      `${inputs.label}: unexpected process execution policy: ${JSON.stringify(policy)}`,
    )

    const controller = new AbortController()
    const abortTimer = setTimeout(() => { controller.abort(new Error('windows-minimal-audit-stop')) }, 3_000)
    const aborted = await execute('Start-Sleep -Seconds 60', controller.signal).finally(() => { clearTimeout(abortTimer) })
    expect(aborted.isError && /abort|windows-minimal-audit-stop/iu.test(toolText(aborted)), `${inputs.label}: abort was not reported: ${JSON.stringify(aborted)}`)
    expect(context.terminals.list(agent).length === 0, `${inputs.label}: aborted terminal was not reset`)

    const recovered = await execute('Write-Output "after-abort-ok"')
    expect(!recovered.isError && toolText(recovered).trim() === 'after-abort-ok', `${inputs.label}: recovery failed: ${JSON.stringify(recovered)}`)

    const exited = await execute('exit 7')
    expect(toolText(exited).includes('next pwsh call starts from the workspace'), `${inputs.label}: shell exit was not reset: ${JSON.stringify(exited)}`)
    expect(context.terminals.list(agent).length === 0, `${inputs.label}: exited terminal was not reset`)

    const afterExit = await execute('Write-Output "after-exit-ok"')
    expect(!afterExit.isError && toolText(afterExit).trim() === 'after-exit-ok', `${inputs.label}: post-exit recovery failed: ${JSON.stringify(afterExit)}`)
    return { label: inputs.label, shellPath: inputs.shellPath }
  } finally {
    await context.fiber.dispose()
  }
}

/** Failure text for any thrown diagnostic value. */
function detail(error) {
  return error instanceof Error ? error.message : String(error)
}

function delay(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

function textFile(path) {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch (error) {
    // An unreadable file is itself evidence; report it instead of aborting.
    return `unreadable (${detail(error)})`
  }
}

function packageVersion(path) {
  const manifest = textFile(path)
  if (!manifest.startsWith('{')) return manifest
  try {
    return String(JSON.parse(manifest).version)
  } catch (error) {
    return `unreadable (${detail(error)})`
  }
}

/**
 * What the failing session still retained. Readiness evidence is invisible in
 * the tool error, so the scrollback separates the three failure shapes: no
 * output at all, output without the controlled prompt, or the prompt itself.
 */
function sessionEvidence(context, agent) {
  let snapshots
  try {
    snapshots = context.terminals.list(agent)
  } catch (error) {
    return `terminal sessions: unreadable (${detail(error)})`
  }
  if (snapshots.length === 0) return 'terminal sessions: none (the startup failure cleaned the session up before publication)'
  return snapshots.map(snapshot => {
    try {
      const page = context.terminals.read(agent, snapshot.sessionId, { offset: 0, count: 40 })
      return `terminal session status=${snapshot.status.kind} lines=${page.totalLines} sawControlledPrompt=${page.text.includes('dsh> ')} scrollback=${JSON.stringify(page.text.slice(-600))}`
    } catch (error) {
      return `terminal session status=${snapshot.status.kind} unreadable (${detail(error)})`
    }
  }).join('\n')
}

/** Host, shell, and node-pty facts that a Windows runner log never carries. */
function hostFacts(inputs) {
  const lines = [
    `host: ${process.platform} ${release()} (${osVersion()}) ${process.arch} node=${process.version}`,
    `shell: ${inputs.shellPath}`,
  ]
  try {
    const probe = spawnSync(inputs.shellPath, ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    })
    const failure = probe.error != null ? detail(probe.error) : `exit ${probe.status}`
    lines.push(`shellVersion: ${(probe.stdout ?? '').trim() || `unavailable (${failure})`}`)
  } catch (error) {
    lines.push(`shellVersion: unavailable (${detail(error)})`)
  }
  lines.push(`electron: ${textFile(join(inputs.packageRoot, 'node_modules', 'electron', 'dist', 'version'))}`)
  lines.push(`node-pty: ${packageVersion(join(inputs.packageRoot, 'node_modules', 'node-pty', 'package.json'))}`)
  return lines.join('\n')
}

/**
 * Reproduce the prompt render on a bare node-pty with the same shell, console
 * size, environment, and bundled console host, deliberately without the ACL
 * relay. The raw bytes separate the failure shapes the readiness path cannot
 * report: no output, a setup line the shell never ran, an OSC `133;D;` marker
 * that never arrived, or a prompt tail the sanitizer cannot match — the system
 * console host replays it as a newline, `dsh>`, and a cursor-forward escape
 * instead of the printable `dsh> ` (upstream bundled-console-host note).
 */
async function probeRawPrompt(inputs) {
  let nodePty
  try {
    nodePty = await import('node-pty')
  } catch (error) {
    return `raw probe: node-pty unavailable (${detail(error)})`
  }
  const pty = nodePty.default ?? nodePty
  const env = {
    ...process.env,
    TERM: 'dumb',
    NO_COLOR: '1',
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    DSH_SHELL: '1',
  }
  let shell
  try {
    shell = pty.spawn(inputs.shellPath, ['-NoLogo', '-NoProfile'], {
      name: 'dumb',
      cols: 160,
      rows: 40,
      cwd: inputs.packageRoot,
      env,
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
    })
  } catch (error) {
    return `raw probe: spawn failed (${detail(error)})`
  }
  let raw = ''
  let exitCode
  const exited = new Promise(resolve => {
    shell.onExit(event => { exitCode = event.exitCode; resolve(event.exitCode) })
  })
  shell.onData(chunk => { raw += chunk })
  try {
    shell.write(`${ENCODING_PREAMBLE}${TerminalBash.PWSH_PROMPT_SETUP}\r`)
    await Promise.race([exited, delay(4_000)])
    if (exitCode === undefined) {
      // A second prompt after real output exercises the console host replay path.
      shell.write('Write-Output ("probe-" + 7)\r')
      await Promise.race([exited, delay(2_500)])
    }
  } finally {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(shell.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } else {
        shell.kill()
      }
    } catch (error) {
      // The probe is disposable; a failed cleanup must not hide its evidence.
      raw += `\nprobe cleanup failed: ${detail(error)}`
    }
  }
  const markerIndex = raw.lastIndexOf('\x1b]133;D;')
  return `raw probe (bare node-pty, no ACL relay): ${JSON.stringify({
    bytes: raw.length,
    exitCode: exitCode ?? 'still-running',
    sawOscPromptMarker: raw.includes('\x1b]133;D;'),
    sawControlledPrompt: raw.includes('dsh> '),
    sawKnownMalformedReplay: raw.includes('\ndsh>\x1b[1C'),
    afterLastMarker: markerIndex < 0 ? null : raw.slice(markerIndex, markerIndex + 160),
    outputTail: raw.slice(-500),
  })}`
}

/** The real session's raw bytes: the only evidence the ACL relay path leaves behind. */
function realPtyEvidence() {
  const markerIndex = realPtyRaw.lastIndexOf('\x1b]133;D;')
  return `real session raw${realPtyRaw.length >= REAL_PTY_RAW_MAX ? ` (last ${REAL_PTY_RAW_MAX} of the stream)` : ''}: ${JSON.stringify({
    bytes: realPtyRaw.length,
    sawOscPromptMarker: realPtyRaw.includes('\x1b]133;D;'),
    sawControlledPrompt: realPtyRaw.includes('dsh> '),
    sawKnownMalformedReplay: realPtyRaw.includes('\ndsh>\x1b[1C'),
    afterLastMarker: markerIndex < 0 ? null : realPtyRaw.slice(markerIndex, markerIndex + 160),
    outputTail: realPtyRaw.slice(-500),
  })}`
}

/** Evidence appended to a scenario failure; it travels on stderr into the annotation. */
async function failureEvidence(inputs) {
  let probe
  try {
    probe = await probeRawPrompt(inputs)
  } catch (error) {
    probe = `raw probe: unavailable (${error instanceof Error ? error.stack ?? error.message : String(error)})`
  }
  return `${realPtyEvidence()}\n${hostFacts(inputs)}\n${probe}`
}

async function worker() {
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase() === EXECUTION_POLICY) delete process.env[key]
  }
  const packageRoot = fileURLToPath(new URL('..', import.meta.url))
  const electron = join(packageRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  const trampoline = join(packageRoot, 'lib', 'windows-acl-runner.js')
  const runner = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner'))
  const systemRoot = process.env.SystemRoot
  if (systemRoot === undefined || systemRoot.length === 0) throw new Error('Windows minimal PTY smoke requires SystemRoot')
  const fallback = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const resolved = resolvePwshPath()
  const paths = [{
    label: 'official-resolver',
    shellPath: resolved,
    expectsBypass: sameWindowsPath(resolved, fallback),
  }]
  if (existsSync(fallback) && !sameWindowsPath(resolved, fallback)) {
    paths.push({ label: 'windows-powershell-5.1-fallback', shellPath: fallback, expectsBypass: true })
  }

  const results = []
  for (const path of paths) {
    const inputs = { packageRoot, electron, trampoline, runner, ...path }
    try {
      results.push(await scenario(inputs))
    } catch (error) {
      const stack = error instanceof Error ? error.stack ?? error.message : String(error)
      throw new Error(`${stack}\n--- diagnostics ---\n${await failureEvidence(inputs)}`)
    }
  }
  await new Promise(resolve => { process.stdout.write(`${JSON.stringify({ ok: true, results })}\n`, resolve) })
}

async function parent() {
  const script = fileURLToPath(import.meta.url)
  const child = spawn(process.execPath, [script, WORKER_FLAG], {
    cwd: dirname(script),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const exitCode = await deadline(new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  }), 90_000, 'Windows minimal PTY smoke worker').catch(error => {
    child.kill()
    throw error
  })
  let report
  try {
    report = JSON.parse(stdout)
  } catch {
    report = undefined
  }
  if (exitCode !== 0 || report?.ok !== true || stderr.length > 0) {
    throw new Error(`Windows minimal PTY smoke leaked host output or failed: ${JSON.stringify({ exitCode, stdout, stderr })}`)
  }
}

async function main() {
  if (process.platform !== 'win32') return
  if (process.argv.includes(WORKER_FLAG)) {
    await worker()
    process.exit(0)
  }
  await parent()
}

/**
 * Publish a failure as a workflow annotation. Job logs need repository rights
 * while annotations travel with the check run, so this keeps a red Windows run
 * diagnosable from the API. The worker stays silent: its stdout must remain a
 * single JSON report for the parent to parse.
 */
function annotate(message) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.argv.includes(WORKER_FLAG)) return
  const payload = message
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
  process.stdout.write(`::error title=verify-windows-minimal-pty::${payload.slice(0, 8_000)}\n`)
}

void main().catch(cause => {
  const detail = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  process.stderr.write(`verify-windows-minimal-pty: ${detail}\n`)
  annotate(detail)
  process.exitCode = 1
})
