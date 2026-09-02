/**
 * 视觉禁令护栏冒烟测试（CV-068 方案 A）。
 *
 * 背景：qwen3.8-27b-mtp 等主模型无 image input，agent 在「生成预览后自查」
 * 场景试图直接读本地 file_path 触发 DSH 运行时能力校验报错
 * （model does not declare image input）。CV-068 在创作规范 SKILL.md 与
 * image2vl 工具描述里加显式禁令，引导走 upload_image → image2vl 唯一通道。
 *
 * 本测试守护：
 * 1. `skills/`（运行时加载产物）与 `skills-local/`（手写源）双副本一致，
 *    防止只改一边导致漂移（skills/ 由 sync 脚本从 skills-local 拷贝）；
 * 2. SKILL.md 禁令关键词在位（被误删直接红）；
 * 3. lib/host-tools.js 产物中 image2vl 描述含工具级护栏（防源码改产物漏 build）。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_SKILL = join(PKG_ROOT, 'skills', 'canvas-studio-creation', 'SKILL.md')
const LOCAL_SKILL = join(PKG_ROOT, 'skills-local', 'canvas-studio-creation', 'SKILL.md')

test('护栏：skills/ 运行时产物与 skills-local 手写源双副本一致（防漂移）', () => {
  const runtime = readFileSync(RUNTIME_SKILL, 'utf8')
  const local = readFileSync(LOCAL_SKILL, 'utf8')
  assert.equal(runtime, local, 'skills/ 与 skills-local/ 的 canvas-studio-creation SKILL.md 不一致——只改了一边，请双写或重跑 scripts/sync-minimax-skills.mjs')
})

test('护栏：SKILL.md 含「无视觉」禁令与 image2vl 唯一通道（防误删）', () => {
  const md = readFileSync(RUNTIME_SKILL, 'utf8')
  // 禁令核心：明确无视觉能力 + 禁止直接读图变体 + 错误码提示
  assert.match(md, /没有视觉能力/, '缺少「没有视觉能力」声明')
  assert.match(md, /does not declare image input/, '缺少报错码提示（model does not declare image input）')
  assert.match(md, /file_path/, '缺少本地路径禁令（file_path）')
  // 唯一合规通道：image2vl + upload_image 前置
  assert.match(md, /唯一合规手段是图像分析工具 `image2vl`/, '缺少 image2vl 唯一通道指引')
  assert.match(md, /upload_image\(imageUrl=url\)/, '缺少 upload_image 前置步骤指引')
  // 产物 URL 用途澄清：不是给模型做视觉输入
  assert.match(md, /不是给你做视觉输入的/, '缺少产物 url 用途澄清')
})

test('护栏：lib/host-tools.js 产物中 image2vl 描述含工具级护栏（防漏 build）', () => {
  const src = readFileSync(join(PKG_ROOT, 'lib', 'host-tools.js'), 'utf8')
  const i2v = src.indexOf('image2vl')
  assert.ok(i2v !== -1, 'lib/host-tools.js 找不到 image2vl（产物未更新？先 build）')
  const segment = src.slice(i2v, i2v + 2000)
  assert.match(segment, /无法直接查看图片/, 'image2vl 描述缺少「无法直接查看图片」护栏')
  assert.match(segment, /upload_image/, 'image2vl 描述缺少 upload_image 前置指引')
  assert.match(segment, /does not declare image input/, 'image2vl 描述缺少报错码提示')
})
