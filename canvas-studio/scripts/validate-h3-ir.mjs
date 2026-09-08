#!/usr/bin/env node
/**
 * H3-Context-IR 简报格式校验 CLI（对应 MiniMax-H3-Context-IR-Skill validate.py 的用法）。
 *
 * 依赖 build 产物 lib/h3-ir-validate.js（h3-prompt-writing skill 的 Workflow 第 5 步引用）。
 *
 * 用法:
 *   node scripts/validate-h3-ir.mjs brief.txt --mode T2VA --duration 10
 *   node scripts/validate-h3-ir.mjs brief.txt --mode Ref2VA --duration 5 --videos 1 --audios 1
 *   node scripts/validate-h3-ir.mjs --self-test        # 4 组官方 IR 输出必须 100% 通过
 *
 * 退出码：0 = 无 ERROR（WARN 不判失败）；1 = 有 ERROR；2 = 用法错误。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib', 'h3-ir-validate.js')

if (!existsSync(LIB)) {
  console.error(`缺少构建产物 ${LIB}，先执行 build（node node_modules/.bin/tsdown）`)
  process.exit(2)
}
const { validateH3Ir } = await import(LIB)

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--self-test') args.selfTest = true
    else if (a === '--allow-transitions') args.allowTransitions = true
    else if (a === '--json') args.json = true
    else if (a === '--mode') args.mode = argv[++i]
    else if (a === '--duration') args.duration = Number(argv[++i])
    else if (a === '--pictures') args.pictures = Number(argv[++i])
    else if (a === '--videos') args.videos = Number(argv[++i])
    else if (a === '--audios') args.audios = Number(argv[++i])
    else args._.push(a)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.selfTest) {
  const fixture = join(ROOT, 'tests', 'fixtures', 'official_ir.json')
  if (!existsSync(fixture)) {
    console.error(`缺少参考数据 ${fixture}`)
    process.exit(2)
  }
  const pairs = JSON.parse(readFileSync(fixture, 'utf8'))
  let failed = 0
  console.log('自检：四组官方 IR 输出必须 100% 通过')
  for (const pair of pairs) {
    const counts = { image_url: 0, video_url: 0, audio_url: 0 }
    for (const c of pair.request.content) {
      if (c.type in counts) counts[c.type] += 1
    }
    const rep = validateH3Ir(pair.ir_output, {
      mode: pair.mode,
      duration: pair.duration,
      pictures: counts.image_url,
      videos: counts.video_url,
      audios: counts.audio_url,
    })
    if (!rep.ok) failed += 1
    console.log(`[${rep.ok ? 'PASS' : 'FAIL'}] ${pair.id.padEnd(22)} mode=${pair.mode.padEnd(7)} errors=${rep.errors.length} warns=${rep.warnings.length}`)
    for (const f of rep.findings) console.log(`         ${f.severity.padEnd(5)} ${f.rule.padEnd(10)} ${f.message}`)
  }
  if (failed) {
    console.error(`\n❌ ${failed}/${pairs.length} 组官方输出未通过 —— 校验器写错了，先修校验器。`)
    process.exit(1)
  }
  console.log(`\n✅ ${pairs.length}/${pairs.length} 组官方输出全部通过。`)
  process.exit(0)
}

const [file, mode, duration] = args._
if (!(file && mode && args.duration !== undefined)) {
  console.error('用法: node scripts/validate-h3-ir.mjs <file> --mode <MODE> --duration <seconds> [--pictures N] [--videos N] [--audios N] | --self-test')
  process.exit(2)
}

const rep = validateH3Ir(readFileSync(file, 'utf8'), {
  mode,
  duration: args.duration,
  pictures: args.pictures ?? 0,
  videos: args.videos ?? 0,
  audios: args.audios ?? 0,
  allowTransitions: args.allowTransitions ?? false,
})
if (args.json) {
  console.log(JSON.stringify({ ok: rep.ok, mode: rep.mode, findings: rep.findings }, null, 2))
} else {
  for (const f of rep.findings) console.log(`${f.severity.padEnd(5)} ${f.rule.padEnd(10)} ${f.message}`)
  console.log(`\n${rep.ok ? 'PASS' : 'FAIL'} — ${rep.errors.length} errors, ${rep.warnings.length} warnings`)
}
process.exit(rep.ok ? 0 : 1)
