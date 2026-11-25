/**
 * REQ-041 L2（2026-11-25）· **段产物取数 Hook**：`segmentRef → 带版本号的媒体 URL`。
 *
 * ## 匹配键只能是 ref
 *
 * 卡上 `segmentRef` 存 spec 原文 id（`spec:s2`），段产物的 `id` 是白名单清洗后的
 * 名字（中文 id 会变 `seg-N`，过期段表整表退化成 `seg-N`）。按序号或按清洗后的
 * id 配都是「名字错了比没有更糟」—— 用户对着第 2 屏说话，改到第 3 屏。这里只做
 * 字符串等值匹配，不复刻任何清洗规则；清单没给 ref 就不配（诚实失败）。
 *
 * ## 取数时机
 *
 * 画布就绪（projectId 变化 / hook 挂载）拉一次；渲染结算经 segment-media-signal
 * 再拉一次。清单拉取失败 / 无段项目 ⇒ 空 Map，卡维持今天的文案，控制台不报错。
 *
 * ## URL 版本串
 *
 * 宿主清单给 `v = mtimeMs`。覆盖写同名文件后浏览器媒体元素可能仍持旧解码帧，
 * `?v=` 是零成本保险；地址属于渲染态，**不写回 canvas.json**。
 */
import { useEffect, useState } from 'react'
import type { SegmentMediaByRef } from '../contracts/segment-media.js'
import { fetchSegmentMedia } from './api.js'
import { createSegmentMediaLoad } from '../segment-media-load.js'
import { segmentMediaByRefOf } from '../segment-media-map.js'
import { subscribeSegmentMediaRefresh } from '../segment-media-signal.js'

export type { SegmentMediaByRef } from '../contracts/segment-media.js'

export function useSegmentMedia(projectId: string | null): SegmentMediaByRef {
  const [byRef, setByRef] = useState<SegmentMediaByRef>(() => new Map())

  useEffect(() => {
    if (projectId === null || projectId === '') {
      setByRef(new Map())
      return
    }
    // 清单不可用 = 这一段还没渲过（或宿主暂时不可达）：卡维持文案，静默。
    const loader = createSegmentMediaLoad(
      () => fetchSegmentMedia(projectId),
      (items) => { setByRef(segmentMediaByRefOf(items)) },
      () => { setByRef(new Map()) },
    )
    void loader.run()
    const unsubscribe = subscribeSegmentMediaRefresh((changed) => {
      if (changed === projectId) void loader.run()
    })
    return () => {
      loader.dispose()
      unsubscribe()
    }
  }, [projectId])

  return byRef
}
