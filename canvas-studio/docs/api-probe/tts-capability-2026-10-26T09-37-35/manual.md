# Canvas Studio TTS 能力手册（`tts_voiceover`）

> 全部结论来自**实测**：后端契约读 `GET /openapi.json`，声音属性由 `ffprobe` + 本机解码实测。
> 取证脚本：`canvas-studio/scripts/probe-tts-capability.mjs`；本轮数据：同目录 `report.md` / `raw.json` / `*.mp3`。
> 代码位置：工具定义 `src/host-tools.ts:2717`、生产函数 `src/generate.ts:3465`、后处理 `src/speech-post.ts`、
> 客户端音色卡 `src/client/canvas/NodeInputCard.tsx` + `VoiceLayerPop.tsx` + `src/voice-dims.ts`。

---

## 0. 一句话结论

**一个工具、三个后端字段（`txt_prompt` / `instruct_prompt` / `refaudio`）+ 两个宿主侧参数（`speed` / `pitchSemitones`）**，
能在 30 种语言 / 9 种中文方言下用**自然语言**设计声音、用**参考音**锁定音色、用 **ffmpeg** 精确控速与变调；
但**没有时长参数、没有 SSML/停顿标记、没有字级时间戳、没有多说话人、没有 voiceId 预设库**。

因此三条铁律：

1. **要精确时长** → 只认 `speed`，或「先合成 → ffprobe 量真值 → 再排帧」；不要按「4 字/秒」硬算。
2. **要音色一致** → 每一段都传**同一个 `refaudio`**；只复用 `instruct_prompt` 不足以保证（实测同一串词三次的基频可差 45%）。
3. **要角色开口（有口型）** → 不用 TTS，写 `<d>[语言]原话</d>` 交给 H3（REQ-017 反判据）。

---

## 1. 三个调用面（先确认你在哪一层）

| 调用面 | 入口 | 适合 |
|---|---|---|
| Agent 工具 | `tts_voiceover`（`src/host-tools.ts:2717`） | 会话里生成旁白/画外音，自动落音频节点 + 血缘 + 真值时长 |
| 画布音频卡 | 双击画布空白 → 音频卡，底栏 `fn` 切「语音生成 / 音色设计 / 音乐生成」 | 人手动调音色（18 维四层面板 + 参考音槽 + 预计时长/积分） |
| 直打后端 | `POST /api/v1/generate/txt2speech` | 探针/批处理；**绕过落卡、血缘、真值时长与 `local:` 句柄换新** |

> `voice` 与 `design` 两个 fn **共用同一个后端工具**（`voice-dims.ts:51` `audioFnToolName`）；差别在 UI 语义与是否携带 `refaudio`（仅 `voice` 发送）。

---

## 2. 参数全表

### 2.1 后端契约（唯一事实源，`TTSRequest`）

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `txt_prompt` | ✅ | — | 要念的文本（缺了直接 422，字段级快失败） |
| `instruct_prompt` | ❌ | `""` | 声音设计：**自然语言**（语言/性别/年龄/语气/情感/语速/方言） |
| `refaudio` | ❌ | `""` | 参考音频句柄（上传后的 filename）→ 克隆音色 |

**就这三个。** 没有 `speed`、没有 `voiceId`、没有 `duration`、没有 `format`、没有 SSML。

### 2.2 工具层（比后端多出来的东西）

| 参数 | 实现层 | 取值 | 要点 |
|---|---|---|---|
| `text` | 后端 `txt_prompt` | 不限（建议 ≤120 字/次） | 逐字念；括号、emoji、舞台指令都不可靠 |
| `instructPrompt` | 后端 `instruct_prompt` | 自然语言短句 | 见 §4 |
| `refaudio` | 后端 `refaudio` | 上传句柄 / `@ref[显示名]` / `lib:<id>` | 卡上三来源统一归一成 `local:<assetFile>`，发送时现换新鲜句柄 |
| `speed` | **宿主 ffmpeg** `atempo` | 0.5–2.0 | 变速**不变调**；越界夹取 + `warnings` |
| `pitchSemitones` | **宿主 ffmpeg** `asetrate` | -12 ~ +12 | 变调**不变速**；负数更低沉；只动基频，不动「沙哑/气声」 |
| `replaces` | 宿主重写节点 | 旧音频节点 id | 改词重配**原地重写**，不堆新卡 |
| `sourceUrls` / `sourceNodeIds` | 宿主血缘 | 画布 URL / 节点 id | 画血缘箭头 |

产物：**mp3 / 48kHz / 单声道**，节点 `duration` 是 ffprobe 真值（**响应里的 `duration` 不是音频时长**，本轮实测最远差 0.69×）。

---

## 3. 能力矩阵：能做什么 / 做不到什么

### ✅ 能

| 能力 | 证据 |
|---|---|
| **30 种语言**（阿拉伯/缅甸/中/丹麦/荷兰/英/芬兰/法/德/希腊/希伯来/印地/印尼/意/日/高棉/韩/老挝/马来/挪威/波兰/葡/俄/西/斯瓦希里/瑞典/他加禄/泰/土耳其/越南） | 后端 schema 自述 + 实测 en/ja 均 200 |
| **9 种中文方言**（四川/粤/吴/东北/河南/陕西/山东/天津/闽南） | 实测四川话、粤语 200 且基频/字速分布合理 |
| **自然语言音色设计**（性别/年龄/质感/腔调/情绪/身体状态/场景/噪声…） | 18 维四层面板 + 实测 6 种人设 F0 跨 91–281Hz |
| **参考音克隆**（`refaudio`） | 三轮独立运行：带 refaudio 的基频**每轮都贴住当轮参考**（差 0–9Hz），基线乱跳（差 5–62Hz） |
| **确定性变速**（`speed`） | `0.9 → 时长 ×1.109`、`1.15 → ×0.876`（理论 `1/speed` = 1.111 / 0.870） |
| **确定性变调**（`pitchSemitones`） | `-3 → F0 ×0.85~0.91`、`+3 → ×1.07~1.17`（理论 0.841 / 1.189，估计噪声 ±10%） |
| **原地重配**（`replaces`） | 保留节点位置与血缘，只换音频与文本 |
| **真值时长** | 落盘后 ffprobe，不伪造（探测失败省略字段） |
| **精确排帧** | 见 §6：`render_composition` 的 `voiceOver[].startFrame` |

### ❌ 不能

| 做不到 | 替代方案 |
|---|---|
| 指定时长（「正好 8 秒」） | 先合成 → 量真值 → 用 `speed` 微调（或增删文本） |
| SSML / 停顿标记 / 重音标记 | 正文写「（停顿两秒）」**实测无效**（多 4 个字，时长反而更短）；停顿只能靠标点、换行，或后期 `cut_audio` 拼 |
| 字级 / 句级时间戳 | 无。字幕只能按字数占比派生（`skills/code-driven-explainer/references/subtitle-timing.md`），或引入 forced alignment |
| 一次合成多个说话人 | 一段一个音色，多角色 = 多次合成 + 排帧 |
| `voiceId` 预设音色库 | 只能「参考音克隆」或「自然语言描述」，没有稳定 ID |
| 音色可复现（同 instruct 同声音） | **实测不可复现**：同一串词连发 3 次，时长极差 8.2%、基频极差 45.1% |

---

## 4. 音色怎么写（这是能不能用好 TTS 的分水岭）

### 4.1 客户端 18 维四层（`src/voice-dims.ts`，UI 直出）

| 层 | 维度 | 形态 |
|---|---|---|
| **L1 身份** | 性别（男/女/中性）、年龄段（少年→苍老）、音色质感（多选 ≤3，`star` 最常漏写：低沉/浑厚/磁性/沙哑/气声/明亮/鼻音/胸腔共鸣/金属感/颗粒感）、身份气质（多选 ≤2：纪录片旁白/新闻主播/相声/有声书/深夜电台/将领/学者） | seg / grid |
| **L3 声学** | 音高、尾音处理（上扬/平收/下沉）、语速（6 档滑杆）、音量（5 档滑杆）、力度（≤2）、清晰流畅（单选）、腔调（标准普通话/播音腔/戏剧腔） | slide / grid / seg |
| **L4 情境** | 情绪（≤2：温柔/平和/热情/雀跃/沉郁/哀伤/愤怒/威严/无奈倦怠/若有所思/笃定克制）、语调性格（≤2：抑扬顿挫/不容置疑/情感外露/自信果决/知性温柔）、身体状态（≤2：强忍悲痛/颤抖中保持平静/带着笑意/哭腔/哽咽停顿）、场景（≤2：深夜电台/昏暗录音室/雨夜/壁炉旁/舞台上）、背景噪声（无/室内混响/户外） | grid / seg |
| **L2 语言** | 语言（30 选 1）、中文方言（9 选 1）—— 两者**互斥**（`excl:'tongue'`），一次合成只可能是其中一种 | grid |

拼接规则（`composeSpeechInstruct`，与原型演示稿逐行对齐）：**层间用「；」，层内用「，」**，自由文本永远垫底。

### 4.2 直接写给 Agent 的七维写法

一句话写完，逗号分隔，不要写成参数表：

```
30岁女性，温柔坚定，普通话，中速
60岁女人笑着说，慢速，四川话
青年男性，平静低沉，标准普通话，中速
Elderly man, warm and slow, standard English
```

**写全才稳**：没提的维度由模型自由发挥（这也是「同一句两次不同声」的成因之一）。

### 4.3 参考音（唯一能把音色钉住的手段）

- 传**上传句柄**（`upload_image` 返回的 filename）、`@ref[音频节点标题]`（Host 现换新鲜句柄），或 `lib:<id>`（资产库）。
- 有参考音后，`instruct_prompt` 只用来控**语气/语速**；性别/年龄以参考音为准。
- 卡上三来源（本地上传 / 资产库 / 画布节点）在客户端统一归一成 `local:<assetFile>`，避免句柄过期（`generate.ts:3442` `isLocalRefaudio`）。
- 失效句柄会 500，Host 归一成中文「参考音色失效，请重新选择」（`normalizeRefaudioError`）。

**多段旁白的正确姿势（C-5）**：先定一次音色 → **每段都传同一个 refaudio**。没有参考音时才退化成「逐字复用第一段的 instruct_prompt」，且要接受音色可能漂移。

---

## 5. 精确时间间隔：三条路 + 一条铁律

### 5.1 铁律：先量后算

> 旁白时长**不可预测**（同输入极差 8%，长文还可能非线性），
> 所以任何排帧都必须**先用 ffprobe 量真值**，再折算帧号。
> 用「4 字/秒」直接算只是**排期估算**（实测 2.99–4.77 字/秒，跨度 60%）。

### 5.2 三条进片路径

| 路径 | 时间精度 | 适用 | 限制 |
|---|---|---|---|
| `compose_video` 的 `bgmNodeId` | **0**（从 0 开始、铺到结束） | 一段旁白配一条片子 | 只有一条轨；旁白自动识别为「旁白角色」（满音量、无淡入淡出、允许短于成片） |
| `render_composition` 的 `audio.voiceOver[]` | **帧级**（`startFrame`） | 多句旁白各落各的时间点 | `voiceOverUrl`（单句）与 `voiceOver` 数组**互斥**；`src` 必须同源 |
| `video_generate` / `video_composite` 的 `audioRefs` | 参考音，不定位置 | 让 H3 用这段声音说话 | ≤3 段、单段 2–15s、合计 ≤15s、**不能作唯一输入**；非口型驱动 |

### 5.3 帧级写法（`render_composition`）

```jsonc
{
  "meta": { "fps": 30, "durationInFrames": 900, "width": 1280, "height": 720, "title": "…" },
  "audio": {
    "bgmUrl": "/canvas-studio/assets/<project>/bgm.mp3",
    "voiceOver": [
      { "src": "/canvas-studio/assets/<project>/vo-1.mp3", "startFrame": 78 },   // 2.60s
      { "src": "/canvas-studio/assets/<project>/vo-2.mp3", "startFrame": 212, "volume": 0.9 }, // 7.07s
      { "src": "/canvas-studio/assets/<project>/vo-3.mp3", "startFrame": 357 }   // 11.90s
    ],
    "mix": { "bgmVolume": 0.35, "voiceVolume": 1 },
    "duck": { "amount": 0.5 },        // BGM 依字幕窗口自动闪避（不做音频分析）
    "fadeInSeconds": 0.5, "fadeOutSeconds": 1.5
  },
  "tracks": [ /* … */ ]
}
```

换算：`startFrame = round(秒 × fps)`。fps 取 `meta.fps`（校验层只要求有限正数；`scaffold_manifest` 脚手架只给 24 / 25 / 30 / 60 四档，缺省 30）；
顺序排布用 `startAfter: { trackId, gapFrames }`（`gapFrames` 负数 = 重叠，转场用），与 `startFrame` 互斥。

### 5.4 字幕与旁白对齐（句级，无字级）

1. 取旁白**真值时长 T**（工具结果里的 `duration`）。
2. 按**字数占比**分配每句：`句时长 = 字数 ÷ 总字数 × T`。
3. 句间留呼吸 0.15s，**从相邻句时长内扣**（不拉长总长）。
4. 折算帧：`startFrame = round(累计秒 × fps)`；**末句强对齐** `round(T × fps)` 吸收舍入。
5. 字幕卡**首尾相接**（`卡i.duration = 卡(i+1).startFrame - 卡i.startFrame`），且**不做淡入淡出** —— 否则接缝处两块同时透明、闪背景（2026-10-16 实测）。

误差预期：总长精确，句边界 ±0.3s/句。**逐字高亮在拿到字级时间戳或做 forced alignment 之前不要碰。**

---

## 6. 混音与音量（成片侧）

| 行为 | 取值 | 代码 |
|---|---|---|
| 旁白满音量 | `VOICE_VOLUME = 1` | `src/compose.ts` |
| BGM 铺底 | `BGM_MIX_VOLUME / BGM_VOLUME` | 同上 |
| 旁白角色识别 | `toolName === 'tts_voiceover'`，或标题含「旁白/配音/口播/念白/narration/voiceover」 | `resolveAudioMixRole` |
| 旁白短于成片 | 只提示（>0.5s 才提示），不报错 | `VOICE_SHORTFALL_NOTE_SEC` |
| BGM 短于成片 | **硬失败**（不产出残次片） | `compose.ts` |
| 音轨构成角标 | 8 值：`native` / `+bgm` / `+voiceOver` / `bgm` / `voiceOver` / `none` … | `host-tools.ts:110` |

⚠️ **`cut_audio` 裁过的旁白仍然是旁白**（按来源链判定）；把 BGM 传进旁白位才会「铺满全片」。

---

## 7. 本轮实测数据（可复现）

三轮独立运行，关键值：

| 项 | 第 1 轮 | 第 2 轮 | 第 3 轮（报告数据） |
|---|---|---|---|
| 契约字段 | `instruct_prompt` / `txt_prompt` / `refaudio` | 同 | 同 |
| 慢 / 中 / 快速（同文案） | 5.95 / 5.64 / 5.47s | 4.99 / 5.16 / 5.16s | 7.70 / 4.82 / 5.16s |
| 同 instruct 连发 3 次的 F0 | — | — | 115 / 184 / 160Hz（极差 45.1%） |
| 同 instruct 连发 3 次的时长 | — | — | 5.64 / 6.12 / 5.78s（极差 8.2%） |
| 克隆：带 ref / 基线 vs 当轮参考 | 106 / 157（参考 108） | 182 / 129（参考 191） | 152 / 147（参考 152） |
| `speed 0.9` 时长比 | ×1.111 | ×1.107 | ×1.109 |
| `speed 1.15` 时长比 | ×0.868 | ×0.870 | ×0.876 |
| 长文线性度 | 4.55 字/秒 | 4.31 字/秒 | 4.14 字/秒（89 字） |

读法：

- **语速词**方向对但幅度不稳（−3% ~ +60%），不能当刻度。
- **音色**：`instruct_prompt` 是「描述」不是「配方」，跨次不可复现；`refaudio` 每次都能把音高拉回当轮参考 —— 克隆是真克隆，不是巧合。
- **`speed` / `pitchSemitones`** 是唯一可刻度的旋钮，且是**本地 ffmpeg**（不额外烧后端额度、不占单任务槽位）。
- **生成耗时**受后端排队影响（同一端点见过 4s–33s），不作为任何判断依据。

---

## 8. 最佳实践清单

1. **先加载 `voiceover-writing` 技能**再写配音（七维 + 语言方言清单 + 示例库）。
2. 声音设计**七维写全**，别留空让模型自由发挥。
3. 长旁白**拆段**（每次 ≤120 字），每段**同一个 refaudio**。
4. **先合成、再量真值、后排帧**；`startFrame = round(秒 × fps)`。
5. 只要一段旁白铺全片 → `compose_video` + `bgmNodeId`；多句定点 → `render_composition` + `voiceOver[]`。
6. 想「正好 8 秒」→ 先合成（约 4.5 字/秒），再按 `speed = 实测 ÷ 目标` 微调，**别反复重写 instruct**。
7. 「更苍老一点」→ `pitchSemitones: -3`（只压基频）；「更沙哑」→ 只能写进 `instruct_prompt`（音色非基频）。
8. 改词重配用 `replaces=<旧节点 id>`，不要堆新卡。
9. 正文里**不要**写「（停顿两秒）」「[叹气]」——实测无效。
10. 数字有歧义写汉字（「三点五亿」）。
11. 角色对白要口型 → `<d>[普通话]原话</d>` 进视频提示词，**不要**用 TTS。
12. `warnings` 非空必须如实转告（后处理被夹取/ ffmpeg 不可用），别说「已按 0.8 倍速」却没生效。

---

## 9. 已知缺口 & 建议（按投入产出排序）

| 优先级 | 缺口 | 建议 |
|---|---|---|
| P1 | 多段旁白要「同一个声音」目前靠人工纪律 | 做一个**项目级音色槽**：首次定音后把产物存成 `lib:<id>`，后续每段自动带上（`refaudio` 已支持 `lib:`，只差 UI/工具层的一行默认） |
| P1 | 排帧靠人肉算「秒 × fps」 | 脚本化两步：TTS 批量出段 → 读真值 → 生成 `voiceOver[]` + 字幕卡（`subtitle-timing.md` 的口径已经写死，可直接实现） |
| P2 | 无字级时间戳 | 引入 forced alignment（本地转写对齐），否则逐字高亮会与音频脱节 |
| P2 | `speed > 2` 或 `< 0.5` 无处可去 | 两级 `atempo` 串联（0.5×0.5 = 0.25），成本很低 |
| P3 | 语速词与 `speed` 叠加会双重生效 | 文档已提醒「别描述同一件事」，可在卡上做互斥提示 |
| P3 | `docs/STATUS.md:212` 仍写「TTS 配音占位降级」 | 文档漂移（实际 CV-271 已转正），下次登记时一并修正 |

---

## 10. 复跑自己的验证

```bash
cd canvas-studio
node scripts/probe-tts-capability.mjs                    # 全跑，约 2 分钟（16 次合成，串行）
node scripts/probe-tts-capability.mjs --skip-clone       # 跳过克隆段
node scripts/probe-tts-capability.mjs --local-only       # 只跑 ffmpeg 后处理段（零后端成本）
node scripts/probe-tts-capability.mjs --report-only \
  --out docs/api-probe/tts-capability-<ts>               # 只按 raw.json 重出报告
DRAMA_API_BASE=http://<host>:<port> node scripts/probe-tts-capability.mjs
```

产物：`report.md`（结论表）+ `raw.json`（原始响应/时长/F0）+ 逐条 `*.mp3`（可直接听）。
