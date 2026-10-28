/**
 * CR-01 / CR-02 契约测试：合法资产文件名 + 资产路径解析的**唯一**判据。
 *
 * 背景（docs/代码审查-2026-10-28/瑕疵与隐患清单.md）：
 *   - CR-01：`upload_image` 的 `imageUrl` 是 agent 可控裸字符串，资产 URL 分支
 *     直接 `join(assetsDir, file)` 读盘，`../../../etc/passwd` 可被上传到外服；
 *   - CR-02：`readLocalAssetBytes` 同款，fal 通道会把读到的字节 base64 内联进
 *     公网请求。
 * 修复口径不是「各点补一行正则」，而是把判据收敛成 `src/asset-path.ts` 一份
 * （此前仓里躺着 7 份同款白名单，漏一处就是一条穿越通道）。
 *
 * 锁住的行为：
 *   1. 判据正例：Host 落盘名（assetId.ext / lib-<id>-<file> / export-<uuid>.mp4）全过；
 *   2. 判据反例：`..`、`.`、分隔符、`%`、中文、空格、空串、隐藏文件一律不过；
 *   3. `resolveAssetPathIn` 的路径恒落在 assetsDir 内；
 *   4. 穿越在**读盘之前**就被拒（防护先于 IO，不靠下游 ENOENT 兜底）；
 *   5. `urlToAssetPath`（成片 / 抽帧 / 素材核对共用）同样受判据保护。
 *
 * 直连 Host tsc 产物 lib/。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isAssetFileName, resolveAssetPathIn } from '../lib/asset-path.js'
import { ProjectRegistry } from '../lib/projects.js'
import { urlToAssetPath } from '../lib/compose.js'
import { promoteAssetFile } from '../lib/generate.js'
import { readLocalAssetBytes } from '../lib/providers/reference.js'

/** 判据反例：每一条都曾是（或可能成为）一条穿越/读取任意文件的入口。 */
const ILLEGAL_NAMES = [
  '',
  '.',
  '..',
  '../secret.png',
  '../../../../etc/passwd',
  'a/b.png',
  'a\\b.png',
  'a:b.png',
  '.hidden',
  '..png',
  'a%2e%2e%2fb.png',
  '%2e%2e',
  '中文名.png',
  'a b.png',
  'a\u0000b.png',
]

/** 判据正例：Host 三条落盘路径实际产生的形态。 */
const LEGAL_NAMES = ['abc123.png', 'aB9-_.mp4', 'lib-01HXY-m_0.png', 'export-9f8e7d.mp3', 'noext']

test('CR-01/CR-02：判据接受 Host 落盘名（收紧不会误伤既有资产）', () => {
  for (const name of LEGAL_NAMES) {
    assert.equal(isAssetFileName(name), true, `应接受 ${JSON.stringify(name)}`)
  }
})

test('CR-01/CR-02：判据拒绝穿越 / 分隔符 / 编码变体 / 非 ASCII', () => {
  for (const name of ILLEGAL_NAMES) {
    assert.equal(isAssetFileName(name), false, `应拒绝 ${JSON.stringify(name)}`)
  }
})

test('CR-01/CR-02：resolveAssetPathIn 合法名 → assetsDir 内路径', () => {
  const base = '/home/x/.dsh/canvas-studio/projects/P/assets'
  assert.equal(resolveAssetPathIn(base, 'clip-1.mp4'), join(base, 'clip-1.mp4'))
})

test('CR-01/CR-02：resolveAssetPathIn 对穿越一律抛 CS-USER-ERR', () => {
  const base = '/home/x/.dsh/canvas-studio/projects/P/assets'
  for (const name of ILLEGAL_NAMES) {
    assert.throws(
      () => resolveAssetPathIn(base, name),
      (err) => err.code === 'CS-USER-ERR',
      `应拒绝 ${JSON.stringify(name)}`,
    )
  }
})

test('CR-01/CR-02：registry.assetsDir 与判据同源（目录口径只有一处）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-cr01-'))
  try {
    const registry = new ProjectRegistry(root)
    const project = await registry.create('穿越审计')
    const assetsDir = registry.assetsDir(project.id)
    assert.equal(resolveAssetPathIn(assetsDir, 'a.png'), join(assetsDir, 'a.png'))
    for (const name of ILLEGAL_NAMES) {
      assert.throws(() => resolveAssetPathIn(assetsDir, name), (err) => err.code === 'CS-USER-ERR')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CR-01：promoteAssetFile 在触网/读盘之前就拒收穿越名', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-cr01-'))
  try {
    const registry = new ProjectRegistry(root)
    const project = await registry.create('提升审计')
    // 只要校验先于 uploadBytesToDrama，这里就不会真的发请求（也就不会超时）。
    await assert.rejects(
      () => promoteAssetFile(registry, project.id, '../../../etc/passwd'),
      (err) => err.code === 'CS-USER-ERR' && /非法资产文件名/u.test(err.message),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CR-02：readLocalAssetBytes 拒绝穿越，合法文件照常读', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-cr02-'))
  try {
    const registry = new ProjectRegistry(root)
    const project = await registry.create('外传审计')
    const assetsDir = registry.assetsDir(project.id)
    await writeFile(join(assetsDir, 'ok.png'), Buffer.from([1, 2, 3]))
    // 项目外放一个「机密」，且**确实存在**：三级上溯可解析到它。
    // 位置必须真实可达，否则测试会因「文件不存在」也抛出 CS-USER-ERR 而假绿。
    await writeFile(join(root, 'secret.txt'), Buffer.from('top-secret'))

    const good = await readLocalAssetBytes(registry, project.id, 'ok.png')
    assert.deepEqual([...good.bytes], [1, 2, 3])
    assert.equal(good.ext, 'png')

    // 断言消息而不是只断言 code —— 两条路径都是 CS-USER-ERR，只有「非法资产文件名」
    // 才证明是判据挡下的，而不是「文件不存在」。
    await assert.rejects(
      () => readLocalAssetBytes(registry, project.id, '../../../secret.txt'),
      (err) => err.code === 'CS-USER-ERR' && /非法资产文件名/u.test(err.message),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CR-01：urlToAssetPath（成片/抽帧/素材核对共用）拒收穿越 url', () => {
  const assetsDir = '/home/x/.dsh/canvas-studio/projects/P/assets'
  assert.equal(urlToAssetPath(assetsDir, '/canvas-studio/assets/P/clip-1.mp4'), join(assetsDir, 'clip-1.mp4'))
  assert.throws(
    () => urlToAssetPath(assetsDir, '/canvas-studio/assets/P/../../../../etc/passwd'),
    (err) => err.code === 'CS-USER-ERR',
  )
  assert.throws(
    () => urlToAssetPath(assetsDir, '/canvas-studio/assets/P/..%2F..%2Fsecret'),
    (err) => err.code === 'CS-USER-ERR',
  )
})

test('CR-01：合法资产 URL 的字节读取不受影响（正例）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-cr01-ok-'))
  try {
    const registry = new ProjectRegistry(root)
    const project = await registry.create('正例')
    await writeFile(join(registry.assetsDir(project.id), 'a.png'), Buffer.from([9]))
    const bytes = await readFile(resolveAssetPathIn(registry.assetsDir(project.id), 'a.png'))
    assert.deepEqual([...bytes], [9])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
