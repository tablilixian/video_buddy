# 真机会话复盘与修复（session-d2711915，2026-11-23）

> 水位：`b75013bfd3`（换代落码）。运行时 checkout `~/Desktop/job/git/playsout/videobuddytest` 已同步。
> 会话导出：`session.v4.jsonl` 248 行 / 2 turn，停在第 2 镜提交中（**未跑完**）。
> 后台日志：`~/Library/Application Support/VideoBuddy/logs/dsh-2026-11-23.error.log`。

## 一、换代验收结论：通过

- 全程**没有** `/content/` 截断、`CS-NET-011/012`（ overhaul 前当天 09:02–09:22 有 5 条，14:50 重启后消失）。
- L62 image_generate 与 L239 video_composite 的「生成成功但文件准备失败」被新模型接住：
  `CS-GEN-210`（result_status=failed）是服务端归档失败，重试一次均成功；文案明确「不自动重生成」，模型自行决定重试一次，结果正确。
- `result_status=archiving` 未出现提前停轮询；`/download/{ordinal}` 票据链无 409/校验失败。

## 二、失败的完整清单（5 处工具失败 + 1 处 turn 中断）

| 位置 | 事件 | 归因 | 结局 |
|---|---|---|---|
| L62 | image_generate | 后端 `result_status=failed` | CS-GEN-210 → 重试成功 |
| L239 | video_composite | 同类归档失败 | 被套成 CS-GEN-206 + 过时音频提示 → 重试成功 |
| L92 | write_storyboard | 模型写非法 JSON | 工具拒收 → 重写成功（护栏正常） |
| L139 | character_sheet | 模型把节点 UUID 当 filename | CS-USER-002 → 改 @ref 成功（护栏正常） |
| L72 | read_image | 回执只给相对 URL，模型拼到 cwd 多一层目录 | not found → bash ls + 正确路径（白耗 2 轮） |
| L169 | turn 1 结束 | 平台侧 `409 insufficient credits`（QUOTA） | 用户「继续」恢复 |

## 三、本批修复（3 处，均已反向变异验证）

1. **视频 catch 错误码改写**（`src/generate.ts` 视频 catch）
   CanvasStudioError（CS-GEN-210/211、CS-NET-010/012、CS-GEN-207 等）原样透传，不再无条件套成 CS-GEN-206 + 「笼统 500 多半由音频/参考字段导致」。
   该提示在换代后已失效：`src/providers/business.ts:76` 明确 `generate_audio` 被新 API 拒收、根本没上后端。
   反向变异（排除 CS-GEN-210 后测试必须红）实证通过。
2. **产物回执缺绝对路径**（`src/generate.ts` 落盘主出口 + `src/host-tools.ts` renderResult/schema）
   `GenerateResult` 新增 `diskPath`，落盘成功即给绝对路径；回执以「本地路径: …（read_image / media_probe 用这个，勿拼 url）」透出。
   反向变异（去掉 disk 回执行）实证通过。旁路产物（music/tts/character_sheet/frame_extract）未纳入本批。
3. **CS-NET-010 文案债**（`src/errors/catalog.ts`）
   devMessage 旧口径「未含 full_url / data[0].url / job_id」与换代后真实触发条件（succeeded 但 result_status 非 ready / 无 download_url）不符，真机日志 16:06/16:22 据此误判成创建响应故障。已改为换代口径 + legacy 括注。

## 四、当前会话后台错误（dsh error.log，15:41/16:06/16:22）

三条 CS-GEN-206 内层原因不同：

- 15:41：`视频产物已生成成功，但结果文件准备失败` = CS-GEN-210（归档失败），修复 ① 后原样透传。
- 16:06 / 16:22：`生成响应中未找到产物地址（或异步任务标识），后端返回结构异常` = CS-NET-010，
  来自 `throwIfResultUnavailable`（succeeded 但 result_status 非 ready）或终态 outputs 无 download_url。
  **不是**创建响应缺字段（那是 legacy devMessage 的误导，修复 ③ 已纠正文案）。
  需要后端确认为何产物到了 succeeded 却没进 ready；客户端不做整单重生成（二次扣费）。

另有 08:13/11:28/11:52/14:42 的 `余额读取失败（unauthenticated）：invalid access token`——管理面 token 刷新问题，与生成链路无关；
`spill-policy: no image token calculator` 是 CV-446 已知基线（日志中持续出现，非本批）。

## 五、验证

- `clean → tsdown → tsc -p tsconfig.json → tsc -p tsconfig.client.json --emitDeclarationOnly → verify-client-loader → typecheck → test:smoke`：**3786/3786，0 红**。
- 反向变异：① 排除 CS-GEN-210 后 generate.test.mjs 红 1；② 去掉 disk 回执后新测试红 1；均恢复后复验全绿。
- ⚠️ 测试 import `lib/**`（tsc emit），tsdown 只产 client bundle —— 只跑 tsdown 再测试＝测旧码（本次变异验证踩过，已按铁律补 tsc）。
- CV 登记：CV-469（换代批）与本批均待真机完整跑完后再取号登记，本批暂不取号。
