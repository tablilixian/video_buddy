/**
 * 「参考素材」派生节（REQ-037 延伸）：故事板里用户上传附件的回看入口。
 *
 * 设计口径（与效果稿 2026-11-10 对齐）：
 *   - 不进契约：九节 / schemaVersion / SECTION_GUIDE / 完成度分母全部不动，
 *     本节是 §07 中 source=user 子集的**渲染视图**，数据只有一个事实源；
 *   - tab 插在 §00 之后、不带编号、带「用户」角标；有 user 条目才点亮；
 *   - 四种格式四种形态：图片 :target 大图、视频/音频原生播放器、文字内联 details；
 *   - 引用失效（CV-408 对账）、waived 折算、空态引导各就各位。
 *
 * 运行：node --test tests/storyboard-user-references.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'
import { renderStoryboard, userReferenceAssets } from '../lib/storyboard-render.js'

function docWithAssets(assets) {
  return createStoryboard({
    projectId: 'p1',
    title: '参考素材节',
    meta: { genre: '品牌宣传', targetDuration: 10, aspect: '16:9' },
    sections: {
      ...emptyStoryboardSections(),
      '07_assets': assets,
    },
  })
}

const userImage = {
  name: '主视觉参考',
  type: 'image',
  status: 'ready',
  ref: { kind: 'file', id: 'abc-123.png' },
  neededBy: ['S2', 'S3'],
  source: 'user',
}
const generatedImage = {
  name: 'Look 卡',
  type: 'image',
  status: 'ready',
  ref: { kind: 'canvasNode', id: 'n-look' },
  neededBy: [],
  source: 'generated',
}

function refSection(html) {
  const start = html.indexOf('id="ref"')
  const end = html.indexOf('id="s1"')
  assert.ok(start > 0 && end > start, '渲染产物应含 ref 节且位于 s1 之前')
  return html.slice(start, end)
}

test('userReferenceAssets 只取 source=user 且未放弃的条目', () => {
  const sections = {
    ...emptyStoryboardSections(),
    '07_assets': [
      userImage,
      generatedImage,
      { ...userImage, name: '放弃的参考', status: 'waived' },
      { ...userImage, name: '待上传参考', status: 'pending', ref: { kind: 'file', id: 'x.png' } },
    ],
  }
  const refs = userReferenceAssets(sections)
  assert.deepEqual(refs.map((asset) => asset.name), ['主视觉参考', '待上传参考'])
})

test('没有 user 素材时：空态引导 + tab 灰显，不出现卡片', () => {
  const html = renderStoryboard(docWithAssets([generatedImage]))
  assert.ok(html.includes('href="#ref"'), 'tab 应存在')
  const refSectionHtml = refSection(html)
  assert.ok(refSectionHtml.includes('还没有用户上传的参考素材'), '应有空态引导')
  assert.ok(!refSectionHtml.includes('Look 卡'), 'generated 条目不得进入参考素材节')
  assert.ok(html.includes('tab miss" href="#ref"'), '无 user 素材时 tab 不点亮')
})

test('有 user 素材时：tab 点亮 + 图片走 :target 大图 + lightbox', () => {
  const html = renderStoryboard(docWithAssets([userImage, generatedImage]), {
    mediaUrl: (ref) => ref.kind === 'file' ? `/canvas-studio/assets/p1/${ref.id}` : undefined,
  })
  assert.ok(html.includes('tab on" href="#ref"'), '有 user 素材时 tab 点亮')
  const refSectionHtml = refSection(html)
  assert.ok(refSectionHtml.includes('href="#ref-lb-0"'), '图片卡应链到 lightbox')
  assert.ok(refSectionHtml.includes('id="ref-lb-0"'), '应渲染 :target lightbox')
  assert.ok(refSectionHtml.includes('src="/canvas-studio/assets/p1/abc-123.png"'), '缩略图走 mediaUrl')
  assert.ok(refSectionHtml.includes('用于 S2 · S3'), 'neededBy 应展示')
  assert.ok(!refSectionHtml.includes('Look 卡'), 'generated 条目不进本节')
})

test('视频 / 音频走原生播放器（无 JS）', () => {
  const assets = [
    { ...userImage, name: '运镜参考', type: 'video', ref: { kind: 'file', id: 'ref.mp4' } },
    { ...userImage, name: '语气参考', type: 'audio', ref: { kind: 'file', id: 'ref.mp3' } },
  ]
  const html = renderStoryboard(docWithAssets(assets), {
    mediaUrl: (ref) => `/canvas-studio/assets/p1/${ref.id}`,
  })
  const refSectionHtml = refSection(html)
  assert.ok(refSectionHtml.includes('<video controls preload="metadata" src="/canvas-studio/assets/p1/ref.mp4"'))
  assert.ok(refSectionHtml.includes('<audio controls preload="metadata" src="/canvas-studio/assets/p1/ref.mp3"'))
})

test('文字条目：textFor 有内容则内联 details，无则降级为引用行', () => {
  const textAsset = { ...userImage, name: '创意说明', type: 'text', ref: { kind: 'file', id: 'brief.txt' } }
  const withText = renderStoryboard(docWithAssets([textAsset]), {
    textFor: (ref) => ref.id === 'brief.txt' ? '全文内容<script>' : undefined,
  })
  const withHtml = refSection(withText)
  assert.ok(withHtml.includes('<details class="refbrief">'))
  assert.ok(withHtml.includes('全文内容&lt;script&gt;'), '正文必须转义')
  assert.ok(!withHtml.includes('<script>'), '不允许出现未转义脚本')

  const withoutText = renderStoryboard(docWithAssets([textAsset]))
  const withoutHtml = refSection(withoutText)
  assert.ok(!withoutHtml.includes('<details class="refbrief">'))
  assert.ok(withoutHtml.includes('file:brief.txt'), '降级为引用行')
})

test('canvasNode 引用失效：CV-408 对账就地标红；在册则不标', () => {
  const nodeAsset = { ...userImage, name: '节点参考', ref: { kind: 'canvasNode', id: 'n-ref' } }
  const stale = renderStoryboard(docWithAssets([nodeAsset]), {
    mediaUrl: () => '/x.png',
    canvasNodeIds: new Set(['n-other']),
  })
  assert.ok(refSection(stale).includes('引用失效'))

  const alive = renderStoryboard(docWithAssets([nodeAsset]), {
    mediaUrl: () => '/x.png',
    canvasNodeIds: new Set(['n-ref']),
  })
  assert.ok(!refSection(alive).includes('引用失效'))
})

test('waived 的 user 条目折算成一行说明，不出卡片', () => {
  const html = renderStoryboard(docWithAssets([
    { ...userImage, name: '不要了的参考', status: 'waived' },
  ]))
  const refSectionHtml = refSection(html)
  assert.ok(!refSectionHtml.includes('不要了的参考</div>'), 'waived 不出卡片')
  assert.ok(refSectionHtml.includes('已标「放弃」'), '应有 waived 说明行')
  assert.ok(refSectionHtml.includes('还没有用户上传的参考素材'), '全部放弃 = 视空态 + 说明')
})

test('mediaUrl 解析不到：图片/视频降级为引用行，不留死链', () => {
  const assets = [
    userImage,
    { ...userImage, name: '运镜参考', type: 'video', ref: { kind: 'file', id: 'ref.mp4' } },
  ]
  const html = renderStoryboard(docWithAssets(assets))
  const refSectionHtml = refSection(html)
  assert.ok(!refSectionHtml.includes('<img'), '无 URL 不渲染 img')
  assert.ok(!refSectionHtml.includes('<video'), '无 URL 不渲染 video')
  assert.ok(refSectionHtml.includes('file:abc-123.png'))
})

test('本节不参与九节完成度：§07 有 1 条 user 素材时进度仍为 1/9（派生节不加分子）', () => {
  const html = renderStoryboard(docWithAssets([userImage]))
  assert.ok(html.includes('已填充 <b>1 / 9</b>'), '派生节不得改变完成度分母与分子')
  assert.ok(!html.includes('/ 10'), '不得出现 10 节口径')
})

test('§07 素材清单显示过滤：user 条目不列表（已在参考素材节），generated 照常', () => {
  const html = renderStoryboard(docWithAssets([
    userImage,
    { name: 'Look 卡', type: 'image', status: 'ready', ref: { kind: 'canvasNode', id: 'n-look' }, neededBy: [], source: 'generated' },
  ]), { mediaUrl: () => '/x.png' })
  const start = html.indexOf('id="s7"')
  const end = html.indexOf('id="s8"')
  assert.ok(start > 0 && end > start, '应存在素材清单节')
  const s7 = html.slice(start, end)
  assert.ok(!s7.includes('主视觉参考'), 'user 条目不在素材清单表中（显示过滤，数据不动）')
  assert.ok(s7.includes('Look 卡'), '非 user 条目照常列出')
  assert.ok(s7.includes('参考素材'), '应带指向参考素材节的说明行')
})

test('§07 全部是 user 条目时：空表 + 指引文案', () => {
  const html = renderStoryboard(docWithAssets([userImage]))
  const start = html.indexOf('id="s7"')
  const end = html.indexOf('id="s8"')
  const s7 = html.slice(start, end)
  assert.ok(s7.includes('没有待备素材'), '应说明没有待备素材')
  assert.ok(s7.includes('全部 1 项都是用户上传的参考'), '应说明条目去向')
})
