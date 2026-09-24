/**
 * CV-241：四类文件统一分类与限额（纯函数层）。
 *
 * `classifyFile` / `MEDIA_EXTENSIONS` / `MEDIA_UPLOAD_LIMITS` 是上传链路的
 * **唯一白名单来源**（Host 落盘校验、Client 拖放分发、工具栏 accept 共用）。
 * 两处各写一份必然漂移 —— 本文件锁死全表 + 未知拒绝 + 限额数值。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyFile,
  extensionOf,
  mediaAcceptAttribute,
  MEDIA_EXTENSIONS,
  MEDIA_KINDS,
  MEDIA_KIND_LABEL,
  MEDIA_UPLOAD_LIMITS,
} from '../lib/media-extension.js'

test('CV-241 classifyFile：四类正例（含大小写扩展名）', () => {
  const cases = [
    ['photo.png', 'image'],
    ['PHOTO.PNG', 'image'],
    ['shot.jpeg', 'image'],
    ['a.webp', 'image'],
    ['clip.mp4', 'video'],
    ['CLIP.MOV', 'video'],
    ['ref.webm', 'video'],
    ['track.mp3', 'audio'],
    ['TRACK.WAV', 'audio'],
    ['bgm.flac', 'audio'],
    ['notes.txt', 'text'],
    ['script.md', 'text'],
    ['data.json', 'text'],
    ['log.csv', 'text'],
    ['app.log', 'text'],
  ]
  for (const [name, expected] of cases) {
    assert.equal(classifyFile(name), expected, `${name} 应分类为 ${expected}`)
  }
})

test('CV-241 classifyFile：未知 / 无扩展名 / 空串一律 reject（null）', () => {
  assert.equal(classifyFile('payload.exe'), null, '未知扩展名必须 reject')
  assert.equal(classifyFile('noextension'), null, '无扩展名必须 reject')
  assert.equal(classifyFile(''), null, '空串必须 reject')
  assert.equal(classifyFile('archive.tar.gz'), null, '不在白名单的扩展名 reject')
})

test('CV-241 classifyFile：裸点文件名边界（主名空、扩展名合法 → 按扩展名收）', () => {
  assert.equal(classifyFile('.png'), 'image', "extensionOf('.png') = '.png'，在 image 白名单内")
})

test('CV-241 MEDIA_EXTENSIONS / LABEL / LIMITS 与 MEDIA_KINDS 键集一致（防漂移）', () => {
  assert.deepEqual([...MEDIA_KINDS].sort(), Object.keys(MEDIA_EXTENSIONS).sort(), 'MEDIA_KINDS 与 MEDIA_EXTENSIONS 键集不一致')
  assert.deepEqual([...MEDIA_KINDS].sort(), Object.keys(MEDIA_KIND_LABEL).sort(), 'MEDIA_KINDS 与 MEDIA_KIND_LABEL 键集不一致')
  assert.deepEqual([...MEDIA_KINDS].sort(), Object.keys(MEDIA_UPLOAD_LIMITS).sort(), 'MEDIA_KINDS 与 MEDIA_UPLOAD_LIMITS 键集不一致')
  for (const kind of MEDIA_KINDS) {
    assert.ok(MEDIA_EXTENSIONS[kind].length > 0, `${kind} 白名单不能为空`)
    assert.ok(MEDIA_EXTENSIONS[kind].every((ext) => ext.startsWith('.') && ext === ext.toLowerCase()), `${kind} 扩展名必须小写含点`)
    assert.ok(typeof MEDIA_KIND_LABEL[kind] === 'string' && MEDIA_KIND_LABEL[kind].length > 0, `${kind} 标签不能为空`)
  }
})

test('CV-241 MEDIA_UPLOAD_LIMITS：Q2 拍板数值（原始字节）', () => {
  assert.equal(MEDIA_UPLOAD_LIMITS.image, 16 * 1024 * 1024, 'image 16MB')
  assert.equal(MEDIA_UPLOAD_LIMITS.audio, 32 * 1024 * 1024, 'audio 32MB')
  assert.equal(MEDIA_UPLOAD_LIMITS.text, 5 * 1024 * 1024, 'text 5MB')
  assert.equal(MEDIA_UPLOAD_LIMITS.video, 128 * 1024 * 1024, 'video 128MB（与 /upload-video 同源）')
})

test('CV-241 mediaAcceptAttribute：四类白名单并集（工具栏 accept）', () => {
  const accept = mediaAcceptAttribute()
  for (const kind of MEDIA_KINDS) {
    for (const ext of MEDIA_EXTENSIONS[kind]) {
      assert.ok(accept.includes(ext), `accept 缺 ${kind} 的 ${ext}`)
    }
  }
  assert.ok(!accept.includes('.exe'), 'accept 不得含未知扩展名')
})

test('CV-241 extensionOf：无扩展名空串、多段取末段、大写归一', () => {
  assert.equal(extensionOf('a.b.c.PNG'), '.png')
  assert.equal(extensionOf('noext'), '')
  assert.equal(extensionOf('archive.tar.gz'), '.gz')
})
