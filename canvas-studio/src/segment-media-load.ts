/**
 * REQ-041 L2（2026-11-25）· **段清单并发加载的唯一闸门**（纯逻辑，零 React 依赖）。
 *
 * ## 为什么不是 `useEffect` 里 `let alive = true` 就够了
 *
 * 清单在「画布就绪」与「每次渲染结算」各拉一次，且渲染结算可能连发两次。
 * 只靠卸载标识挡不住**同一次挂载内的并发**：旧请求（渲前发出、网络慢）晚于
 * 新请求（渲后发出）返回，就会把旧清单写回状态 —— 卡停在旧画面，且再没有
 * 下一次刷新来纠正。这是「改完看不到这一屏」的 silent killer。
 *
 * 处置：每次 run 领一个单调序号，只有**最后一次**请求的结果可以落状态；
 * dispose 后所有在飞请求全部作废（换项目时也走这条）。
 */
export interface SegmentMediaLoad {
  /** 发起一次加载；同一实例内只有最新一次的结果生效。 */
  run(): Promise<void>
  /** 卸载 / 换项目：作废全部在飞请求。 */
  dispose(): void
}

/**
 * @param fetcher 取数（宿主清单接口）
 * @param apply   成功落状态（只有最新请求会调用）
 * @param onEmpty 失败落空（同样是「最新请求才生效」，静默回退文案）
 */
export function createSegmentMediaLoad<T>(
  fetcher: () => Promise<readonly T[]>,
  apply: (items: readonly T[]) => void,
  onEmpty: () => void = (): void => {},
): SegmentMediaLoad {
  let latest = 0
  let alive = true
  return {
    async run(): Promise<void> {
      const seq = ++latest
      try {
        const items = await fetcher()
        if (!alive || seq !== latest) return
        apply(items)
      } catch {
        if (!alive || seq !== latest) return
        onEmpty()
      }
    },
    dispose(): void {
      alive = false
    },
  }
}
