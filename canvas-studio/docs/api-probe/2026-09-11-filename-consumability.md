# 产物文件名不可直接作为「带文件端点」的输入（定案）

- 后端：`http://117.50.108.73:8082` · 样本：两次真实会话（`session.jsonl 9` / `session.jsonl 10`）
- 分析工具：`scripts/analyze-session.mjs`（本轮修了两个漏报缺陷，见 §8）
- 性质：**对既有结论的更正** —— 修掉了 STATUS.md 里「qc_shot 失败 = 后端 down」的误判

---

## 一、结论

后端有**两类文件名**，可消费性完全不同：

| 类别 | 形态 | 来源 | 能否作带文件端点的入参 |
| --- | --- | --- | --- |
| **上传句柄** | `ref-<uuid8>.<ext>` | `POST /api/v1/generate/upload` | ✅ 能 |
| **产物名** | `img_NNNNN_.png` / `z-image_NNNNN_.png` | 生成接口返回的 `filename` | ❌ **不能** —— 约 0.1s 内 500 |

**任何带文件入参的调用，都必须先把素材重传成 `ref-*` 句柄。** 这本来就是 `generated-refs-20260910/recheck.md` 里写明的「生产同款」流程（生成 → 下载 → 上传拿句柄 → 用句柄调用），只是代码里**只对一部分入口落实了**（见 §5）。

## 二、证据链

### 证据 1｜同一分钟内的交错对照（决定性）

失败全部是 **0.09–0.18s**（入口即拒），成功全部是 **15–45s**（真跑了）。且**按文件类别严格二分**，与时间无关：

| seq | 文件 | 类别 | 耗时 | 结果 |
| ---: | --- | --- | ---: | --- |
| 378 | `ref-40bf8914.png` | 上传句柄 | 28.00s | ✅ |
| 389 | `img_01287_.png` | 产物名 | 0.16s | ❌ 500 |
| 400 | `img_01287_.png` | 产物名 | 0.12s | ❌ 500 |
| 411 | `img_01287_.png` | 产物名 | 0.10s | ❌ 500 |
| 433 | `img_01289_.png` | 产物名 | 0.16s | ❌ 500 |
| 444 | `img_01287_.png` | 产物名 | 0.10s | ❌ 500 |
| 455 | `z-image_00852_.png` | 产物名 | 0.09s | ❌ 500 |
| 466 | `ref-40bf8914.png` | 上传句柄 | 34.45s | ✅ |
| 477 | `img_01287_.png` | 产物名 | 0.14s | ❌ 500 |
| 488 | `img_01288_.png` | 产物名 | 0.09s | ❌ 500 |
| 499 | `img_01289_.png` | 产物名 | 0.09s | ❌ 500 |
| 521 | `img_01290_.png` | 产物名 | 0.16s | ❌ 500 |
| 532 | `img_01287_.png` | 产物名 | 0.10s | ❌ 500 |
| 543 | `img_01289_.png` | 产物名 | 0.10s | ❌ 500 |
| 554 | `ref-40bf8914.png` | 上传句柄 | 26.90s | ✅ |

**同一个文件 `ref-40bf8914.png` 在 466（成功）和 554（成功）各夹在失败的产物名之间** —— 后端是活的、`temp/` 里那份素材是好的。变量只有「文件类别」。

### 证据 2｜上一次会话已复现同一规律

`docs/api-probe/session-20260910/report.md`（脚本自动发现，与本轮一致）：

| 工具 | 特征 | 带该特征成功率 | 对照 |
| --- | --- | ---: | ---: |
| `image_generate` | `filename=img-*` | **11%（9）** | 83%（12） |
| `video_generate` | `filename=img-*` | **0%（2）** | 100%（9） |
| `qc_shot` | — | **0%（2）** | 无成功样本 |

### 证据 3｜仓库自带的探测记录

`generated-refs-20260910/recheck.md` 写的是「用句柄调用带文件端点（**生产同款**）」，并给出一行 `image2vl | image | 200 | 6651ms`，用的句柄是 `ref-sheet-6ed6b279.png`。**探测时用的就是上传句柄，从未用产物名试过** —— 这条缺口正是本次踩到的。

## 三、为什么此前被误判为「后端挂了」

`docs/STATUS.md` 的旧结论（时间线条目）：

> ①先依赖·维持 🟡：CV-111 character_sheet（会话 3 次全 Drama 500，含用真实新图仍失败→后端 down，自愈仅覆盖失效引用子集无法恢复）+ C4 qc_shot（同 Drama 500）；…**结论：skill 路由/编排逻辑无 bug，失败均源于 Drama**

**这个归因不成立**：若后端 down，同一分钟的 `ref-*` 调用不可能成功。当时的证据不足以区分「后端 down」与「这类文件名不可消费」，而两者现象完全一样（笼统 500、无原因）。

这与 CV-145（1×1 占位图导致「带文件端点全挂」误判）、CV-153（>3 张静默丢弃）同属一类：**证据缺失导致的错误归因**。教训是——**判断后端/接口级结论前，必须先在同一时间窗内跑一个「已知可用」的对照**。

## 四、影响面

| 能力 | 工具 | 本次会话 | 累计 | 性质 |
| --- | --- | ---: | ---: | --- |
| 画面分析 / VLM 归纳 | `image2vl` | 5/19 | — | 高频（14 次死在产物名） |
| 一致性自动质检 | `qc_shot` | **0/3** | **0/5** | **结构性失效** |
| 视频生成（带首帧） | `video_generate` | 本地拦截，未到后端 | 0/2（09-10） | 有自愈，但未见效 |
| 多图合成 | `video_composite` | 本地拦截，未到后端 | — | 同上 |

**`qc_shot` 是结构性失效**：它的输入**永远是刚生成的镜头图**（产物名），所以在当前实现下**不可能成功**。这一条最要紧 —— 它意味着：

1. `quality-check.ts` 的 C4 质检闭环实际上从未运行过；
2. Look 资产化的 **Phase 4（风格质检基准）在此修复前不可能有效**（本轮 Agent 已经把 5 项 tokens 原文当 `expect` 传进来了，服务不了）。

另外注意一个**误导性**：`image_generate` 带产物名有时能过（11%），是因为生成类工具有自愈（见 §5）。于是同一个产物名，**在生成工具上"偶尔能用"、在分析工具上"必然不能用"** —— 这种不一致比全面失效更难诊断。

## 五、根因（代码层）

### 5.1 同一个解析函数，两种可消费性

`src/host-tools.ts:346 resolveRefFilenames()` 返回 `node.filename`。而：

| 节点类型 | `node.filename` 是什么 | 可消费性 |
| --- | --- | --- |
| 对话附件 / 上传素材 | `ref-<uuid8>.<ext>`（上传时自造的唯一名） | ✅ |
| 生成产物（`image_generate` 等） | `img_NNNNN_.png`（后端返回的产物名） | ❌ |

且 `resolveRefFilenames` 里**只有** `node.filename` 为空时才现场上传（`:361-371`）。生成类节点的 filename 非空 → **原样透传产物名** → 必挂。

### 5.2 自愈只覆盖了一半入口

| 入口 | 自愈（反查节点 → 重传 → 换句柄 → 重试） |
| --- | --- |
| `runGeneration`（`image_generate` / `video_generate` / `video_composite` / `character_generate`） | ✅ `callWithFallback`（`src/generate.ts:1079`，4 处调用） |
| `generateCharacterSheet`（三视图资产卡） | ✅ `src/generate.ts:1478` |
| **`analyzeImage`（`image2vl` + `qc_shot` 共用）** | ❌ **无** —— 直连 `callDramaRaw` |

`isBadReferenceError()`（`src/generate.ts:688`）**已经认识** `Internal Server Error`，所以缺的不是判据，而是**没把 `analyzeImage` 接进来**。

## 六、修复方案（分层，按优先级）

| 层 | 动作 | 落点 | 说明 |
| --- | --- | --- | --- |
| **P0** | `analyzeImage` 补同款自愈 | `src/generate.ts:913` + 抽出与 `refreshByCanvasNodes` 共用的 helper | 一处修复同时救回 `image2vl` 与 `qc_shot`；代码已有，属接线 |
| **P1** | 产物名一律先重传，不靠「失败后重试」 | `resolveRefFilenames` / `analyzeImage` 入参处 | 与 `backfillUploadFilename` 同一不变式：**节点 filename 必须是后端当前可用的句柄**。避免先白烧一次 0.1s 失败 + 一次重传 |
| **P2** | 措辞纠偏 | `image_generate` 结果里的「Drama 文件名」、`image2vl` 的 `filename` 参数描述 | 产物名被标成「Drama 文件名」，看起来像可用句柄 —— Agent 这次就是这么被带进去的 |
| **P2** | 把「两类文件名」写进 skill | `references/toolchain.md` | 让模型知道：分析/质检**产物**时，工具侧会自动重传，不要因为「名字我有了」就直接用 |

**回归验证建议**（修复后必做）：真实跑一次「生成一张图 → `qc_shot` 它」，应看到先 500 后自动重传再成功（或直接成功、全程无 500）；再跑「对同一张图连续两次 `image2vl`」。

## 七、第二类失败：`video_composite` 的 IR 模式判定冲突（3 次）

这 3 次是**本地预检拦截**（0.01–0.02s），**后端没收到请求** —— 属于 CV-119 正常工作，反倒省下了 3 次视频生成（单次 30–400s）。

| seq | 工具 | 参数 | 工具判定的模式 | Agent 写的格式 | 结果 |
| ---: | --- | --- | --- | --- | --- |
| 639 / 650 | `video_composite` | `filenames=[img_01290_, ref-40bf8914_]`（2 图） | **FL2VA**（首尾帧） | **Ref2VA 六段式**（`subject_definitions:` + `<Subject 1>`） | 10 ERROR |
| 661 | `video_generate` | `filename=img_01290_`（1 图） | **I2VA** | 三段式但**漏了对齐行** | 1 ERROR |
| 683 | `video_generate` | 同上（已读 `format-base.md` 后） | I2VA | 对齐行 + 三段式 | 已发出（会话在此结束） |

**根因是「两套模式判定规则」**：

- **skill（正确，H3 官方口径）**：模式由**素材角色**决定 —— `h3-prompt-writing/SKILL.md:26-30` 写得很清楚（首帧=I2VA / 尾帧=L2VA / 首尾帧=FL2VA / 通用参考=Ref2VA），还有专门警告「一张图当首帧是 I2VA，不是 Ref2VA」。
- **我们的预检**：模式由**图片数量**决定 —— `src/host-tools.ts:1058-1062`（1 图=I2VA / 2 图=FL2VA / ≥3 图=Ref2VA）。

于是 Agent 的语义（「参考图定风格 + 首帧定构图」→ Ref2VA）与工具的解释（「2 图 = 首尾帧」→ FL2VA）**正面对撞**。而 skill 自己的硬约束写着「FL2VA/I2VA/L2VA 与 **Ref2VA 互斥**（锁首帧与参考风格**只能两步走**）」—— **正解就是分两步调用**，Agent 想一步到位。按 FL2VA 解，`filenames` 的顺序还会把**风格参考图当成「尾帧」**，语义上是荒谬的，而预检只看 IR 文本、看不到这层错位。

**修复方向**：
1. 预检报错文案要点出真因 —— 现在说「IR 格式 10 处 ERROR」，真因是「把 Ref2VA 的参考与 FL2VA 的首尾帧塞进了同一次调用，需分两步」；
2. 工具描述里写死「N 图 → 哪个模式 + 第 N 张是什么位次」；
3. 更彻底的做法是让模式**显式化**（参数声明），不再从数量反推。

## 八、附：分析脚本自身的两个漏报缺陷（本轮已修）

`scripts/analyze-session.mjs` 的「参数嫌疑分析」本该第一时间报出 §2 的规律，本轮**没有报出来**。两个叠加缺陷：

1. **值形态分析被「键存在性判据」连带跳过** —— 原代码把值形态族分析写在 `if (withK.length < 2 || withoutK.length < 2) continue` 之后，而 `image2vl` / `qc_shot` **每次都带 `filename`**（`withoutK.length === 0`），于是最该被发现的规律**整段没跑**。→ 把值形态族分析移出该判据，使其在「恒带该键」的工具上也能运行。
2. **对照取工具整体成功率** —— 判据 `rate < baseRate - 0.3`。当嫌疑族本身就是多数派时（`img-*` 13/19），它把 `baseRate` 一起拉到 26%，`0 < 0.26-0.3` 恒为假 → 永不触发。→ 对照改为**同键的其它形态族**；该键只有单一形态族时退回**不带该键**的样本。

**修复后**（两个会话同时验证）：

| 会话 | 自动报出的嫌疑行 |
| --- | --- |
| 09-11（本次） | `image2vl \| filename=img-* \| 0%（13） \| 83%（6）` |
| 09-10（回归） | 7 行，**⊇** 修复前的 6 行（原有检测一个没丢，另多出 `video_generate \| prompt=text`） |

> 教训与 §3 同源：**分析工具本身也会「证据缺失」**。判据里凡是拿「整体均值」当对照的地方，都要先问一句「如果嫌疑样本占多数，这个对照还成立吗」。

---

## 9. 修复落地（CV-155，2026-09-11 当日完成）

三层修法全部落地：

| 层 | 改动 | 位置 |
| --- | --- | --- |
| ① P0 共用自愈 | 抽出**唯一**实现 `healReferenceFilename(registry, projectId, filename, signal)`：反查画布节点 → `promoteAssetFile` 重传 → 回写节点 `filename` → 返回新名；反查不中 / 资产缺失 / 上传失败一律返回 `null`，由调用方抛**原始错误**（不掩盖真因）。`generateCharacterSheet` 的内联自愈改为调用它；`analyzeImage` 新增可选 `heal` 上下文接入 —— `image2vl` 与 `qc_shot` **共用这一处** | `src/generate.ts` |
| ② P1 主动换名 | `resolveRefFilenames` 新增 `isDramaProductName` 判据，命中即重传换句柄并回写节点，**不等失败**（判据有意取窄：漏判由 ① 兜底、误判只多一次上传） | `src/host-tools.ts` |
| ③ P2 措辞 | `renderResult` 标签 / `resultSchema` / image2vl·qc_shot·video_generate·video_composite 参数描述 / `SKILL.md` 核心规则（删掉那条教 Agent 拿产物名当入参的错规则）/ `references/toolchain.md` 新增专章 | 见 STATUS 时间线 |

**判据形态**：`/_\d{4,}_?\.[A-Za-z0-9]+$/u`。实测命中 `img_01287_.png`、`z-image_00852_.png`、`output_00012.mp4`；不误伤 `ref-40bf8914.png`、`bb465e619602.png`、`a4ed-37ac8d71907c.png`。

**回归**：`tests/filename-consumability.test.mjs` 5 例 —— 判据正/反例 / `@ref` 主动换名并回写节点 / 500 后自愈且**恰好重试一次** / **反查不中必须抛原始错误**（防「自愈吞掉真因」）/ `healReferenceFilename` 兼认 `filename` 与本地资产名。验证链 **421/421**。

**未覆盖的残留（有意不动）**：`runGeneration` 的 `callWithFallback` 仍保留自己那套自愈（要处理多个 filename + `sourceUrls` 兜底），未与 ① 合并 —— 合并需把它改成「逐个文件名单点自愈」，属独立重构。**新增任何带图入口时务必接上自愈**，否则又会回到「一处有、一处没有」的老问题。
