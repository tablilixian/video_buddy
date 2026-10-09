/**
 * BUG-002：音频裁切（Host 侧本地 ffmpeg + `cut_audio` 工具）契约测试。
 *
 * ## 抓的是什么 bug
 *
 * ffmpeg 二进制早已随包（CV-201），但 agent 侧**没有任何音频加工入口**：
 * `music_generation` 只能整段生成、`compose_video.bgmNodeId` 只能整段混入，于是
 * 用户说「把这首音乐裁成 12–20 秒」时，模型只能去问人 ffmpeg 在哪、自己拼 shell
 * 命令（BUG-002 现场）。修复 = 能力模块 `src/audio-cut.ts` + `cut_audio` 工具 +
 * skill/描述两处互提指引。
 *
 * 这一份守六件事：
 *  ① **参数拼装正确**（不是靠纯函数断言，而是读假 ffmpeg 记下的真实 argv）：
 *     `-ss/-i/-t/-vn/-map 0:a:0/-c:a libmp3lame` 与「输出路径是最后一个参数」；
 *  ② **边界语义**：起点越界报错并给出可用区间、终点超长截到末尾 + warnings、
 *     非法区间（start ≥ end / 负数 / 非数字）与非法文件名（穿越 / 非媒体 / 不存在）一律拒收；
 *  ③ **半成品不留盘**：ffmpeg 失败时输出文件必须被清掉；
 *  ④ **落卡**：新音频节点带 `toolName` / `origin` / `sourceIds` / 实测 `duration`，
 *     标题写清区间，血缘指向源节点 —— 漏登记 `asset-capture` 就会「裁完画布不刷新」；
 *  ⑤ **不接审批门**：`cut_audio` 不得出现在 `approval-gate` 的任何一份名单里
 *     （纯本地、不调后端，拦它只会逼模型绕路）；
 *  ⑥ **render 能把 url / nodeId / 区间讲清楚**（模型看不见 = 用户不知道）。
 *
 * 能力层用显式 `ffmpegPath` 注入假替身；工具层走 `FFMPEG_PATH` 环境变量（工具
 * 不透传 ffmpegPath，正是生产形态）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cutAudioSegment, AUDIO_CUT_OUTPUT_EXT } from '../lib/audio-cut.js'
import { createStudioTools } from '../lib/host-tools.js'
import { ProjectRegistry } from '../lib/projects.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 假 ffmpeg（sh 替身）：
 *  - **无 `-y`**（探测 `ffmpeg -i <file>`）：向 stderr 打印 `Duration:` 并 exit 1。
 *    时长优先读旁路 `<file>.dur`（裁剪产出时由 `-t` 写入），否则按文件名分档
 *    （`song*` = 30s、`clip*` = 12s、其余 5s）—— 于是「end 超长截到末尾」与
 *    「duration 是实测值」都能被真实断言，而不是靠 mock。
 *  - **有 `-y`**（产出）：把 `-t` 的值写进 `<out>.dur`，往输出写最小字节，exit 0；
 *    `FAKE_FFMPEG_FAIL` 非空则 exit 1（半成品清理用例）。
 *  - `FAKE_FFMPEG_LOG` 非空：追加每次调用的完整 argv（① 的断言来源）。
 */
const FAKE_FFMPEG = [
  '#!/bin/sh',
  'if [ -n "$FAKE_FFMPEG_LOG" ]; then printf \'%s\\n\' "$*" >> "$FAKE_FFMPEG_LOG"; fi',
  'HAS_Y=0',
  'T=""',
  'PREV=""',
  'LAST=""',
  'for arg in "$@"; do',
  '  if [ "$PREV" = "-t" ]; then T="$arg"; fi',
  '  if [ "$PREV" = "-i" ]; then SRC="$arg"; fi',
  '  case "$arg" in',
  '    -y) HAS_Y=1 ;;',
  '  esac',
  '  PREV="$arg"',
  '  LAST="$arg"',
  'done',
  'if [ "$HAS_Y" = "1" ]; then',
  '  if [ -n "$FAKE_FFMPEG_FAIL" ]; then echo "fake encode failure: broken stream" >&2; exit 1; fi',
  '  printf \'FAKEMP3\' > "$LAST"',
  '  if [ -n "$T" ]; then printf \'%s\' "$T" > "$LAST.dur"; fi',
  '  exit 0',
  'fi',
  'D=5',
  'if [ -f "$LAST.dur" ]; then',
  '  D=$(cat "$LAST.dur")',
  'else',
  '  case "$LAST" in',
  '    *song*) D=30 ;;',
  '    *clip*) D=12 ;;',
  '  esac',
  'fi',
  'SECS=$D',
  'FRAC=0',
  'case "$D" in',
  '  *.*) SECS=${D%%.*}; FRAC=${D##*.} ;;',
  'esac',
  'MM=$((SECS / 60))',
  'SS=$((SECS % 60))',
  'printf \'  Duration: 00:%02d:%02d.%s00, start: 0.000000, bitrate: 1024 kb/s\\n\' "$MM" "$SS" "$FRAC" >&2',
  'echo \'    Stream #0:0: Audio: mp3, 44100 Hz, stereo\' >&2',
  'exit 1',
].join('\n')

/** 建临时工作区 + 假 ffmpeg，返回全部素材；测试体内一律 `try/finally` 清场。 */
async function makeWorkspace(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const ffmpegPath = join(dir, 'fake-ffmpeg.sh')
  await writeFile(ffmpegPath, FAKE_FFMPEG)
  await chmod(ffmpegPath, 0o755)
  const log = join(dir, 'ffmpeg.log')
  const registry = new ProjectRegistry(dir)
  const project = await registry.create('裁剪测试')
  const assetsDir = registry.assetsDir(project.id)
  await mkdir(assetsDir, { recursive: true })
  return { dir, ffmpegPath, log, registry, project, assetsDir }
}

/** 读假 ffmpeg 记下的 argv（每次调用一行）。 */
async function readLog(path) {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter((line) => line.trim().length > 0)
  } catch {
    return []
  }
}

/**
 * 从 argv 日志里挑出**产出调用**那一行。
 *
 * 判据必须是 `libmp3lame` 而不是 `-y`：BSD `mkdtemp` 的随机后缀是字母数字混排，
 * 可能以 `y` 开头 ⇒ 临时目录名 `…-yXXXXXX` 会让**探测行**（`-i <源路径>`）也含
 * `-y`，按 `-y` 挑就会挑到探测行、断言 `-vn` 时随机变红（1/62 概率的假红）。
 */
function findEncodeLine(calls) {
  const line = calls.find((entry) => entry.includes('libmp3lame'))
  assert.ok(line, '应有一次 libmp3lame 产出调用（按编码器定位，不按 -y）')
  return line.split(' ')
}

/** 工具 execute 的最小上下文（与其它工具测试同一形态）。 */
const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(15000) })

// ---------------------------------------------------------------------------
// 1. 能力层：参数拼装与产物
// ---------------------------------------------------------------------------
test('cut_audio 能力：-ss/-i/-t/-vn/-map/-c:a libmp3lame 拼装正确，产物落 mp3，duration 是实测值', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-')
  try {
    process.env.FAKE_FFMPEG_LOG = ctx.log
    await writeFile(join(ctx.assetsDir, 'song.mp3'), 'FAKESOURCE')

    const result = await cutAudioSegment(ctx.registry, ctx.project.id, { file: 'song.mp3', start: 12, end: 20 }, undefined, ctx.ffmpegPath)

    assert.equal(result.start, 12)
    assert.equal(result.end, 20)
    assert.equal(result.duration, 8, 'duration 来自落盘后探测（假替身把 -t 写进旁路时长）')
    assert.equal(result.warnings, undefined, '区间合法时不应有 warnings')
    assert.match(result.url, new RegExp(`^/canvas-studio/assets/${ctx.project.id}/[0-9a-f-]+\\.${AUDIO_CUT_OUTPUT_EXT}$`))
    assert.equal(result.assetFile, result.url.split('/').at(-1))

    const bytes = await readFile(join(ctx.assetsDir, result.assetFile))
    assert.ok(bytes.length > 0, '产物文件应已写入 assets 目录')

    // ① 真实 argv（不是纯函数断言）。
    const argv = findEncodeLine(await readLog(ctx.log))
    assert.equal(argv[0], '-hide_banner')
    assert.ok(argv.includes('-ss') && argv.includes('12'), '-ss 应是入参起点')
    assert.equal(argv[argv.indexOf('-i') + 1], join(ctx.assetsDir, 'song.mp3'), '-i 应指向源文件')
    assert.equal(argv[argv.indexOf('-t') + 1], '8', '-t 是区间长度 8s')
    assert.ok(argv.includes('-vn'), '丢画面')
    assert.equal(argv[argv.indexOf('-map') + 1], '0:a:0', '只取首条音轨')
    assert.equal(argv[argv.indexOf('-c:a') + 1], 'libmp3lame', '重编码而非 -c copy')
    assert.equal(argv[argv.indexOf('-q:a') + 1], '2')
    assert.equal(argv.at(-1), join(ctx.assetsDir, result.assetFile), '输出路径必须是最后一个参数')
  } finally {
    delete process.env.FAKE_FFMPEG_LOG
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('cut_audio 能力：end 超过源时长自动截到末尾 + warnings，-t 与返回值同步收窄', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-tail-')
  try {
    process.env.FAKE_FFMPEG_LOG = ctx.log
    await writeFile(join(ctx.assetsDir, 'song.mp3'), 'FAKESOURCE')

    const result = await cutAudioSegment(ctx.registry, ctx.project.id, { file: 'song.mp3', start: 20, end: 40 }, undefined, ctx.ffmpegPath)

    assert.equal(result.end, 30, '实际终点被截到源文件总长（30s）')
    assert.equal(result.start, 20)
    assert.equal(result.duration, 10)
    assert.equal(result.warnings.length, 1, '必须有 warnings 转告用户')
    assert.match(result.warnings[0], /已截到末尾/u)

    const argv = findEncodeLine(await readLog(ctx.log))
    assert.equal(argv[argv.indexOf('-t') + 1], '10', '-t 用的是截断后的长度，不是入参 20s')
  } finally {
    delete process.env.FAKE_FFMPEG_LOG
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 2. 能力层：边界与拒收
// ---------------------------------------------------------------------------
test('cut_audio 能力：起点越界报错并给出可用区间', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-oob-')
  try {
    await writeFile(join(ctx.assetsDir, 'song.mp3'), 'FAKESOURCE')
    await assert.rejects(
      () => cutAudioSegment(ctx.registry, ctx.project.id, { file: 'song.mp3', start: 45, end: 50 }, undefined, ctx.ffmpegPath),
      (error) => {
        assert.equal(error.code, 'CS-USER-ERR')
        assert.match(error.message, /可用区间/u)
        return true
      },
    )
    const files = await readdir(ctx.assetsDir)
    assert.deepEqual(files, ['song.mp3'], '拒收时不得落任何新文件')
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('cut_audio 能力：非法区间（start ≥ end / 负数 / 非数字）一律拒收', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-range-')
  try {
    await writeFile(join(ctx.assetsDir, 'song.mp3'), 'FAKESOURCE')
    const cases = [
      [{ start: 20, end: 20 }, /必须小于终点/u],
      [{ start: 0, end: 0 }, /必须小于终点/u],
      [{ start: -1, end: 5 }, /不能为负数/u],
      [{ start: 'abc', end: 5 }, /必须是数字/u],
      [{ start: 0, end: 'xyz' }, /必须是数字/u],
    ]
    for (const [input, pattern] of cases) {
      await assert.rejects(
        () => cutAudioSegment(ctx.registry, ctx.project.id, { file: 'song.mp3', ...input }, undefined, ctx.ffmpegPath),
        pattern,
        `应拒绝 ${JSON.stringify(input)}`,
      )
    }
    const files = await readdir(ctx.assetsDir)
    assert.deepEqual(files, ['song.mp3'], '非法区间不得落任何新文件')
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('cut_audio 能力：文件名穿越 / 非媒体扩展 / 不存在一律拒收', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-files-')
  try {
    await writeFile(join(ctx.assetsDir, 'song.mp3'), 'FAKESOURCE')
    await writeFile(join(ctx.assetsDir, 'notes.txt'), 'not media')

    await assert.rejects(() => cutAudioSegment(ctx.registry, ctx.project.id, { file: '../secrets.mp3', start: 0, end: 1 }, undefined, ctx.ffmpegPath), /不合法/u)
    await assert.rejects(() => cutAudioSegment(ctx.registry, ctx.project.id, { file: 'a/b.mp3', start: 0, end: 1 }, undefined, ctx.ffmpegPath), /不合法/u)
    await assert.rejects(() => cutAudioSegment(ctx.registry, ctx.project.id, { file: 'notes.txt', start: 0, end: 1 }, undefined, ctx.ffmpegPath), /只能裁切音频或视频文件/u)
    await assert.rejects(() => cutAudioSegment(ctx.registry, ctx.project.id, { file: 'missing.mp3', start: 0, end: 1 }, undefined, ctx.ffmpegPath), /找不到音频文件/u)
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('cut_audio 能力：视频源可裁音轨（classifyFile 放行 video，-vn 丢画面）', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-video-')
  try {
    process.env.FAKE_FFMPEG_LOG = ctx.log
    await writeFile(join(ctx.assetsDir, 'clip.mp4'), 'FAKECLIP')
    const result = await cutAudioSegment(ctx.registry, ctx.project.id, { file: 'clip.mp4', start: 2, end: 8 }, undefined, ctx.ffmpegPath)
    assert.equal(result.start, 2)
    assert.equal(result.end, 8)
    assert.equal(result.duration, 6)
    const argv = findEncodeLine(await readLog(ctx.log))
    assert.ok(argv.includes('-vn'), '视频源必须丢画面只留音轨')
  } finally {
    delete process.env.FAKE_FFMPEG_LOG
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('cut_audio 能力：ffmpeg 失败不留半成品', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-fail-')
  try {
    await writeFile(join(ctx.assetsDir, 'song.mp3'), 'FAKESOURCE')
    process.env.FAKE_FFMPEG_FAIL = '1'
    await assert.rejects(
      () => cutAudioSegment(ctx.registry, ctx.project.id, { file: 'song.mp3', start: 1, end: 4 }, undefined, ctx.ffmpegPath),
      /音频裁切失败/u,
    )
    const files = await readdir(ctx.assetsDir)
    assert.deepEqual(files, ['song.mp3'], '失败时不得留下半成品 mp3')
  } finally {
    delete process.env.FAKE_FFMPEG_FAIL
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 3. 工具层：execute 落卡 / 血缘 / render（走 FFMPEG_PATH，即生产解析形态）
// ---------------------------------------------------------------------------
test('cut_audio 工具：@ref 解析 → 裁切 → 新音频节点落画布（血缘、标题、实测时长齐全）', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-tool-')
  const previousFfmpegPath = process.env.FFMPEG_PATH
  try {
    process.env.FFMPEG_PATH = ctx.ffmpegPath
    await writeFile(join(ctx.assetsDir, 'song.mp3'), 'FAKESOURCE')
    const source = {
      id: 'src-audio-1',
      kind: 'audio',
      url: `/canvas-studio/assets/${ctx.project.id}/song.mp3`,
      x: 40,
      y: 60,
      width: 260,
      height: 132,
      createdAt: 1000,
      title: '用户上传的长曲',
      duration: 30,
      origin: 'manual',
      sourceIds: [],
    }
    await ctx.registry.writeCanvas(ctx.project.id, [source])

    const tools = createStudioTools(ctx.registry, 3005)
    const cutAudio = tools.find((tool) => tool.name === 'cut_audio')
    assert.ok(cutAudio, 'cut_audio 工具应已注册（BUG-002 的 agent 侧入口）')

    const res = await cutAudio.execute({ audio: '@ref[用户上传的长曲]', start: 12, end: 20 }, EXEC(ctx.project.dir))
    assert.match(res.url, new RegExp(`^/canvas-studio/assets/${ctx.project.id}/[0-9a-f-]+\\.mp3$`))
    assert.equal(res.duration, 8, 'duration 必须是落盘实测值')
    assert.equal(res.start, 12)
    assert.equal(res.end, 20)
    assert.ok(res.warnings === undefined)

    const doc = await ctx.registry.readCanvas(ctx.project.id)
    assert.equal(doc.nodes.length, 2, '源节点保留，新增一张裁剪卡')
    const node = doc.nodes.find((candidate) => candidate.id === res.nodeId)
    assert.ok(node, '返回的 nodeId 必须真在画布上')
    assert.equal(node.kind, 'audio')
    assert.equal(node.toolName, 'cut_audio')
    assert.equal(node.origin, 'agent')
    assert.deepEqual(node.sourceIds, [source.id], '血缘指向源节点')
    assert.equal(node.duration, 8)
    assert.equal(node.title, '用户上传的长曲 · 裁剪 12–20s')
    assert.equal(node.width, 480, '音频节点用 AUDIO_NODE_WIDTH/HEIGHT（CV-289 起 480×168）')
    assert.equal(node.height, 168)
    assert.equal(node.url, res.url)

    // 源节点不能被顶掉。
    assert.ok(doc.nodes.some((candidate) => candidate.id === source.id), '源节点必须仍在画布上')

    // ⑥ render：模型/用户要能看见 url、节点 id 与区间。
    const blocks = cutAudio.output.render({ audio: '@ref[用户上传的长曲]' }, res)
    assert.equal(blocks.length, 1)
    assert.match(blocks[0].text, /已裁剪音频/u)
    assert.match(blocks[0].text, /12–20s/)
    assert.match(blocks[0].text, new RegExp(res.url))
    assert.match(blocks[0].text, new RegExp(res.nodeId))

    // ③ 再裁一刀互不影响：源节点不动，画布多一张卡。
    const second = await cutAudio.execute({ audio: 'song.mp3', start: 0, end: 3 }, EXEC(ctx.project.dir))
    const doc2 = await ctx.registry.readCanvas(ctx.project.id)
    assert.equal(doc2.nodes.length, 3)
    const bare = doc2.nodes.find((candidate) => candidate.id === second.nodeId)
    assert.equal(bare.title, '音频 · 裁剪 0–3s', '裸文件名无源节点时标题回落「音频」')
    assert.deepEqual(bare.sourceIds, [], '裸文件名没有血缘来源')
    assert.equal(bare.duration, 3)
  } finally {
    if (previousFfmpegPath === undefined) delete process.env.FFMPEG_PATH
    else process.env.FFMPEG_PATH = previousFfmpegPath
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('cut_audio 工具：end 超长走 warnings 而非报错，且 warnings 进 render', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-tool-tail-')
  const previousFfmpegPath = process.env.FFMPEG_PATH
  try {
    process.env.FFMPEG_PATH = ctx.ffmpegPath
    await writeFile(join(ctx.assetsDir, 'song.mp3'), 'FAKESOURCE')
    const tools = createStudioTools(ctx.registry, 3005)
    const cutAudio = tools.find((tool) => tool.name === 'cut_audio')

    const res = await cutAudio.execute({ audio: 'song.mp3', start: 25, end: 99 }, EXEC(ctx.project.dir))
    assert.equal(res.end, 30, '终点被截到源文件末尾')
    assert.equal(res.duration, 5)
    assert.equal(res.warnings.length, 1)
    const blocks = cutAudio.output.render({ audio: 'song.mp3' }, res)
    assert.match(blocks[0].text, /⚠️/u)
    assert.match(blocks[0].text, /已截到末尾/u)
  } finally {
    if (previousFfmpegPath === undefined) delete process.env.FFMPEG_PATH
    else process.env.FFMPEG_PATH = previousFfmpegPath
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('cut_audio 工具：引用没命中时分诊清楚 —— 不存在的文件名报「找不到」，中文引用报「没有该节点」', { skip: process.platform === 'win32' && '假 ffmpeg 是 sh 脚本' }, async () => {
  const ctx = await makeWorkspace('cs-audio-cut-tool-missing-')
  const previousFfmpegPath = process.env.FFMPEG_PATH
  try {
    process.env.FFMPEG_PATH = ctx.ffmpegPath
    const tools = createStudioTools(ctx.registry, 3005)
    const cutAudio = tools.find((tool) => tool.name === 'cut_audio')
    // (a) 纯文件名形态：名字合法但文件不存在。
    await assert.rejects(
      () => cutAudio.execute({ audio: 'ghost-track.mp3', start: 0, end: 3 }, EXEC(ctx.project.dir)),
      /找不到音频文件/u,
    )
    // (b) 没命中的引用（中文标题 / 空格）：不能报「文件名不合法」—— 那会误导模型
    //     去改文件名，而真相是画布上没有这个节点。
    await assert.rejects(
      () => cutAudio.execute({ audio: '@ref[画布上没有的音乐]', start: 0, end: 3 }, EXEC(ctx.project.dir)),
      /没有可引用的节点/u,
    )
  } finally {
    if (previousFfmpegPath === undefined) delete process.env.FFMPEG_PATH
    else process.env.FFMPEG_PATH = previousFfmpegPath
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 4. 决策固化：不接审批门
// ---------------------------------------------------------------------------
test('BUG-002 决策：cut_audio 不进任何审批名单（纯本地，不调后端）', () => {
  const source = readFileSync(join(ROOT, 'src', 'approval-gate.ts'), 'utf8')
  assert.ok(!source.includes('cut_audio'), 'approval-gate.ts 不得出现 cut_audio —— 接门只会逼模型绕路')
  const gateTest = readFileSync(join(ROOT, 'tests', 'approval-gate.test.mjs'), 'utf8')
  assert.ok(!gateTest.includes('cut_audio'), '审批门测试的 DIRECT/FORMAL/PRODUCING 名单同样不得含 cut_audio')
})
