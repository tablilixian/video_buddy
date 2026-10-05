# 提示词写法分册（写前必读对应小节）

## 图像提示词写法（先加载 skill 再写，必须遵守）

生成图片（`image_generate` / `character_generate`）前**必须先用 `skill` 工具加载对应规范**，不要凭记忆写 prompt：

- **纯文生图**（`image_generate` 不传参考图；动漫画风同样走这里，风格写进 prompt）：加载 `krea2-turbo-writing`。核心 —— 九段式完整场景描述（主体/环境/打光/风格媒介/技术细节/约束）、**禁止传 `negativePrompt`**（Krea2 Turbo cfg=1.0 负向条件结构性失效，实测带负向「排除太阳」仍照画，约束一律改写成正向表述）、画面要出现文字时用引号给出确切文本并锁定字体排版。
- **图生图 / 改图**（`image_generate` 传参考图、`character_generate`）：加载 `krea2-edit-writing`。核心 —— 指令式四段式（操作 + 目标 + 规格 + **保留子句**），保留子句必写；复杂改动拆成链式多步，每步重申约束。
- **图内文字修复**（`image_fix`，CV-202）：出图后画面文字出错（错字/乱码）时走本工具，**不要换提示词整图重出**（重出会丢掉已正确的画面）。修复 prompt **只写文字部分**——要修的文字 + 字体/排版/位置锁定，从原出图 prompt 里提取文字那部分描述即可，**不要带场景/角色/画风描述**（改图接口，多余描述会伤及画面）；产物 `boogu_*` 前缀。

### 含文字图片：Qwen 一步直出为首选，image_fix 只做兜底（CV-212/270 + R-P1-03，必须遵守）

**首选路径（一步直出）**：纯文生图且 prompt 含**要显示到画面上的文字**（引号框住、未被否定）时，Host 逐次调用**现算路由**（R-P1-03，`src/model-route.ts`）自动走 **Qwen 文字渲染链路**（`txt2image_withtxt`，CV-270）——中文逐字正确（探针实测《剑归江湖》四字无错字，约 20s 比 Krea2 慢，无字图不要走）。调 `image_generate` 或 `image_generate_withtxt` **等价**：端点由 Host 按提示词现算，你不必为选端点纠结。命中本路径时产物已是逐字正确，**不会也不会触发 image_fix 兜底**——返回里没有 CV-212 修复 warning 是正常现象，**不要看到没挂修复就再手动补一次 image_fix**。

**自动兜底（仅两条仍落在 Krea2 的链路）**：「出图后自动挂一次 `image_fix`」的旧策略（CV-212/218）只在以下链路继续生效，其余一律不触发：

1. **图生图带字**：`image_generate` 传参考图（产物落 Krea2 Edit）。withtxt 是纯文生端点、没有参考图槽位，**这条路径没有一步直出的替代，先出图再自动修复是设计内行为**——不要在这里反复尝试「直接出」，也不要把两版产物当故障报给用户。
2. 引号文本命中检测、但路由未走 Qwen 的边界情形（如后续「默认生图模型」设置项显式指配后的组合）。

兜底是否跑了看回包：`warnings` 含 `CV-212/218：…已自动调 image_fix 兜底` = 走了兜底；没有该 warning = 走了 Qwen 直出。**不调用 image2vl 校对，不做修复后再验**。

**为什么 image_fix 只做兜底（历史沿革，勿回退）**：CV-270（2026-09-30）之前文字图只有 Krea2 一条路、非 ASCII 文字几乎必错，当时的最优解就是出图后自动挂修复；Qwen 文字渲染上线并由 R-P1-03 收进统一路由后，直出成为首选，自动修复降级为上面两条链路的兜底。更早的 CV-211（出图后用 `image2vl` 逐字复述再修）因 VLM 对非英文脚本的字形复述不可靠（实测中日韩/阿拉伯文常丢字、编字，还会把错的「目标字」塞进修复 prompt 改坏原图）已退役，仅存手动模式（见 §与旧 CV-211 的兼容）。

#### 检测算法（agent 与 host 工具共用）

实现位置：`src/text-detection.ts`（单测在 `tests/text-detection.test.mjs`）：

| 函数 | 作用 |
|---|---|
| `extractQuotedText(prompt)` | 抽出所有引号包裹的字符串（支持英文双引号 / 中文双引号 `""` / 日文方括号 `「」` / 书名号 `《》` 等） |
| `hasNonAscii(text)` | 检查一段字符串是否含 `U+0080` 以上字符（CJK / 阿拉伯 / 西里尔 / 天城 / 泰 / 韩 / 全角标点 / 表情 等） |
| `shouldAutoFixText(prompt)` | 命中条件：存在**未被否定**的引号文本（`不要"水墨"风格` 这类不算）**且**任一段含非 ASCII |
| `extractTextSpec(prompt)` | 从原 prompt 抽「文字规格句（含引号文本的句子）+ 逐字约束句 + 占位元素句」 |
| `buildTextFixPrompt(originalPrompt)` | 构造 image_fix 的修复 prompt = 原 prompt 的**文字规格段 + 逐字约束段**（CV-218 原 prompt 直通） |

#### 兜底链式执行（工具侧自动，仅上述两条兜底链路）

1. **前置 / 出图**：照常 `image_generate`（含引号锁字），拿到产物 URL + nodeId。
2. **后置触发**（工具自动，agent 无感；R-P1-03 起先重算路由，命中 Qwen 直出即整体跳过）：检测通过 → 立即 `upload_image` 拿句柄 → 调 `image_fix`，prompt 由 `buildTextFixPrompt(**本次的原出图 prompt**)` 抽出、`filename` 传上传句柄、`replaces` 填原图 nodeId（让修复版原子替换原图，不留旧版）。
3. **失败兜底**：image_fix 失败或返回超时不重试——返回原图 + warning；agent 仍可手动调 `image_fix` 进一步修复，或重出整图（`autoFixText: false` 关闭后可用）。

> **一次 image_generate 至多触发一次 image_fix**——不做修复后 VLM 复读、不做修复循环。规则简单才不会被 VLM 的噪音带偏。

#### 关闭方式

```js
image_generate({ prompt: '...', autoFixText: false })  // 显式关闭（如大批量无文字图省成本）
```

#### image_fix prompt 形态（Boogu Edit 接口特化，CV-218）

由 `buildTextFixPrompt(原出图 prompt)` 构造 —— **不另发明一套措辞，而是从原 prompt 里抽「文字规格段 + 逐字约束段」**。agent 看不到，但要知道大致形态（真实案例）：

```
前景是一处武侠书专摊：原木长桌上码放一摞摞旧版武侠小说，书脊朝外整齐堆叠，桌边垂挂手写木牌价签，摊后竹架上挂一面写着毛笔字 "武侠" 二字的红色竖幡；
画面中每一个汉字都必须逐字准确还原，字形结构完整、笔画无缺失无变形，不得替换、增删、乱码或自造汉字。
```

规则：**逐句保留**含引号文本的句子（文字在哪、什么字体、多大、什么颜色、怎么排，全在里面）+ **逐字约束**句 + **占位元素**句（如「二维码占位」方框，丢了会被重绘掉）；画幅/材质/光线/配色/气质等美术描述句自然被滤掉。

⚠️ **不要退回「字符清单」形态**（`- "武侠" —— 保持原字体、字号、颜色、位置不变`）：那只给字符、丢掉**位置锚点**，模型只能按形近字猜 —— 实测把 `武仔` 修成 `武传`（**仍错**）并凭空多出两处文字、曝光漂移。规格段形态实测 8 处错字全对、排版零漂移。取证：`docs/api-probe/image2fix-20260920-text-spec/`。

**反面**（会伤画面）：
```
把一张夏季促销海报改进一下，标题更清晰、整体更鲜艳 —— ❌
"修正'促销'为'大促'" —— ❌（"促销"没坏，是无中生有）
```

#### 文件名消费注意（CV-155 同型）

`image_fix` 产物名 `boogu_*` 属"后端产物名"——**不能直接当输入**。要把修复版喂给下游：
- 引用走 `@ref[节点标题]`（Host 会把节点上的产物名自动换成可用句柄）；
- 或显式 `upload_image(imageUrl=修复版 url)` 拿上传句柄。

落在 keyshot 上时记得传 `shotRefs=[该镜分镜卡]`，把修复版挂到对应分镜卡，避免血缘指向旧版本。

#### 与旧 CV-211 的兼容

旧 CV-211 链仍可作为**手动**模式使用：用户或 agent 显式调用 `image2vl`（如确需逐字校验 Latin 字符的美式/英式写法细节），但**默认路径已切到 CV-212**。工具 `image_fix` 的输入纪律不变（prompt 只写文字部分），只是触发逻辑不再依赖 VLM。

硬约束（不依赖 skill 也要遵守）：

1. 文生图路径**禁止传 `negativePrompt`** —— 不生效且浪费（Krea2 Turbo 实测负向词零效果），约束写进正向提示词。

skill 加载失败时：文生图按九段式骨架自行写（务必禁用 negativePrompt），图生图按四段式写，并在回复开头说明「未按完整规范执行（skill 加载失败）」，不要卡流程。

## 视频提示词写法（MiniMax H3 规范：先加载 skill 再写，必须遵守）

生成视频（video_generate / video_composite）前**必须先用 `skill` 工具加载 `h3-prompt-writing`**，并按模式读该 skill 资源目录下的对应 references 文件——不要凭记忆或一句话摘要写 prompt：

- **Ref2VA 多参考（video_composite ≥3 张）**：读 h3-prompt-writing 的 `ref-en.txt`，按六段式写。
- **FL2VA（video_generate 单图 / video_composite 两图首尾帧）**：读 h3-prompt-writing 的 `base-en.txt`。

对白标签、说话人 ID、运镜词汇、镜头切分等基础语法两种模式共用，以上游 references 为准。

**Ref2VA 六段式最小骨架**（保证下限；完整规则与示例读 h3-prompt-writing 的 `ref-en.txt`）——六段按序、正文英文（对白与画面内文字保留原语言）：

1. `subject_definitions:` 每个要锁定的内容一行定义：`<Subject 1> is the <角色> in <Picture 1>, with <外貌/服装特征>.`、`<Subject 2> is the <场景环境> in <Picture 2>, featuring <地标/光位>.`——`<Subject N>` 定义角色/场景等可复用内容；仅作来源的图不设独立 `<Picture N>` 条目，直接在 Subject 定义里引用。
2. `summary:` 以 `[reference generation]` 开头的一句话任务总结，引用已定义的标签。
3. `retention_analysis:` 每个标签一行：`<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - <保留哪些特征>.`（标记四选一：fully_preserved / partially_preserved / attribute_transfer / weak_reference）。
4. `detailed_description:` 主体（英文 350–500 词）：先 1–2 句风格定调，再 `[Shot 1]`、`[Shot 2] At 00:03.000, ...` 沿时间轴写构图/动作/运镜/台词；`<Subject N>` 在首次出现处引用、后续沿用不重定义；对白 `<d>[语言]原话</d>` 逐字保留，说话人用稳定 ID (S1) / (S2)。
5. `overall_soundscape:` 1–4 句环境音与动作音总结。
6. `non_diegetic_music:` 1–3 句 BGM（乐器/速度/强弱变化，不写情绪词；无则 N/A）。

**FL2VA 降级骨架（h3-prompt-writing 加载失败时用，勿卡流程）**：首行对齐指令——video_generate 单首帧固定 `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`；video_composite 两图首尾帧固定 `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.`（S.SS = 时长两位小数）。随后空行 + 三字段：`integrated_multimodal_description:`（沿时间轴的画面/动作/运镜/台词）、`overall_soundscape:`（环境音 1–4 句）、`non_diegetic_music:`（BGM 1–3 句，无则 N/A）；总长控制在 200 词内，对白用 `<d>[语言]原话</d>` 逐字保留不翻译。降级骨架只覆盖 FL2VA；要走 Ref2VA 而加载失败时，按上方六段式骨架写，并在回复开头说明「未按完整规范执行（skill 加载失败）」。
