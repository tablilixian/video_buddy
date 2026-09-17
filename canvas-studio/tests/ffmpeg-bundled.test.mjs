/**
 * CV-201 内置 ffmpeg 解析链守卫（canvas-studio 侧）。
 *
 * 测的是「用户机器上没装 ffmpeg 也能用」这条产品承诺的运行时一半：
 * 1. `bundledFfmpegCandidates`：候选顺序＝显式覆盖 → `resourcesPath` → 模块祖先；
 *    win32 用 `ffmpeg.exe`；祖先档深度足以命中打包布局。
 * 2. `resolveFfmpegPath()`：**随包二进制优先于 PATH**（否则 brew 用户与用户机器
 *    会跑不同版本），缺失时才回退 PATH。
 * 3. 全落空时的文案面向终端用户（要求「重新安装应用」，不再是 `brew install`）。
 *
 * 反向变异（人工验证过）：把随包候选从 `resolveFfmpegPath` 里摘掉 → 第 2 组立刻变红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledFfmpegCandidates, resolveFfmpegPath } from '../lib/ffmpeg-run.js'

const HOST_KEY = `${process.platform}-${process.arch}`
const FAKE_BINARY = '#!/bin/sh\nexit 0\n'

/** 建一个临时目录，测试结束自动清理。 */
function makeTempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cs-ffmpeg-bundled-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 在 `<root>/ffmpeg/<key>/ffmpeg` 放一个可执行占位文件，返回其绝对路径。 */
function placeBundled(root, key = HOST_KEY) {
  const dir = join(root, 'ffmpeg', key)
  mkdirSync(dir, { recursive: true })
  const binary = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  writeFileSync(binary, FAKE_BINARY)
  chmodSync(binary, 0o755)
  return binary
}

/** 在 `<dir>/ffmpeg` 放一个可执行占位文件，返回其绝对路径。 */
function placeOnPath(dir) {
  mkdirSync(dir, { recursive: true })
  const binary = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  writeFileSync(binary, FAKE_BINARY)
  chmodSync(binary, 0o755)
  return binary
}

/** 临时改写环境变量，测试结束还原。 */
function withEnv(t, values) {
  const previous = new Map()
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name])
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
}

test('bundledFfmpegCandidates：顺序＝覆盖 → resourcesPath → 模块祖先，且去重', { skip: process.platform === 'win32' && '路径拼接按 POSIX 断言' }, () => {
  const moduleDir = '/app/Contents/Resources/app.asar.unpacked/node_modules/canvas-studio/lib'
  const expected = join('/app/Contents/Resources', 'ffmpeg', 'darwin-arm64', 'ffmpeg')
  const candidates = bundledFfmpegCandidates({
    platform: 'darwin',
    arch: 'arm64',
    resourcesPath: '/app/Contents/Resources',
    overrideDir: '/override',
    moduleDir,
  })

  assert.equal(candidates[0], join('/override', 'ffmpeg', 'darwin-arm64', 'ffmpeg'))
  assert.equal(candidates[1], expected)
  assert.equal(new Set(candidates).size, candidates.length, '候选必须去重')

  // 祖先档单独成立：模块在 app.asar.unpacked 里时向上第三级正是 Resources
  const ancestorOnly = bundledFfmpegCandidates({ platform: 'darwin', arch: 'arm64', moduleDir })
  assert.ok(
    ancestorOnly.includes(expected),
    `祖先档必须能命中打包布局：${ancestorOnly.join(' | ')}`,
  )
})

test('bundledFfmpegCandidates：win32 用 ffmpeg.exe，且缺省输入不产生候选', () => {
  const windows = bundledFfmpegCandidates({
    platform: 'win32',
    arch: 'x64',
    resourcesPath: 'C:\\app\\resources',
  })
  assert.deepEqual(windows, [join('C:\\app\\resources', 'ffmpeg', 'win32-x64', 'ffmpeg.exe')])
  assert.deepEqual(bundledFfmpegCandidates({ platform: 'darwin', arch: 'arm64' }), [])
})

test('resolveFfmpegPath：随包二进制优先于 PATH 上的系统 ffmpeg', (t) => {
  const bundleRoot = makeTempDir(t)
  const pathDir = join(makeTempDir(t), 'bin')
  const bundled = placeBundled(bundleRoot)
  const onPath = placeOnPath(pathDir)
  withEnv(t, { DSH_FFMPEG_DIR: bundleRoot, PATH: pathDir, FFMPEG_PATH: undefined })

  assert.equal(resolveFfmpegPath(), bundled)
  assert.notEqual(resolveFfmpegPath(), onPath)
})

test('resolveFfmpegPath：随包缺失时回退系统 ffmpeg', (t) => {
  const emptyBundleRoot = makeTempDir(t)
  const pathDir = join(makeTempDir(t), 'bin')
  const onPath = placeOnPath(pathDir)
  withEnv(t, { DSH_FFMPEG_DIR: emptyBundleRoot, PATH: pathDir, FFMPEG_PATH: undefined })

  assert.equal(resolveFfmpegPath(), onPath)
})

test('resolveFfmpegPath：全部落空时报面向终端用户的错误', (t) => {
  const emptyBundleRoot = makeTempDir(t)
  withEnv(t, { DSH_FFMPEG_DIR: emptyBundleRoot, PATH: '', FFMPEG_PATH: undefined })

  assert.throws(
    () => resolveFfmpegPath(),
    (error) => {
      assert.match(error.message, /未找到可用的 ffmpeg/)
      assert.match(error.message, /内置的 ffmpeg 组件缺失/)
      assert.match(error.message, /重新安装应用/)
      assert.match(error.message, /FFMPEG_PATH/)
      assert.doesNotMatch(error.message, /brew install/, '不能把开发者安装步骤推给终端用户')
      return true
    },
  )
})
