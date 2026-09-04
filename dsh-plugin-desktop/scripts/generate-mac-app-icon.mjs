/** Generate the macOS Dock icon with the platform's visual safe area. */

import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Pixel width and height of the generated macOS icon canvas. */
export const MAC_APP_ICON_CANVAS_SIZE = 1024
/** Pixel width and height of the centered source artwork. */
export const MAC_APP_ICON_ARTWORK_SIZE = 824
/** Transparent inset on each edge of the generated macOS icon. */
export const MAC_APP_ICON_INSET = (MAC_APP_ICON_CANVAS_SIZE - MAC_APP_ICON_ARTWORK_SIZE) / 2
/**
 * Corner radius of the macOS icon tile, as a fraction of the artwork side.
 * 185.4 / 824 = 0.225, matching Apple's published icon grid (measured off
 * shipping system icons). Used with {@link MAC_APP_ICON_CORNER_SMOOTHING} to
 * reproduce Apple's continuous-corner squircle.
 */
export const MAC_APP_ICON_RADIUS_RATIO = 0.225
/**
 * Continuous-corner smoothing term (Figma's corner-smoothing construction).
 * 0 would be a plain circular arc; 0.7 tracks Apple's squircle.
 */
export const MAC_APP_ICON_CORNER_SMOOTHING = 0.7

/**
 * SVG path for a rounded square with Apple's continuous-corner squircle shape.
 * Ported from chartr's mac-app-icon grid (measured off Apple system icons):
 * each corner is a circular arc of measure 90*(1-s) flanked by two cubic
 * Béziers that carry curvature continuously out to the straight edge.
 * @param {number} side - side length of the rounded square (px).
 * @param {number} radius - corner radius (px).
 * @param {number} s - corner smoothing in [0, 1).
 * @returns {string} SVG path data string.
 */
export function squirclePath(side, radius, s) {
  const r = radius
  const p = (1 + s) * r
  const arcMeasure = 90 * (1 - s)
  const arc = Math.sin((arcMeasure / 2) * Math.PI / 180) * r * Math.sqrt(2)
  const angleAlpha = (90 - arcMeasure) / 2
  const angleBeta = 45 * s
  const c = r * Math.tan((angleAlpha / 2) * Math.PI / 180) * Math.cos((angleBeta) * Math.PI / 180)
  const d = c * Math.tan((angleBeta) * Math.PI / 180)
  const b = (p - arc - c - d) / 3
  const a = 2 * b
  const n = (v) => v.toFixed(4)
  // prettier-ignore
  return [
    `M ${n(side - p)} 0`,
    `c ${n(a)} 0 ${n(a + b)} 0 ${n(a + b + c)} ${n(d)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(arc)}`,
    `c ${n(d)} ${n(c)} ${n(d)} ${n(b + c)} ${n(d)} ${n(a + b + c)}`,
    `L ${n(side)} ${n(side - p)}`,
    `c 0 ${n(a)} 0 ${n(a + b)} ${n(-d)} ${n(a + b + c)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(arc)}`,
    `c ${n(-c)} ${n(d)} ${n(-(b + c))} ${n(d)} ${n(-(a + b + c))} ${n(d)}`,
    `L ${n(p)} ${n(side)}`,
    `c ${n(-a)} 0 ${n(-(a + b))} 0 ${n(-(a + b + c))} ${n(-d)}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(-arc)}`,
    `c ${n(-d)} ${n(-c)} ${n(-d)} ${n(-(b + c))} ${n(-d)} ${n(-(a + b + c))}`,
    `L 0 ${n(p)}`,
    `c 0 ${n(-a)} 0 ${n(-(a + b))} ${n(d)} ${n(-(a + b + c))}`,
    `a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(-arc)}`,
    `c ${n(c)} ${n(-d)} ${n(b + c)} ${n(-d)} ${n(a + b + c)} ${n(-d)}`,
    'Z',
  ].join(' ')
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourcePath = join(packageRoot, 'build', 'app-icon.png')
const outputPath = join(packageRoot, 'build', 'app-icon-mac.png')

/**
 * Derive the macOS application icon without changing the cross-platform source.
 * @param {string} source - absolute path to the square source PNG.
 * @param {string} output - absolute path for the generated macOS PNG.
 * @returns {Promise<void>} Resolves after the complete PNG has been written.
 */
export async function generateMacAppIcon(source = sourcePath, output = outputPath) {
  if (resolve(source) === resolve(output)) {
    throw new Error('generate-mac-app-icon: output must not overwrite the source icon')
  }

  const metadata = await sharp(source).metadata()
  if (
    metadata.format !== 'png'
    || metadata.width !== MAC_APP_ICON_CANVAS_SIZE
    || metadata.height !== MAC_APP_ICON_CANVAS_SIZE
    || metadata.space !== 'rgb16'
    || metadata.depth !== 'ushort'
    || metadata.bitsPerSample !== 16
    || metadata.channels !== 4
    || metadata.hasAlpha !== true
    || metadata.icc === undefined
  ) {
    throw new Error(
      `generate-mac-app-icon: source must be a ${MAC_APP_ICON_CANVAS_SIZE}x${MAC_APP_ICON_CANVAS_SIZE} RGBA16 PNG with an ICC profile`,
    )
  }

  const artworkRadius = MAC_APP_ICON_ARTWORK_SIZE * MAC_APP_ICON_RADIUS_RATIO
  const maskSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MAC_APP_ICON_ARTWORK_SIZE}" height="${MAC_APP_ICON_ARTWORK_SIZE}" viewBox="0 0 ${MAC_APP_ICON_ARTWORK_SIZE} ${MAC_APP_ICON_ARTWORK_SIZE}">`
      + `<path d="${squirclePath(MAC_APP_ICON_ARTWORK_SIZE, artworkRadius, MAC_APP_ICON_CORNER_SMOOTHING)}" fill="#fff" fill-rule="evenodd"/>`
      + '</svg>',
  )

  const rendered = await sharp(source, { failOn: 'warning' })
    .resize({
      width: MAC_APP_ICON_ARTWORK_SIZE,
      height: MAC_APP_ICON_ARTWORK_SIZE,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .composite([{ input: maskSvg, blend: 'dest-in' }])
    .extend({
      top: MAC_APP_ICON_INSET,
      bottom: MAC_APP_ICON_INSET,
      left: MAC_APP_ICON_INSET,
      right: MAC_APP_ICON_INSET,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toColourspace('rgb16')
    .keepIccProfile()
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
    || generated.width !== MAC_APP_ICON_CANVAS_SIZE
    || generated.height !== MAC_APP_ICON_CANVAS_SIZE
    || generated.space !== 'rgb16'
    || generated.depth !== 'ushort'
    || generated.bitsPerSample !== 16
    || generated.channels !== 4
    || generated.hasAlpha !== true
    || generated.icc?.equals(metadata.icc) !== true
  ) {
    throw new Error('generate-mac-app-icon: generated icon did not preserve the source color data')
  }

  await writeFile(output, rendered)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await generateMacAppIcon()
}
