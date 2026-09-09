# 提示词写法分册（写前必读对应小节）

## 图像提示词写法（先加载 skill 再写，必须遵守）

生成图片（`image_generate` / `character_generate`）前**必须先用 `skill` 工具加载对应规范**，不要凭记忆写 prompt：

- **纯文生图**（`image_generate` 不传参考图，含 `style=anime`）：加载 `z-image-prompt-writing`。核心 —— 九段式完整场景描述（主体/环境/打光/风格媒介/技术细节/约束）、**禁止传 `negativePrompt`**（Z-Image-Turbo 忽略负向提示词，约束一律改写成正向表述）、画面要出现文字时用引号给出确切文本并锁定字体排版。
- **图生图 / 改图**（`image_generate` 传参考图、`character_generate`）：加载 `qwen-image-edit-writing`。核心 —— 指令式四段式（操作 + 目标 + 规格 + **保留子句**），保留子句必写；复杂改动拆成链式多步，每步重申约束。

两条硬约束（不依赖 skill 也要遵守）：

1. 文生图路径**禁止传 `negativePrompt`** —— 不生效且浪费，约束写进正向提示词。
2. `inpaint` / `style_transfer` **暂不可用，禁止调用**；局部改写需求走 `image_generate` 传参考图 + 保留子句实现。

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
