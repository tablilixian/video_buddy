/**
 * Re-publish the tail of a captured CI log as workflow annotations.
 *
 * Job logs are only readable by people with repository rights, while
 * annotations are part of the check run payload. Writing the interesting tail
 * into `::error::` commands keeps a failing gate diagnosable from the API and
 * from the pull-request UI without downloading logs.
 *
 * Usage: node scripts/annotate-log-tail.mjs <log-file> [tail-lines]
 */

import { existsSync, readFileSync } from 'node:fs'

const TAIL_LINES_DEFAULT = 80
const TAIL_CHARS_LIMIT = 6000
const DETAIL_MESSAGE_LIMIT = 500
const DETAIL_MATCH_LIMIT = 5
const DETAIL_PATTERN = /(?:\berror\b|\bfailed\b|\bfailure\b|\bnot ok\b|AssertionError|\bexit code [1-9])/iu
const ANSI_ESCAPE = /\u001B\[[0-9;]*[A-Za-z]/gu

/** Escape the characters GitHub parses inside a workflow command payload. */
function escapeAnnotation(value) {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
}

function write(command) {
  process.stdout.write(`${command}\n`)
}

function truncate(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

function annotate(title, message) {
  write(`::error title=${title}::${escapeAnnotation(truncate(message, TAIL_CHARS_LIMIT))}`)
}

function detail(title, message) {
  write(`::error title=${title}::${escapeAnnotation(truncate(message, DETAIL_MESSAGE_LIMIT))}`)
}

function main(argv) {
  const [path, rawLines] = argv
  if (path === undefined) throw new Error('a log file path is required')
  if (!existsSync(path)) {
    // Earlier steps can fail before the gate writes its log; that case is
    // already annotated by the failing step itself.
    detail(`${path} missing`, `No captured log at ${path}; the failure happened before the gate command ran.`)
    return
  }
  const limit = Number.parseInt(rawLines ?? '', 10)
  const tailLines = Number.isSafeInteger(limit) && limit > 0 ? limit : TAIL_LINES_DEFAULT
  const text = readFileSync(path, 'utf8').replace(ANSI_ESCAPE, '')
  const lines = text.split(/\r?\n/u).filter(line => line.length > 0)
  if (lines.length === 0) {
    detail(`${path} empty`, 'The captured log is empty.')
    return
  }

  const details = lines
    .filter(line => DETAIL_PATTERN.test(line))
    .slice(-DETAIL_MATCH_LIMIT)
  for (const line of details) detail('gate error line', line.trim())

  annotate(`${path} tail`, lines.slice(-tailLines).join('\n'))
}

try {
  main(process.argv.slice(2))
} catch (cause) {
  const detailText = cause instanceof Error ? cause.message : String(cause)
  process.stderr.write(`annotate-log-tail: ${detailText}\n`)
  process.exitCode = 1
}
