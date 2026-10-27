# 视频 megapixels 升档验证（2026-10-27）——**未取得结论，后端 H3 工作流当日在 400**

- 基址：`http://117.50.108.73:8082`（`/api/v1/health` 全程 200，26–46ms）
- 端点：`/api/v1/generate/image2videofl2va`（带首帧 `image1`，等价生产 keyframe→i2v 分支）
- 脚本：`scripts/probe-resolution-tiers.mjs --only video --bootstrap-image --mp <值>`
- 原始记录：[`../resolution-tier-1793087410045/`](../resolution-tier-1793087410045/report.md)（mp=1）、
  [`../resolution-tier-1793087440902/`](../resolution-tier-1793087440902/report.md)（mp=0.4）

## 为什么要跑

档位表把 720P 定义为 H3 官方 `megapixels = 1.0`、像素 1376×768，但**引擎是否真按 1.0MP 出片从未实测**
（`docs/api.md` 的 openapi 只证明该字段 `{type:number, default:0.4}`、无 enum 无范围，不证明会照做）。
这条同时是「升档 = 重新推理而非放大」告知文案的唯一实证依据。

## 实测

| 用例 | megapixels | HTTP | 耗时 | 产物 | health（前 → 后） |
|:--|:--|:--|:--|:--|:--|
| 待验档位 | `1` | 502 | 84ms | 无 | 200 → 200 |
| **对照组**（现状硬编码值） | `0.4` | 502 | 95ms | 无 | 200 → 200 |

两者响应体完全相同：

```json
{"detail":"请求失败: 400 Client Error: Bad Request for url: http://100.104.225.14:8188/prompt"}
```

## 结论

1. **这不是 megapixels 的问题**。对照组 `0.4` 是 `drama.ts` 现状对**所有视频请求**发送的值，
   历史上（2026-09-15）同一载荷 200 / 130.8s / 产物 864×480；今天它和 `1` 一样 502。
   ⇒ 被拒的是**上游 ComfyUI 的整条 H3 工作流**（`/prompt` 400），与本项目发送的档位参数无关。
2. **本调查表里的「拒收判据」需要加一条限定**：原判据「耗时 <5s 且前后 health 都 200 ⇒ 后端拒绝该请求体」
   成立的前提是 drama 自己校验入参。**502 + 上游 `Client Error` 属于「上游链路故障」，不是「请求体被拒」**——
   判别方法就是跑一组已知可用值做对照（本次 0.4）。只跑单值必误判，与 09-15 那次把 `fetch failed`
   读成「后端拒收」是同一类错误。
3. **720P 真实像素仍然未实证**，`docs/plans/resolution-unify-20261027.md` §12.7-1 保持未完成。
   后端恢复后按「0.4 / 1.0 成对跑」复验；`2k`（`2.0`）同理。
4. 顺带确认：health 端点正常不代表生成可用 —— **health 只证明进程活着**，不能当生成链路的存活信号。

## 复跑方法

```bash
# 先确认对照组能出片，再跑目标档位；单跑目标档位无法归因
DRAMA_API_BASE=http://117.50.108.73:8082 node scripts/probe-resolution-tiers.mjs --only video --bootstrap-image --mp 0.4
DRAMA_API_BASE=http://117.50.108.73:8082 node scripts/probe-resolution-tiers.mjs --only video --bootstrap-image --mp 1
```
