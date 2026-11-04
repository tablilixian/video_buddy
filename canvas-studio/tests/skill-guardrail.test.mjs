/**
 * 读图能力护栏冒烟测试（CV-068 → 2026-11-04 能力恢复改版）。
 *
 * 历史背景：早期创作模型（qwen3.8-27b-mtp 等）无 image input，agent 直接读本地
 * file_path 会触发 DSH 能力校验报错（model does not declare image input）；CV-068
 * 因此在创作规范里加「无视觉」禁令，把分析通道收敛到 upload_image → image2vl。
 *
 * 2026-11-04 实测：DramaServer /v1/llm 把 deepseek-flash 路由到
 * deepseek-v4.1-flash，带 image_url 的请求 200 且能正确描述图像；缺的只是
 * llm-pi-ai 模型行的 input 声明（src/gateway.ts 已补 input: [text, image]）。
 * 能力恢复后禁令方向反转：直接 read_image 是画面类判据首选，image2vl 降级为
 * 「后端另一个 VLM 的文字转述，不可当事实」。
 *
 * 本测试守护：
 * 1. toolchain.md 同时写清「可直接读图」与「VLM 输出不可当事实」，旧禁令不得复活；
 * 2. lib/host-tools.js 产物中 image2vl 描述同步（防源码改产物漏 build）。
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
// CV-321 起，平台事实类内容（filename 语义、读图能力、附件转存、资产库 lib:uuid、
// 产物 URL 用途…）已从总纲「核心规则」节下沉到 toolchain.md §平台事实清单 ——
// 总纲只留路由 / 审批语义 / 安全协议。因此这两条护栏**跟着内容搬家**：
// 断言的**保护对象不变**（能力声明、取证通道边界、同步单任务纪律），
// 只是改到内容现在所在的那本分册上。内容被删仍然红。
const TOOLCHAIN = join(PKG_ROOT, 'skills', 'canvas-studio-creation', 'references', 'toolchain.md')

test('护栏：toolchain.md 含读图通道与 VLM 边界，旧「无视觉」禁令不得复活', () => {
  const md = readFileSync(TOOLCHAIN, 'utf8')
  // 能力声明 + 首选取证通道
  assert.match(md, /input: \[text, image\]/, '缺少图像输入能力声明')
  assert.match(md, /`read_image\(file_path/, '缺少直接读本地图的首选通道')
  assert.match(md, /file_path/, '缺少本地路径说明')
  // 边界：VLM 文字转述不可当事实、精确值走像素工具
  assert.match(md, /不得当事实/, '缺少「VLM 文字结果不可当事实」边界')
  assert.match(md, /只作辅助参考/, '缺少 image2vl 辅助定位')
  assert.match(md, /`inspect_image`/, '缺少像素真值工具指引')
  // 远端句柄路径仍在（附件 / 产物 URL 不是本地图片）
  assert.match(md, /视频用 `video2vl`/, '缺少 video2vl 视频分析通道指引')
  assert.match(md, /upload_image\(imageUrl=url\)/, '缺少 upload_image 前置步骤指引')
  assert.match(md, /不是本地图片路径/, '缺少产物 url 用途澄清')
  // 反向护栏：旧禁令复活会误导模型放弃已经可用的读图能力
  assert.doesNotMatch(md, /你没有视觉能力/, '旧「无视觉」禁令复活了')
  assert.doesNotMatch(md, /唯一合规手段是/, 'image2vl 不应再是唯一合规通道')
})

test('护栏：lib/host-tools.js 产物中 image2vl 描述含读图通道与 VLM 边界（防漏 build）', () => {
  const src = readFileSync(join(PKG_ROOT, 'lib', 'host-tools.js'), 'utf8')
  // CV-155：锚点必须是**工具定义**本身，不能拿「首次出现的 'image2vl'」当锚点 —— 源码
  // 别处（注释 / 渲染函数）一旦提到 image2vl，锚点就被提前，断言落到无关片段上误报
  // 「护栏缺失」（本次实测踩到：renderResult 的注释里写了 image2vl）。`name: 'image2vl'`
  // 只在 defineTool 里出现，稳定。
  const i2v = src.indexOf("name: 'image2vl'")
  assert.ok(i2v !== -1, "lib/host-tools.js 找不到 name: 'image2vl'（产物未更新？先 build）")
  const segment = src.slice(i2v, i2v + 3000)
  assert.match(segment, /read_image/, 'image2vl 描述缺少「自己直接读图」通道指引')
  assert.match(segment, /CV-214 VLM 不可靠警告/, 'image2vl 描述缺少 VLM 不可靠警告')
  assert.match(segment, /upload_image/, 'image2vl 描述缺少 upload_image 前置指引')
  assert.match(segment, /inspect_image/, 'image2vl 描述缺少像素定位替代工具')
  assert.doesNotMatch(segment, /你是文本模型/, '旧「你是文本模型」护栏复活了')
  assert.doesNotMatch(segment, /无法直接查看图片/, '旧「无法直接查看图片」护栏复活了')
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

test('护栏：第 7 步不再说「可并行」，且骨架与分册都写明后端同步单任务（CV-215）', () => {
  const md = readFileSync(RUNTIME_SKILL, 'utf8')
  assert.ok(!md.includes('可并行'), 'SKILL.md 不得再出现「可并行」——后端是同步单任务（CV-215 修正）')
  assert.match(md, /同步单任务/, 'SKILL.md 第 7 步缺少「同步单任务」约束（被整段删掉了？）')
  const toolchain = readFileSync(TOOLCHAIN, 'utf8')
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
