# 探针报告：Drama 异步视频任务（0.5.0）

- **日期**：2026-09-24
- **执行者**：canvas-studio（CV-231 集成前探针）
- **脚本**：`scripts/probe-video-jobs.mjs`（提交 → 轮询 → 取结果 → 取消，串行）
- **后端**：`http://117.50.108.73:8082`（health `{"status":"ok","queue_task_count":0}`，队列空闲）

## 结论（全部通过，后端已在 0.5.0）

| # | 问题 | 实测 | 判读 |
| --- | --- | --- | --- |
| 1 | 提交是否立即 202 | **48ms** 返回 `202` + `{job_id, status, status_url, cancel_url, result_url}`，job_id = ComfyUI prompt_id | 客户端提交走 60s 短超时档绰绰有余 |
| 2 | 未完成取 result | `202 {"detail":"Job is not completed"}`；未知 job → `404 {"detail":"Job not found"}` | result 三态（200/202/404/409）成立 |
| 3 | 状态机流转 | `in_progress@+0s → completed@+132.1s`（0.4MP / 5s 文生视频，队列空）| 单片 ~132s；`pending` 未观测到（空队列直接开跑），批量提交时才会出现 |
| 4 | result 结构与下载 | `200` + `{prompt_id, filename, full_url, duration}`（duration=129.11 = 服务端耗时，非片长）；full_url 下载 `200` `video/mp4` 481KB | **与旧同步响应同构**，产物下载链路零改动 |
| 5 | 取消链路 | `cancel` → `200 {"job_id","cancelled":true,"status":"in_progress"}`，约 5s 内状态翻 `cancelled` | executor 超时/打断时调 cancel 即可清远端任务 |

## 原始输出

```text
[health] status=200 body={"status":"ok","queue_task_count":0}
[submit#1] status=202 ms=48 job_id=4bf08c5f-9a06-4a1b-9e86-25cdebb87406
  字段=job_id,status,status_url,cancel_url,result_url
[result@0s] 202 {"detail":"Job is not completed"}
[missing job] 404 {"detail":"Job not found"}
[状态机] in_progress@+0.0s → completed@+132.1s（5s 间隔轮询）
[result] 200 {"prompt_id":"4bf08c5f-...","filename":"minimax-h3-fl2av_00030-audio.mp4",
         "full_url":"http://117.50.108.73:8082/view?filename=minimax-h3-fl2av_00030-audio.mp4",
         "duration":129.11}
[download] 200 bytes=481305 type=video/mp4
[submit#2] 202 ms=32 job_id=3ad7ef8d-9c99-4625-b91f-b219cbe7922c
[cancel] 200 {"job_id":"3ad7ef8d-...","cancelled":true,"status":"in_progress"}
[after cancel] in_progress@+0.0s → cancelled@+5.1s
```

## 对本仓设计的直接影响

1. **提交 48ms** → `DRAMA_TIMEOUT_MS.videoSubmit = 60s`（快失败），`video`（40min）转为 executor 轮询整体墙钟。
2. **单片 ~132s（0.4MP/5s）** → 放开连续提交后，N 个镜头排队墙钟 ≈ N×单片耗时，40min deadline 覆盖 ~18 个 5s 镜头（736p 会更长，客户端 42min 占位截止成对抬高）。
3. **result 与旧同步响应同构** → `persistGeneratedAsset` 的下载/ffmpeg 实测/节点落盘链路零改动。
4. **取消后 ~5s 内 cancelled** → executor 的 cancel-on-abort 语义成立；取消后状态查询仍 200（不会立即 404），但排队中任务被取消可能 404（后端文档口径，poll 按失败处理）。
