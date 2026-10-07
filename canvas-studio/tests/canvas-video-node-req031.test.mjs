/**
 * REQ-031（CV-282 Step 5）video 节点卡三态 + 工具栏三项守卫。
 *
 * 口径（方案 §四 A 组 F1~F4 / H7 + 拍板第二批③）：
 *   - F1 空态：橙色摄像机图标 + 「点击节点选中，输入你的创作需求」（无产物、未生成时）；
 *   - F2 角标：「{画幅} · {时长}s · {清晰度}」读生成参数（缺省 16:9/5s/480p），
 *     无参数（上传素材）不显示，生成中让位进度环；
 *   - F3 进度环：csAdvanceSpin 旋转 + 「生成中…」+ 副文案「MiniMax H3 · {模式} · {时长}s」
 *     ——**无假百分比**（后端 202+轮询无进度回调，拍板③）；其余类型保持线性光带；
 *   - F4 工具栏：video = 引用到对话 / 预览 / 下载 三项（演示 1:1，无「添加到资产库」），
 *     非 video 路径（重试/改提示词/引用到对话）零改动；
 *   - H7：产物实测时长读数走既有 probeMediaDuration / video metadata（零改动）。
 *
 * 源码级字符串断言（与 canvas-video-chips-req031 同款手法）。
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-031 F1 空态：video 无产物卡 = 橙色摄像机图标 + 引导语逐字', async () => {
  const node = await read('src/client/canvas/CanvasNode.tsx')
  assert.match(
    node,
    /node\.kind === 'video' && node\.url === undefined && node\.isLoading !== true && \(\s*<div className="csNodeVideoEmpty">/,
    '空态必须只对「video 且无产物且未在生成」渲染',
  )
  assert.match(node, /点击节点选中，输入你的创作需求/, '引导语必须逐字取演示')
  assert.match(node, /csNodeVideoEmptyIcon/, '必须有空态图标槽（橙色摄像机，样式在 styles）')
  const styles = await read('src/client/styles.ts')
  assert.match(styles, /\.csNodeVideoEmptyIcon \{ display: flex; color: #ffb066; \}/, '图标必须为演示橙色 accent（固定 #ffb066，偏差登记）')
})

test('REQ-031 F2 参数角标：读生成参数拼装，缺省 16:9/5s/480p，生成中让位', async () => {
  const node = await read('src/client/canvas/CanvasNode.tsx')
  assert.match(node, /videoBadge !== null && node\.isLoading !== true/, '角标必须在生成中隐藏（让位进度环）')
  // 拼装：aspect 缺省 16:9 / duration 缺省 5 / resolution 走产品化展示名。
  assert.match(node, /params\.aspectRatio === 'string' && params\.aspectRatio !== '' \? params\.aspectRatio : '16:9'/, '画幅缺省必须 = 16:9')
  assert.match(node, /Math\.round\(params\.duration\) : 5/, '时长缺省必须 = 5s（video_generate fallback 同值）')
  assert.match(node, /resolutionDisplay\(resolution\)\.label/, '清晰度必须走产品化展示名（拍板⑥共享映射）')
  assert.match(node, /className="csNodeVideoBadge"/, '角标必须挂 csNodeVideoBadge（右下、脚部读数行上方）')
})

test('REQ-031 F3 进度环：csAdvanceSpin 旋转 + 副文案逐字 + 无假百分比 + 降级成对', async () => {
  const node = await read('src/client/canvas/CanvasNode.tsx')
  const styles = await read('src/client/styles.ts')
  assert.match(node, /node\.kind === 'video' && <span className="csNodeVideoRing"/, 'video 生成中必须挂进度环')
  assert.match(node, /'生成中…' : \(TOOL_TITLES\[node\.toolName \?\? ''\] \?\? '生成中…'\)/, 'video 标签必须为「生成中…」（工具名让位副文案）')
  assert.match(node, /MiniMax H3 · \$\{channel\} · \$\{duration\}s/, '副文案必须 = 「{模型} · {模式} · {时长}s」拼装')
  assert.match(node, /params\.channel === 'fl2va' \? '首尾帧' : '全能参考'/, '模式读数必须与输入框卡 channel 口径一致')
  // 无假百分比：进度环路径不得出现百分比数字（拍板③；其它类型的 MM:SS 计时不受影响）。
  assert.equal(/生成中\s*\d+%|生成中 0%/.test(node), false, '不得出现假百分比读数')
  // 其余类型保持线性显影光带（零改动）。
  assert.match(node, /node\.kind !== 'video' && <span className="csNodeProgress">/, '非 video 类型必须维持原进度条')
  // 环动画 = 行进语义（DD-03 前缀白名单）+ reduced-motion 降级成对。
  assert.match(styles, /@keyframes csAdvanceSpin/, '旋转动画必须归入 csAdvance 行进语义')
  assert.match(styles, /animation: csAdvanceSpin 1s linear infinite/, '环必须挂旋转动画')
  const reduced = styles.split(/(?=@media)/).filter(chunk => chunk.startsWith('@media (prefers-reduced-motion')).join('\n')
  assert.ok(reduced.includes('.csNodeVideoRing'), 'prefers-reduced-motion 降级必须覆盖进度环')
})

test('REQ-031 F4 工具栏三项：video = 引用到对话/预览/下载，非 video 路径零改动', async () => {
  const bar = await read('src/client/canvas/NodeActionBar.tsx')
  // video 裁剪：重试/改提示词只在非 video 出现（单击节点 = 输入框卡是唯一编辑面）。
  assert.match(bar, /const canRetry = !isVideo && onRetry !== undefined/, '重试必须退出 video 工具栏')
  assert.match(bar, /const canEdit = !isVideo && onEditPrompt !== undefined/, '改提示词必须退出 video 工具栏（输入框卡是唯一编辑面）')
  assert.match(bar, /const canPreview = isVideo && onOpenPlayback !== undefined && node\.url !== undefined && node\.isLoading !== true/, '预览必须 video + 有产物 + 未生成')
  assert.match(bar, /canDownloadNode\(node\)/, '下载判据必须与右键菜单同源（canDownloadNode）')
  // 三项按钮逐字。
  assert.match(bar, /onClick=\{\(\) => \{ onReferenceToChat\(node\) \}\}/, '引用到对话保留')
  assert.match(bar, />\s*预览\s*</, '预览按钮必须存在')
  assert.match(bar, />\s*下载\s*</, '下载按钮必须存在')
  assert.equal(/onAddToLibrary|>\s*添加到资产库\s*</.test(bar), false, 'video 工具栏不得出现「添加到资产库」按钮/属性（B-3 同口径；注释说明不误伤）')
})

test('REQ-031 接线：CanvasSurface 新下载出口 + StudioFrame 复用 handleDownload', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  const frame = await read('src/client/StudioFrame.tsx')
  assert.match(surface, /onNodeDownload\?\(id: string\): void/, 'CanvasSurface 必须新增按 id 的下载出口')
  assert.match(surface, /\{\.\.\.\(onNodeDownload !== undefined \? \{ onDownload: onNodeDownload \} : \{\}\)\}/, '工具条必须接 onDownload')
  assert.match(surface, /\{\.\.\.\(onNodeOpenPlayback !== undefined \? \{ onOpenPlayback: onNodeOpenPlayback \} : \{\}\)\}/, '工具条必须接 onOpenPlayback')
  assert.match(frame, /onNodeDownload=\{id => \{/, 'StudioFrame 必须为工具条接下载回调')
  assert.match(frame, /if \(target !== undefined\) handleDownload\(target\)/, '下载必须复用既有 handleDownload 通路')
})
