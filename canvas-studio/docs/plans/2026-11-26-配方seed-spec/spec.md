# Spec：§9 第 5 步 —— 配方 → 故事板 seed（recipeToStoryboardSeed + specSeed + 反变异 2/2b）

来源计划：[2026-11-26-配方正确用法与两张补充卡-开发文档.md](../2026-11-26-配方正确用法与两张补充卡-开发文档.md) §3.4 / §3.4.1 / §8。
状态：待批准。批准后按 [tasks.md](tasks.md) 执行。

## 目标

把配方（`Recipe`）编译成可直接喂 `write_storyboard` 的种子九节（只填 00/02/04/07/08）+ `specSeed`（喂 `build/manifest-spec.json`），并钉住两条反变异（2：pending 素材必须在**落地**时被拒；2b：seed 生成时**不得**被 `validateForSeed` 拦截）。

## 背景事实（已实证，不再重查）

- `normalizeStoryboard`（`src/contracts/storyboard.ts:808-833`）→ `normalizeStoryboardSections`（`:682-711`）：`'07_assets'` 只认 `Array.isArray`，`'08_constraints'` 只认 `strList` ⇒ **wrapper 形态 `{"assets":[…]}` / `{"constraints":[…]}` 被静默清空成 `[]`，bare 数组才存活**（node 直调已证实）。
- `write_storyboard` execute（`src/host-tools.ts:4542-4554`）`parse` 只 `JSON.parse` 无 unwrap；description L4454-4455 教 wrapper 形态 —— **描述是错的**。
- `creative`/`visual`/`storyboard` 的 wrapper（`{"brief":…}`/`{"tokens":…}`/`{"scenes":…}`）是 normalize 认的形态，保持不变。
- `validateForSeed(document, {enforceAssetReadiness})`（`contracts/storyboard.ts:881`）：pending + enforce ⇒ blocker；pending 不 enforce ⇒ warning；ghost neededBy ⇒ warning（`:983-988`）。真拦截点在落地 `src/storyboard-land.ts:205-213`（blockers 非空 `throwError('CS-USER-ERR', …)`）。
- `file-size-guard` 棘轮：`src/host-tools.ts` 登记 5645（实测 5787，余量内）；`host-tools-template.ts` 未见登记条目（加行前确认是否受测，若受测需查登记值）。
- `text-guard.test.mjs:190` 只约束 `write_script` 描述，不约束 `write_storyboard`。

## 变更清单（精确到文件/函数）

### 1. 新建 `src/remotion/recipe-to-storyboard.ts`

导出：

```ts
export interface RecipeSeedInput {
  readonly recipe: Recipe
  readonly requirements: { totalSeconds?: number; audience?: string; ... }  // 与 list_recipes 入参同构
  readonly fps?: number            // 缺省 30
  readonly title?: string          // §00 brief / spec meta.title 用
}
export interface RecipeSeedResult {
  readonly sections: Partial<StoryboardSections>   // 只含 00/02/04/07/08
  readonly specSeed: Partial<ContentSpec>
  readonly filledSections: readonly string[]       // 「配方填的节」清单，供回执文案
}
export function recipeToStoryboardSeed(input: RecipeSeedInput): RecipeSeedResult
```

映射（按 §3.4 表，逐条落实）：

| 源 | 落点 | 规则 |
|---|---|---|
| `segments[]` | §04 `scenes[]` | 一段一 scene 一 shot；scene `id=S<n>`、shot `id=S<n>-Sh1`（过 `ID_PATTERN`）；`duration` = 权重归一 × `totalSeconds`（无 totalSeconds 时按 5s/段兜底并在 §08 记一条约束）；`frames = round(duration × fps)`；`visual` = `「${label}」${card}：${copy}`；`camera`/`audio` 非空占位（camera `'固定'`、audio `'无声/环境底'`）；`backup:false` |
| `assets[]` | §07 `assets[]` | `status:'pending'`、`ref:{kind:'file',id:''}`、`neededBy:[对应段的 shot id]`（**修 `recipeAssetsJson` 空 neededBy 行为**——本函数不再用它，neededBy 直接指向本批生成 shot）、`source` 原样、`note` 并进 `name`（`name: "${note摘要}（${name}）"`，超 80 字截断）或追加进 §08 constraints |
| `theme` | §02 `tokens` | `[{k:'theme', v: recipe.theme}]` |
| `note` | §00 `brief` 短句 + §08 constraints | brief 为字符串：`"${title}：${recipe.title}（${recipe.id}）"` |
| `note` 全文 | §08 `constraints[]` | 一条：`配方注意：${recipe.note}` |
| `audience`（入参给时） | §08 `constraints[]` | `受众：${audience}（文案抽象度以该人群为准）` |
| structure 裁决 | §08 `constraints[]` | 一条：`结构起点：配方 ${recipe.id}，判据由 list_recipes 五判据给出` |
| `segments[].id/card/copy/weight` | `specSeed.sections[]` | 原样；**只写 `weight` 不写 `durationSec`**（二选一）；`copy` 标注是提示语（在回执文案里说明需改写） |
| `recipe.theme` | `specSeed.meta.theme` | 原样 |
| `requirements.totalSeconds` | `specSeed.meta.durationSec` | 原样（无则不写） |
| — | `specSeed.units` / `carry` / `meta.autoStages` | **留空 / 不开** |

结构自检（函数内，不过不返回 —— 抛 `Error`，消息带失败项）：
1. 输出先过 `normalizeStoryboard({projectId:'seed', sections})`，拿归一化结果；
2. §02 tokens 非空；§04 ≥1 scene 且每 scene ≥1 shot；
3. 每 shot `visual`/`camera`/`audio` 非空；
4. `collectSemanticIds`（导出的 `storyboard.ts:839`）唯一；
5. 每 shot `frames === Math.round(duration × fps)`；
6. **不跑 `validateForSeed`**（反变异 2b：谁在生成路径上调它，三套有素材配方单测必须红）。

### 2. 修 `src/host-tools.ts:4454-4455`（write_storyboard description）

- `assets` 示例 `{"assets":[…]}` → bare `[{"name":…,"type":"image","status":"pending","ref":{"kind":"file","id":""},"neededBy":["S1-Sh1"],"source":"user"}]`；
- `constraints` 示例 `{"constraints":[…]}` → bare `["…"]`；
- 附一行理由注释：wrapper 形态会被 `normalizeStoryboard` 静默清空成 `[]`（`contracts/storyboard.ts:709-710`）。
- 净增行数计入 `host-tools.ts` 棘轮（当前 5787，登记 5645+300=5945，**余量 <158 行，改动控制在 ~10 行内**）。

### 3. `src/host-tools-template.ts` list_recipes 回执尾部（D7 载体）

在 tail 结论之后（每配方 block 内或尾部统一，取**尾部统一**以控制行数）追加：

- 当结论为「1✅ 可用」或用户已指定 `recipe`/`theme` 时，调 `recipeToStoryboardSeed`，回执附：

```
seed（原样喂 write_storyboard 分节参数；seed 只填 00/02/04/07/08，其余节保留你已写的内容）：
<sections JSON，bare 形态>
specSeed（写进 build/manifest-spec.json 后 scaffold_manifest({specPath})；copy 是提示语，必须改写）：
<specSeed JSON>
```

- 生成失败（结构自检不过）时回执降级为一句「seed 生成失败：{原因}」，不阻断 list_recipes 本体。
- 若 `host-tools-template.ts` 在 file-size-guard 白名单内，同步补登行数。

### 4. 新建 `tests/recipe-seed.test.mjs`

- **反变异 2**（落地拒）：复用 `storyboard-gate.test.mjs` 的 makeRegistry/EXEC/harness 范式 → `recipeToStoryboardSeed`（`story-arc`）→ `createStoryboard` 拼 sections → `saveStoryboard` → `landStoryboard(reg,'p1')` 必须 throw，且 message 含 `未就绪` / `不能落地`；另断言 `validateForSeed(doc,{enforceAssetReadiness:true})` blockers 非空、ghost neededBy（人为指错 shot id）只进 warnings 不进 blockers。
- **反变异 2b**（生成不被拦）：`product-walkthrough` / `story-arc` / `product-promo-60s` 三套 seed **直接调用必须返回**（不抛）；再断言生成路径源码不含 `validateForSeed` 调用（读 `src/remotion/recipe-to-storyboard.ts` 文本断言，防「顺手加拦截」）。
- 附加断言：ID 符合 `S<n>`/`S<n>-Sh1`；`neededBy` ⊆ 本批 shot ids；bare 形态（`sections['07_assets']` 是数组）；specSeed 不双写 durationSec/weight；explainer-cards（0 素材）产出 §07 为 `[]`。
- **描述漂移断言**（配合 §2）：`host-tools.ts` 的 write_storyboard description 中 assets/constraints 示例不含 `"assets":[` 开头的 wrapper 包裹（防回潮）。

## 验收（全量门禁）

在 `canvas-studio/` 下：
1. `corepack yarn typecheck`
2. 拆步 build：`node node_modules/.bin/tsdown && node node_modules/.bin/tsc -p tsconfig.json && node node_modules/.bin/tsc -p tsconfig.client.json --emitDeclarationOnly`
3. 六生成器 `node scripts/<gen>.mjs --check`（本轮不改生成器，预期 0 diff）
4. `corepack yarn verify:loader`
5. `corepack yarn test:smoke`（唯一测试入口）→ `门禁 ✅ 失败 0 条`
6. §8 反变异 1-8 全绿（1/3/4/7/8 已闭环，本轮补 2/2b）

## 明确不做

- 不新增独立 seed 工具（D7 已拍板并入 list_recipes 回执）；
- 不生成 §03/§05/§06；
- 不动 `validateForSeed`、`landStoryboard` 的拦截语义；
- 不提交 git、不动收尾四步（需 CV 号，等用户）。

## 需要批准的点

1. seed 的 `duration` 兜底：`requirements.totalSeconds` 缺失时按 5s/段并写 §08 约束 —— 接受？
2. `note` 进 §07 的方式：并进 `name`（截断 80 字）而非全塞 §08 —— 接受？
3. list_recipes 只在「结论可用」时附 seed（0✅ 自由编排时不附）—— 接受？
