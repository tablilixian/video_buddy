# api-probe 探针报告索引（INDEX）

> **探针报告 = 时点快照**：记录「某时刻对 Drama Backend 的实测结论」，供决策追溯；**现行契约一律以 [../api.md](../api.md) 为准**（其修订说明按时间线标注了作废关系，并多处引用本目录）。
> `archive/` 子目录存「结论已被后续复验吸收或推翻」的早期复验链；根目录保留仍在役的证据链（验收用例会指挥复跑的那种）。
> 新探针请放本目录 `<主题>-<YYYYMMDD>/report.md`，并在本表登记一行。

## 一、在役证据链（根目录）

| 报告 | 日期 | 一句话结论 / 用途 | 被引用于 |
| --- | --- | --- | --- |
| [krea2-turbo-20260916](./krea2-turbo-20260916/report.md) | 09-16 | Krea2 Turbo 三档分辨率实测（CV-190/191 证据） | api.md、STATUS 等 4 份 |
| [resolution-tier-1789462074585](./resolution-tier-1789462074585/report.md) | 09-15 | 分辨率三档逐档出图/出片实测 | api.md P0 实测段等 9 份 |
| [image2fix-20260918](./image2fix-20260918/report.md) | 09-18 | image2fix 接入实测：200 / 68.5s，SALLE→SALE 修复生效；产物名直用 500 快失败 | tools.md、验收用例 O-9 |
| [image2fix-20260920-text-spec](./image2fix-20260920-text-spec/report.md) | 09-20 | 修复 prompt = 完整「文字规格段」才能全对（字符清单会修错字+凭空多字） | api-usage §4、验收用例 |
| [image2fix-20260921-ab](./image2fix-20260921-ab/report.md)（含 report-r2 / analysis） | 09-21 | CV-218 真机 A/B（后端 09-21 恢复后复跑）；人判读见 analysis.md | 验收用例 O-9 指挥复跑 |
| [video2vl-20260922](./video2vl-20260922/report.md) | 09-22 | video2vl 接入实测：上传句柄 200 / 16.7s、产物名 0.1s 前置 500 | api.md CV-230 修订说明 |
| [video-reference-20260922](./video-reference-20260922/report.md) | 09-22 | H3 官方参考视频通道（video1–3）字段实证 | api.md、video-chain.md |
| [video-jobs-20260924](./video-jobs-20260924/report.md) | 09-24 | 后端 0.5.0 异步任务（202 + job_id + jobs 三端点）实测 | api.md 0.3.x、drama.ts 头注 |
| [txt2image-withtxt-20260930](./txt2image-withtxt-20260930/report.md) | 09-30 | `image_generate_withtxt`（Qwen Image 2.1）接入实测 | api.md 0.4.0（CV-270） |
| [txt2speech-20260930](./txt2speech-20260930/report.md) | 09-30 | `txt2speech`（VoxCPM2）接入实测，tts_voiceover 转真 | api.md 0.4.0（CV-271） |

## 二、已归档复验链（`archive/`，2026-09-10~09-11）

> 这一批是「带文件名端点全挂」误判（CV-145）→ 撤回 → 上传端点反转（CV-137）的完整取证链；结论已全部吸收进 api.md 横幅与现行契约，仅作追溯。

| 项 | 一句话 |
| --- | --- |
| `2026-09-10-backend-status.md` | 当日后端状态快照（已就地标注勘误） |
| `2026-09-10-file-endpoint-recheck.md` | CV-145「全 500」撤回证据链：根因是 1×1 占位图让后端读取即崩 |
| `2026-09-11-filename-consumability.md` | 两类 filename 消费性定案（上传句柄可用 / 产物名 500） |
| `contract-20260910/` · `contract-20260910-file/` | 当日 openapi 契约快照 |
| `file-recheck-full/` · `file-recheck-stage1/` | 带文件端点逐个复验记录 |
| `generated-refs-20260910/` | 生成产物引用形态快照 |
| `session-20260910/` · `session-20260911/` | 会话画像快照（`scripts/analyze-session.mjs` 产物） |
| `openapi-2026-09-10.json` | 时点 openapi 原文 |

## 三、已删除

- `video-backend-test-1789875595087/`、`video-backend-test-1789875604280/`（2026-09-30）：仅 `raw.json`、无报告、全库零引用（`scripts/video-backend-test.mjs` 的输出残留）。
