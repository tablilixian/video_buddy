# 画布音频节点（REQ-032）后端对拍探针报告

**日期**：2026-10-08 ｜ **后端**：`117.50.108.73:8082`（无鉴权、单任务串行；开跑与收尾时 `queue_task_count: 0`，期间占用均为本探针）
**触发**：REQ-032「画布 audio 节点的设计和交互」开工前对拍 —— 演示参考
`docs/assets/library-2026-10-08/canvas-audionode-inputbox.html` 的三大功能（音色设计 / 语音生成 / 音乐生成）映射到后端两端点后，验掉 4 项开工闸门里唯一的硬卡点（闸门②：语音/音乐模型对拍）。
**结论一句话**：**两端点全通、4 项探针全过**——`refaudio` 克隆通道首次实测成功（不再「未实测」）、无效句柄 500 快失败、演示的 `字数/5` 时长估算公式与实测吻合、人声歌词音乐生成精确生效。

---

## 一、探针记录（串行，curl 直打）

| # | 动作 | 结果 | 判读 |
|---|---|---|---|
| 0 | `POST /api/v1/generate/upload`（mp3 94KB 参考音频） | **200**，`{name:"probe-tts.mp3"}` | 上传句柄正常，供探针 1 复用 |
| 1 | `POST /api/v1/generate/txt2speech` + `refaudio: "probe-tts.mp3"` | **200 / 30.9s**，产物 `voxcpm_00034.mp3`（真值 6.43s） | **克隆通道首次实测通过**——参考音色单选（演示三来源：上传/资产/画布）压的这条链可用 |
| 2 | 同上但 `refaudio: "nonexistent_file_xyz.mp3"` | **500 / 0.060s**「Internal Server Error」 | 无效句柄**快失败不排队**；与 CV-155「产物名直用 500」同型 ⇒ 客户端必须走句柄纪律（上传/画布反查），且错误文案要归一 |
| 3 | `POST txt2speech`，净字数 139（整段 153 字含标点） | **200 / 19.4s**（服务端），产物真值 **27.55s** | 时长口径关键数据，见下节 |
| 4 | `POST txt2audio`，`duration:20` + 歌词（[Verse]/[Chorus]） | **200 / 11.5s**，`yue2_00019.mp3` 真值 **20.04s** | **人声歌词路径通**；`duration` 精确生效（20 → 20.04），复证 ≤300 口径 |
| 5 | `POST txt2speech` 缺 `txt_prompt`（复证 09-30 探针 4） | **422 / 字段级** `loc:["body","txt_prompt"]` | 「音色设计」也必须有正文输入（后端没有「只出样音不给文本」的模式） |

原始响应落盘：`probe1-refaudio.json`、`probe2-refaudio-invalid.json`、`probe3-longtext.json`、`probe4-lyrics-music.json`；产物样本 `probe1-refaudio-clone.mp3` / `probe3-longtext.mp3` / `probe4-lyrics-music.mp3`。

## 二、时长估算口径：演示公式 `Math.round(净字数/5)` **实测吻合**

演示 `estSeconds()`（HTML:1330）：去空白去标点后 `n/5` 秒（音乐模式用「描述+歌词」字数）。

| 样本 | 净字数 | 演示估算 | ffprobe 真值 | 实测字/秒 |
|---|---|---|---|---|
| 探针 3（长文本） | 139 | **27.8s** | **27.55s** | 5.05 |
| 探针 1（短文本） | 24 | 4.8s | 6.43s | 3.73 |

**判读**：`n/5` 在长文本上误差 <1%（启动开销被摊薄）；短文本偏乐观 1.5s 左右（固定起音开销）。与 voiceover-writing skill 现行「每秒约 4 字」是同一族口径（skill 偏保守、留余量，演示偏贴合）。**结论：客户端估算直接照抄演示公式即可，无需后端接口**；底栏显示「估算」而非承诺值。

## 三、由探针直接决定的实现选择

| 选择 | 依据 |
|---|---|
| **三功能两后端映射成立**（音色设计+语音生成→`txt2speech`，音乐→`txt2audio`） | 探针 1/3/4 + 09-30 报告全通；VoxCPM2 名称口径已对齐，无需再验 |
| **`refaudio` 从「未实测」升为「已实测可用」** —— 演示「参考音色单选 0/1」可以转真 | 探针 1 |
| **参考音色必须过句柄纪律 + 错误归一**（上传句柄 / 画布资产反查；坏句柄 500 需转成可读文案） | 探针 2（0.06s 快失败，可先校验再提交） |
| **音色设计 ≠ 独立端点**：与语音生成共用 `txt2speech`，差异只在「正文 = 音色文案（≥3 秒）」还是「正文 = 要合成的台词」 | 探针 5（无 `txt_prompt` 即 422）+ 演示 `applyMode()` 占位文案 |
| **时长估算纯客户端**（照抄 `n/5`），不新增后端调用 | 第二节 |
| **音乐「人声歌词开关」映射 `lyrics` 有/无**（无 → 自动 `[Instrumental]`）；`duration` 精确生效 | 探针 4（CV-130 既有口径复证） |

## 四、可直接复现的命令

```bash
# 0：上传参考音频（拿句柄）
curl -s -X POST http://117.50.108.73:8082/api/v1/generate/upload -F "file=@docs/api-probe/txt2speech-20260930/probe-tts.mp3"

# 1：克隆通道（约 30s，占单任务槽位）
curl -s -X POST http://117.50.108.73:8082/api/v1/generate/txt2speech \
  -H 'content-type: application/json' \
  -d '{"instruct_prompt":"标准普通话，平静叙述","txt_prompt":"这是参考音色克隆测试，听到的声音应该与参考音频接近。","refaudio":"probe-tts.mp3"}'

# 2：坏句柄快失败（≈0.06s）
curl -s -X POST http://117.50.108.73:8082/api/v1/generate/txt2speech \
  -H 'content-type: application/json' \
  -d '{"instruct_prompt":"标准普通话","txt_prompt":"句柄校验测试。","refaudio":"nonexistent_file_xyz.mp3"}'

# 3：长文本时长样本（约 20s）
curl -s -X POST http://117.50.108.73:8082/api/v1/generate/txt2speech \
  -H 'content-type: application/json' \
  -d @docs/api-probe/audio-node-20261008/probe3-req.json   # 见 git 历史或按报告正文构造

# 4：人声歌词音乐（约 12s）
curl -s -X POST http://117.50.108.73:8082/api/v1/generate/txt2audio \
  -H 'content-type: application/json' \
  -d '{"caption_prompt":"gentle acoustic folk ballad, warm female vocal, fingerpicked guitar, intimate, 72 BPM","lyrics_prompt":"[Verse]\n月光洒在旧窗台上\n你的影子慢慢拉长\n\n[Chorus]\n我们唱着那年的歌\n直到星星都睡着","duration":20}'

# 真值探测（ffmpeg：dsh-plugin-desktop/build/ffmpeg/darwin-x64/ffmpeg）
ffmpeg -i <产物>.mp3 2>&1 | grep Duration
```

> 注：后端单任务串行，跑前看 `/api/v1/health` 的 `queue_task_count`；本探针 4 项 + 上传耗时约 2 分钟。
