/**
 * AR-02：损坏文件的**留证**（把读不懂的文件改名成 `<file>.corrupt`，而不是删掉或原地覆盖）。
 *
 * ## 为什么要有独立模块
 *
 * 这个动作原本只在 `storyboard-store.ts` 里有一份私有实现（`quarantine`）。AR-02 的
 * 结论是 **`canvas.json` 也需要同一件事**（它现在坏了就静默按空文档继续，下一次保存
 * 把原内容永久写掉）。与其复制第二份，抽成共享件 —— 这也符合本仓「单点收口，禁止
 * 第二份实现」的规矩。
 *
 * ## 语义（从 storyboard 原实现逐字节搬过来，行为不变）
 *
 * - 备份名恒为 `<file><suffix>`（默认后缀 `.corrupt`），**覆盖同名旧备份**（`rename`
 *   在 POSIX 上覆盖）——只保留「最近一次损坏」。理由：多次损坏说明有稳定的写入缺陷，
 *   旧备份没有新增信息，而无限堆积会污染用户的资产目录。
 * - **失败照原样抛**（含 ENOENT）。调用方据此区分「已成功留证」与「原文件还留在原地」，
 *   后者必须拒绝后续写入，否则就是把唯一一份数据盖掉。
 *
 * ## 与「拒绝继续」的关系（两个调用方刻意不同）
 *
 * - `storyboard-store`：留证后**显式报错、拒绝一切操作**（故事板是用户创作资产的
 *   SSOT，且 agent 可以用 `write_storyboard` 重写一份 ⇒ 阻塞有出路）。
 * - `projects.ts`（画布）：留证后**按空画布继续**，只在**留证失败**时拒绝写入。
 *   理由：画布被每次手势自动保存，若一律拒绝会让画布永久不可用（客户端每次保存都失败），
 *   而原内容此时已安全躺在 `.corrupt` 里；且画布**没有**等价的「重写一份」工具，
 *   阻塞等于把用户堵死。
 */
import { rename, unlink } from 'node:fs/promises'

/** 损坏留证的默认后缀（原名 + `.corrupt`）。 */
export const CORRUPT_SUFFIX = '.corrupt'

/**
 * 把 `file` 改名留证，返回备份的绝对路径。
 *
 * @param file - 要留证的**已存在的**文件路径。
 * @param suffix - 备份后缀，默认 `.corrupt`（`storyboard` / `canvas` 同款）。
 * @throws 文件不存在、无权限、跨设备等任何 `rename` 失败 —— 调用方必须把它当作
 *   「原文件仍在原地」处理。
 */
export async function quarantineFile(file: string, suffix: string = CORRUPT_SUFFIX): Promise<string> {
  const backup = `${file}${suffix}`
  // 覆盖同名旧备份（只留最近一次损坏）。
  await unlink(backup).catch(() => undefined)
  await rename(file, backup)
  return backup
}
