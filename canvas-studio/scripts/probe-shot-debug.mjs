/**
 * CV-445 调试探针：输出全片逐帧特征与判定中间量，定位漏检/误报成因。
 * 用法：node scripts/probe-shot-debug.mjs <videoPath>
 */
import { extractFrameTrack, localMedian, SHOT_SAMPLE_FPS, SHOT_THUMB_W, SHOT_THUMB_H } from '../lib/shot-detect.js'

const videoPath = process.argv[2]
if (!videoPath) {
  console.error('用法：node scripts/probe-shot-debug.mjs <videoPath>')
  process.exit(1)
}

const track = await extractFrameTrack(videoPath, SHOT_SAMPLE_FPS)
const fps = track.fps
const n = track.luma.length
const radius = Math.max(4, Math.round(fps * 0.5))
const score = track.histDist.map((h, i) => 0.6 * h + 0.4 * Math.min(1, (track.pixDiff[i] ?? 0) * 4))
if (score.length > 0) score[0] = 0
const base = localMedian(score, radius)
const chgBase = localMedian(track.changed, radius)

console.log(`帧数 ${n}，fps ${fps}，缩略图 ${SHOT_THUMB_W}x${SHOT_THUMB_H}`)
console.log('i   t(s)   hist   pixD   chg    luma   score  base   s>b*2.5+.06 chg>.25 s>th  rel')
for (let i = 1; i < n; i += 1) {
  const s = score[i] ?? 0
  const chg = track.changed[i] ?? 0
  const b = base[i] ?? 0
  const cb = chgBase[i] ?? 0
  const strong = s > 0.30 && s > b * 2.5 + 0.06 && chg > 0.25
  const relative = chg > 0.45 && chg > cb * 3 + 0.2 && s > b * 4 + 0.03
  const mark = strong ? 'STRONG' : relative ? 'REL' : ''
  // 只打印「有动静」的行（score > 0.05 或 chg > 0.1），避免刷屏
  if (s > 0.05 || chg > 0.1) {
    console.log(
      `${String(i).padStart(3)} ${((i / fps).toFixed(2)).padStart(6)} ${(track.histDist[i] ?? 0).toFixed(3).padStart(6)} `
      + `${(track.pixDiff[i] ?? 0).toFixed(3).padStart(6)} ${chg.toFixed(3).padStart(6)} ${(track.luma[i] ?? 0).toFixed(0).padStart(5)} `
      + `${s.toFixed(3).padStart(6)} ${b.toFixed(3).padStart(6)} ${String(s > b * 2.5 + 0.06).padStart(6)} ${String(chg > 0.25).padStart(5)} ${String(s > 0.3).padStart(5)} ${mark}`,
    )
  }
}
