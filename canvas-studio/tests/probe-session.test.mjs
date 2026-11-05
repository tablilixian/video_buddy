/**
 * A-3 判定框架守卫：`scripts/probe-session.mjs` 必须能读真实会话。
 *
 * 自检发现的缺口（2026-11-05）：真机落盘的会话 1379/1379 全是 `.jsonl.zstd`，
 * 脚本原本只会读裸 jsonl ⇒ 判定框架一个真实会话都打不开。本文件两条腿：
 * ① 裸 jsonl fixture 的解析语义（配对 / 计数 / 错误归集）；
 * ② zstd 路径（本机 `zstd -dc` 解压；机器没装 zstd 时跳过该条，不假红）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'probe-session.mjs')

/** 一份最小但覆盖全事件面的会话：header / 两轮 / 一次成功调用 / 一次错误调用。 */
const FIXTURE_LINES = [
  JSON.stringify({ type: 'request/header', time: 1793161890000, data: { header: { config: { provider: 'test-gateway', model: 'deepseek-flash' } } } }),
  JSON.stringify({ type: 'turn/start', time: 1793161890500, data: { turn: 1 } }),
  JSON.stringify({ type: 'user/message', time: 1793161891000, data: { content: [{ type: 'text', text: '做一段科普片' }] } }),
  JSON.stringify({ type: 'assistant/message', time: 1793161892000, data: { message: { content: [{ type: 'text', text: '好的，先渲染探针。' }], source: { responseModel: 'deepseek-v4.1-flash' } } } }),
  JSON.stringify({ type: 'tool/call', time: 1793161893000, data: { callId: 'c1', name: 'render_composition', arguments: '{"manifestPath":"/p/build/manifest.json"}' } }),
  JSON.stringify({ type: 'tool/result', time: 1793161900000, data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: '渲染报告：quality=draft · 120 帧 · 体检=2 条\n[编排体检] 命中 2 条：ML-02 / ML-10（前 2 条原文见下方渲染报告）' }] } } }),
  JSON.stringify({ type: 'tool/call', time: 1793161901000, data: { callId: 'c2', name: 'read_image', arguments: '{"file_path":"/p/assets/f.png"}' } }),
  JSON.stringify({ type: 'tool/result', time: 1793161902000, data: { message: { toolCallId: 'c2', isError: true, content: [{ type: 'text', text: 'CS-USER-ERR：模型 does not declare image input' }] } } }),
  JSON.stringify({ type: 'turn/end', time: 1793161903000, data: { turn: 1 } }),
  '{bad json line 应被跳过}',
]

function runProbe(inputPath, cwd) {
  return spawnSync('node', [SCRIPT, inputPath], { cwd, encoding: 'utf8' })
}

test('裸 jsonl：配对 / 计数 / 错误归集 / 关键回执命中', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-probe-'))
  try {
    const input = join(dir, 'session.v4.jsonl')
    writeFileSync(input, FIXTURE_LINES.join('\n'), 'utf8')
    const run = runProbe(input, dir)
    assert.equal(run.status, 0, `退出码 ${run.status}：${run.stderr?.slice(0, 300)}`)
    const out = /已写入: (.+)/.exec(run.stdout)?.[1]
    assert.ok(out && existsSync(out), '应输出取证草稿路径')
    const md = readFileSync(out, 'utf8')
    // 配对语义：c1 的渲染报告挂在 render_composition 名下
    assert.match(md, /render_composition[\s\S]{0,400}体检=2 条/u, 'callId 必须把调用名与结果配对')
    // 错误归集：isError 的 read_image 进错误回执
    assert.match(md, /## 错误回执[\s\S]*\*\*read_image\*\*[\s\S]*does not declare image input/u)
    // 计数：工具 breakdown + summary
    assert.match(md, /"read_image": 1/u)
    assert.match(md, /"toolCalls": 2/u)
    assert.match(md, /"errors": 1/u)
    // 关键回执命中分类
    assert.match(md, /## 关键回执 · 体检 lint（1）/u)
    assert.match(md, /## 关键回执 · 读图（1）/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('zstd：.jsonl.zstd 输入自动解压（机器无 zstd 时跳过）', () => {
  const has = spawnSync('which', ['zstd'], { encoding: 'utf8' }).status === 0
  if (!has) {
    console.log('    ↷ 本机无 zstd，跳过解压用例（真机自检路径见 scripts/probe-session.mjs 头注）')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'cs-probe-z-'))
  try {
    const plain = join(dir, 'session.v4.jsonl')
    writeFileSync(plain, FIXTURE_LINES.join('\n'), 'utf8')
    const zstdPath = `${plain}.zstd`
    const comp = spawnSync('zstd', ['-f', plain, '-o', zstdPath])
    assert.equal(comp.status, 0, `zstd 压缩失败：${comp.stderr}`)
    const run = runProbe(zstdPath, dir)
    assert.equal(run.status, 0, `zstd 输入应可解析：${run.stderr?.slice(0, 300)}`)
    assert.match(run.stdout, /"toolCalls": 2/u, '解压后事件数一致')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('坏输入：退出码非 0 且给指引（不静默成功）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-probe-e-'))
  try {
    const missing = join(dir, 'nope.jsonl')
    const run = runProbe(missing, dir)
    assert.notEqual(run.status, 0, '缺失文件必须显式失败')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
