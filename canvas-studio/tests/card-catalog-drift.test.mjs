/**
 * S-1 守卫：**卡目录必须与注册表同步**（REQ-038-R11 文档体系整改）。
 *
 * 抓的是什么：2026-11-16 第二轮真机会话 53 分钟零产物，48 次 bash 里约 14 次在
 * 枚举卡（`grep -rhn "id: '"`），`recipe-cards*.ts` 被读 11 次 —— 因为
 * `references/shot-cards.md` 的 24 个编号里只有 7 个是真实卡号（覆盖率 12%）。
 * 手写目录必然随注册表漂移，且漂移后没有任何机制会红。所以改成机器生成 + 门禁。
 *
 * 四条断言：
 * 1. 磁盘上的生成物 === 现跑脚本的输出（漂移即红）。
 * 2. 覆盖完整：58 张一张不少、零素材张数与注册表一致（防「生成成功但漏了一半」）。
 * 3. **反向变异**：临时注册一张卡，生成结果必须跟着出现且 box 来自它自己的产物
 *    —— 证明确实是从注册表 + `generate()` 抽的，不是把内容硬编码在脚本里。
 * 4. 假编号不在表里：`shot-cards.md` 里那 17 个非卡号（`subtitle` / `chartBars` /
 *    `wipeLeft` / `F1`…）绝不能被目录收进来（收进来就是新的信任崩塌点）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderCardCatalog, OUTPUT } from '../scripts/gen-card-catalog.mjs'
import { registeredCardIds, getCard, registerCard } from '../lib/remotion/recipe-cards-all.js'

test('卡目录与注册表一致（加了卡 / 改 title / 改 assets 必须重跑 gen-card-catalog.mjs）', () => {
  const generated = renderCardCatalog()
  const onDisk = readFileSync(OUTPUT, 'utf8')
  assert.equal(
    onDisk,
    generated,
    '生成物与注册表不一致 —— 跑 `yarn build && node scripts/gen-card-catalog.mjs` 后一起提交。'
    + '（这条守卫的意义：目录一旦与注册表脱钩，模型就会回去 grep 源码枚举卡，那 11 次读文件就白省了。）',
  )
})

test('覆盖完整：58 张卡一张不漏，零素材张数与注册表一致', () => {
  const text = readFileSync(OUTPUT, 'utf8')
  const ids = registeredCardIds()
  const missing = ids.filter((id) => !new RegExp(`^\\| ${id} \\|`, 'mu').test(text))
  assert.deepEqual(missing, [], `目录缺卡：${missing.join(', ')}`)
  const zeroAsset = ids.filter((id) => getCard(id).assets.length === 0).length
  assert.ok(
    text.includes(`本表共 ${ids.length} 张：**${zeroAsset} 张零素材可用**`),
    `表头计数与注册表不符（应为 ${ids.length} 张 / ${zeroAsset} 张零素材）——`
    + '零素材那张数是「这条需求能不能用这张卡」的第一道筛子，错了会直接把模型引向缺素材的卡',
  )
  assert.ok(text.length < 12_000, `生成物 ${text.length} 字节 —— 超过 8KB 量级说明表格写法失控（references 体积要克制）`)
})

test('反向变异：临时注册一张卡，目录必须跟着出现，且 box 来自它自己的产物', () => {
  registerCard({
    id: 'TYP9',
    title: '临时探针卡',
    assets: [],
    generate: (ctx) => [
      {
        id: `${ctx.segmentId}-only`,
        type: 'textCard',
        variant: 'title',
        text: ctx.copy,
        box: { x: 11, y: 22, w: 33, h: 44 },
        startFrame: ctx.startFrame,
        durationInFrames: ctx.durationInFrames,
        fadeFrames: 0,
      },
    ],
  })
  const text = renderCardCatalog()
  assert.match(
    text,
    /^\| TYP9 \| 临时探针卡 \| — \| 11,22 33×44 \|/mu,
    '新注册的卡没出现在目录里，或它的主体 box 不是从 generate() 产物抽的'
    + '（硬编码的目录 = 下一个漂移源头）',
  )
})

test('假编号不进表：非卡号的参数名 / 上游手法名一律不得出现在卡号列', () => {
  const text = readFileSync(OUTPUT, 'utf8')
  // shot-cards.md 里混进卡号坐标系的 17 个非卡号（复盘文档附录 C）
  const notCards = ['A3', 'B2', 'C1', 'D1', 'D2', 'E2', 'E3', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']
  const present = new Set(registeredCardIds())
  const leaked = notCards.filter((id) => present.has(id))
  assert.deepEqual(
    leaked, [],
    `以下编号被注册成了卡（${leaked.join(', ')}）—— 它们本来是 manifest 参数 / 上游手法名，`
    + '注册成卡会让「文档里的编号」与「注册表的卡号」重新混成两套坐标系',
  )
  for (const id of notCards) {
    assert.doesNotMatch(text, new RegExp(`^\\| ${id} \\|`, 'mu'), `目录里出现了非卡号 ${id}`)
  }
})
