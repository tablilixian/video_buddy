# 会话后端接口画像（自动生成）

- 会话文件：`session.jsonl 10`
- 会话跨度：25.1min（2026/9/11 11:51:52 → 2026/9/11 12:16:56）
- 工具调用：53 次，其中后端 34 次 / 本地 13 次 / 人等待 6 次
- 后端占用：6.1min（占会话墙钟 24%），人在回路等待 6.3min
- 并发峰值：1（后端单任务同步 → 并发 1 才是无排队状态）

## 一、结论速览

- **[P1]** `image2vl` 成功率仅 26%（5/19），是当前最不稳的后端链路。
- **[P1]** `qc_shot` 成功率仅 0%（0/3），是当前最不稳的后端链路。
- **[P1]** 17 次**快失败 500**（<2s）：请求没进队列就被拒。优先怀疑「引用的文件名在后端不存在 / 文件类型不被该端点接受」，其次怀疑后端忙时拒单——这两者都能用一个上传过的真实句柄复现验证。
- **[P2]** 同参数重试累计烧掉 1.2min（2 组）。其中不少是本地 schema / 预检类错误——这类错误重试多少次都不会成功，应在工具层直接判死而非让模型重试。

## 二、工具画像

| 工具 | 类 | 调用 | 成功 | 成功率 | p50 | p95 | max | 主要失败模式 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `image2vl` | 后端 | 19 | 5 | 26% | 28.0s | 37.9s | 37.9s | backend-500-fast×14 |
| `image_generate` | 后端 | 8 | 8 | 100% | 28.3s | 45.6s | 45.6s | — |
| `read` | 本地 | 6 | 6 | 100% | 17ms | 24ms | 24ms | — |
| `ask_user_choice` | 人等待 | 6 | 6 | 100% | 82.7s | 99.1s | 99.1s | — |
| `qc_shot` | 后端 | 3 | 0 | 0% | — | — | — | backend-500-fast×3 |
| `skill` | 本地 | 2 | 2 | 100% | 14ms | 14ms | 14ms | — |
| `video_composite` | 后端 | 2 | 0 | 0% | — | — | — | local-precheck×2 |
| `video_generate` | 后端 | 2 | 0 | 0% | — | — | — | local-precheck×1, no-result×1 |
| `list_references` | 本地 | 1 | 1 | 100% | 13ms | 13ms | 13ms | — |
| `write_screenplay` | 本地 | 1 | 1 | 100% | 11ms | 11ms | 11ms | — |
| `submit_storyboard_for_approval` | 本地 | 1 | 1 | 100% | 16ms | 16ms | 16ms | — |
| `submit_keyframes_for_approval` | 本地 | 1 | 1 | 100% | 13ms | 13ms | 13ms | — |
| `write_script` | 本地 | 1 | 1 | 100% | 9ms | 9ms | 9ms | — |

> 耗时分位只统计**成功**样本；`ask_user_choice` 的耗时是用户思考时间，不是接口耗时。

## 三、失败模式分布

| 失败模式 | 次数 | 含义 | 处置建议 |
| --- | ---: | --- | --- |
| 后端 500·快失败（<2s） | 17 | 请求未进队列，入口即拒。查引用的文件名是否存在、后端是否正忙 | — |
| 本地预检拦截 | 3 | 按提示修 prompt/参数，重试无意义 | — |
| 无 result 事件 | 1 | 会话中断 | — |

## 四、参数嫌疑分析（自动发现）

| 工具 | 特征 | 带该特征成功率 | 其它成功率 | 样本 |
| --- | --- | ---: | ---: | ---: |
| `image2vl` | filename=img-* | 0%（13） | 83%（6） | 13 |

> 判据：样本 ≥2 且带该特征的成功率比对照低 30 个百分点以上。值形态族的对照优先取**同键的其它形态族**；该键只有单一形态族时，退回**不带该键**的样本。`ref-*.png`（上传句柄）与 `img_*`/`z-image_*`（后端产物名）在后端的可消费性不同，是高频坑点。

## 五、端点可用性判定

| 后端端点 | 工具 | 样本 | 成功率 | 判定 | 证据 |
| --- | --- | ---: | ---: | --- | --- |
| （未映射） | `image2vl` | 19 | 26% | **疑似不可用** | 成功率 26%（5/19）；成功样本 p50 28.0s / max 37.9s |
| txt2image / image2image（写实）· txt2imageanime（卡通） | `image_generate` | 8 | 100% | **可用** | 8/8 成功；成功样本 p50 28.3s / max 45.6s |
| image2vl | `qc_shot` | 3 | 0% | **疑似不可用** | 成功率 0%（0/3）；无成功样本 |
| image2videofl2va / image2videoref2va | `video_composite` | 2 | 0% | **本地阻断，后端未验证** | 全部 2 次栽在本地环节；无成功样本 |
| image2videofl2va（drama）· minimax/h3/*（fal） | `video_generate` | 2 | 0% | **本地阻断，后端未验证** | 全部 2 次栽在本地环节；无成功样本 |

> 判定口径：成功率 ≥90% = 可用；30–90% = 不稳定；<30% = 疑似不可用。若失败全部落在本地环节（预检/schema），则标「本地阻断，后端未验证」——此时**不能**把锅甩给后端。

## 六、文件引用维度（带文件名 vs 不带）

| 工具 | 带文件名成功率 | 不带成功率 | 样本（带/不带） |
| --- | ---: | ---: | ---: |
| `image_generate` | 100% | 100% | 4/4 |

> 这个维度是把「纯文本链路」与「带参考文件链路」分开看。若差距显著，说明问题出在**文件句柄的可消费性**（文件名不存在 / 类型不被该端点接受 / 后端未落 input 目录），而不是模型或 prompt。

## 七、排队与产能（单任务约束）

| 指标 | 值 | 说明 |
| --- | --- | --- |
| 会话墙钟 | 25.1min | 含人在回路等待 6.3min |
| 后端占用总时长 | 6.1min | 所有后端调用耗时之和 = 串行产能下限 |
| 后端占用率 | 24% | 余数主要是模型思考、文件读写与人等待 |
| 并发峰值 | 1 | >1 说明存在排队，耗时被污染 |
| 重叠调用数 | 0 | 这些调用的耗时含排队等待 |

> **重要**：本会话并发峰值为 **1**，即调用全程严格串行、无任何区间重叠。这排除了一个常见误判——那些 <2s 的快失败 **不是**「本会话内排队等不到资源」造成的（压根没有并发），而是请求到达后端时就被入口拒绝，或后端正被**会话外**的其它任务占用。要定性只能靠串行主动探测复现。
>
> **口径提醒**：后端单任务同步，两个请求并发时后者要么排队（耗时变长），要么被入口拒（快失败 500）。因此「并发探测」对这个后端没有意义——探测必须串行，且耗时基线要在**后端空闲**时测。

## 八、重试浪费

| 工具 | 连续次数 | 累计耗时 | 最终是否成功 | 参数首值（截断） |
| --- | ---: | ---: | --- | --- |
| `image_generate` | 2 | 70.1s | 是 | filename=ref-40bf8914.png |
| `qc_shot` | 2 | 262ms | 否 | filename=img_01287_.png |

## 九、逐次调用明细

| # | 工具 | 起(相对) | 耗时 | 排队等待 | 结果 | 关键参数 | 错误/产物摘要 |
| ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| 0 | `skill` | 104s | 14ms | — | ✅ | name=canvas-studio-creation | <skill_content name="canvas-studio-creation"> <skill_resources> Base directory for this skill: /Users/wl/Deskt |
| 1 | `read` | 112s | 13ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/canvas-studio-creation/references/clarifica |
| 2 | `read` | 117s | 13ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/canvas-studio-creation/references/look.md</ |
| 3 | `list_references` | 117s | 13ms | — | ✅ | — | 可用参考图（1）： 1. [image] 雪地坦克.png（强度 1，filename=ref-40bf8914.png）  画布文本节点（1）： 1. 【user_brief】创意：参考图中风格，生成一段部队推进的视频 |
| 4 | `image2vl` | 129s | 15.3s | — | ✅ | filename=ref-40bf8914.png systemPrompt=你是一个专业的影视视觉分析师，擅长从画面中提炼可复用的风 | 色彩：冷灰白调主导，局部高光点缀形成强烈对比 光线：阴天漫射光营造压抑氛围，爆炸点光源制造戏剧性焦点 材质：雪地呈现粗糙质感与坦克金属反光结合，士兵服装显厚重臃肿感 镜头语汇：广角俯瞰视角强化战场规模感，动态模糊表现高速 |
| 5 | `ask_user_choice` | 148s | 30.0s | — | ✅ | question=成片想要什么形态？ options=["单镜精品短片（推荐）","多镜头叙事短片"] | 用户的选择：单镜精品短片（推荐） |
| 6 | `image_generate` | 188s | 28.3s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/2ba8b10e-5f37-43ee-ae93-da924e24fe4c/78120a4c-7f16-4e37-a528-f475739b7d21.png (12 |
| 7 | `ask_user_choice` | 222s | 82.7s | — | ✅ | question=这是按参考图归纳出的基调样张（冷灰白雪地战场景，不是最终 options=["就是这个感觉","换一批","我来说说"] | 用户的选择：环境感觉对，但是真实战场不是这样的，没有这么整齐的坦克，是步兵跟坦克协同前进 |
| 8 | `image_generate` | 316s | 16.0s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/2ba8b10e-5f37-43ee-ae93-da924e24fe4c/17d51fba-1adf-47cb-8c77-6a88d1e0d567.png (12 |
| 9 | `ask_user_choice` | 337s | 61.6s | — | ✅ | question=已按「步兵散兵线 + 坦克穿插协同」重出基调样张（非最终 options=["就是这个感觉","换一批","我来说说"] | 用户的选择：坦克和步兵，要按照参考图上进行分布，摄像机夜视跟在部队后面，跟着部队同步向前推进 |
| 10 | `image2vl` | 406s | 37.9s | — | ✅ | filename=ref-40bf8914.png systemPrompt=你是一个专业的影视构图分析师。 | 该图像为高角度俯瞰式广角镜头拍摄。  - 摄像机位于较高处，以略微倾斜向下视角捕捉战场全景；相机方位大致呈垂直于地面但略有前倾，使主体元素呈现开阔纵深感。    - 坦克数量较多，在画面上约有十余辆清晰可辨或部分被雪雾遮 |
| 11 | `image_generate` | 458s | 22.7s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/2ba8b10e-5f37-43ee-ae93-da924e24fe4c/f8c48fa3-b1d0-4b31-b46d-9a4ae40d1aa3.png (12 |
| 12 | `ask_user_choice` | 487s | 84.2s | — | ✅ | question=已按「夜视仪跟随视角 + 坦克步兵参考图式分布」重出基调 options=["就是这个感觉","换一批","我来说说"] | 用户的选择：感觉对了，但是摄像机不是放在坦克上的，类似航拍跟随，而且不需要夜视仪 |
| 13 | `image_generate` | 582s | 16.5s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/2ba8b10e-5f37-43ee-ae93-da924e24fe4c/29d925bc-10dd-4b2c-83e6-bb465e619602.png (12 |
| 14 | `ask_user_choice` | 603s | 22.5s | — | ✅ | question=已改为「高角度航拍跟随 + 参考图式坦克步兵分布」（非最 options=["就是这个感觉","换一批","我来说说"] | 用户的选择：就是这个感觉 |
| 15 | `skill` | 629s | 10ms | — | ✅ | name=h3-prompt-writing | <skill_content name="h3-prompt-writing"> <skill_resources> Base directory for this skill: /Users/wl/Desktop/jo |
| 16 | `read` | 629s | 11ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/canvas-studio-creation/references/screenpla |
| 17 | `write_screenplay` | 668s | 11ms | — | ✅ | summary=雪地部队协同推进 · 单镜精品 · 30s · 高角度航 | 剧本已落到画布（节点 id=cee0052d-bca0-418e-ab8b-f8fd334520e9）。下一步调用 submit_screenplay_for_approval 提交审批（逐步确认模式下等待用户批准后才能 |
| 18 | `submit_storyboard_for_approval` | 685s | 16ms | — | ✅ | summary=2 段 ×15s · 高角度航拍跟随雪地部队推进 · 冷 | 分镜表已按 3 个镜头拆分落到画布：分镜 # · 景别 / 机位（id=83dda86a-f39c-4aeb-94c6-39263732779e）、分镜 1 · 大远景·高角度航拍跟随（部队后方高处）（id=29593e |
| 19 | `read` | 718s | 24ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/h3-prompt-writing/references/format-ref2va. |
| 20 | `read` | 718s | 24ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/h3-prompt-writing/references/camera-vocabul |
| 21 | `image_generate` | 740s | 45.6s | — | ✅ | aspectRatio=16:9 style=realistic filename=ref-40bf8914.png sourceUrls=["/canvas-studio/assets/2ba8b10e-5f37-43 shotRefs=["分镜 1 · 大远景·高角度航拍跟随（部队后方高处）"] | 已生成产物: /canvas-studio/assets/2ba8b10e-5f37-43ee-ae93-da924e24fe4c/182522e4-b009-4588-ba5b-f68ba66c52ed.png (12 |
| 22 | `qc_shot` | 794s | 159ms | — | ❌ | filename=img_01287_.png expect=色彩：冷灰白调主导的大面积低饱和底色 + 局部爆炸火光橙 shotRefs=["分镜 1 · 大远景·高角度航拍跟随（部队后方高处）"] | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 23 | `qc_shot` | 802s | 103ms | — | ❌ | filename=img_01287_.png expect=色彩：冷灰白调主导的大面积低饱和底色 + 局部爆炸火光橙 shotRefs=["分镜 1 · 大远景·高角度航拍跟随（部队后方高处）"] | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 24 | `image_generate` | 816s | 19.4s | — | ✅ | aspectRatio=16:9 style=realistic filename=ref-40bf8914.png sourceUrls=["/canvas-studio/assets/2ba8b10e-5f37-43 shotRefs=["分镜 2 · 大远景·同机位跟随"] | 已生成产物: /canvas-studio/assets/2ba8b10e-5f37-43ee-ae93-da924e24fe4c/434c4078-1427-4f78-a58c-60b44c94b886.png (12 |
| 25 | `qc_shot` | 844s | 179ms | — | ❌ | filename=img_01288_.png expect=色彩：冷灰白调主导的大面积低饱和底色 + 局部爆炸火光橙 shotRefs=["分镜 2 · 大远景·同机位跟随"] | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 26 | `image2vl` | 853s | 97ms | — | ❌ | filename=img_01287_.png systemPrompt=你是一个专业的影视视觉质检员。 | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 27 | `image2vl` | 858s | 96ms | — | ❌ | filename=img_01287_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 28 | `image2vl` | 862s | 28.0s | — | ✅ | filename=ref-40bf8914.png systemPrompt=你是一个专业的影视视觉分析师。 | 这是一张具有强烈战争史诗感的广角俯瞰式画面，呈现了严冬雪原上大规模机械化部队行进或交战的场景。  **画面内容：** - **环境背景**：一片广阔无垠、被厚厚积雪覆盖的平原战场，在灰白阴沉天空下显得肃杀而寒冷；远处可见 |
| 29 | `image2vl` | 897s | 160ms | — | ❌ | filename=img_01287_.png systemPrompt=你是一个专业的影视视觉质检员，请客观逐项核对。 | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 30 | `image2vl` | 901s | 115ms | — | ❌ | filename=img_01287_.png systemPrompt=You are a professional film  | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 31 | `image2vl` | 905s | 101ms | — | ❌ | filename=img_01287_.png | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 32 | `image_generate` | 919s | 35.0s | — | ✅ | aspectRatio=16:9 style=realistic filename=ref-40bf8914.png sourceUrls=["/canvas-studio/assets/2ba8b10e-5f37-43 shotRefs=["分镜 1 · 大远景·高角度航拍跟随（部队后方高处）"] | 已生成产物: /canvas-studio/assets/2ba8b10e-5f37-43ee-ae93-da924e24fe4c/78e91950-d8c8-4bb5-aa31-0cceb73810c2.png (12 |
| 33 | `image2vl` | 960s | 156ms | — | ❌ | filename=img_01289_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 34 | `image2vl` | 964s | 97ms | — | ❌ | filename=img_01287_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 35 | `image2vl` | 968s | 93ms | — | ❌ | filename=z-image_00852_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 36 | `image2vl` | 972s | 34.5s | — | ✅ | filename=ref-40bf8914.png | 作为专业影视镜头分析师，我对该画面的电影摄影角度进行如下解析：  【画面内容】   这是一幅宏大的雪地战场全景图：广袤无垠的白色平原上布满坦克和步兵，形成多组进攻或推进阵型；中央偏左一辆主战坦克正向前行驶并伴随炮火喷射（ |
| 37 | `image2vl` | 1012s | 136ms | — | ❌ | filename=img_01287_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 38 | `image2vl` | 1016s | 86ms | — | ❌ | filename=img_01288_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 39 | `image2vl` | 1021s | 89ms | — | ❌ | filename=img_01289_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 40 | `image_generate` | 1034s | 35.1s | — | ✅ | aspectRatio=16:9 style=realistic filename=ref-40bf8914.png sourceUrls=["/canvas-studio/assets/2ba8b10e-5f37-43 shotRefs=["分镜 1 · 大远景·高角度航拍跟随（部队后方高处）"] | 已生成产物: /canvas-studio/assets/2ba8b10e-5f37-43ee-ae93-da924e24fe4c/0b00481f-128e-4a60-a4ed-37ac8d71907c.png (12 |
| 41 | `image2vl` | 1074s | 159ms | — | ❌ | filename=img_01290_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 42 | `image2vl` | 1079s | 103ms | — | ❌ | filename=img_01287_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 43 | `image2vl` | 1083s | 105ms | — | ❌ | filename=img_01289_.png systemPrompt=你是一个专业的影视视觉分析师。 | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 44 | `image2vl` | 1087s | 26.9s | — | ✅ | filename=ref-40bf8914.png systemPrompt=你是一个专业的影视视觉分析师。 | 【画面内容】   这是一幅大规模雪地战场的动态场景，呈现了坦克集群与步兵在严寒环境中推进或交火的情景。中央偏左一辆主战坦克正向前行驶，车体上可见红色标记（可能是伪装或标识），其后方及两侧分布着多辆同型号坦克和成群士兵；右 |
| 45 | `ask_user_choice` | 1122s | 99.1s | — | ✅ | question=关键帧已出齐（分镜 1 / 2 各一张，按参考图风格生成 options=["就是这个感觉","需要修改"] | 用户的选择：就是这个感觉 |
| 46 | `submit_keyframes_for_approval` | 1226s | 13ms | — | ✅ | summary=2 镜关键帧已出齐（分镜 1 / 2，冷灰白雪地战场景  | 关键帧已全部生成并落到画布（2 镜关键帧已出齐（分镜 1 / 2，冷灰白雪地战场景 + 高角度航拍跟随视角）；质检接口当前不可用，画面由用户直接确认。），本回合到此结束。请等待用户在画布上方点击「确认关键帧」；用户可能先 |
| 47 | `write_script` | 1382s | 9ms | — | ✅ | — | 文案已落到画布（节点 id=8313677a-1b56-43df-821d-10a697fd9570），合成成片时可作为 scriptId 传入 compose_video。 |
| 48 | `video_composite` | 1424s | 16ms | — | ❌ | filenames=["img_01290_.png","ref-40bf8914.png"] aspectRatio=16:9 duration=15 sourceUrls=["/canvas-studio/assets/2ba8b10e-5f37-43 shotRefs=["分镜 1 · 大远景·高角度航拍跟随（部队后方高处）"] shotTransition=cut | 本地预检拦截｜请求发出前被插件侧的格式校验拦下（如 H3-Context-IR 句式不合规）。零后端消耗，按提示改 prompt 即可。 |
| 49 | `video_composite` | 1455s | 11ms | — | ❌ | filenames=["img_01290_.png","ref-40bf8914.png"] aspectRatio=16:9 duration=15 sourceUrls=["/canvas-studio/assets/2ba8b10e-5f37-43 shotRefs=["分镜 1 · 大远景·高角度航拍跟随（部队后方高处）"] shotTransition=cut | 本地预检拦截｜请求发出前被插件侧的格式校验拦下（如 H3-Context-IR 句式不合规）。零后端消耗，按提示改 prompt 即可。 |
| 50 | `video_generate` | 1475s | 14ms | — | ❌ | filename=img_01290_.png aspectRatio=16:9 duration=15 sourceUrls=["/canvas-studio/assets/2ba8b10e-5f37-43 shotRefs=["分镜 1 · 大远景·高角度航拍跟随（部队后方高处）"] shotTransition=cut | 本地预检拦截｜请求发出前被插件侧的格式校验拦下（如 H3-Context-IR 句式不合规）。零后端消耗，按提示改 prompt 即可。 |
| 51 | `read` | 1479s | 17ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/h3-prompt-writing/references/format-base.md |
| 52 | `video_generate` | 1504s | — | — | ❌ | filename=img_01290_.png aspectRatio=16:9 duration=15 sourceUrls=["/canvas-studio/assets/2ba8b10e-5f37-43 shotRefs=["分镜 1 · 大远景·高角度航拍跟随（部队后方高处）"] shotTransition=cut | 无结果记录｜会话中断或未落 result 事件。 |

> 完整明细见同目录 `calls.json`；甘特时间线见 `timeline.html`。
