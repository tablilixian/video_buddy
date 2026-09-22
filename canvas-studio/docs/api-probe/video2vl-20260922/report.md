# 视频理解通道（`video2vl`）取证报告

**日期**：2026-09-22 ｜ **后端**：`117.50.108.73:8082`（无鉴权、单任务串行）
**触发**：CV-230「接入后端新增的 `video2vl` 视频理解端点」—— 接线前要确认入参形态与耗时，决定超时档位与是否要自愈。
**结论一句话**：**通道可用**（上传句柄 → 200 / 16.7s，输出逐镜头描述）；**产物名被前置 500**（0.1s），与 CV-155/CV-226 两类 filename 纪律同型 ⇒ 工具侧必须带换名自愈。

---

## 一、两个探针（串行，脚本 `scripts/probe-video2vl.mjs`）

| # | 入参 | 结果 | 判读 |
|---|---|---|---|
| 1 | `video` = 生成产物名（`MiniMax_H3_ref2va_00020_.mp4`） | **500 / 0.1s** | 前置拒绝 —— **产物名不可作 `video` 入参** |
| 2 | `video` = 上传句柄（`probe-v2vl-*.mp4`，1.65MB） | **200 / 16.7s**，`duration: 16.66` | 通道可用；输出是按时间轴逐镜头的描述 |

探针 2 的原始输出（节选）：

```json
{
  "prompt_id": "2c283f02-da27-4c96-b4bb-fbb0c6668f5a",
  "output": "- 从低角度特写开始：聚焦于一双穿着白色运动鞋的脚步在湿漉漉的地面上行走或奔跑…\n\n- 镜头拉远至中远景（广角）：展现一名男子正在一条空旷街道上跑步…\n\n- 接近人物面部侧影拍摄（特写）：…",
  "duration": 16.66
}
```

**判读要点**

- **`duration` = 服务端耗时**（16.66s ≈ HTTP 墙钟 16.7s），**不是视频时长** —— 与 `docs/api.md` 横幅里那条既有结论一致（"响应 `duration` = 服务端生成耗时，不是媒体时长"）。
- 上传本身 **15.5s**（1.65MB），不算在 `duration` 里。**视频理解的实际墙钟 = 上传 + 推理**。
- 空 body 的 ping 返回 **422**（`system_prompt` / `prompt` 均必填）—— 与 openapi 的 `required` 一致，**这两个字段不能省**。

---

## 二、由探针直接决定的三个实现选择

| 选择 | 依据 |
|---|---|
| **超时取视频档 600s**（`DRAMA_TIMEOUT_MS.video`），不用文本档 180s | 16.7s 是对 1.65MB 样片；耗时随片长增长，长片会顶到 180s 以上 |
| **工具侧自愈必开**（`@ref` 主动换名 + 500 后重试一次） | 探针 1：产物名 0.1s 就 500，而 agent 最常喂的正是「刚生成的视频」 |
| **工具描述写「产物名不能直接传」** | 同 CV-155/226：这类纪律不改描述就会被反复踩 |

---

## 三、可直接复现的命令

```bash
# 探针 1：产物名（预期 0.1s 500，成本≈0）
node scripts/probe-video2vl.mjs --only 1

# 探针 2：上传句柄端到端（约 30s，会占后端单任务槽位）
node scripts/probe-video2vl.mjs --only 2

# 换样本
node scripts/probe-video2vl.mjs --video /path/to/xxx.mp4
```

⚠️ 后端**单任务同步** ⇒ 探针避开用户使用时段；脚本已处理两个已知坑（长超时 dispatcher；dispatcher 的 symbol 要等首次请求之后才存在）。

---

## 四、本次取证带来的产品改动（CV-230）

1. `src/config.ts` 收录端点 `video2vl`；
2. `src/generate.ts` 新增 `analyzeVideo()`（与 `analyzeImage` 同纪律，共享自愈实现；`callDramaRaw` 增加超时参数）；
3. `src/host-tools.ts` 新增工具 **`video2vl`**（`@ref` 解析 + 自愈 + 串行提示）；
4. `docs/api.md` / `docs/canvas-studio-tools.md` / skill `toolchain.md` 同步登记，并顺手勘误工具计数（少算了 `image_fix`）；
5. 守卫：`tests/filename-consumability.test.mjs` +2（`@ref` 主动换名 / 500 自愈恰好一次）；`tests/video-analysis.test.mjs` +5（提示词常量契约 / 默认模式发出模板原文 / 关注点附句 / `free` 模式原样发出与缺参报错 / 工具描述引导）。
6. **提示词固化（本轮追加）**：后端同事给出的角色设定与分镜拆解 prompt 不再依赖模型自己写 —— 落成 `src/video-analysis.ts` 的 `VIDEO_ANALYST_SYSTEM_PROMPT` / `VIDEO_SHOT_BREAKDOWN_PROMPT`，工具缺省模式直接发出；`mode:'free'` 是自由问答出口。
