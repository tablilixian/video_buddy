/**
 * P1-3 落盘单测：`scaffold_manifest({ writeTo })` 的实现层。
 *
 * 为什么必须测「拒收」这一半：落盘是本插件**唯一**由工具直接写文件的入口
 * （其余都走宿主资产目录）。路径逃逸一旦漏判，模型一句 `../../..` 就能把
 * JSON 写到项目外。所以三条拒绝路径（项目外 / 同前缀兄弟目录 / `..` 逃逸）
 * 各自钉一条，并且断言**拒收后零副作用**（没有留下半个文件）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
// 错误码注册是副作用导入（与 timing-segments / shot-ref 等同类测试同一写法）：
// 不先注册，`throwError('CS-USER-ERR')` 会抛「未注册的错误码」而不是本意的用户错误。
import '../lib/errors/catalog.js'
import {
  MANIFEST_PREVIEW_LINES,
  isInsideProject,
  previewLines,
  writeManifestFile,
} from '../lib/manifest-file.js'

function freshProject() {
  return mkdtempSync(join(tmpdir(), 'cs-manifest-file-'))
}

/** 清不掉的临时目录不该让测试红（沙箱里 `$TMPDIR` 递归删除会被拦）。 */
function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // 忽略：见上。
  }
}

function catchError(fn) {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}

const JSON_BODY = JSON.stringify({ id: 'comp-1', meta: { title: 't' }, tracks: [{ id: 'a' }, { id: 'b' }] }, null, 2)

test('相对路径按项目根解析并落盘，返回 path / bytes / trackCount', () => {
  const dir = freshProject()
  try {
    const written = writeManifestFile({ projectDir: dir, writeTo: 'build/manifest.json', json: JSON_BODY, trackCount: 2 })
    assert.equal(written.path, join(dir, 'build', 'manifest.json'))
    assert.equal(written.bytes, Buffer.byteLength(JSON_BODY, 'utf8'))
    assert.equal(written.trackCount, 2)
    assert.equal(readFileSync(written.path, 'utf8'), JSON_BODY)
  } finally {
    cleanup(dir)
  }
})

test('多级目录自动创建（build/versions/ 这种）', () => {
  const dir = freshProject()
  try {
    const written = writeManifestFile({
      projectDir: dir, writeTo: 'build/versions/v9.json', json: JSON_BODY, trackCount: 2,
    })
    assert.ok(existsSync(written.path))
  } finally {
    cleanup(dir)
  }
})

test('绝对路径落在项目内也接受', () => {
  const dir = freshProject()
  try {
    const target = join(dir, 'manifest.json')
    const written = writeManifestFile({ projectDir: dir, writeTo: target, json: JSON_BODY, trackCount: 2 })
    assert.equal(written.path, target)
  } finally {
    cleanup(dir)
  }
})

test('项目外绝对路径：拒收 CS-USER-ERR，且零副作用', () => {
  const dir = freshProject()
  const outside = join(tmpdir(), `cs-outside-${String(Date.now())}.json`)
  try {
    const error = catchError(() => {
      writeManifestFile({ projectDir: dir, writeTo: outside, json: JSON_BODY, trackCount: 2 })
    })
    assert.equal(error?.code, 'CS-USER-ERR')
    assert.equal(existsSync(outside), false, '拒收不能留下半个文件')
  } finally {
    cleanup(dir)
  }
})

test('同前缀兄弟目录（<proj>-evil）不能被前缀匹配放进来', () => {
  const dir = freshProject()
  const evil = `${dir}-evil${sep}manifest.json`
  try {
    assert.equal(isInsideProject(dir, evil), false)
    const error = catchError(() => {
      writeManifestFile({ projectDir: dir, writeTo: evil, json: JSON_BODY, trackCount: 2 })
    })
    assert.equal(error?.code, 'CS-USER-ERR')
    assert.equal(existsSync(evil), false)
  } finally {
    cleanup(dir)
  }
})

test('相对路径用 .. 逃逸：拒收', () => {
  const dir = freshProject()
  try {
    const error = catchError(() => {
      writeManifestFile({ projectDir: dir, writeTo: '../escape.json', json: JSON_BODY, trackCount: 2 })
    })
    assert.equal(error?.code, 'CS-USER-ERR')
    assert.equal(existsSync(join(dir, '..', 'escape.json')), false)
  } finally {
    cleanup(dir)
  }
})

test('指向项目根目录本身：拒收（writeTo 必须是文件）', () => {
  const dir = freshProject()
  try {
    assert.equal(isInsideProject(dir, dir), false)
    const error = catchError(() => {
      writeManifestFile({ projectDir: dir, writeTo: '.', json: JSON_BODY, trackCount: 2 })
    })
    assert.equal(error?.code, 'CS-USER-ERR')
  } finally {
    cleanup(dir)
  }
})

test('空 writeTo：拒收', () => {
  const dir = freshProject()
  try {
    const error = catchError(() => {
      writeManifestFile({ projectDir: dir, writeTo: '   ', json: JSON_BODY, trackCount: 2 })
    })
    assert.equal(error?.code, 'CS-USER-ERR')
  } finally {
    cleanup(dir)
  }
})

test('previewLines 只回前 40 行：长 manifest 不把 60KB 再塞回上下文', () => {
  const long = Array.from({ length: 200 }, (_, i) => `line-${String(i)}`).join('\n')
  const preview = previewLines(long)
  assert.equal(preview.split('\n').length, MANIFEST_PREVIEW_LINES)
  assert.ok(preview.startsWith('line-0'))
  assert.ok(!preview.includes('line-199'))
  // 短文件整份给（不多不少）
  assert.equal(previewLines('a\nb'), 'a\nb')
})
