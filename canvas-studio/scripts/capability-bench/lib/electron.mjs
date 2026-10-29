/**
 * 能力基准 · Electron 外壳与启动器。
 *
 * 两个已踩实的坑，在这里一次性解决（见文档 §11.2 E4 / §11.3 G4）：
 *   1. 父 shell 的 `ELECTRON_RUN_AS_NODE=1` 会漏给 Electron ⇒ 退化成 Node，
 *      报 `Cannot read properties of undefined (reading 'commandLine')`。**在 spawn 前删掉**，
 *      不靠"记得手打 `env -u`"。
 *   2. Electron 把「目录」当 app 启动时，该目录必须有含 `main` 的 `package.json`。
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ELECTRON_APP = join(HERE, '..', 'electron')

/**
 * 起一次渲染。返回 { code, lines, stats }；`lines` 是所有 `[bench] {...}` 的结构化行。
 * @param {{ binary: string, url: string, window?: 'visible'|'hidden', flags?: string[], timeoutMs?: number, onLine?: (line: string) => void }} options
 */
export function launchRenderer(options) {
  const { binary, url, window = 'visible', flags = [], timeoutMs = 600000, onLine } = options

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE // 坑 1
  env.BENCH_URL = url
  env.BENCH_WINDOW = window
  env.BENCH_FLAGS = flags.join(',')

  return new Promise((resolveDone) => {
    const child = spawn(binary, [ELECTRON_APP], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const lines = []
    let settled = false
    let timer = null

    const finish = (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch {
        /* 已退出 */
      }
      resolveDone({ code, lines })
    }

    const inspect = (buffer) => {
      const text = buffer.toString()
      process.stdout.write(text)
      for (const raw of text.split('\n')) {
        const line = raw.replace(/^\[page\]\s*/, '').trim()
        if (!line.startsWith('[bench]')) continue
        lines.push(line)
        onLine?.(line)
        if (line.includes('"step":"finished"')) setTimeout(() => finish(0), 800)
        if (line.includes('"step":"error"')) setTimeout(() => finish(1), 400)
      }
    }

    child.stdout.on('data', inspect)
    child.stderr.on('data', (buffer) => process.stderr.write(buffer.toString()))
    child.on('exit', (code) => finish(code ?? 0))
    child.on('error', (error) => {
      console.error('[bench] Electron 启动失败：', error.message)
      finish(1)
    })
    timer = setTimeout(() => {
      console.error(`[bench] 渲染超时（${timeoutMs}ms），强制结束`)
      finish(1)
    }, timeoutMs)
  })
}

/** 从 `[bench] {...}` 行里摘出结构化事件。 */
export function parseEvents(lines) {
  const events = []
  for (const line of lines) {
    const json = line.slice('[bench]'.length).trim()
    try {
      events.push(JSON.parse(json))
    } catch {
      /* 非 JSON 行（比如异常栈）忽略 */
    }
  }
  return events
}
