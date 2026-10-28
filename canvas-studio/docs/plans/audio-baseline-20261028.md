# 音频基线取证（CV-040 · 2026-10-28）

> **角色**：audio-timeline-plan-20261028.md **S0 的产出**——把 §1.4 的手工实验固化成可重跑探针后的实测记录。后续每个阶段（S2a / G1a / S2b）都以本页三条判据为对照尺。
> **复跑**：`node scripts/probe/audio-baseline.probe.mjs`（探针在 test:smoke 门禁之外运行；报告落 `build/probe/audio-baseline.json`）。
> **预期**：修复完成前 **exit 1**（三条全红）；S2a 后 ①② 变绿；S2b 后全部变绿 exit 0。

## 样本（`tests/fixtures/audio/`，脚本 `scripts/fixtures/make-audio-fixtures.mjs` 可随时重造，不入 git）

6 个 320×240 / 25fps 视频样本合计 189,722 bytes（预算 <300KB）：`t-audio2s`（440Hz 2s）/ `t-silent2s`（无音轨 2s）/ `t-audio04s`（0.4s）/ `t-audio06s`（0.6s）/ `t-audio2s-16kmono` / `t-audio2s-48kstereo`。另有 G2 用已知 BPM 鼓点曲 `beat-{120,90,140}.wav`（`--all` 生成）。

## 三条判据实测（2026-10-28，内置 ffmpeg 6.0，走现有 `composeStudioVideo` 全流程）

| # | 判据 | 预期（修复后） | 实测（修复前） | 结论 |
|---|---|---|---|---|
| ① A1-音轨时长对齐 | 3 段含 1 段无声 → 音轨时长 == 视频时长 ±0.15s | 6.0s ≈ 6.0s | **音轨 4.011s vs 视频 6.000s（差 −1.989s）** | ❌ 红 |
| ② A2-无声段区间静音 | [2s,4s) 静音、相邻有声（逐 0.5s RMS） | 中段 RMS < 0.02 | **中段 [2s,4s) RMS ≈ 0.062（有声——第三段的声音被错位塞进来）；尾部 [4s,6s) 无音轨** | ❌ 红 |
| ③ C1-混采样率时长对齐 | 16k 单声道 × 48k 立体声混拼 → 音轨 == 视频 ±0.15s | 等长 | **容器 Duration 虚报 12.02s（视频实际 4.000s）；音轨解码 2.048s 后解码器报错中止（`Number of bands (68) exceeds limit`）** | ❌ 红 |

## 与计划 §1.4 预测的偏差

- 实验 A 复现一致：音轨 4.011s（计划实测 4.09s），错位特征一致（第二段区间被第三段声音填充、尾部静音）。
- **实验 C 比计划预测更严重**：计划用 44.1k/48k 混拼测得「时长 6.29 vs 6.02、RMS 缓降」；本基线用更极端的 16k 单声道 / 48k 立体声（真实场景里 H3 32k 与 TTS 混拼同样跨档），结果是**容器时长虚报到 12.02s、音轨中途解码崩溃**——不只是「变速变调」这种听感问题，而是流级损坏。判定口径（wav 逐秒 RMS + 部分解码标注）比计划预测的更必要：`-f null -` 与容器 `Duration:` 在这里都会撒谎。
- 判定工具按坑清单只用了两类：wav 导出逐 bin RMS（`scripts/probe/lib/audio-probe.mjs`）与 `ffmpeg -i` stderr 解析；`-f null -` 仅用于 silencedetect 时间戳（判据是日志时间戳，不是解码帧计数）。

## 判据定义（探针内实现，S2a 后原样搬进 tests/）

- **A1 / C1**：`|filmAudioSec − filmVideoSec| ≤ 0.15`。音轨时长 = wav data 块折算（`-vn -ac 1 -ar 8000 pcm_s16le` 后按字节算）；视频时长 = `-an -c copy` 导出后读 `Duration:`（容器 Duration 会取 max(video, audio)，补静音后会冒充视频长度，故单独导视频流）。
- **A2**：0.5s bin RMS——下标 4..7（[2s,4s)）全部 < 0.02 为静音；下标 0..3 与 8..11 各至少一个 bin > 0.05 为有声。
- 容差 ±0.15s 的依据：§1.4 实验 B 实测 AAC 补静音轨比视频长 0.11s（编码延迟），±0.05 会假红。
