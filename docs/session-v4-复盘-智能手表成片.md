# 会话复盘：智能手表科普成片（session.v4.jsonl）

> 源文件：`/Users/lilixian/Downloads/session.v4.jsonl`（15MB / 1326 行）
> 任务：`code-driven-explainer` 技能 → 60s 智能手表功能讲解片（左右分栏 + 打字机 + 表盘代码绘制）
> 结论：**片子从未成功渲染出来**（无 output.mp4 / 无「成片已生成」标记）

## 一、硬数据事实

| 指标 | 数值 |
|---|---|
| 起止时间 | 2026-10-24 08:37 → 13:27（跨度 4h50m） |
| assistant 消息 | 233 |
| 用户真实输入 | 仅 8 条（其余 17 条 user 消息是 runtime/skills/compaction 系统注入噪声） |
| 工具调用 | 269（bash 200 / render_composition 26 / inspect_image 12 / read 8 / ask_user_choice 5 / tts_voiceover 5 / write_storyboard 4 / image_generate 2 / music_generation 1 …） |
| compaction（上下文压缩） | 5 次 |
| 渲染结果 | 26 次 render_composition：19 次超时、6 次小探针成功、1 次 manifest 校验错、1 次素材缺失 |
| 最终产出 | 无 output.mp4 / 无「成片已生成」标记 |

## 二、时间线

- **前半段 ~1 小时（高质量完成）**：加载技能 → 分镜落地 → 文生手表图 → 像素级定位表盘黑区 → 编写 manifest（最终 **61 条轨道 / 1800 帧，字段校验零错误**）。
- **后半段 11:24–13:47（约 2.5 小时，占全程一半以上）**：渲染超时死亡螺旋。

## 三、核心卡点：渲染超时

**致命卡点 = CS-RENDER-TIMEOUT 硬墙（90–420s）。** 关键矛盾数据：
- 成功小探针：S1（270 帧）23s → **85 ms/帧**（证明管线本身快）。
- 但 10 帧探针 55.6s（**5559 ms/帧**）、30 帧 35s（1167 ms/帧）。
- **同样小片段帧耗时差 65 倍** → 不可能是 manifest 复杂度问题，是**环境节流**。

**真因（agent 后期推断但没解决）**：渲染窗口是 Remotion CSR 的隐藏页面窗口，它①被浏览器在后台/最小化时节流；②工单需由「处在正确项目的画布页」认领（hasProjectId 为真），页面停首页或项目切走就空转到超时；③渲染失败残留「上一单未清干净」状态。

**用户判断正确但工具侧突破不了**：用户说「会不会是你的超时时间太短了，刚才看进度已经在走了」「我重启客户端了，你再试试」——进度确实在动，是固定超时窗口把"还在跑"的任务杀掉。

**agent 策略失误放大损失**：把"环境节流"误判为"内容/轨道数/ECG path/draw 描边慢"，于是不断把 manifest 切得更小反复试（probe_ecg / probe_min / probe_path_simple / probe_5pt / probe_nograin … 十几个），而小探针同样撞节流 → 越试越慢的死循环。若早识别"小探针也慢=环境"，应让用户保活页面而非缩内容。

**客户端重启雪上加霜**：重启清空资产目录，watch-hero.png 从磁盘消失，agent 重裁图后渲染依旧超时。

**上半场过度验证**：58 次「确认」、27 次「像素」、19 次「探针」，反复读 Shape.tsx/Transition.tsx/lookStyles 源码并自写 PNG 解码器/ASCII 亮度图做像素实测，大量上下文被吃光（5 次 compaction 的代价）。

## 四、对当前项目有用的信息（已验证引擎事实，建议沉淀）

可直接进 skill 文档 / 单元测试，避免下次重头验证：

- **CompositionManifest 硬规则**：`meta.durationInFrames` 必须等于 `max(track.startFrame + durationInFrames)`。
- **textCard 全居中**；只有 `bullets` 是左对齐变体（圆点+文本同行、固定 900px 宽容器居中）→ 左栏须按像素换算 `translate(x-50%)` 定位。
- **打字机** = `anim:"typewriter"` + `animOptions{wordDelayFrames,offsetY,blur}`；`useCurrentFrame()` 是**轨内相对帧**（Sequence 重置）。
- **几何坑（已踩）**：`boxStyle.h` 是**百分比**不是像素；`circle` 的 `paddingBottom` 按父宽解析→真圆；`path` 坐标直接是画布百分比（真圆需按 rx/ry 校正）；`line.x` 是**左边缘**；`look.temperature>0` 走 `hue-rotate(-12deg)` 偏暖，冷调必须用负值。
- **bullets 文字色硬编码 `#e6edf3`**、`accentColor` 只改圆点色 → 表盘内多色强调只能靠 `shape` 实现。
- **`animateStateAt` 按维度独立选段**（CV-336）：只动画 y 时 x 保持 `transform.x`，卡片滑入可行。
- **CS-RENDER-TIMEOUT 硬约束**：`render_composition` **绝不传 projectId**；长 manifest 必须走 `manifestPath` 绝对路径（内联截断触发 tail-integrity 拒收）。
- **环境事实**：本机无 PIL/numpy；ffmpeg 在 `/Applications/Jellyfin.app/Contents/MacOS/ffmpeg`（非标准路径，探测脚本要覆盖）。

## 五、可优化点（项目 / skill 改进建议）

**A. 渲染可靠性（最高优先，直接决定能否出片）**
1. 渲染超时阈值**可配置 / 随 segment 时长动态放宽**，或工具侧改成「异步派发 + 进度回报轮询」，而非固定窗口傻等（用户已指出进度在走）。
2. 渲染前**环境自检**：确认画布页在该项目、可见、未后台；认领工单必须 hasProjectId 为真。
3. 隐藏渲染窗口加「上一单 reset / 心跳保活」机制，避免失败残留卡死。

**B. 资产持久化 bug**：客户端重启清空用户资产目录（watch-hero.png 丢失）——重启不应删用户产物，改为惰性重新物化并保留引用。

**C. Agent / 技能层**
1. 把第四节引擎事实**沉淀进 skill 文档 + 加守卫测试**，下次不再重读源码、不再写十几个像素脚本（省掉 5 次 compaction 大部分开销）。
2. **区分「内容慢」vs「环境节流」**：最小探针也 >1s/帧 → 立即判定窗口/资源问题并提示用户保活页面，而非继续缩小 manifest。
3. 「刷新页面/保持前台/确认项目」操作指引**一次性完整给出**，不要反复试。
4. **msPerFrame 纳入告警**：渲染报告已有该字段，>阈值即提示环境异常而非继续渲染。

**D. 既定方向**：分段渲染（按节）+ ffmpeg concat 拼接已在会话里被验证为正确路线，应固化成 `code-driven-explainer` 的标准出片流程。

## 六、一句话结论

前 1 小时把片子（manifest）做完了，后 2.5 小时全耗在「渲染窗口被节流导致固定超时 + agent 误判为内容复杂而用小探针空转」上，最终未出片。真正要修的是渲染窗口的可见性/认领/reset 机制与超时策略，而非内容或技能逻辑。
