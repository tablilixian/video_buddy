# 画布工具链完整手册（按需查阅）

> 全部工具的参数表、占位工具降级、视频供应商差异与参数现状。核心硬规则（filename 约定、aspectRatio、无视觉能力等）在 SKILL.md 核心规则节，此处不重复。

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| write_screenplay | 剧本落画布（标题「剧本」，重复调用原地更新；= 上游风格 skill 的故事大纲/story-outline/叙事主轴，禁止另建大纲节点） | screenplay（完整剧本 markdown）、summary? |
| submit_screenplay_for_approval | 剧本提交审批（逐步确认模式下分镜规划前必经） | summary? |
| prompt_enhance | 增强提示词 | prompt |
| ask_user_choice | 点选式提问（澄清阶段必用） | question、options[]（推荐项加「（推荐）」）、allowFreeText?（缺省开启自由输入框，false 隐藏）、multiSelect?（true 为多选，答案以「、」拼接） |
| submit_storyboard_for_approval | 分镜表提交审批（逐步确认模式必经） | storyboard（分镜表 markdown）、summary? |
| submit_keyframes_for_approval | 关键帧提交确认（逐步确认模式逐镜出图后必经） | summary? |
| storyboard_generate | 文本 → 格子分镜图 | prompt（每行一个场景）、gridnum、filename? |
| storyboard_split | 格子分镜图 → 单镜（每个镜头一张独立图） | filename（storyboard_generate 返回的 Drama 文件名）、gridnum（4/6/9）、sourceUrls? |
| image_generate | 文生图 / 图生图（单或多参考）；style=realistic 写实（默认）/ anime 卡通（仅纯文生图，传参考图则回退写实图生图） | prompt、aspectRatio、style?（realistic/anime）、filename?（单参考图）、filenames?（最多 3 张多参考图）、negativePrompt?、shotRefs?（关联分镜卡） |
| character_generate | 角色设计图 → 角色立绘 / 三视图（**只要一张立绘图、不建资产卡**；一致性锚点走 character_sheet） | filename（角色设计图，来自 upload_image）、aspectRatio?、shotRefs?（关联分镜卡） |
| character_sheet | 定妆照 / 角色设计图 → **一致性资产卡**：四视图立绘 + 切分分图（进参考托盘）+ 冻结 SAME 块；**同名卡整体覆盖**（纠正冻结描述的路径） | filename（定妆照/设计图，来自 upload_image 或 `@ref[...]`）、name（稳定角色名，如「女主」）、lockedPrompt（与用户确认后的 SAME 块）、negativePrompt?、sourceUrls? |
| inpaint | 【暂不可用】图像修复 / 编辑（Inpainting）：功能保留未开放，调用会报错，请勿调用 | — |
| style_transfer | 【暂不可用】风格迁移：功能保留未开放，调用会报错；风格统一改用 image_generate 传参考图 | — |
| image2vl | 画面分析（VLM） | filename、prompt |
| video_generate | 图生视频（FL2VA：文生 / 首帧图生视频） | prompt、filename?（首帧图）、duration（默认 5s）、audioRefs?（参考音频，≤3 段 / 合计 ≤15s）、generateAudio?（原生音轨开关）、shotRefs?（关联分镜卡） |
| video_composite | 多图合成视频（FL2VA 首尾帧 / REF2VA 多参考） | prompt、filenames[]（2 张 = 首尾帧 FL2VA，按时间顺序；≥3 张 = 多参考 Ref2VA，按用途组合：定妆照/场景概念图/姿态关键帧，最多 6 张）、duration（默认 10s）、shotRefs?（关联分镜卡） |
| qc_shot | **逐镜一致性质检**：视觉模型对照资产卡 lockedPrompt 核对画面（外貌/服装/道具/配色光感）→ PASS / FAIL / WARN + 漂移项，结论写回该节点 | filename（被检镜头图）、expect?（缺省取资产卡 lockedPrompt）、shotRefs?（**必传**，重跑预算按镜累计）、budget?（默认 2） |
| upload_image | 上传本地/产物图片到 Drama Backend 拿 filename（任何图片作为下游输入的必经前置） | imageUrl（产物 URL 或本地路径） |
| write_script | 产出结构化文案（对白/字幕/BGM/SFX 说明）落到「文案」节点 | script（markdown） |
| list_shots | **镜头清单**：列画布上所有视频片段（节点 id / 分镜卡 / 版本号 / 状态 / 时长）。**返工或精确合成前必调** | includeRetired?（默认只列有效片段） |
| compose_video | 拼接时间轴已有视频片段成成片（可混 BGM / 挂文案）。**缺省只取有效片段**（失效版本自动排除） | clipIds?、bgmNodeId?、scriptId?、colorGrade?（默认开，统一调色；false 关闭） |
| list_references | 列出当前项目参考图（角色/风格）与**一致性资产卡**供 `@ref[显示名]` 引用；返回 `references` / `assets` / `notes` 三段 | — |

**BGM 生成 `music_generation`（可用，Drama txt2audio / ACE Step）**：prompt 传音频整体描述 tags（情绪/风格/乐器/节奏，英文效果更稳）；纯器乐 BGM 传 `language="unknown"` 且 lyrics 留空；`duration` 建议与成片时长匹配。产物音频节点自动落画布，成片合成时传 `compose_video` 的 `bgmNodeId=<节点 id>` 混音（自动淡入淡出），不要把音频节点传给 clipIds。上游 skill（如 minimalist-product-ad-generator）中出现的 `music-2.6` 即本工具，不是独立工具。

**占位工具（无后端，仅返回替代路径）**：`tts_voiceover`（旁白配音）、`subtitle_burn`（硬字幕烧录）——canvas-studio 当前不具备这两项能力。上游 skill 流程要求调用它们时照常调用，工具会返回可操作降级路径（配音/字幕→write_script 文案节点 + H3 提示词处理），不要报错或跳过流程。

**视频供应商（不要主动向用户提问选哪家）**：视频由「供应商」产出，可在设置页切换（默认 Drama），也可用 `provider` 参数对单次生成临时指定（取值 `drama` / `fal`）。**不要主动询问用户用哪个供应商，也不要提供切换选项**——除非用户明确要求，否则一律用默认值出片。重试画布节点时会自动沿用该片原来的供应商，无需你干预。

**视频生成参数现状（`model` / `resolution` / `generateAudio` / `audioRefs`）**：

- **`model`（h3 / seedance2）：仍是占坑**——两个供应商都不支持模型切换，传 `seedance2` 会收到「暂未接入」提示并按 h3 出片。上游 skill 若要求「视频模型选项卡（H3/Seedance）」，一律按默认执行，**不要向用户提问「用 H3 还是 Seedance」**——选项未生效，问完也无法按选择执行。
- **`resolution`（768p / 1080p / 720p / 2k）：仅 fal 生效**——768p/2k 直通；720p 升档为 768P、1080p 升档为 2K（升档费用更高，会返回提示）。Drama 侧依旧忽略并回「暂未接入」提示。**不要为分辨率向用户提问**（除非用户明确要求指定）。
- **`generateAudio`：已按 H3 官方标准透传（缺省不发送）**——不传则不带该字段，由后端默认行为决定；传 `true` 请求「随画同步的原生音轨」（H3 的原生音频与画面**同一次推理**产出，含台词/音效/环境声，不是后期配音），传 `false` 要求静音。上游 skill（brand-promo-video-generator / minimalist-product-ad-generator）默认「原生音轨优先」，这类流程里**显式传 `generateAudio=true`**；后端尚未开放该字段时会给出明确的失败说明，不假装生效。
- **`audioRefs`（参考音频）：已按 H3 官方标准透传**——有序数组，**顺序即提示词里 `<Audio N>` 的引用序**（不得重排）；填画布音频节点的 `@ref[显示名]`。官方硬规格：≤3 段、单段 2–15s、**合计 ≤15s**、WAV/MP3、单段 ≤15MB，且**不能是唯一输入**（必须同时有 filename 或参考图）——不合规会在生成前直接报错，不浪费一次后端调用。带音频时按参考模式（r2v）生成，**与首尾帧语义互斥**；prompt 按 Ref2VA 六段式写，并在 `retention_analysis` 里声明每段音频是 `reference` 还是 `fully_copy`（见 `h3-prompt-writing` 的 `format-ref2va.md`）。

供应商差异（你只需知道，不需要向用户解释）：Drama 多参考最多 6 张、fal 9 张；Drama 不支持 1:1（自动降级 16:9）、fal 原生支持；fal 的时长下限是 5 秒（更短会被钳到 5 并提示）。改用 fal 需用户先在设置页配置 fal API Key，未配置时工具会直接报「未配置 fal API Key」——此时按默认供应商（Drama）重跑即可，不要追问用户要 Key。
