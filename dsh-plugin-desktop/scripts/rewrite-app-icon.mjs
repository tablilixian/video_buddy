/**
 * 将 Canvas Studio 品牌应用图标（icon-1024.png）改写为桌面打包用跨平台源图标
 * build/app-icon.png，并转成 mac 生成器（generate-mac-app-icon.mjs）要求的
 * RGBA16 + ICC 格式。
 *
 * 单一事实来源：
 * - 位图来源 -- canvas-studio/assets/brand/png/icon-1024.png（build-brand-assets.mjs 产出）；
 * - 色彩配置 -- 沿用既有打包图标管线使用的 Display P3 ICC 配置（内嵌，避免依赖待替换的旧图）。
 *
 * 用法：
 *   node scripts/rewrite-app-icon.mjs
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** 既有打包管线采用的 Display P3 ICC 配置（与旧 build/app-icon.png 的 iCCP 一致）。 */
const DISPLAY_P3_ICC_B64 =
  'AAACGGFwcGwEAAAAbW50clJHQiBYWVogB+YAAQABAAAAAAAAYWNzcEFQUEwAAAAAQVBQTAAAAAAA' +
  'AAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1hcHBsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAwY3BydAAAASwAAABQd3RwdAAAAXwAAAAUclhZ' +
  'WgAAAZAAAAAUZ1hZWgAAAaQAAAAUYlhZWgAAAbgAAAAUclRSQwAAAcwAAAAgY2hhZAAAAewAAAAs' +
  'YlRSQwAAAcwAAAAgZ1RSQwAAAcwAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAUAAAAHABEAGkA' +
  'cwBwAGwAYQB5ACAAUAAzbWx1YwAAAAAAAAABAAAADGVuVVMAAAA0AAAAHABDAG8AcAB5AHIAaQBn' +
  'AGgAdAAgAEEAcABwAGwAZQAgAEkAbgBjAC4ALAAgADIAMAAyADJYWVogAAAAAAAA9tUAAQAAAADT' +
  'LFhZWiAAAAAAAACD3wAAPb////+7WFlaIAAAAAAAAEq/AACxNwAACrlYWVogAAAAAAAAKDgAABEL' +
  'AADIuXBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbc2YzMgAAAAAAAQxCAAAF3v//8yYA' +
  'AAeTAAD9kP//+6L///2jAAAD3AAAwG4='

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const brandSource = resolve(desktopRoot, '..', 'canvas-studio', 'assets', 'brand', 'png', 'icon-1024.png')
const outputPath = join(desktopRoot, 'build', 'app-icon.png')

/**
 * 生成跨平台打包源图标。
 * @param {string} source - canvas-studio 品牌 icon-1024.png 的绝对路径。
 * @param {string} output - 写出的 build/app-icon.png。
 * @returns {Promise<void>}
 */
export async function rewriteAppIcon(source = brandSource, output = outputPath) {
  const icc = Buffer.from(DISPLAY_P3_ICC_B64, 'base64')
  const meta = await sharp(source).metadata()
  if (meta.format !== 'png' || meta.width !== 1024 || meta.height !== 1024) {
    throw new Error(`rewrite-app-icon: source must be a 1024x1024 PNG (got ${meta.width}x${meta.height} ${meta.format})`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'videobuddy-icon-'))
  const iccPath = join(tempDir, 'display-p3.icc')
  await writeFile(iccPath, icc)
  try {
    const rendered = await sharp(source, { failOn: 'warning' })
      .toColourspace('rgb16')
      .withIccProfile(iccPath)
      .png({
        compressionLevel: 9,
        progressive: false,
        adaptiveFiltering: false,
        palette: false,
      })
      .toBuffer()

    const generated = await sharp(rendered).metadata()
    if (
      generated.format !== 'png'
      || generated.width !== 1024
      || generated.height !== 1024
      || generated.space !== 'rgb16'
      || generated.depth !== 'ushort'
      || generated.bitsPerSample !== 16
      || generated.channels !== 4
      || generated.hasAlpha !== true
      || generated.icc === undefined
    ) {
      throw new Error('rewrite-app-icon: generated icon failed the RGBA16 + ICC contract')
    }

    await writeFile(output, rendered)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await rewriteAppIcon()
}
