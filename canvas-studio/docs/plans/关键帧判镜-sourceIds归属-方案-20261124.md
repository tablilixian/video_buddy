# 关键帧判镜：`sourceIds` 归属缺失的根因与方案

- **状态**：**已拍板不采用（2026-11-24，用户决定）** —— 保持现状：**允许分镜没有关键帧**，这是设计上的选择，不是缺陷。本文保留仅作**根因证据链**（解释图为什么落「创意」节、判镜为什么认不出），**勿据此改代码**；§5 的 P0/P1/P2 一律不执行。
- **现象**：分镜托盘里只剩视频，关键帧全落在「创意」节；`分镜 8/8` 里 8 = 4 卡 + 4 视频
- **实测样本**：`VideoOut/new4/projects/帮我制作一段短片，内容是 圣经故事中的`（2026-11-24）
- **本方案不改存量数据**：P0 是只读投影；P1/P2 只改产生路径与用户操作入口

---

## 1. 结论

不是布局问题，也不是布局函数算错。是 **9 次 `image_generate` 调用全都没传 `shotRefs`**，于是 9 张图的 `sourceIds` 为空、`operationType` 全被判成 `look`，判镜函数认不出它们属于哪一镜。

而这条路径上**没有任何硬闸**：skill 写了要求、Host 不校验、事后也没有改绑入口。四层叠加，才让一个「静默漏参」变成 9/9 的稳定失败。

---

## 2. 证据链

### 2.1 数据侧

| 事实 | 数值 |
|---|---|
| 分镜卡创建时间 | 11:08:26（4 张，同一批） |
| 9 张 `image_generate` 图创建时间 | 11:15:57 – 11:28:38（**晚于卡 7 分钟以上**） |
| 9 张图的 `sourceIds` | **全部 `[]`** |
| 9 张图的 `operationType` | **全部 `look`**（绑镜才会是 `text-to-image` / `image-to-image`） |
| 4 条视频的 `sourceIds` | **含分镜卡**（如 `2134a198` → 角色图 + `90e8ec96` + 分镜卡 `23d10444`） |
| 4 条视频的 `shotNodeIds`（jobs.json） | 有值，说明视频侧传了 `shotRefs` |

结论一：**卡先存在，图后生成** ⇒ 不存在「调图时还没有卡可绑」。
结论二：**同一个项目里视频绑上了、图片全没绑** ⇒ 不是工具链能力问题，是图片路径漏参。
结论三：如果传了 `shotRefs` 却解析失败，`resolveShotRefs` 会抛 `CS-USER-ERR`（`reference-resolve.ts:291`）⇒ 图会失败而不是成功落盘。9 张图全部 `settled` ⇒ **确定是没传，不是传错**。

### 2.2 代码链路

```
image_generate({ shotRefs: ['分镜 1 · S1-Sh1'] })
  → host-tools.ts:2255  resolveShotRefs()            // 解析成卡节点 id
  → params.shotNodeIds
  → generate.ts:3035-3039  mergeSourceIds(..., shotNodeIds)   // 并入血缘
  → 节点 sourceIds 含卡
  → canvas-view.ts:449-458 deriveShotSemantics 第三趟
      图引用卡 ⇒ keyframes.add + shotNo.set
  → 落进分镜托盘，role = keyframe
```

漏传 `shotRefs` 时，这条链第一步就断了，后面每一步都"正确地"按未绑镜处理 —— 这是设计好的降级，不是 bug。

---

## 3. 根因：四层叠加

### 3.1 skill 有要求，但只是提示词

`consistency.md:33`、`SKILL.md:68`、`toolchain.md:36` 三处都写了「逐镜出图必须传 `shotRefs`」。**已经写了，模型还是漏了 9 次**。文案不是闸。

### 3.2 Host 侧不校验

`host-tools.ts:2256` 只把 `shotBound` 用于两件事：落地前软预算、`autoAttachLookSample`。**没有任何「该绑却没绑」的拒收分支**。

`generate.ts:1636` 的降级是显式的：

```ts
const shotBound = (params.shotNodeIds?.length ?? 0) > 0
if (tool === 'image_generate') {
  if (!shotBound) return 'look'      // 静默降级为「定妆/样张」
  ...
}
```

`generate.ts:1623-1635` 的注释甚至把「模型忘传 shotRefs 时最多把那张图算成定妆」当作**可接受的设计**。在标准流程里它成立（场景概念图/定妆照本来就不该绑镜），但在「逐镜关键帧」这一步，它把错误吞掉了。

### 3.3 唯一的"闸"是假承诺

`skills/drama-episode-executor/SKILL.md:45`：

> 角色镜全带 `shotRefs` 定妆句柄（绑镜纪律，**Host 会拒收缺省调用**）。

**Host 不拒收。** 模型读到这句会认为「我不传也会被拦，拦了再补」，而实际是不传就静默落成 `look`。这类「文档承诺了、代码没有」的闸，比完全没有闸更危险。

### 3.4 落地后是无闸区

`look-budget.ts:34`：

```ts
return mode === 'confirm' && state === 'storyboarding'
```

软预算只管**落地前**。落地后（`keyframe_review` / `executing` / `drafting`）不绑镜出图**不限量、不提示、不计数**。逐镜阶段恰好全在落地后 —— 9 张图就出在这个窗口里。

### 3.5 事后无补救

- `deriveShotSemantics` 只认 `sourceIds` 含卡，第二条判据都没有。
- 画布没有「把这张图归到某一镜」的操作。用户看到图在创意节，只能重出。

---

## 4. 方案

### P0 · 读侧兜底：镜视频的第一个画面位 = 该镜关键帧（只读，不改数据）

在 `deriveShotSemantics`（`canvas-view.ts:429`）的第三趟之后加第四趟：

```ts
// 第四趟：图未绑镜时，按「镜视频的第一个画面参考」反查归属。
// 语义依据：image2video 的第 1 张画面参考就是该镜首帧。
const claimed = new Set<number>()
for (const video of nodes
  .filter(n => n.kind === 'video' && n.toolName !== 'compose')
  .sort((a, b) => a.createdAt - b.createdAt)) {
  const shot = shotNo.get(video.id)
  if (shot === undefined || claimed.has(shot)) continue
  const first = video.sourceIds
    .map(id => byId.get(id))
    .find(src => src !== undefined
      && src.kind === 'image'
      && src.toolName !== 'character_sheet'   // 角色锚点不是关键帧
      && src.origin !== 'manual'              // 用户上传的参考图不是关键帧
      && !isAuxiliaryNode(src)                // 末帧另算
      && !keyframes.has(src.id))              // 已绑镜的不改判
  if (first === undefined) continue
  keyframes.add(first.id)
  shotNo.set(first.id, shot)
  claimed.add(shot)
}
```

**实测命中（本项目）**：

| 镜 | 视频 sourceIds（按序） | 取到的第一张画面位 | 结果 |
|---|---|---|---|
| 1 | `54ea815e`(character_sheet) → `90e8ec96` → 卡 | `90e8ec96` | ✅ 归镜 1 |
| 2 | `54ea815e` → `6403940c` → 卡 | `6403940c` | ✅ 归镜 2 |
| 3 | `1adf21ea` → `54ea815e` → 卡 | `1adf21ea` | ✅ 归镜 3 |
| 4 | `86492b1c` → `54ea815e` → `90e8ec96` → 卡 | `86492b1c` | ✅ 归镜 4 |

角色图 `54ea815e` 被 5 条视频引用，但它是 `character_sheet` ⇒ 排除，不会被判成任何镜的关键帧。
镜 4 视频也引用了镜 1 的 `90e8ec96`，但它不在第一位 ⇒ 不抢。

**与 2026-09-22 删掉的那条推断的区别（关键）**：

| | 旧（已删） | 新（本方案） |
|---|---|---|
| 判据 | 被**任何**视频消费过 | 被镜视频的**第一个画面位**引用 |
| 失败模式 | 一张被 6 镜共用的色彩参考图被判给其中一镜 | 只有「首帧位」才算，多镜共用但不在首位的图不会被抢 |
| 排除项 | 无 | `character_sheet` / `origin:'manual'` / 辅助卡 / 已绑镜 |

**风险**：如果 agent 把场景概念图排在 `filenames[0]`，会被误认为关键帧。缓解：只在只读投影里生效、不改数据；建议同时在 `WaterfallLayout` 加 `inferredKeyframes: ReadonlySet<string>`，渲染层给这类格加一个「推断」小角标，用户能一眼看出不是显式绑定。

**放哪里的取舍**：

- 放 `deriveShotSemantics`（共享）⇒ 整理布局（CV-223）也会把图放回分镜区，两处口径一致；但要跑全量 `test:smoke` + `verify-previews`，确认整理布局位移可接受。
- 只放瀑布流 ⇒ 风险最小，但自由画布的整理结果仍把图丢创意区，两套口径。

**推荐前者**，并在 PR 里附整理布局的前后坐标对比。

### P1 · 产生侧：落地后强制绑镜（治本）

`host-tools.ts:2256` 之后插入：

```ts
const workflow = normalizeWorkflow((await registry.getProject(projectId))?.workflow)
const landed = !lookBudgetApplies(workflow.mode, workflow.state)   // 已过 storyboarding
if (!shotBound && landed && hasShotCards(projectId) && a.intent !== 'look') {
  throwError('CS-USER-ERR', {
    message: '项目已落地，逐镜出图必须传 shotRefs（该镜分镜卡标题，如「分镜 2 · S1-Sh2」）'
      + '；若是场景概念图 / 基调样张，请显式传 intent:"look"。'
      + '当前可用分镜卡：' + cardTitles.join('、'),
  })
}
```

要点：

1. 新增可选参数 `intent?: 'look'`，**只用于豁免**，缺省不豁免（默认按逐镜处理）。向后兼容：老调用若不带 shotRefs，会从"静默落 look"变成"报错"——这是**有意**的行为变更，需要写进 changelog。
2. 报错必须列出可用卡标题 —— 光说"未找到"会让模型换参数绕道（`reference-resolve.ts` 的注释记着这条教训）。
3. 豁免路径要留全：定妆照走 `character_generate`、Look 样张走 `intent:'look'`、场景概念图走 `intent:'look'`。
4. 同时删掉 `drama-episode-executor/SKILL.md:45` 的假承诺，或把它改成「Host 会拒收」——但只在 P1 落地后才成立。

### P2 · 补救入口：手动归镜

节点详情面板加「归属镜」下拉（现有分镜卡列表），选中后向 `sourceIds` **追加**卡 id（不删原有血缘），并把 `operationType` 从 `look` 改为 `text-to-image`。

这是历史画布唯一的修复手段，也是 agent 再漏参时的兜底。工作量比 P0 大，但它是产品能力，不是迁移脚本 —— 不违反「不修存量数据」的纪律（用户手动操作，不是批量回填）。

---

## 5. 验证

| 层 | 方法 |
|---|---|
| P0 单测 | 用本项目 4 镜的最小 fixture：断言 4 张现行图进 `keyframes`、`shotNo` 正确；断言 `54ea815e` **不在** `keyframes`；断言镜 4 的 `90e8ec96` 不被判给镜 4 |
| P0 反向变异 | 去掉 `toolName !== 'character_sheet'` ⇒ 角色图被误判，红；去掉"第一位"改用"任一消费" ⇒ `90e8ec96` 被判给镜 4，红 |
| P0 回归 | `yarn test:smoke` + `verify-previews`（整理布局位移）+ `tsc ×2` |
| P1 单测 | 落地态 + 无 shotRefs + 无 intent ⇒ 抛 `CS-USER-ERR` 且文案含卡标题；`intent:'look'` ⇒ 通过；落地前 ⇒ 不受影响 |
| P2 | 手动绑镜后 `deriveShotSemantics` 认出关键帧；解绑后回到创意节 |

---

## 6. 顺序建议

1. **P0 随「一行一镜」一起落**：布局改完如果图还在创意节，4 格行里只有 3 格，验收会误判成布局没做对。两者必须同一次真机验收。
2. **P1 单独一批**：它是行为变更（未绑镜出图会报错），要更新 skill 文案、changelog，并观察会不会挡住正常流程。
3. **P2 排期另定**：界面能力，与布局无关。

---

## 7. 一句话总结

`sourceIds` 判镜靠的是「图引用分镜卡」这一条硬血缘。9 张图没传 `shotRefs`，血缘从源头就空，Host 又静默降级成 `look`，于是判镜函数"正确地"把她们放进了创意节。

治本是让漏参变成**报错**（P1），救急是让首帧参考位**反查归属**（P0），兜底是给用户一个**手动归镜**的入口（P2）。
