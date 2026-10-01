# 会话后端接口画像（自动生成）

- 会话文件：`session.jsonl 9`
- 会话跨度：79.0min（2026/9/10 18:02:37 → 2026/9/10 19:21:39）
- 工具调用：71 次，其中后端 47 次 / 本地 21 次 / 人等待 3 次
- 后端占用：60.4min（占会话墙钟 76%），人在回路等待 1.7min
- 并发峰值：1（后端单任务同步 → 并发 1 才是无排队状态）

## 一、结论速览

- **[P0]** 6 次调用栽在**本地 output schema**（music_generation / compose_video）：后端其实已经把活干完了（耗时 26–64s 说明真跑了），但工具返回值声明 additionalProperties:false 且漏了字段，产物在返回给模型前被丢弃。这是插件 bug，不是后端问题，修 schema 即刻恢复。
- **[P1]** `music_generation` 成功率仅 0%（0/4），是当前最不稳的后端链路。
- **[P1]** 14 次**快失败 500**（<2s）：请求没进队列就被拒。优先怀疑「引用的文件名在后端不存在 / 文件类型不被该端点接受」，其次怀疑后端忙时拒单——这两者都能用一个上传过的真实句柄复现验证。
- **[P2]** `video_generate` p95 耗时 403.2s（max 403.2s）。单任务串行下，这类接口是整条流水线的产能瓶颈，排期必须按「镜数 × p95」估时。

## 二、工具画像

| 工具 | 类 | 调用 | 成功 | 成功率 | p50 | p95 | max | 主要失败模式 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `image_generate` | 后端 | 22 | 12 | 55% | 17.8s | 30.9s | 30.9s | backend-500-fast×9, backend-500-slow×1 |
| `video_generate` | 后端 | 13 | 9 | 69% | 322.9s | 403.2s | 403.2s | local-precheck×2, backend-500-fast×2 |
| `read` | 本地 | 6 | 6 | 100% | 13ms | 17ms | 17ms | — |
| `skill` | 本地 | 4 | 4 | 100% | 8ms | 9ms | 9ms | — |
| `todo_write` | 本地 | 4 | 4 | 100% | 10ms | 11ms | 11ms | — |
| `music_generation` | 后端 | 4 | 0 | 0% | — | — | — | local-schema×4 |
| `ask_user_choice` | 人等待 | 3 | 3 | 100% | 36.0s | 40.5s | 40.5s | — |
| `character_sheet` | 后端 | 3 | 2 | 67% | 99.3s | 99.3s | 99.3s | backend-500-fast×1 |
| `upload_image` | 后端 | 3 | 3 | 100% | 9.4s | 11.7s | 11.7s | — |
| `qc_shot` | 后端 | 2 | 0 | 0% | — | — | — | backend-500-fast×2 |
| `compose_video` | 本地 | 2 | 0 | 0% | — | — | — | local-schema×2 |
| `write_screenplay` | 本地 | 1 | 1 | 100% | 16ms | 16ms | 16ms | — |
| `submit_storyboard_for_approval` | 本地 | 1 | 1 | 100% | 18ms | 18ms | 18ms | — |
| `submit_keyframes_for_approval` | 本地 | 1 | 1 | 100% | 7ms | 7ms | 7ms | — |
| `write_script` | 本地 | 1 | 1 | 100% | 13ms | 13ms | 13ms | — |
| `list_shots` | 本地 | 1 | 1 | 100% | 7ms | 7ms | 7ms | — |

> 耗时分位只统计**成功**样本；`ask_user_choice` 的耗时是用户思考时间，不是接口耗时。

## 三、失败模式分布

| 失败模式 | 次数 | 含义 | 处置建议 |
| --- | ---: | --- | --- |
| 后端 500·快失败（<2s） | 14 | 请求未进队列，入口即拒。查引用的文件名是否存在、后端是否正忙 | — |
| 本地 output schema 校验失败 | 6 | 插件 bug：改 Host 工具 output schema，把返回字段补全 | — |
| 本地预检拦截 | 2 | 按提示修 prompt/参数，重试无意义 | — |
| 后端 500·慢失败 | 1 | 进队列后生成中崩。可原样重试，2 次仍失败再怀疑参数 | — |

## 四、参数嫌疑分析（自动发现）

| 工具 | 特征 | 带该特征成功率 | 其它成功率 | 样本 |
| --- | --- | ---: | ---: | ---: |
| `image_generate` | 参数 filenames 存在 | 0%（2） | 60%（20） | 2 |
| `image_generate` | filenames=array[img-*|ref-*] | 0%（2） | 55%（20） | 2 |
| `video_generate` | 参数 filename 存在 | 0%（2） | 100%（9） | 2 |
| `video_generate` | filename=img-* | 0%（2） | 82%（9） | 2 |
| `image_generate` | filename=img-* | 11%（9） | 55%（13） | 9 |
| `image_generate` | 参数 filename 存在 | 20%（10） | 83%（12） | 10 |

> 判据：样本 ≥2 且带该特征的成功率比对照低 30 个百分点以上。值形态族把 `ref-*.png`（上传句柄）与 `img_*`/`z-image_*`（产物名）自动区分开——这两类文件名在后端的可消费性不同，是高频坑点。

## 五、端点可用性判定

| 后端端点 | 工具 | 样本 | 成功率 | 判定 | 证据 |
| --- | --- | ---: | ---: | --- | --- |
| txt2image / image2image（写实）· txt2imageanime（卡通） | `image_generate` | 22 | 55% | **不稳定** | 成功率 55%（12/22）；成功样本 p50 17.8s / max 30.9s |
| image2videofl2va（drama）· minimax/h3/*（fal） | `video_generate` | 13 | 69% | **不稳定** | 成功率 69%（9/13）；成功样本 p50 322.9s / max 403.2s |
| txt2audio | `music_generation` | 4 | 0% | **本地阻断，后端未验证** | 全部 4 次栽在本地环节；无成功样本 |
| image2character | `character_sheet` | 3 | 67% | **不稳定** | 成功率 67%（2/3）；成功样本 p50 99.3s / max 99.3s |
| upload（统一上传端点） | `upload_image` | 3 | 100% | **可用** | 3/3 成功；成功样本 p50 9.4s / max 11.7s |
| image2vl | `qc_shot` | 2 | 0% | **疑似不可用** | 成功率 0%（0/2）；无成功样本 |

> 判定口径：成功率 ≥90% = 可用；30–90% = 不稳定；<30% = 疑似不可用。若失败全部落在本地环节（预检/schema），则标「本地阻断，后端未验证」——此时**不能**把锅甩给后端。

## 六、文件引用维度（带文件名 vs 不带）

| 工具 | 带文件名成功率 | 不带成功率 | 样本（带/不带） |
| --- | ---: | ---: | ---: |
| `image_generate` | 17% | 100% | 12/10 |
| `video_generate` | 0% | 100% | 2/9 |

> 这个维度是把「纯文本链路」与「带参考文件链路」分开看。若差距显著，说明问题出在**文件句柄的可消费性**（文件名不存在 / 类型不被该端点接受 / 后端未落 input 目录），而不是模型或 prompt。

## 七、排队与产能（单任务约束）

| 指标 | 值 | 说明 |
| --- | --- | --- |
| 会话墙钟 | 79.0min | 含人在回路等待 1.7min |
| 后端占用总时长 | 60.4min | 所有后端调用耗时之和 = 串行产能下限 |
| 后端占用率 | 76% | 余数主要是模型思考、文件读写与人等待 |
| 并发峰值 | 1 | >1 说明存在排队，耗时被污染 |
| 重叠调用数 | 0 | 这些调用的耗时含排队等待 |

> **重要**：本会话并发峰值为 **1**，即调用全程严格串行、无任何区间重叠。这排除了一个常见误判——那些 <2s 的快失败 **不是**「本会话内排队等不到资源」造成的（压根没有并发），而是请求到达后端时就被入口拒绝，或后端正被**会话外**的其它任务占用。要定性只能靠串行主动探测复现。
>
> **口径提醒**：后端单任务同步，两个请求并发时后者要么排队（耗时变长），要么被入口拒（快失败 500）。因此「并发探测」对这个后端没有意义——探测必须串行，且耗时基线要在**后端空闲**时测。

## 八、重试浪费

| 工具 | 连续次数 | 累计耗时 | 最终是否成功 | 参数首值（截断） |
| --- | ---: | ---: | --- | --- |
| `image_generate` | 2 | 12.1s | 否 | filenames=img_01255_.png,ref-8e6fce70.png |
| `image_generate` | 3 | 370ms | 否 | filename=img_01256_.png |
| `image_generate` | 2 | 274ms | 否 | filename=img_01257_.png |
| `video_generate` | 2 | 272ms | 否 | filename=img_01257_.png |
| `qc_shot` | 2 | 240ms | 否 | filename=img_01257_.png |

## 九、逐次调用明细

| # | 工具 | 起(相对) | 耗时 | 排队等待 | 结果 | 关键参数 | 错误/产物摘要 |
| ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| 0 | `skill` | 146s | 9ms | — | ✅ | name=canvas-studio-creation | <skill_content name="canvas-studio-creation"> <skill_resources> Base directory for this skill: /Users/wl/Deskt |
| 1 | `read` | 155s | 8ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/canvas-studio-creation/references/clarifica |
| 2 | `ask_user_choice` | 161s | 36.0s | — | ✅ | question=成片想要什么形态？ options=["多镜头叙事短片（推荐）","单镜精品短片"] | 用户的选择：多镜头叙事短片（推荐） |
| 3 | `ask_user_choice` | 201s | 40.5s | — | ✅ | question=想走哪种风格大类？（你的题材是古装武侠剧情向，我倾向动画 options=["商业推广","动画叙事（推荐）","讲解科普","艺术创意"] | 用户的选择：艺术创意 |
| 4 | `read` | 244s | 17ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/canvas-studio-creation/references/style-pre |
| 5 | `ask_user_choice` | 253s | 22.5s | — | ✅ | question=艺术创意大类下，选哪种具体风格？（古装客栈+杀手接单的对 options=["手绘实景融合","MV 字幕","街采跟拍","惊吓遭遇战（推荐）"] | 用户的选择：写实电影古装 |
| 6 | `read` | 280s | 11ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/canvas-studio-creation/references/screenpla |
| 7 | `read` | 283s | 13ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/canvas-studio-creation/references/shot-form |
| 8 | `write_screenplay` | 353s | 16ms | — | ✅ | summary=客栈夜会 · 刺客接单 · 五幕节拍链 · 90s ·  | 剧本已落到画布（节点 id=505a8d0c-dfbc-4321-9e4b-b598268bee67）。下一步调用 submit_screenplay_for_approval 提交审批（逐步确认模式下等待用户批准后才能 |
| 9 | `submit_storyboard_for_approval` | 394s | 18ms | — | ✅ | summary=客栈夜会 · 刺客接单 · 五幕节拍链 · 90s ·  | 放手跑模式：分镜表已按 10 镜拆卡落画布：分镜 # · 节拍（id=8edcb9a3-d181-40dc-b857-78ee987c7c75）、分镜 B1 · 开场铺垫：客栈夜色（id=4aa0239d-b17e-46 |
| 10 | `read` | 407s | 11ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/canvas-studio-creation/references/consisten |
| 11 | `skill` | 424s | 8ms | — | ✅ | name=z-image-prompt-writing | <skill_content name="z-image-prompt-writing"> <skill_resources> Base directory for this skill: /Users/wl/Deskt |
| 12 | `character_sheet` | 435s | 164ms | — | ❌ | filename=刺客定妆照 name=刺客 lockedPrompt=一位身形高挑精瘦的古代杀手，约三十岁，黑色窄袖劲装束腰， negativePrompt=不更换服装、不摘下面巾、不换发型 | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 13 | `image_generate` | 446s | 27.9s | — | ✅ | aspectRatio=1:1 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/a776e511-025d-43fb-9267-67a2fb4bc563.png (10 |
| 14 | `image_generate` | 482s | 16.6s | — | ✅ | aspectRatio=1:1 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/9043d0a1-f0bf-499c-8bd7-dc4b51cd4522.png (10 |
| 15 | `image_generate` | 510s | 18.6s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/da050416-7e8f-4bd1-96c9-dcf4fe3ff7f1.png (12 |
| 16 | `upload_image` | 535s | 9.4s | — | ✅ | imageUrl=/canvas-studio/assets/876250 | 已上传到 Drama Backend: ref-a2765d9d.png |
| 17 | `upload_image` | 551s | 8.5s | — | ✅ | imageUrl=/canvas-studio/assets/876250 | 已上传到 Drama Backend: ref-7b6d25d2.png |
| 18 | `upload_image` | 564s | 11.7s | — | ✅ | imageUrl=/canvas-studio/assets/876250 | 已上传到 Drama Backend: ref-8e6fce70.png |
| 19 | `character_sheet` | 583s | 99.3s | — | ✅ | filename=ref-a2765d9d.png name=刺客 lockedPrompt=一位身形高挑精瘦的古代杀手，约三十岁，黑色窄袖劲装束腰， negativePrompt=不更换服装、不摘下面巾、不换发型 | 已建立一致性资产卡「刺客」（id=c6c1c896-c267-44ed-b863-0bef76d0a3a2）。 四视图拼图（资产卡唯一锚点）: /canvas-studio/assets/8762505b-bb00-45 |
| 20 | `character_sheet` | 690s | 72.4s | — | ✅ | filename=ref-7b6d25d2.png name=柳娘 lockedPrompt=一位妩媚大胆的古代美女，约二十五六岁，大红色高开衩长裙半 negativePrompt=不更换服装、不换发型、不改妆容 | 已建立一致性资产卡「柳娘」（id=4fb64b34-07cf-4c53-802f-acb3a4f94552）。 四视图拼图（资产卡唯一锚点）: /canvas-studio/assets/8762505b-bb00-45 |
| 21 | `skill` | 769s | 8ms | — | ✅ | name=h3-prompt-writing | <skill_content name="h3-prompt-writing"> <skill_resources> Base directory for this skill: /Users/wl/Desktop/jo |
| 22 | `todo_write` | 783s | 10ms | — | ✅ | — | Updated todo list: 4 pending, 1 in progress, 2 completed. |
| 23 | `image_generate` | 795s | 12.0s | — | ❌ | aspectRatio=16:9 style=realistic filenames=["img_01255_.png","ref-8e6fce70.png"] shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] | 后端 500·慢失败｜耗时 12.0s 已接近正常耗时 → 请求进了队列、生成过程中崩。可原样重试（后端偶发），重试 2 次仍失败再怀疑参数。 |
| 24 | `image_generate` | 818s | 89ms | — | ❌ | aspectRatio=16:9 style=realistic filenames=["img_01255_.png","ref-8e6fce70.png"] shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 25 | `image_generate` | 829s | 30.9s | — | ✅ | aspectRatio=16:9 style=realistic filename=ref-8e6fce70.png shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/6b7e15a5-5ef8-47d2-a3c0-747352f9dae6.png (12 |
| 26 | `image_generate` | 874s | 164ms | — | ❌ | aspectRatio=16:9 style=realistic filename=img_01256_.png shotRefs=["分镜 B2 · 她登场"] | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 27 | `image_generate` | 883s | 93ms | — | ❌ | aspectRatio=16:9 style=realistic filename=img_01256_.png shotRefs=["分镜 B2 · 她登场"] | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 28 | `image_generate` | 892s | 113ms | — | ❌ | aspectRatio=16:9 style=realistic filename=img_01256_.png shotRefs=["分镜 B2 · 她登场"] | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 29 | `image_generate` | 906s | 25.8s | — | ✅ | aspectRatio=16:9 style=realistic filename=img_01257_.png shotRefs=["分镜 B3 · 落座·开价"] | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/8f82361b-0d9f-4717-a53e-dd5287ddf935.png (12 |
| 30 | `image_generate` | 946s | 173ms | — | ❌ | aspectRatio=16:9 style=realistic filename=img_01257_.png shotRefs=["分镜 B2 · 她登场"] | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 31 | `image_generate` | 956s | 101ms | — | ❌ | aspectRatio=16:9 style=realistic filename=img_01257_.png shotRefs=["分镜 B2 · 她登场"] | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 32 | `image_generate` | 970s | 107ms | — | ❌ | aspectRatio=16:9 style=realistic filename=img_01257_.png shotRefs=["分镜 B2 · 她登场"] | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 33 | `image_generate` | 980s | 164ms | — | ❌ | aspectRatio=16:9 style=realistic filename=img_01257_.png shotRefs=["分镜 B4 · 他反问目标"] | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 34 | `image_generate` | 990s | 108ms | — | ❌ | aspectRatio=16:9 style=realistic filename=img_01257_.png shotRefs=["分镜 B5 · 她亮底牌"] | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 35 | `image_generate` | 1001s | 22.8s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/ac963109-967e-44df-af18-43aa48a8cbe9.png (12 |
| 36 | `image_generate` | 1036s | 15.8s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/a4b6f54e-5de2-4f89-982a-74ff363ea4f5.png (12 |
| 37 | `image_generate` | 1061s | 15.0s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/e2c069a3-33ac-439d-8683-18485da993d4.png (12 |
| 38 | `image_generate` | 1085s | 15.6s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/9b6468e1-62f3-4702-95b5-01a045d80029.png (12 |
| 39 | `image_generate` | 1110s | 15.5s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/94cf13a7-5a06-4c0a-acc6-98ffe0692c3c.png (12 |
| 40 | `image_generate` | 1135s | 15.2s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/f8689221-fdf6-433f-bb5b-cae2fc3a2835.png (12 |
| 41 | `image_generate` | 1161s | 17.8s | — | ✅ | aspectRatio=16:9 style=realistic | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/dea56b10-64c9-4404-8f35-bf2a58ea443b.png (12 |
| 42 | `qc_shot` | 1185s | 148ms | — | ❌ | filename=img_01257_.png shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 43 | `qc_shot` | 1188s | 92ms | — | ❌ | filename=img_01257_.png shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 44 | `todo_write` | 1202s | 11ms | — | ✅ | — | Updated todo list: 3 pending, 1 in progress, 3 completed. |
| 45 | `submit_keyframes_for_approval` | 1206s | 7ms | — | ✅ | summary=9 镜关键帧已出齐（客栈夜会·刺客接单）；qc_shot | 放手跑模式：关键帧确认已放行，继续执行后续流程（文案 / 逐镜视频 / 成片合成）。 |
| 46 | `write_script` | 1234s | 13ms | — | ✅ | — | 文案已落到画布（节点 id=6a398529-335b-443e-a54a-8819bb83ca53），合成成片时可作为 scriptId 传入 compose_video。 |
| 47 | `video_generate` | 1254s | 13ms | — | ❌ | filename=img_01257_.png aspectRatio=16:9 duration=8 shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] shotTransition=cut | 本地预检拦截｜请求发出前被插件侧的格式校验拦下（如 H3-Context-IR 句式不合规）。零后端消耗，按提示改 prompt 即可。 |
| 48 | `read` | 1259s | 13ms | — | ✅ | file_path=/Users/wl/Desktop/job/learn/ | <path>/Users/wl/Desktop/job/learn/video_buddy/canvas-studio/skills/h3-prompt-writing/references/format-base.md |
| 49 | `video_generate` | 1277s | 10ms | — | ❌ | filename=img_01257_.png aspectRatio=16:9 duration=8 shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] shotTransition=cut | 本地预检拦截｜请求发出前被插件侧的格式校验拦下（如 H3-Context-IR 句式不合规）。零后端消耗，按提示改 prompt 即可。 |
| 50 | `video_generate` | 1291s | 164ms | — | ❌ | filename=img_01257_.png aspectRatio=16:9 duration=8 shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] shotTransition=cut | 后端 500·快失败｜耗时 0.2s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 51 | `video_generate` | 1303s | 108ms | — | ❌ | filename=img_01257_.png aspectRatio=16:9 duration=8 shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] shotTransition=cut | 后端 500·快失败｜耗时 0.1s 远低于该接口的正常耗时 → 请求没有进入生成队列，在入口即被拒（常见成因：引用的文件名在后端不存在、后端正忙、链路未就绪）。 |
| 52 | `video_generate` | 1317s | 263.8s | — | ✅ | aspectRatio=16:9 duration=8 shotRefs=["分镜 B1 · 开场铺垫：客栈夜色"] shotTransition=cut | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/a818dee1-f9bb-423f-9813-f7ea41d5dfc6.mp4 (12 |
| 53 | `video_generate` | 1598s | 325.4s | — | ✅ | aspectRatio=16:9 duration=10 shotRefs=["分镜 B2 · 她登场"] shotTransition=cut | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/f9937259-c4ce-4685-bc6a-50e96d39803a.mp4 (12 |
| 54 | `video_generate` | 1939s | 319.6s | — | ✅ | aspectRatio=16:9 duration=10 shotRefs=["分镜 B3 · 落座·开价"] shotTransition=cut | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/f6af1974-a2ba-4192-93f2-3366f77025bc.mp4 (12 |
| 55 | `video_generate` | 2274s | 297.5s | — | ✅ | aspectRatio=16:9 duration=10 shotRefs=["分镜 B4 · 他反问目标"] shotTransition=cut | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/2cf58c18-67c0-4d74-91cc-e96531529aa2.mp4 (12 |
| 56 | `video_generate` | 2587s | 376.5s | — | ✅ | aspectRatio=16:9 duration=12 shotRefs=["分镜 B5 · 她亮底牌"] shotTransition=cut | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/7403a5e1-f56a-4e20-b4b4-185ee845035f.mp4 (12 |
| 57 | `video_generate` | 2977s | 403.2s | — | ✅ | aspectRatio=16:9 duration=12 shotRefs=["分镜 B6 · 杀手权衡·试探"] shotTransition=cut | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/bf52f3f1-a98f-44b3-9880-b3394bd475c2.mp4 (12 |
| 58 | `video_generate` | 3395s | 374.7s | — | ✅ | aspectRatio=16:9 duration=12 shotRefs=["分镜 B7 · 暧昧拉扯"] shotTransition=cut | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/87137a6d-4db2-439d-a4ef-ac208f5c1f43.mp4 (12 |
| 59 | `video_generate` | 3786s | 318.5s | — | ✅ | aspectRatio=16:9 duration=10 shotRefs=["分镜 B8 · 他接活"] shotTransition=cut | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/bd7ca099-6b66-467f-830e-3b495057a092.mp4 (12 |
| 60 | `video_generate` | 4121s | 322.9s | — | ✅ | aspectRatio=16:9 duration=10 shotRefs=["分镜 B9 · 收尾定格"] shotTransition=cut | 已生成产物: /canvas-studio/assets/8762505b-bb00-452a-a495-463296781b53/6a86ff0a-68ca-4761-a192-6413d4bce045.mp4 (12 |
| 61 | `todo_write` | 4455s | 10ms | — | ✅ | — | Updated todo list: 0 pending, 1 in progress, 6 completed. |
| 62 | `list_shots` | 4457s | 7ms | — | ✅ | — | 当前镜头清单（9 段）： - integrated_m… · 分镜 B1 · 开场铺垫：客栈夜色 · v1 8s · id=a818dee1-f9bb-423f-9813-f7ea41d5dfc6 - integrate |
| 63 | `skill` | 4463s | 8ms | — | ✅ | name=music-prompt-writing | <skill_content name="music-prompt-writing"> <skill_resources> Base directory for this skill: /Users/wl/Desktop |
| 64 | `music_generation` | 4477s | 64.1s | — | ❌ | lyrics= duration=90 bpm=65 language=unknown timesignature=4 | 本地 schema 校验失败｜Host 工具 output schema 声明了 additionalProperties:false，但 execute 返回了未声明字段——产物其实已生成却被丢弃。纯本地 bug，与后 |
| 65 | `music_generation` | 4548s | 26.5s | — | ❌ | duration=90 bpm=65 language=unknown timesignature=4 | 本地 schema 校验失败｜Host 工具 output schema 声明了 additionalProperties:false，但 execute 返回了未声明字段——产物其实已生成却被丢弃。纯本地 bug，与后 |
| 66 | `music_generation` | 4580s | 26.4s | — | ❌ | duration=90 bpm=65 language=unknown | 本地 schema 校验失败｜Host 工具 output schema 声明了 additionalProperties:false，但 execute 返回了未声明字段——产物其实已生成却被丢弃。纯本地 bug，与后 |
| 67 | `music_generation` | 4613s | 50.8s | — | ❌ | duration=90 bpm=65 language=unknown | 本地 schema 校验失败｜Host 工具 output schema 声明了 additionalProperties:false，但 execute 返回了未声明字段——产物其实已生成却被丢弃。纯本地 bug，与后 |
| 68 | `compose_video` | 4673s | 7.5s | — | ❌ | scriptId=6a398529-335b-443e-a54a-8819 colorGrade=true | 本地 schema 校验失败｜Host 工具 output schema 声明了 additionalProperties:false，但 execute 返回了未声明字段——产物其实已生成却被丢弃。纯本地 bug，与后 |
| 69 | `compose_video` | 4685s | 7.6s | — | ❌ | — | 本地 schema 校验失败｜Host 工具 output schema 声明了 additionalProperties:false，但 execute 返回了未声明字段——产物其实已生成却被丢弃。纯本地 bug，与后 |
| 70 | `todo_write` | 4706s | 7ms | — | ✅ | — | Updated todo list: 0 pending, 1 in progress, 6 completed. |

> 完整明细见同目录 `calls.json`；甘特时间线见 `timeline.html`。
