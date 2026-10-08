# REQ-032 画布 audio 节点交互方案（开工方案 v1.0）

> 状态：**拍板已收口（A/B/C 三组 12 项 + D1 验收口径）· 后端对拍探针 4 项全过 · 方案待用户审核，审核前不开工**。拍板记录见 [tracking.md](../tracking.md) REQ-032 条目「拍板」段；后端证据见 [api-probe/audio-node-20261008/report.md](../api-probe/audio-node-20261008/report.md)；开工时按 STATUS §0 规则领主线号（已编到 CV-286，**顺位 CV-287**）。
> 本方案的**反遗漏核心是 §四功能点对照总表**：演示 HTML（2306 行）逐元素盘点的 F1~F24 + H1~H8 + X1~X5 全量编号，每点映射到 Step 与守卫/偏差，验收按表逐项过。

## 一、目标与范围

**目标**：在 CV-281 输入框卡基座上实现 audio 形态——对 `canvas-audionode-inputbox.html`（110KB，2306 行）做 **1:1 精准还原（布局/颜色/交互）**，三功能（语音生成 / 音色设计 / 音乐生成）映射 `tts_voiceover` / `music_generation` 两端点，功能点按 §四总表全覆盖。

**非目标（本方案不做）**：
- 商业化计费（积分=纯展示占位，标「预估」——拍板 B5）；
- 音色 subagent 打磨（拍板 A3：二期不启用）；
- 画布手势重定义（沿 CV-286 已验收口径，演示手势仅作对照）；
- 操作要点卡 / 深链 / 样例按钮 / 放大态（演示自述机制，X1~X5 排除）；
- REQ-029/031 的桌面验收返工（若涉及共享组件则修复插队，见 §八）。

## 二、事实源与还原纪律（1:1）

1. **像素级事实源**：`docs/assets/library-2026-10-08/canvas-audionode-inputbox.html`（2306 行，含 JS 状态机；无附图）。实现前逐组件对照，不凭记忆。
2. **裁决顺序**：拍板口径 > 演示 > 现状交互延续。拍板只裁「选项集合/语义/数据源」，不动「布局/颜色/交互形态」。
3. **演示 HTML 是存档件不改**；每处偏差登记 §八（沿用 CV-280/CV-281 手法）。
4. **架构性偏差先亮明（本方案最大五处）**：
   - **描述区 = contenteditable token 系统**（词条 chip 内嵌文本流，手打/退格/× 三路汇同一状态，`reconcile()` 双向同步，HTML:1230-1255）→ 产品**不建 contenteditable**：描述区改为**结构化词条 chips（可 ×）+ 自由文本 textarea 混排**（token-lite），`sel` 状态独立存 `generationPrompt`。不能沿 image/video 的「纯文本插入再反解」——`低沉` 等词**跨维重名**（音色质感×音高），文本反解有歧义，面板已选态与上限计数必须吃结构化状态。由此派生：手打文字与词条不互串（演示靠 reconcile 合并，产品靠两者并排），偏差登记。
   - **演示生成 = 1600ms 假进度动画 +「生成中 0%」**（HTML:1773-1805）→ 沿 REQ-031 拍板③**无假百分比**；产品真进度走既有 overlay 线性条。
   - **演示无真实生成**（原型 toast）→ 拍板 C2：卡直发 `/canvas-studio/generate`，**绕 `FORMAL_TOOLS`**（与 image/video 卡直发同构）；发送 = `commitAll()` → `retryStudioNode`（`retryOf` 必带）。
   - **参考音色三来源在演示里是 mock**（`AA_ASSETS`/`pkItems` 假数据）→ 产品在**客户端解析为项目 `assetFile`**，`generationPrompt.refaudio` 存 `local:` 前缀形态，发送时 Host 换新鲜 Drama 句柄（§六）。
   - **演示单节点预置**（loadSample/深链）→ 产品**首发无画布媒体手动新建入口**（`CanvasBlankMenu` 只有便签/文本/提示词）：入口 = 对话 agent 首创（pending 节点）+ 上传/产物落卡，卡做编辑+重放；空态音频节点 = 失败残留/待新增入口（建议项，§八）。

## 三、演示设计规格速览（提取自 HTML，实现对照基线）

- **色板**：与 image/video 演示同一套 tokens（`--bg:#0a0b0e`、卡片渐变、chips `#1e222a/262c35/2b323d`、弹层 `#1a1e25/2d343f`、accent `#ffb066`）；audio 特有 **`--aud:#7dd3fc`** 波形/头像色；四层语义色 = 演示自述「不新增颜色」复用三样板 token（`--lay1:vid` / `--lay2:ok` / `--lay3:aud` / `--lay4:accent`，HTML:25-30）。**`CHROME_GAP = 12`（HTML:1496）与产品 `12×z` 口径一致，零偏差**。
- **JS 状态机关键事实**（实现交互形态的依据）：
  - `FNS` 三功能 `{voice:语音生成, design:音色设计, music:音乐生成}`（:1139）；`S={fn, sel, refVoice, lyricsOn, lyrics, playing, zoom}`；`setFn` toast「节点功能 → X」、切功能关全部弹层（:1698）；
  - **数据底座**：`LAYERS` 身份/语言/声学/情境（:1074）、`LAYER_ORDER=['L1','L2','L3','L4']`（:1081，渲染/遍历/清空单一来源）、**`DIMS` 18 维**（:1083——L1 性别seg/年龄段one/音色质感 many3★/身份气质 many2；L3 音高seg/尾音seg/语速slide6/音量slide5/力度many2/清晰流畅one4/腔调seg；L4 情绪many2/语调性格many2/身体状态many2/场景many2/背景噪声seg；L2 语言 one 30 词条 + 中文方言 one 9 词条，`excl:"tongue"` 互斥）；
  - **写入/组合**：选择即写描述（`chooseWord`:1268，再点取消、many 上限 toast、seg/one 互斥、excl 清同组）；`renderCaption`（:1235）按 `LAYER_ORDER` → 层内 DIMS 声明序 → 选择序，**层内「，」、跨层「；」、自由段前导标点不补分隔**，「所见与投喂串一致」（:1248 注释）；清空层 toast「已清空「X」层」；
  - **估算/计费**：`bodyChars` = 去空白去标点净字数（:1327）；`estSeconds` = 音乐（描述+歌词）字数 / 其余正文字数 → `max(1, round(n/5))`（:1330）；`creditCost = 2 + ceil(n/20)`（0 字 = 0 分）（:1338）；tooltip「本次消耗 X 积分 · 基准 2 + 文本每 20 字 1 分」/「填写文本后计算消耗积分」；**「时长估算」唯一展示位 = 生成中 `progSub`**（:1781-1785，格式见 F4）；
  - **显隐联动**（CSS :581-588）：music 隐藏描述/正文/四 pills、显示歌曲描述/歌词；**参考音色槽仅 voice 模式**；正文占位按 fn（design=「音色文案，3秒以上」，`applyMode`:2224）；
  - **发送判据**（`btnGen.disabled`:1373）：music 需描述，voice/design 需 描述‖正文 —— **产品改探针口径**（见 F17 偏差）；
  - `REF_SRCS` 三来源（:2070：upload「mp3 / wav / m4a」/ asset「从资产库挑一个音色」/ canvas「用画布上已有的音频」）+ 弹层 hint「支持 MP3 / WAV，单个 ≤ 50MB」（:2149）；选择器 `PK_CATS=["音色"]` 单分类单选 0/1（:2076）；入库对话框 `AA_CATS=['音色','旁白','音乐','音效','其他']`（:1898，双 tab 新建/添加到已有）；
  - **底栏结构**（:959-1038）：`pf-left` = fn 菜单 ‖ 歌词 chip+开关（music）‖ 四 pills ‖ `pf-right` = 积分 chip + 生成钮 ↑；**工具栏 4 项**（:827：引用到对话 / 添加到资产库 / 预览 / 下载）；节点卡 = 空态（麦克风图标 +「设计音色，语音生成，音乐生成」）/ 波形 poster + ▶ / 字幕条 `.capstrip`（**仅产物后显示**，`body:not(.has-audio)` opacity 0，:122）/ 4 手柄 / 生成中 overlay；
  - `waveArt` 波形封面（96 条，`#7dd3fc`）用于参考音色槽/选择器/入库封面（:1914）——产品**真波形既有**（`useWaveBars`），伪波形仅作无 url 时的降级插画（沿 C3，§八）。

## 四、功能点对照总表（反遗漏核心——验收逐项过）

### A. 节点卡（audio 态）

| # | 功能点（演示出处） | Step | 守卫/偏差 |
|---|---|---|---|
| F1 | 空态：麦克风图标 + 「设计音色，语音生成，音乐生成」（:752） | 5 | 守卫：空态结构 + 文案 |
| F2 | 产物态：波形 + ▶ 试听 + 播放进度着色（:761） | — | 沿产品既有真波形/真播放（偏差：演示 7s 假动画） |
| F3 | 字幕条 `.capstrip`：`（描述）正文` / `（描述）♪ 含人声歌词`（:1360-1368），**仅产物后显示** | 5 | 守卫：拼装规则；与产品既有歌词行**合并为一行**（不双写，偏差登记） |
| F4 | 生成中 overlay：线性条 + 标题 + 副文案（`progSub` 三格式：`{功能} · {参考 X/无参考音色 · N 词条｜N 词条｜含人声歌词/纯音乐} · {est}s`，:1781） | 4/5 | **无假百分比**（拍板沿 031）；偏差：演示「生成中 0%」；产品标「约」（B4） |
| F5 | 工具栏 **4 项**：引用到对话 / 添加到资产库 / 预览 / 下载（:827；重试/改提示词退出工具栏——单击开卡为唯一编辑面） | 5 | 守卫：audio 四项；预览→AudioPlayerModal（CV-130） |
| F6 | 四角手柄 resize（:771） | — | 沿基座零改动 |

### B. 输入框卡 · 操作行与文本区

| # | 功能点 | Step | 守卫/偏差 |
|---|---|---|---|
| F7 | 操作行：**清空**（music=描述+歌词+开关 toast「已清空描述与歌词」；voice/design=词条+描述+正文 toast「已清空描述与正文」，:1853）+ **收起 ×** | 1 | 守卫：清空分支两 toast；偏差：演示 `btnZoom` 放大态 = X5 |
| F8 | 描述区：placeholder「点下方「身份 / 声学 / 情境 / 语言」按钮挑词，或直接手写描述…」（:926）；词条 chips 可 × + 自由文本混排（token-lite，§二） | 1/2 | 偏差：contenteditable → chips+textarea；守卫：chips 增删 |
| F9 | 正文/歌曲描述 textarea：占位按 fn（「要合成的正文。」/「音色文案，3秒以上」/「描述歌曲风格、情绪、演唱音色、节奏和使用场景…」）；三区显隐按 fn（CSS :581-588 1:1） | 1 | 守卫：三占位 + 显隐矩阵 |
| F10 | 参考音色槽（**仅 voice 模式**，住在描述区右上）：`+ 参考音色` ↔ 已选态（波形 art + title「参考音色：X」）；× 清除 toast「已清除参考音色」；弹层 header「参考音色 · 可选 · 不选则自由生成」+ 三来源行 + hint（:2142-2149） | 3 | 守卫：槽态/清除/显隐；偏差：design/music 隐藏但**状态保留、发送不带**（§六） |
| F11 | 三来源转真：**本地上传**（accept `audio/*` → `uploadStudioMedia`，**真通道**——拍板 B1，与 image 置灰不同）/ 选择资产 / 画布导入；单选 0/1 | 3 | 守卫：三来源各一路 |
| F12 | 候选池：资产库 = 「音色」分类含音频媒体条目；画布 = `kind==='audio'` 有 url 节点；空态文案「该分类下暂无可用音频」（:2116） | 3 | 偏差：演示模态 pk 选择器 → 产品沿 image/video 三来源内联菜单（§八） |

### C. 输入框卡 · 底栏

| # | 功能点 | Step | 守卫/偏差 |
|---|---|---|---|
| F13 | fn 菜单：图标+当前名+caret，三项下拉（当前项对勾），切换 toast + **单次整体重写 `{toolName, generationPrompt}`**（§六） | 1 | 守卫：toolName 映射 + 参数整体重写 |
| F14 | 人声歌词（music）：chip + 开关；开 → 弹层 textarea（placeholder「请输入完整歌词…未填写时将生成纯音乐。」）+ hint（「已填 N 字 · …」/「未填写时将生成纯音乐」）+ 确定；toast「歌词已保存（N 字）」/「未填写歌词，将生成纯音乐」（:2188-2217） | 1 | 守卫：开关/弹层/hint 双态 |
| F15 | 四层 pills（voice/design）：身份/语言/声学/情境，**已填态 `.has`**（无计数徽标，:1357），点开对应面板；music 隐藏整行 | 2 | 守卫：已填态 + 显隐 |
| F16 | 积分 chip：⚡ + `creditCost()`（2+ceil(n/20)），title 双态文案（:1347），**标「预估」**（拍板 B5 纯展示） | 1 | 守卫：公式与演示一致 |
| F17 | 生成钮 ↑：校验禁用 —— music 需描述；**voice/design 需正文必填**（探针 5：缺 `txt_prompt` 即 422；演示 `desc‖body` 判据为原型宽松，偏差登记）；toast「先描述一下这首歌的风格与情绪」/正文空提示 | 1 | 守卫：双分支校验 |
| F18 | 时长估算：客户端 `n/5` 标「约」（拍板 B4，探针 3 误差 <1%）——展示位 = 生成中副文案（1:1）；底栏积分 title 追加「预计约 N 秒」（产品增益，§八登记） | 1/4 | 守卫：公式纯函数 |

### D. 四层设置面板（浮于卡上方，输入框可见）

| # | 功能点 | Step | 守卫/偏差 |
|---|---|---|---|
| F19 | 面板机制：432px、贴 pill 上方 11px（越界翻转/夹取，:1538 注释）、header = 色点+层名+**清空**+×、滚动区 ≤62vh、Esc/点外关 | 2 | 守卫：结构与关闭语义 |
| F20 | **L1 身份**：性别 seg3 / 年龄段 one8 / 音色质感 many **max3 + ★**（title「最常漏写的一维」）/ 身份气质 many max2 | 2 | 守卫：与演示 DIMS 逐条比对 |
| F21 | **L2 语言**：语言 one（官方 30 词条）+ 中文方言 one（9 词条），`excl:"tongue"` 互斥 | 2 | 守卫：互斥组 |
| F22 | **L3 声学**：音高 seg5 / 尾音处理 seg3 / 语速 slide 6 档 / 音量 slide 5 档 / 力度 many2 / 清晰流畅 one4 / 腔调 seg3 | 2 | 守卫：slide 档位与 ticks |
| F23 | **L4 情境**：情绪/语调性格/身体状态/场景 各 many max2 + 背景噪声 seg3 | 2 | 守卫：DIMS 逐条 |
| F24 | 选择行为：one 再点取消、seg 替换、many 上限 toast「「X」最多选 N 个 —— 再多关键词之间会互相干扰」+ 满额禁用 title「已达上限 N 个，先取消一个」+ 计数「已选 X / N」；slide 默认中档显示「未设定」、拖动即写词永不写数字；清空层 toast；**词条写入描述的分隔符规则**（层内「，」跨层「；」自由段前导标点不补）+ chips × 删除 | 2 | 守卫：上限/互斥/分隔符单测 |

### E. Host 侧

| # | 功能点 | Step | 守卫/偏差 |
|---|---|---|---|
| H1 | 三功能两后端（拍板 A1）：voice/design → `tts_voiceover`（`txt2speech`）、music → `music_generation`（`txt2audio`）；**音色设计无独立端点**（探针 5），差异仅正文语义 | 1/4 | 既有链路（`generateSpeech`/`generateMusic`）回归 |
| H2 | `composeSpeechInstruct(sel, free)` 纯函数 → `instruct_prompt`；正文 → `txt_prompt`；音乐 → `caption_prompt`/`lyrics_prompt`（拍板 A2 主体；「交给 agent 打磨」= 复用既有「引用到对话」，无新钮） | 1/4 | 守卫：与描述区显示同一拼装（所见即所投） |
| H3 | **参考音色 `local:` 约定**（§六）：卡直发存 `local:<assetFile>`，`generateSpeech` 遇前缀 → `promoteAssetFile` 换 Drama 新鲜句柄；非前缀原样透传（agent 路径零改动） | 3/4 | 守卫：剥前缀+promote 单测；**陈旧句柄 500 → 中文归一**（探针 2：0.06s 快失败） |
| H4 | 音乐 `duration` 写入（**新决策 D-MusicDur：= estSeconds**，探针 4 证实精确生效 20→20.04；不传则默认 30s 与估算显示冲突） | 3/4 | 守卫：估算→duration；待审核点头 |
| H5 | 歌词映射：开关开+非空 → `lyrics_prompt`；否则不传（Host 自动 `[Instrumental]`，CV-130 既有） | 1/4 | 既有测试回归 |
| H6 | **参数蛇形规范化**（CS-PARAM-001 防）：卡读 snake 优先、camel 兜底（pending 残留 `text`/`instructPrompt`，`setPendingNode`:1533 落的是 `info.arguments`）；**发送一律整体重写蛇形**；fn 切换同步重写（不遗留异键） | 1/4 | 守卫：camel 兜底 + 整体重写 |
| H7 | 估算/积分纯函数（`n/5`、`2+ceil(n/20)`）——**不新增后端调用**（探针报告 §二结论） | 1 | 守卫：公式单测 |
| H8 | 重放链路零改造：`REPLAYABLE_TOOLS` 已含两工具、`STUDIO_TOOL_KINDS` 已登记、`replayDetachedAsset` 分支既有；仅补 `TOOL_TITLES['music_generation']='生成音乐中…'`（`CanvasNode.tsx:22` 现缺） | 4 | 既有测试回归 + 标题守卫 |

### F. 排除项（演示里存在但不是产品功能）

| # | 项 | 处置 |
|---|---|---|
| X1 | 操作要点卡 guide（:787 三列自述） | 演示文档自述，排除 |
| X2 | 深链 `#sample/#l1~#l4/#zoom/#music/#design`（:2287） | 演示文档机制，排除 |
| X3 | `loadSample` 完整样例（:2265） | 演示启动态，排除 |
| X4 | `zoomctl`（−/100%/+）与 `btnZoom` 放大态 | 沿 CV-283「砍放大态」同款排除 |
| X5 | 1600ms 假进度动画 +「生成中 0%」 | 拍板沿 031 ③：真进度、无假数字 |

## 五、拍板口径落图（A/B/C 三组 12 项 → 组件）

| 拍板 | 落点 |
|---|---|
| A1 三功能两后端（音色设计差异=正文语义，占位「音色文案，3秒以上」） | F13/H1/F9 |
| A2 参数→提示词 = `composeSpeechInstruct()` 纯函数为主 + 可选「引用到对话」打磨 | H2/F24/F8 |
| A3 不启用 subagent（二期） | §一非目标 |
| B1 参考音色三来源全做（上传/资产/画布，单选 0/1；**本地上传转真**） | F10/F11/F12 |
| B2 音色文案直接合成即样音（无独立试听钮） | F10（样音 = 发送产物，§一） |
| B3 人声歌词开关 + 歌词弹层（不填=纯音乐） | F14/H5 |
| B4 时长估算客户端 `n/5` 标「约」 | F18/H7/F4 |
| B5 积分纯展示占位 `2+ceil(n/20)` | F16 |
| B6 同组件第三形态 `InputCardForm` 加 `'audio'` | §六 |
| C1 资产库加「音色」第五分类（**动 REQ-023 范围**，tracking 联动注记） | F5/F12/Step 5 |
| C2 卡直发 `/generate` 绕 `FORMAL_TOOLS`（与 image/video 同构） | §六/H6 |
| D1 克隆听感留验收人工 A/B（样本 `probe1-refaudio-clone.mp3` vs `probe-tts.mp3` 已存仓） | §九.3 |

## 六、组件设计：`NodeInputCard` 第三形态 + 参数规范

- **形态注入**：`InputCardForm` → `'image' | 'video' | 'audio'`（`NodeInputCard.tsx:16`），`CanvasSurface.tsx:1405` 判定加 `kind === 'audio'`。image/video 路径零改动。
- **卡状态七元组** `{fn, sel, free, body, lyrics, lyricsOn, ref}`：**写通落盘**（每次变更即时 `onUpdateNode(generationPrompt)`——区别 image/video 的草稿-发送二段；理由：词条结构化状态非文本、须跨开关/重开存活；「发送=commitAll+replay」红线与 `canvas-input-card-req029` 守卫不变）。
- **参数键形（蛇形为规范）**：
  - tts：`{txt_prompt, instruct_prompt, refaudio?, voice_sel?, voice_free?, fn}`（`voice_sel` = 结构化词条 JSON，host 忽略；`fn` 区分 voice/design 子形态，host 忽略）；
  - music：`{caption_prompt, lyrics_prompt?, duration, fn}`；
  - 额外键经 `parseGenerationParams` 无害透传，`DetachedReplayParams` 白名单只读己键。
- **fn 切换 = 单次原子重写**：`onUpdateNode(id, {toolName, generationPrompt})` 整体换新（voice/design→`tts_voiceover`、music→`music_generation`），不合并旧键（防异工具键残留 CS-PARAM-001）；`onUpdateNode` 的 Partial 能力既有（`NodeInputCard.tsx:37`）。
- **发送**：`canSend`（`NodeInputCard.tsx:615`，先 `commitAll()` 再 `onRetry`——req029 守卫逐字钉住）+ audio 分支校验（F17）→ `retryStudioNode`（`api.ts:747`，恒带 `retryOf`）→ `generateAsset` 分流 `replayDetachedAsset` 既有。
- **描述区 token-lite**：flex 容器 = 词条 chips（state 驱动、× 删）+ 自由 textarea（Enter 语义沿基座）；`composeSpeechInstruct` 把 `sel` 按 `LAYER_ORDER`/层内声明序/选择序拼接（分隔符照 `renderCaption`），**显示与 `instruct_prompt` 同一函数**。
- **参考音色解析（本轮定案）**：三来源统一归一为项目 `assetFile`——上传 `uploadStudioMedia`（`api.ts:494`，返 `{url, assetFile}`，不建节点）、资产库 `fetch(libraryMediaUrl)` → 再走 `uploadStudioMedia`（v1 自包含，不扩 host 签名）、画布 `node.url` basename；`refaudio = 'local:<assetFile>'`；发送时 host 剥前缀 → `promoteAssetFile`（`generate.ts:923`）现换 Drama 句柄（每次发送现换，避开句柄时效）。备选 `lib:<id>` 直传需给 `generateAsset` 扩 library 入参（`routes.ts`/`host-tools.ts` 均可达）——**登记二期**。design/music 隐藏槽但状态保留，**发送仅 voice 模式携带 refaudio**（与显示语义一致）。
- **词库模块**：新 `src/voice-dims.ts`（纯函数 + 静态数据，仿 `camera-moves.ts` 先例）= `LAYERS`/`LAYER_ORDER`/`DIMS` 18 维逐条转录 + `composeSpeechInstruct` + `estSecondsOf` + `creditCostOf`；client 引用按 AGENTS 追加 `tsconfig.client.json` include。
- **新决策（待审核点头）**：
  - **D-MusicDur**：music 发送 `duration = estSeconds()`（估算变承诺，展示仍标「约」）；否则默认 30s 与 n/5 估算显示互相打架。
  - **D-入口**：首发走对话 agent 创音频节点（与 image/video 同构），卡做编辑+重放；不在 `CanvasBlankMenu` 加手动新建（若要加，另拍板）。

## 七、分步实施（每步独立可验收，`yarn check` 全绿后提交）

| Step | 内容 | 主要改动 | 新增守卫 |
|---|---|---|---|
| 1 | **形态骨架 + 三功能 + 文本区**：`form:'audio'` 注入与显隐矩阵（CSS :581-588 1:1）；fn 菜单切换（原子重写 toolName+参数）；描述/正文/歌词三区（占位按 fn、歌词弹层+开关+hint）；底栏（fn chip/四 pill 占位/积分 chip 公式/发送）；canSend 双分支校验；`src/voice-dims.ts` 数据底座 + 三纯函数；camel 读取兜底 | `NodeInputCard.tsx` + `CanvasSurface.tsx` + 新 `src/voice-dims.ts` + `styles.ts` | 词库 18 维逐条比对演示 / 显隐矩阵与三占位 / 校验双分支 / 公式（约 6 条，新 `voice-dims-req032` + 扩 `canvas-input-card-req029`） |
| 2 | **四层设置面板 + 词条写入**：面板机制（432px/pill 上 11px/清空/×）；18 维四控件（seg/grid/slide/star/计数/满额禁用）；互斥组；选择写入描述（chips + 分隔符规则 + × 删）；pills 已填态 | 新 `VoiceLayerPop.tsx`（四层同组件）+ `NodeInputCard.tsx` 接线 | 面板结构 / 上限 toast / 互斥 / 分隔符单测（约 5 条，新 `canvas-audio-panel-req032`） |
| 3 | **参考音色 + 歌词音乐参数**：ref-slot UI（槽态/×/弹层 hint）；三来源转真（上传/资产/画布 → `local:`）；候选池过滤与空态；est/credit 上屏（积分 title 附预计时长）；music `duration=estSeconds`（D-MusicDur）；发送仅 voice 带 refaudio | `NodeInputCard.tsx` + `api.ts`（若需候选 helper）+ `styles.ts` | `local:` 归一单测 / 三来源各一路 / 单选 0/1（约 5 条，`canvas-audio-card-req032`） |
| 4 | **host 转真**：`generateSpeech` 遇 `local:` → `promoteAssetFile` + 陈旧句柄 500 错误归一；`generateMusic` duration 接线确认；`TOOL_TITLES['music_generation']`；progSub 三格式副文案（读 generationPrompt，缺参回退）；参数蛇形规范化确认（fn 切换/发送两写点） | `src/generate.ts` + `CanvasNode.tsx` + `src/node-params.ts`（注释级） | promote 剥前缀单测 / 错误归一 / 副文案拼装 / 标题（约 5 条，新 `audio-replay-req032` + 扩 `canvas-video-node-req031`） |
| 5 | **节点卡 + 工具栏 + 入库收口**：空态（F1）；字幕行（F3，与既有歌词行合并）；进度副文案（F4）；工具栏 audio 四项（F5：引用/入库/预览/下载，重试/改提示词退出）；`LibImportDialog` + `LIB_CATEGORIES` 加「音色」（C1，`contracts/asset-library.ts`）+ audio 降级占位确认（`collectNodeMediaSources` 已放行 audio，仅拒 video）；演示对照走查 + 文档登记 | `CanvasNode.tsx` + `NodeActionBar.tsx` + `StudioFrame.tsx` + `AssetLibrary.tsx` + `contracts/asset-library.ts` | 空态/字幕行/四工具栏/第五分类（约 5 条，新 `canvas-audio-node-req032`） |

每步收尾：`corepack yarn check`（typecheck + build + verify:loader + test:smoke）全绿后提交；Step 2/3/5 各出截图对照演示稿供桌面验收。

## 八、风险与偏差登记

| 项 | 说明 | 处置 |
|---|---|---|
| 描述区架构偏差 | 演示 contenteditable token（reconcile 双向同步）vs 产品 chips+textarea | §二亮明；「所见即所投」靠同一 compose 函数；手打/词条不互串登记偏差 |
| 发送判据 | 演示 `desc‖body`（原型宽松）vs 后端缺正文 422（探针 5） | 产品 **body 必填**（F17 偏差登记），toast 引导 |
| 首发入口 | 演示单节点预置；产品无画布媒体手动新建入口 | 首发 = 对话 agent 首创 + 失败/pending 残留可编辑；**建议项待拍板**（D-入口） |
| pending camel 键形 | `setPendingNode` 落 `info.arguments`（camel），重载才变蛇形 | 卡读 snake 优先 camel 兜底、发送整体重写（H6）；守卫钉住 |
| refaudio 句柄时效 | 探针 2：坏句柄 500 快失败（CV-155 同型） | 发送现 promote + 错误归一「参考音色失效，请重新选择」 |
| 上传孤儿文件 | 上传参考音色未发送前可能被 asset-gc 回收 | 发送时 ENOENT → 清 refaudio + 提示重选（兜底，不建隐藏节点） |
| 陈旧 `lib:` 直传 | 二期方案需扩 `generateAsset` 签名 | v1 走下载重传（自包含），登记二期 |
| C1 动 REQ-023 范围 | 「音色」第五分类先于 REQ-023 落库 | tracking REQ-023 联动注记（分类底座由本需求先落） |
| D-MusicDur 估算变承诺 | `duration=est` 由后端精确执行 | 新决策待审核点头；展示仍标「约」 |
| 时长估算展示位 | 演示只在 progSub | 底栏积分 title 附「预计约 N 秒」= 产品增益，登记 |
| 字幕行双写 | 演示 capstrip vs 产品既有歌词行 | 合并为一行（F3），不双写 |
| 波形 | 演示 96 条伪波形 + 假播放 | 产品真波形/真播放（C3 沿既有；伪波形仅无 url 降级插画） |
| 假进度 | 演示 1600ms 0%→100% | 拍板沿 031 ③（X5） |
| 选择器形态 | 演示模态 pk「选择参考音色」 | 产品沿 image/video 三来源内联菜单（F12 偏差登记，产品一致性优先） |
| TOOL_TITLES 缺项 | `music_generation` 不在表 | Step 4 补（现显示兜底「生成中…」） |
| 入库对话框 | 演示双 tab + 封面/名称/分类五分类 | 产品复用 `LibImportDialog`（分类/名称/别名/描述，无封面字段——画布入库媒体即封面）；分类只加「音色」（旁白/音乐/音效/其他不加，登记） |
| REQ-029/031 验收未过即开工 | 同组件共享风险 | 顺序纪律：同 §七每步 check；返工插队修复再继续 |
| 上游宿主约束 | 无（画布内纯插件面） | 低风险 |

## 九、验收出口

1. **按 §四总表逐项过**（F1~F24 + H1~H8 + X1~X5）：逐组件截图对照演示 HTML，布局/颜色/交互三清单；
2. 三功能各一次生成成功：语音生成（带参考音色克隆一例）/ 音色设计 / 音乐（含歌词 + 纯音乐各一例），产物落节点、波形试听、字幕行与参数角读数正确；
3. **D1 听感 A/B**：卡直发克隆产物 vs 探针样本 `probe1-refaudio-clone.mp3`（有参考）与 `probe-tts.mp3`（无参考）人工并排评，决定克隆语义验收是否过关；
4. 参数规范化走查：fn 双向切换后 `generationPrompt` 蛇形可重放、无异工具键；pending 残留（camel）节点开卡可直接发送成功；
5. 参考音色三来源各一路 + 资产库入库「音色」分类落库 + 字幕行/空态/工具栏四项对照演示；
6. 词库 18 维与演示逐条一致（守卫）+ compose 分隔符单测 + 公式单测；
7. 手势全项零回归（CV-044/186/185/223 + CV-286 新口径）；`yarn check` 全绿（含新增守卫）；tracking/STATUS 登记。
