/**
 * CV-325：用户上传 skill 的**契约与校验**（第一阶段只开放知识型槽位，D1 拍板）。
 *
 * ## 边界声明（先读这一段，避免误判本文件的作用）
 *
 * 本批**不含上传 UI、不含上传端点**。第一阶段落地的是**契约与校验**：
 * 把「什么样的 skill 允许进入、进入后是否参与绑定」写成可执行、可单测的纯函数，
 * 并在安全协议（CV-326）里把四条底线预写死。
 *
 * 这么排期是因为：开放上传的**前置**是让内置 skill 体系先自洽（CV-317~322），
 * 而不是先做一个能上传的空壳。真接上传端点时，本文件的 `validateUpload`
 * 就是那个端点该调用的唯一判据 —— 规则不在端点里再写一遍。
 *
 * ## 两条不可协商的规则
 *
 * 1. **只接受知识型**（D1 拍板）。`role` 缺失或不是 `knowledge` 一律拒绝。
 *    决策型 skill（编排 / 导演型）由平台掌控，开放上传会重新引入决策打架。
 * 2. **槽位冲突内置优先**（D1 的推论）。用户 skill 声明了已被内置占用的槽位时，
 *    **允许入库但不参与绑定** —— 平台仍知道该槽位装谁，装机行为不受用户干扰。
 *    注意是「入库但不生效」而不是「拒绝」：用户的工作不白做，且提示要说清原因。
 */

/** 第一阶段开放上传的 6 个能力槽位（与 `toolchain.md` 的绑定表同源）。 */
export const UPLOAD_SLOTS = [
  'video-prompt', 'image-t2i', 'image-edit',
  'audio-music', 'audio-voice', 'camera-language',
] as const

export type UploadSlot = (typeof UPLOAD_SLOTS)[number]

/** 第一阶段唯一接受的 role（D1 拍板）。 */
export const UPLOADABLE_ROLE = 'knowledge'

/**
 * 内置槽位占用表：`槽位 → 内置 skill 名`。
 * 复用 `toolchain.md` §能力槽位绑定表的同一份事实，由调用方注入，
 * 本模块不自己维护第二份（双份必然漂移 —— 那正是 CV-324 要消灭的东西）。
 */
export type BuiltinSlotOwners = Readonly<Partial<Record<UploadSlot, string>>>

export type UploadVerdict =
  | {
    ok: true
    slot: UploadSlot
    /** 是否参与槽位绑定。`false` = 已入库但被内置实现挡住。 */
    bound: boolean
    /** 面向用户的一句话说明（入库成功也要说清「生效 / 暂不生效」及原因）。 */
    note: string
  }
  | { ok: false; reason: string }

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 *
 * 只支持本仓用到的扁平 `key: value` 形态（**不引 YAML 依赖**——为一个 3 行解析器
 * 加依赖不划算）。数组、行内对象、多行值一律解析不出来，因此不可能误吞结构化字段。
 * @returns 键 → 去首尾空白的原始值；无 frontmatter 或缺 `---` 围栏时返回空表。
 */
export function parseSkillFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)
  if (!match) return {}
  const body = match[1]
  if (body === undefined) return {}
  const out: Record<string, string> = {}
  for (const line of body.split(/\r?\n/u)) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line)
    const key = kv?.[1]
    const value = kv?.[2]
    if (key !== undefined && value !== undefined) out[key] = value.trim()
  }
  return out
}

/**
 * 校验一份待上传的 skill，产出**唯一判据**。
 *
 * 真接上传端点时，端点只应调用本函数并把 verdict 原样回给用户；
 * 规则不在端点里再写第二遍，也不靠模型自觉。
 *
 * @param frontmatter - `parseSkillFrontmatter` 的结果。
 * @param owners - 内置槽位占用表（来自能力槽位绑定表）。
 */
export function validateUpload(
  frontmatter: Readonly<Record<string, string>>,
  owners: BuiltinSlotOwners = {},
): UploadVerdict {
  const role = frontmatter.role
  if (role === undefined || role.trim() === '') {
    return {
      ok: false,
      reason: `缺少 \`role\` 声明。第一阶段只开放知识型 skill，frontmatter 必须写 \`role: ${UPLOADABLE_ROLE}\`。`,
    }
  }
  if (role !== UPLOADABLE_ROLE) {
    return {
      ok: false,
      reason: `\`role: ${role}\` 不被接受。第一阶段只开放知识型（\`role: ${UPLOADABLE_ROLE}\`）——`
        + '编排与导演型（决策型）skill 由平台掌控，开放上传会让多个决策型同时激活而互相打架。',
    }
  }

  const slot = frontmatter.slot
  if (slot === undefined || slot.trim() === '') {
    return {
      ok: false,
      reason: `缺少 \`slot\` 声明。知识型 skill 必须绑定到能力槽位之一：${UPLOAD_SLOTS.join(' / ')}。`,
    }
  }
  if (!(UPLOAD_SLOTS as readonly string[]).includes(slot)) {
    return {
      ok: false,
      reason: `\`slot: ${slot}\` 不是合法能力槽位。合法值：${UPLOAD_SLOTS.join(' / ')}。`,
    }
  }

  const typed = slot as UploadSlot
  const owner = owners[typed]
  if (owner) {
    return {
      ok: true,
      slot: typed,
      bound: false,
      note: `该槽位已有内置实现 \`${owner}\`，**内置优先**。你的 skill 已入库但暂不参与绑定，`
        + '不会改变本项目的提示词写法。',
    }
  }
  return {
    ok: true,
    slot: typed,
    bound: true,
    note: `已绑定到槽位 \`${typed}\`，创建任务时会按绑定表装配。`,
  }
}
