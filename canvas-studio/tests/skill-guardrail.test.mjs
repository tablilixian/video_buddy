/**
 * 视觉禁令护栏冒烟测试（CV-068 方案 A）。
 *
 * 背景：qwen3.8-27b-mtp 等主模型无 image input，agent 在「生成预览后自查」
 * 场景试图直接读本地 file_path 触发 DSH 运行时能力校验报错
 * （model does not declare image input）。CV-068 在创作规范 SKILL.md 与
 * image2vl 工具描述里加显式禁令，引导走 upload_image → image2vl 唯一通道。
 *
 * 本测试守护：
 * 1. SKILL.md 禁令关键词在位（被误删直接红）；
 * 2. lib/host-tools.js 产物中 image2vl 描述含工具级护栏（防源码改产物漏 build）。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// CV-215：从**编译产物**取常量 —— `lib/host-tools.js` 里只有 `+ DRAMA_SERIAL_HINT`
// 这个引用，字面量落在 lib/config.js，所以断言的正确姿势是「常量内容对 + 每个工具都引用它」，
// 而不是「在 host-tools.js 里找中文」。
import { DRAMA_SERIAL_HINT, DRAMA_VIDEO_ASYNC_HINT } from '../lib/config.js'

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_SKILL = join(PKG_ROOT, 'skills', 'canvas-studio-creation', 'SKILL.md')
test('护栏：SKILL.md 含「无视觉」禁令与 image2vl 唯一通道（防误删）', () => {
  const md = readFileSync(RUNTIME_SKILL, 'utf8')
  // 禁令核心：明确无视觉能力 + 禁止直接读图变体 + 错误码提示
  assert.match(md, /没有视觉能力/, '缺少「没有视觉能力」声明')
  assert.match(md, /does not declare image input/, '缺少报错码提示（model does not declare image input）')
  assert.match(md, /file_path/, '缺少本地路径禁令（file_path）')
  // 唯一合规通道：image2vl + upload_image 前置
  assert.match(md, /唯一合规手段是图像分析工具 `image2vl`/, '缺少 image2vl 唯一通道指引')
  // CV-230：视频同理 —— 没有视觉能力就等于也没法「看视频」，要给 video2vl 这条出口，
  // 否则模型只会知道图能分析、遇到视频就去读文件。与上一条同属「防误删」。
  assert.match(md, /视频用 `video2vl`/, '缺少 video2vl 视频分析通道指引')
  assert.match(md, /upload_image\(imageUrl=url\)/, '缺少 upload_image 前置步骤指引')
  // 产物 URL 用途澄清：不是给模型做视觉输入
  assert.match(md, /不是给你做视觉输入的/, '缺少产物 url 用途澄清')
})

test('护栏：lib/host-tools.js 产物中 image2vl 描述含工具级护栏（防漏 build）', () => {
  const src = readFileSync(join(PKG_ROOT, 'lib', 'host-tools.js'), 'utf8')
  // CV-155：锚点必须是**工具定义**本身，不能拿「首次出现的 'image2vl'」当锚点 —— 源码
  // 别处（注释 / 渲染函数）一旦提到 image2vl，锚点就被提前，断言落到无关片段上误报
  // 「护栏缺失」（本次实测踩到：renderResult 的注释里写了 image2vl）。`name: 'image2vl'`
  // 只在 defineTool 里出现，稳定。
  const i2v = src.indexOf("name: 'image2vl'")
  assert.ok(i2v !== -1, "lib/host-tools.js 找不到 name: 'image2vl'（产物未更新？先 build）")
  const segment = src.slice(i2v, i2v + 2000)
  assert.match(segment, /无法直接查看图片/, 'image2vl 描述缺少「无法直接查看图片」护栏')
  assert.match(segment, /upload_image/, 'image2vl 描述缺少 upload_image 前置指引')
  assert.match(segment, /does not declare image input/, 'image2vl 描述缺少报错码提示')
})

/**
 * CV-215：后端「同步单任务」纪律必须传达给模型。
 *
 * 背景：Drama Backend 同刻只处理一个请求（并发只排队、墙钟不变），但这条例律此前
 * **只写在 docs/api.md 这个开发者文档里**（不进模型上下文）；而 SKILL.md 第 7 步
 * 反倒写着 upload_image「（可并行）」，与事实相反。本守卫锁三件事：
 * 1. SKILL.md 第 7 步不得再出现「可并行」（回归点，改回去即红）；
 * 2. SKILL.md 与分册含「同步单任务」表述（被整段删掉即红）；
 * 3. 同步批量工具的描述都带 `DRAMA_SERIAL_HINT`（防谁重排描述时把 hint 弄丢）；
 * 4. 后端 0.5.0 异步化：视频两工具换带 `DRAMA_VIDEO_ASYNC_HINT`（可连续提交），
 *    且**不得**再引用串行提示——两套纪律并存会自相矛盾。
 *
 * 锚点必须用 `name: '<tool>'`——不用「首次出现的工具名」（CV-155 的教训：源码别处
 * 提到工具名会让锚点提前，断言落到无关片段上误判）。
 */
const SERIAL_HINT_TOOLS = ['image_generate', 'upload_image']
const ASYNC_HINT_TOOLS = ['video_generate', 'video_composite']

test('护栏：SKILL.md 第 7 步不再说「可并行」，且两处都写明后端同步单任务（CV-215）', () => {
  const md = readFileSync(RUNTIME_SKILL, 'utf8')
  assert.ok(!md.includes('可并行'), 'SKILL.md 不得再出现「可并行」——后端是同步单任务（CV-215 修正）')
  assert.match(md, /后端同步单任务/, 'SKILL.md 缺少「后端同步单任务」约束（被整段删掉了？）')
  const toolchain = readFileSync(
    join(PKG_ROOT, 'skills', 'canvas-studio-creation', 'references', 'toolchain.md'),
    'utf8',
  )
  assert.match(toolchain, /同步单任务/, 'toolchain.md 缺少「同步单任务」分册说明')
  assert.match(toolchain, /逐个调用/, 'toolchain.md 缺少「逐个调用」调用纪律')
})

test('护栏：批量风险工具的提示分两档——同步工具串行、视频工具异步（CV-215 / 0.5.0 异步化）', () => {
  // ① 常量本身就是模型可见文本：它必须真的在说这两件事。
  assert.match(DRAMA_SERIAL_HINT, /同步单任务/, 'DRAMA_SERIAL_HINT 不再声明「同步单任务」')
  assert.match(DRAMA_SERIAL_HINT, /逐个调用/, 'DRAMA_SERIAL_HINT 缺少「逐个调用」纪律')
  // ② 每个批量风险工具都必须引用它（漏加 / 被谁重排描述时删掉，这里就红）。
  const src = readFileSync(join(PKG_ROOT, 'lib', 'host-tools.js'), 'utf8')
  for (const tool of SERIAL_HINT_TOOLS) {
    const anchor = `name: '${tool}'`
    const at = src.indexOf(anchor)
    assert.ok(at !== -1, `lib/host-tools.js 找不到 ${anchor}（产物未更新？先 build）`)
    // 描述紧跟在 name 之后，3000 字符足以覆盖本工具的 description 全段。
    const segment = src.slice(at, at + 3000)
    assert.match(segment, /DRAMA_SERIAL_HINT/, `${tool} 描述没有引用 DRAMA_SERIAL_HINT（漏加或被删）`)
  }
  // ③ 视频两端点改异步（后端 0.5.0）：描述换用 DRAMA_VIDEO_ASYNC_HINT——
  // 「可连续提交」是放开并发的模型可见面，丢了它 agent 会退回逐个等待。
  assert.match(DRAMA_VIDEO_ASYNC_HINT, /异步任务/, 'DRAMA_VIDEO_ASYNC_HINT 不再声明「异步任务」')
  assert.match(DRAMA_VIDEO_ASYNC_HINT, /连续提交/, 'DRAMA_VIDEO_ASYNC_HINT 缺少「连续提交」纪律')
  for (const tool of ASYNC_HINT_TOOLS) {
    const anchor = `name: '${tool}'`
    const at = src.indexOf(anchor)
    assert.ok(at !== -1, `lib/host-tools.js 找不到 ${anchor}（产物未更新？先 build）`)
    const segment = src.slice(at, at + 3000)
    assert.doesNotMatch(segment, /DRAMA_SERIAL_HINT/, `${tool} 是异步工具，不应再引用串行提示`)
    assert.match(segment, /DRAMA_VIDEO_ASYNC_HINT/, `${tool} 描述没有引用 DRAMA_VIDEO_ASYNC_HINT（漏加或被删）`)
  }
})
