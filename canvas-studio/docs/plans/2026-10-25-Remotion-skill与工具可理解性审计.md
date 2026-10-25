# Remotion skill 与工具说明：可理解性审计（2026-10-25）

> 问题：**知识型 skill 应该教模型怎么用工具，而不是让模型自己摸索。** 那么 Remotion 这条链路上，
> skill 和工具描述是否已经"正确且可被模型理解"？
> 方法：① 盘点 6 个相关工具的描述体量；② 统计 skill/分册对每个工具与关键主题的覆盖；
> ③ 把"模型实际去读了什么"当成缺口证据（2026-10-24 会话的 read/bash 记录）。
> 证据等级按 `docs/postmortem-method.md`：A 复现 / B 日志或计数 / C 源码 / D 推断。

---

## 一、结论

**结构是齐的，但有 4 个缺口，其中 2 个会直接导致"自己摸索"，2 个是维护性隐患。**

| 维度 | 现状 | 评价 |
|---|---|---|
| 有没有 skill | 有：`code-driven-explainer` 主文件 11.5KB + 6 个分册约 60KB | ✅ |
| 有没有工具描述 | 有：6 个相关工具，合计 **12,789 字符** | ✅ 但过重 |
| 描述是否准确 | 大体准确；`inspect_image` 的"唯一真值来源"已在本轮修掉 | ✅（CV-364） |
| 是否教了"何时用哪个" | 主线（取真值 → 组装 → 渲染）有；**新工具 `scaffold_manifest` 一次都没被提到** | ❌ G1 |
| 硬约束是否可执行 | `id` 必填、时长自洽都在，但 `id` 只写了"唯一 id"，没写"必填" | ⚠️ G2 |
| 是否只有一套事实 | **两套**：工具描述 6,628 字符 + 契约分册 33KB，各写了一遍 manifest 规则 | ⚠️ G3 |
| 遇错能否自查 | SKILL 只有 3 条；错误码没有对照表 | ⚠️ G4 |

---

## 二、覆盖矩阵（工具 × 三处说明）

| 工具 | 工具描述 | SKILL 工作流 | 分册细则 | 问题 |
|---|---|---|---|---|
| `render_composition` | **6,628 字符** | 第 4 步 | `manifest-contract.md` 33KB | **重复**：描述里内联了 easing 13 档 / orbit / startAfter / shape 全表 |
| `scaffold_manifest` | 404 字符 | **0 次提及** | **0 次提及** | **G1：形同虚设** |
| `inspect_image` | 606 字符 | 0 | 只在 `canvas-studio-creation/toolchain.md` | 弱：explainer 侧不指路 |
| `list_shots` | 241 字符 | 第 1 步（取真值） | `source-duration.md` | ✅ |
| `list_references` | 1,000 字符 | 第 1 步 | —— | ✅ |
| `compose_video` | 783 字符 | 0 | —— | 可接受（另一条路线） |

**关键数字**：26 个工具的描述合计 **41,642 字符**，其中 `render_composition` 一个占 16%。
首轮 29k tokens 输入里，工具 schema 是主要构成之一（B 级：字符统计 + 首轮 usage）。

---

## 三、四个缺口（含证据与修法）

### G1 · `scaffold_manifest` 没被 skill 串联（B 级）

- 证据：`grep -c scaffold_manifest` 在 `code-driven-explainer/SKILL.md` 与 6 个分册里 **全为 0**。
- 后果：D11 决定"做成 host 工具让 agent 直接调"，但**没有任何一处告诉模型它存在**。
  工具表里躺着，模型不会主动用 —— 它只会继续手写整份 manifest。
- 已修：SKILL 工作流第 2 步改为"**先 `scaffold_manifest` 拿骨架**，再往 tracks 加轨"；
  契约硬约束第 0 条也指向它。

### G1b · 解释器 skill 不指向"工具总表"（B 级）

- 证据：`code-driven-explainer/SKILL.md` 只引用 6 个分册（explainer-patterns / fonts /
  manifest-contract / motion-patterns / source-duration / subtitle-timing），**没有一处**提到
  `canvas-studio-creation/references/toolchain.md` —— 而那张表才是"每个工具干什么、参数是什么"的
  唯一清单（`grep toolchain` 在该 SKILL 里 0 次）。
- 后果：模型拿到的是"流程"，不是"工具地图"。它得自己从 26 个工具的描述里推断该用哪个，
  这一步失败就会去读源码（16 分钟窗口里的 6 次 read 就是它）。
- 建议（低成本）：在"前置"或"工作流"开头加一行「工具清单与参数见
  `../canvas-studio-creation/references/toolchain.md`」，约 60 字节。

### G2 · 顶层 `id` 只写"唯一 id"，没写"必填"（C 级，源码）

- 证据：`validateManifest` 对缺 `id` 直接报 `manifest.id 必须是非空字符串`；而契约「顶层结构」
  的示例注释只写"唯一 id（便于血缘与重试）"，读起来像可选。硬约束列表里也没有这一条。
- **更正**：我一度以为这个错在 2026-10-24 会话里真实发生过，但 `grep` 该会话 **0 次命中**
  （那 31 次 `CS-RENDER-TIMEOUT` 是 skill 正文被加载时带进去的字样，不是真错误）。
  所以这条只有源码级证据，**不是会话实证** —— 按方法论降级为 C。
- 已修：硬约束新增第 0 条，写明"必填 + 报错原文 + 指向 scaffold"。

### G3 · 两套 manifest 说明并存（B 级）

- 证据：`render_composition.description` 6,628 字符里，easing 13 档、`orbit`、`startAfter`、
  `shape` 全表、`meta.look`、体检说明 —— 与 `manifest-contract.md` 的对应小节**各写一遍**。
- 后果有两层：
  1. **漂移风险**：改一处忘另一处，就会造出"描述说 A、实现是 B"（本轮的 `inspect_image` 就是这种）。
  2. **每轮付费**：工具描述每次都进上下文；契约分册只在 skill 加载时进一次。
- 建议（需拍板，动产品面）：描述瘦身到"何时用 + 边界 + 3 条硬警告"，细则一律指向契约分册。
  预计 6,628 → ~2,000 字符，**每轮省约 1.8k 字符**（不是 token 级巨变，但方向正确且减漂移）。

### G4 · 错误码没有对照表（B 级）

- 证据：SKILL 的「遇错处理」只有 `CS-RENDER-TIMEOUT` / `CS-RENDER-002` / `CS-USER-ERR` 三条；
  分册里 `CS-40x` 出现 0 次。路由层的 4xx（审批、项目不存在、参数非法）没有面向模型的说明。
- 后果：模型遇错只能猜或去读 `src/errors/catalog.ts`（又回到"读源码"）。
- 建议：新增 `references/errors.md`（约 1KB）：错误码 → 含义 → **该改什么**（改画面 / 补素材 / 查现场 / 别重试）。

---

## 四、为什么"让模型摸索"在本仓代价特别高

| 事实 | 数据 | 来源 |
|---|---|---|
| 一次会话到"第一次提问" | 16.05 分钟，其中模型推理 98%、工具 18 秒 | A（转录逐事件） |
| 期间读源码/查文档 | 6 次 `read`（含 `TextCard.tsx`）+ 8 次考古类 bash | A |
| 每次"读源码"的代价 | 该步 reasoning 常达 2.7–4.0 万字符 | A |
| 每步固定首 token 开销 | ≈6 秒，与输入大小无关 | B（残差法，4 个样本） |

结论：**skill 少写一句，模型多花几分钟**。G1 这种"工具没被提到"的缺口，成本是整份手写 manifest
+ 若干轮校验失败重试；G3 这种"两套说明"，成本是长期的漂移与被误导。

---

## 五、自检清单（以后改工具/改 skill 都过一遍）

1. **新工具上线**：skill 里有没有一句话告诉模型"什么时候该用它"？（G1 的教训）
2. **新硬约束**：是不是同时进了"契约分册"与"工具描述"？如果只进一处，另一处必须显式指向它。
3. **改实现**：`tests/manifest-contract-doc.test.mjs` 会把 10 条文档断言回对源码 —— 它红了就是该改文档了。
4. **新错误码**：SKILL 的遇错处理有没有对应一行？
5. **描述变长**：超过 ~2k 字符就该问"这段细则是不是该搬到分册"。

---

## 六、本轮改动（已落）

- `SKILL.md` 工作流第 2 步：先 `scaffold_manifest` 拿骨架 → 再改（11.2KB → 11.5KB）。
- `manifest-contract.md` 硬约束新增第 0 条：顶层 `id` 必填 + 报错原文 + 指向 `scaffold_manifest`。

> G3（描述瘦身）与 G4（错误码表）**未动**：前者动产品面、需要你拍板；后者建议随下次工具改动一起加。
