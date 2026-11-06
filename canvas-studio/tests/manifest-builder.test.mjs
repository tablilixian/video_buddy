/**
 * manifest-builder（代码驱动科普的内容表 → manifest）单测。
 *
 * 为什么必须测：
 *  - 它是「20 分钟内出首片」的产能来源 —— 脚本一旦生成非法 manifest，模型会收到一次
 *    校验失败，然后**回去读源码推契约**（今天 2h40m 空转的入口就在这里）。
 *    所以验收不是「生成了 JSON」，而是「生成的 JSON 能过一次真正的 `validateManifest`」。
 *  - 段边界冻结是「以第一版为锚点丰富」的技术前提：改了必须红，否则整片重排会静默发生。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../lib/remotion/manifest.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const BUILDER = resolve(HERE, '..', 'skills', 'code-driven-explainer', 'assets', 'manifest-builder.mjs')

function run(spec, dir) {
  mkdirSync(join(dir, 'build'), { recursive: true })
  writeFileSync(join(dir, 'build', 'manifest-spec.json'), JSON.stringify(spec, null, 2), 'utf8')
  return spawnSync(process.execPath, [BUILDER], { cwd: dir, encoding: 'utf8' })
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'build', 'manifest.json'), 'utf8'))
}

test('captions 通道：生成合法 manifest，字幕首尾相接、总帧自洽', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-builder-'))
  try {
    const spec = {
      title: '玻璃为什么是透明的',
      fps: 30,
      captions: [
        { id: 'V1', text: '玻璃其实是液态', frames: 90 },
        { id: 'V2', text: '光线照上去时', frames: 120 },
        { id: 'V3', text: '大部分直接穿过去了', frames: 132 },
      ],
      visuals: [
        { id: 'v-data', type: 'textCard', variant: 'dataCard', at: 'V2', text: '96%', subtitle: '可见光透过率' },
        { id: 'v-line', type: 'chart', at: 'V3', until: 'V3', variant: 'line', labels: ['1950', '1980', '2020'], values: [0.2, 0.6, 1.2] },
      ],
      outro: { text: '玻璃不挡光', frames: 60 },
    }
    const result = run(spec, dir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const manifest = readManifest(dir)
    const check = validateManifest(manifest)
    assert.equal(check.ok, true, check.errors.join('；'))

    const captions = manifest.tracks.filter((t) => t.type === 'textCard' && t.variant === 'subtitle')
    assert.equal(captions.length, 3)
    assert.equal(captions[0].startFrame, 0)
    for (let i = 1; i < captions.length; i += 1) {
      assert.equal(captions[i].startFrame, captions[i - 1].startFrame + captions[i - 1].durationInFrames)
    }
    const maxEnd = manifest.tracks.reduce((m, t) => Math.max(m, t.startFrame + t.durationInFrames), 0)
    assert.equal(manifest.meta.durationInFrames, maxEnd)
    // 视觉轨跟着句子走：at=V2 → 起点 = V2.startFrame
    assert.equal(manifest.tracks.find((t) => t.id === 'v-data').startFrame, 90)
    // 片尾贴末尾，不吃掉最后一句
    assert.equal(manifest.tracks.find((t) => t.id === 'outro').startFrame, maxEnd - 60)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('captions 带 src → 走 caption 轨（自播旁白），不再生成 textCard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-builder-'))
  try {
    const result = run({
      title: 't',
      captions: [
        { id: 'V1', text: '第一句', frames: 60, src: '/canvas-studio/assets/a.mp3' },
        { id: 'V2', text: '第二句', frames: 60, src: '/canvas-studio/assets/b.mp3' },
      ],
    }, dir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const manifest = readManifest(dir)
    const captions = manifest.tracks.filter((t) => t.type === 'caption')
    assert.equal(captions.length, 2)
    assert.equal(captions[0].src, '/canvas-studio/assets/a.mp3')
    // 纯 caption 片不需要 outro；仍然要过校验（caption 的 src 必须是合法资产引用）
    const check = validateManifest(manifest)
    assert.equal(check.ok, true, check.errors.join('；'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CV-447 T0-A1：captions[].words 原样透传到 caption 轨（缺省则不写）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-builder-'))
  try {
    const words = [
      { text: '第', from: 0, to: 12 },
      { text: '一', from: 12, to: 24 },
      { text: '句', from: 24, to: 60 },
    ]
    const result = run({
      title: 't',
      captions: [
        { id: 'V1', text: '第一句', frames: 60, src: '/canvas-studio/assets/a.mp3', words },
        { id: 'V2', text: '第二句', frames: 60, src: '/canvas-studio/assets/b.mp3' },
      ],
    }, dir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const manifest = readManifest(dir)
    const captions = manifest.tracks.filter((t) => t.type === 'caption')
    assert.deepEqual(captions[0].words, words, '词级时间戳必须原样透传（卡拉 OK 字幕依赖它）')
    assert.equal(captions[1].words, undefined, '没给 words 就不要凭空造（让渲染层走能量谷兜底）')
    const check = validateManifest(manifest)
    assert.equal(check.ok, true, check.errors.join('；'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('narration（秒）通道：按 fps 折算，且帧数累计等于总时长', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-builder-'))
  try {
    const result = run({
      title: 't',
      fps: 25,
      narration: [
        { id: 'V1', text: '一句话', seconds: 2 },
        { id: 'V2', text: '两句话', seconds: 3 },
      ],
    }, dir)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const manifest = readManifest(dir)
    assert.equal(manifest.meta.durationInFrames, 125)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('段边界冻结：首次落锁，第二次改 frames 必须拒绝生成（这是「重排」）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-builder-'))
  try {
    const base = {
      title: 't',
      captions: [
        { id: 'V1', text: 'a', frames: 90 },
        { id: 'V2', text: 'b', frames: 90 },
      ],
    }
    assert.equal(run(base, dir).status, 0)
    assert.equal(existsSync(join(dir, 'build', 'segment-lock.json')), true)

    // 只加视觉轨：段边界不变 → 必须放行
    const withVisual = { ...base, visuals: [{ id: 'v1', type: 'shape', shape: 'rect', at: 'V1', box: { x: 50, y: 50, w: 20, h: 20 } }] }
    assert.equal(run(withVisual, dir).status, 0)

    // 改了一句的帧数：段边界变了 → 必须拒绝
    const reflowed = {
      ...base,
      captions: [
        { id: 'V1', text: 'a', frames: 120 },
        { id: 'V2', text: 'b', frames: 90 },
      ],
    }
    const bad = run(reflowed, dir)
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /段边界被改动了/)
    assert.match(bad.stderr, /重排/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('空 spec / 空文案 / 换行：显式报错，不静默出半条片', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-builder-'))
  try {
    assert.match(run({ title: 't' }, dir).stderr, /没有任何句子/)
    assert.match(run({ title: 't', captions: [{ id: 'V1', text: ' ', frames: 30 }] }, dir).stderr, /text 是空的/)
    assert.match(run({ title: 't', captions: [{ id: 'V1', text: 'a\nb', frames: 30 }] }, dir).stderr, /含换行/)
    assert.match(run({ title: 't', captions: [{ id: 'V1', text: 'a', frames: 30 }], visuals: [{ type: 'chart', at: 'V9' }] }, dir).stderr, /不存在的句子 id/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
