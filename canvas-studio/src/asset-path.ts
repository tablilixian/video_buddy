/**
 * 合法资产文件名 + 「资产名 → 磁盘路径」的**唯一**判据（CR-01/CR-02）。
 *
 * 为什么必须收敛：资产文件名从两条路进来 —— Host 自己落盘的 `${assetId}.${ext}`
 * （`saveLocalAssetBytes`），以及 agent 可写参数里的文件名段（资产 URL 的
 * `<file>`、`video_composite` 的 filenames、`readLocalAssetBytes` 的 file）。
 * 判据原先在 7 个文件里各留一份（`promoteAssetFile` 内联、`PLAIN_ASSET_NAME_RE`、
 * `LIB_FILE_RE`、`ASSET_FILE_RE`、`waveform-host` 内联、`routes.ts` 四份内联），
 * 漏一处就是一条 `join(assetsDir, '../../secret')` 的穿越通道：`path.join` 会把
 * `..` 折叠掉，而画布资产 URL 的文件名段完全由模型给定。
 *
 * 判据 = ASCII 白名单 + 不以 `.` 开头：
 * - 落盘名恒为 ASCII（`assetId.ext` / `lib-<assetId>-<file>` / `export-<uuid>.mp4`），
 *   用户上传时的中文原名不进磁盘，所以收紧不会误伤既有资产；
 * - `/` `\` `:` `%` 不在字符集内 ⇒ 路径分隔符与编码变体（`%2e%2e`）都过不来。
 *   本模块**不做 URL 解码**：调用方解码后再过这道闸，判据只有一份。
 * - `.` 开头既挡 `..`（显式再判一次，防将来放宽首字符），也挡 `.`（会折成资产
 *   目录自身）与隐藏文件。
 *
 * 本模块零项目内依赖（仅 `node:path` + 错误系统），Host / Client / 纯函数测试
 * 都可直接引用，不会与 `projects.ts`、`compose.ts` 形成环。
 */
import { join, resolve, sep } from 'node:path'
import { throwError } from './error-system.js'

/** 资产文件名的字符集白名单。**唯一**一份；其余模块一律调 `isAssetFileName`。 */
const ASSET_FILE_NAME_RE = /^[A-Za-z0-9._-]+$/u

/** 名字是否可作为资产文件名（`null` 语义的调用方用这个，抛错语义用 `assertAssetFileName`）。 */
export function isAssetFileName(file: string): boolean {
  return ASSET_FILE_NAME_RE.test(file) && !file.startsWith('.') && !file.includes('..')
}

/** 校验资产文件名，通过则原样返回，否则抛面向用户的错误（CR-01/CR-02 的统一出口）。 */
export function assertAssetFileName(file: string): string {
  if (!isAssetFileName(file)) {
    throwError('CS-USER-ERR', { message: `非法资产文件名: ${file}`, detail: `invalid asset name: ${file}` })
  }
  return file
}

/**
 * 资产目录 + 合法文件名 → 绝对路径。**这是读盘/写盘的唯一解析点**，
 * 其它模块不得再自己 `join(assetsDir, file)`。
 *
 * 前缀复核是第二道闸：将来有人放宽上面的正则，也不会立刻变成穿越。
 */
export function resolveAssetPathIn(assetsDir: string, file: string): string {
  assertAssetFileName(file)
  const base = resolve(assetsDir)
  const target = join(base, file)
  if (!resolve(target).startsWith(base + sep)) {
    throwError('CS-DEV-ERR', { detail: `资产路径越界: ${file}` })
  }
  return target
}
