/**
 * 探针：`image_crop` 端到端（真 ffmpeg + 真 PNG + 真自证）。
 *
 * 单测只覆盖纯函数层（gridToRect / rectWithin / summarizeCrop），但有一条链只有真跑
 * 才知道通不通：**`probeMediaInfo` 能不能从 ffmpeg 的 `Stream` 行读到 PNG 的宽高**。
 * 读不到就直接报「读不到源图尺寸」，整个工具等于废的 —— 所以这条必须实测。
 *
 * 跑法：node scripts/probe-image-crop.mjs（产物落在项目 build/ 下的临时目录，跑完自删）
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runImageCrop } from '../lib/image-crop.js'

/** `#rrggbb` → 是否「亮红」（R 高、G/B 都低）。ffmpeg 的 red 出图量化后是 #fc0000 而非 #ff0000，别写死具体值。 */
function isRed(hex) {
  if (typeof hex !== 'string' || hex.length !== 7) return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return r > 200 && g < 40 && b < 40
}

const dir = mkdtempSync(join(import.meta.dirname, '..', 'build', 'probe-crop-'))
const sheet = join(dir, 'sheet.png')
try {
  // 1280×480 三格横排：白 / 红 / 蓝 —— 中间格裁出来必须是红的。
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=white:s=426x480:d=1',
    '-f', 'lavfi', '-i', 'color=red:s=427x480:d=1',
    '-f', 'lavfi', '-i', 'color=blue:s=427x480:d=1',
    '-filter_complex', 'hstack=inputs=3',
    '-frames:v', '1', sheet,
  ])
  const scratch = join(dir, 'scratch.png')
  const { bytes, outcome } = await runImageCrop({
    srcPath: sheet,
    grid: { rows: 1, cols: 3, row: 1, col: 2 },
    scratchPath: scratch,
  })
  console.log('源图尺寸（探针读到的）:', outcome.sourceWidth, '×', outcome.sourceHeight)
  console.log('裁切 rect:', JSON.stringify(outcome.rect))
  console.log('产物字节:', bytes.length)
  console.log('自证:', JSON.stringify(outcome.provenance, null, 1))
  // 1280 分 3 列 → floor = 426，余数 2 归最后一列 ⇒ 426 / 426 / 428；取第 2 格 = x426 w426。
  const { provenance } = outcome
  const checks = [
    ['源图宽高读到了', outcome.sourceWidth === 1280 && outcome.sourceHeight === 480],
    ['rect 是第 2 格', outcome.rect.x === 426 && outcome.rect.y === 0 && outcome.rect.w === 426 && outcome.rect.h === 480],
    ['产物非空', bytes.length > 0],
    ['自证尺寸与 rect 一致', provenance.width === 426 && provenance.height === 480],
    ['四边都是红', ['top', 'bottom', 'left', 'right'].every((k) => isRed(provenance.edges[k]))],
    ['主色是红', isRed(provenance.topColors[0]?.split('(')[0])],
    ['不透明（红格没抠东西）', provenance.alphaPct === 0],
  ]
  const failed = checks.filter(([, pass]) => !pass).map(([name]) => name)
  for (const [name, pass] of checks) console.log(pass ? `  ok   ${name}` : `  FAIL ${name}`)
  console.log(failed.length === 0 ? '\nPROBE PASS' : `\nPROBE FAIL —— ${failed.join('、')}`)
  process.exitCode = failed.length === 0 ? 0 : 1
} finally {
  // 沙箱里 rmSync 可能被 safe-delete 拦截抛错；清理失败不该污染探针结论，显式吞掉并告知残留路径。
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    console.log(`（清理失败，残留目录：${dir}，可直接删）`)
  }
}
