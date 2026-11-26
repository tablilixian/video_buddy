# Tasks：§9 第 5 步 配方 seed

前置：[spec.md](spec.md) 已批准。按序执行，每步完成即勾。

- [x] **T1 新建 `src/remotion/recipe-to-storyboard.ts`**
  实现 `recipeToStoryboardSeed`：§3.4 映射表（segments→§04 `S<n>`/`S<n>-Sh1`、assets→§07 pending+bare+neededBy 指向本批 shot、theme→§02、note/audience/structure→§00 brief+§08）+ §3.4.1 specSeed（weight 二选一、units/carry 留空、autoStages 不开）+ normalizeStoryboard 过归一 + 6 项结构自检（**不含 validateForSeed**）。

- [x] **T2 修 `src/host-tools.ts:4454-4455`**
  write_storyboard description 的 assets/constraints wrapper 示例 → bare 数组，附静默清空理由注释；控制净增 ≤10 行（棘轮余量 <158）。

- [x] **T3 接线 `src/host-tools-template.ts` list_recipes 回执（D7）**
  结论「可用」时附 seed sections JSON + specSeed JSON，标注「哪些节是配方填的（00/02/04/07/08）、其余保留原值」「copy 是提示语必须改写」；生成失败降级不阻断。若文件在 file-size-guard 白名单则补登行数。

- [x] **T4 新建 `tests/recipe-seed.test.mjs`**
  反变异 2（story-arc seed → saveStoryboard → landStoryboard 必 throw，message 含未就绪/不能落地；enforce 下 blockers 非空；ghost neededBy 只进 warnings）+ 反变异 2b（三套有素材配方 seed 直接调用不抛 + 源码文本断言生成路径无 `validateForSeed`）+ 结构断言（ID 形态、neededBy ⊆ shots、bare 数组、specSeed 不双写、explainer-cards §07=[]）+ description 漂移断言（wrapper 不回潮）。

- [x] **T5 全量门禁**
  `corepack yarn typecheck` → 拆步 build（tsdown + tsc ×2）→ 六生成器 `--check` → `corepack yarn verify:loader` → `corepack yarn test:smoke` 全绿（`门禁 ✅ 失败 0 条`）。

- [ ] **T6 汇报**
  向用户汇报「做了什么 + 怎么验收」；在第 7 步真机复验 / 收尾 CV 号处停下等拍板。
