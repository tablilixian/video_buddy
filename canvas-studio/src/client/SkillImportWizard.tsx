/**
 * CV-333：用户 skill 导入向导（三步）。
 *
 * ## 为什么是「选文件」而不是「给路径」
 *
 * 原生目录选择器只存在于 `dsh-plugin-desktop`（`showOpenDialog`），**没有注入给
 * canvas-studio**（`src/index.ts` 的 inject 列表里没有对应服务）。所以导入只能是：
 *
 * ```
 * 用户在 renderer 选目录 → 读出文件内容（File.text()）→ POST 内容给 Host → Host 校验 + 落盘
 * ```
 *
 * 而不是「让用户选一个路径、Host 去读」。好处不只是可行性：**Host 永远不读用户给的
 * 路径**，`..` / 绝对路径 / 符号链接逃逸这类问题在数据模型上就不存在（只落
 * `<DSH_HOME>/skills/<校验过的 slug>/`）。
 *
 * ## 三步的边界
 *
 * | 步 | 谁说了算 |
 * |---|---|
 * | 1 选择来源 | 前端（列文件、读内容、标二进制） |
 * | 2 预览与校验 | **Host**（`validateImport` 的 verdict）——前端不重算规则 |
 * | 3 完成 | **Host**（落盘结果 + advisories）+ 列表轮询（真进了 catalog 才翻绿） |
 *
 * 步 2 与落盘之间没有用户可操作的东西，所以「开始导入」就是调 `/import`：
 * 校验失败停在步 2（红字 + 怎么改），成功即进步 3。硬要拆成「dry-run 校验 →
 * 再落盘」会让同一次校验跑两遍，而两遍之间世界可能变了（同名文件被别人删了）。
 *
 * ## ⚠️ 步 3 的「已进 catalog」不能靠前端假设
 *
 * 落盘完成 ≠ 立即可见（Chokidar ≤ ~300ms）。所以步 3 只陈述事实（文件落在哪、
 * 有几条提示），**是否真的进了 catalog 由列表轮询随后反映**（`SkillStatusBadge`
 * 的「扫描中 → 已生效/未装载」）。把「已进 catalog ✓」写在完成页上，就等于替
 * 上游打了包票 —— 而它此刻可能还没扫到。
 */
import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { ImportSkillResult, UploadAdvisory } from '../contracts/skill.js'
import { advisoryText } from '../skill-upload-contract.js'
import { RichText } from './rich-text.js'
import { importUserSkill } from './api.js'
import { copyTextQuietly } from './copy-text.js'

/** 只上传文本内容（D6）；其余按名登记、不上传内容。 */
const TEXT_EXTENSIONS: readonly string[] = ['.md', '.txt', '.json', '.yaml', '.yml']

/** 单次导入的展示上限（与 Host 侧 `IMPORT_LIMITS.fileCount` 同口径，仅用于提示）。 */
const FILE_COUNT_HINT = 50

export interface SkillImportWizardProps {
  /** 关闭向导（不触发列表刷新）。 */
  readonly onClose: () => void
  /** 落盘成功后调用（父组件据此立刻拉一次列表）。 */
  readonly onImported: (slug: string) => void
  /** 落点根目录（完成页展示绝对路径）。 */
  readonly skillsRoot: string
}

/** 一条待导入文件（`text` 缺省 = 非文本，不上传内容）。 */
interface PendingFile {
  readonly path: string
  readonly text?: string
  readonly bytes: number
}

function isTextPath(path: string): boolean {
  const lower = path.toLowerCase()
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))
}

/**
 * 逐条列建议（文案来自契约层的 `advisoryText`，UI 与测试共用同一份措辞）。
 *
 * ⚠️ 那份措辞带 markdown 标记（`` `name` ``、`**重点**`），React 文本节点不渲染
 * markdown ⇒ 必须过 `RichText`，否则用户看到的是一串反引号与星号。
 */
function AdvisoryList(props: { readonly advisories: readonly UploadAdvisory[] }): ReactElement | null {
  if (props.advisories.length === 0) return null
  return (
    <ul className="csSkillImportAdvisories">
      {props.advisories.map((advisory, index) => (
        <li key={`${advisory.kind}-${String(index)}`}><RichText text={advisoryText(advisory)} /></li>
      ))}
    </ul>
  )
}

/** 导入向导三步（选择来源 → 预览与校验 → 完成）。 */
export function SkillImportWizard(props: SkillImportWizardProps): ReactElement {
  const { onClose, onImported, skillsRoot } = props
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [pending, setPending] = useState<readonly PendingFile[]>([])
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<ImportSkillResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [dirNotice, setDirNotice] = useState<string | null>(null)
  const dirInput = useRef<HTMLInputElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const readFiles = async (list: FileList | null, label: string): Promise<void> => {
    if (list === null || list.length === 0) return
    const collected: PendingFile[] = []
    for (const file of Array.from(list)) {
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
      const path = relative !== undefined && relative !== '' ? relative : file.name
      if (!isTextPath(path)) {
        // 二进制 / 未知类型：只登记名字（不上传内容），Host 侧会产 binary-skipped 提示。
        collected.push({ path, bytes: file.size })
        continue
      }
      try {
        const text = await file.text()
        collected.push({ path, text, bytes: file.size })
      } catch {
        collected.push({ path, bytes: file.size })
      }
    }
    setPending(collected)
    setSource(label)
    setError(null)
    setVerdict(null)
    setStep(2)
  }

  const runImport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await importUserSkill({
        files: pending.map(file => file.text === undefined ? { path: file.path } : { path: file.path, text: file.text }),
        ...(overwrite ? { overwrite: true } : {}),
      })
      setVerdict(result)
      if (result.ok) {
        setStep(3)
        onImported(result.slug ?? '')
      } else if (result.code === 'CS-SKILL-007') {
        // 落点已存在：不是「格式错」，而是「要不要覆盖」的问题 —— 给按钮而不是红字。
        setOverwrite(true)
        setError(result.reason ?? '同名技能已存在。')
      } else {
        setError(result.reason ?? '导入失败。')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const textCount = pending.filter(file => file.text !== undefined).length
  const skipped = pending.filter(file => file.text === undefined)

  return (
    <div className="csSkillImportBackdrop" onClick={onClose}>
      <div
        className="csSkillImport"
        role="dialog"
        aria-modal="true"
        aria-label="导入技能"
        onClick={(event) => { event.stopPropagation() }}
      >
        <header className="csSkillImportBar">
          <h3 className="csSkillImportTitle">导入技能</h3>
          <span className="csSkillImportStep">第 {step} / 3 步</span>
          <span className="csSkillMarketSpacer" />
          <button type="button" className="csSkillDetailClose" onClick={onClose}>关闭</button>
        </header>

        <div className="csSkillImportBody">
          {step === 1 && (
            <div className="csSkillImportChoices">
              <p className="csSkillImportLead">
                选择一个<strong>包含 <code>SKILL.md</code> 的文件夹</strong>（推荐），
                或直接选一个 <code>.md</code> 文件。你的技能会放进本机技能目录，
                <strong>对你所有项目可用</strong>。
              </p>
              <button
                type="button"
                className="csSkillImportChoice"
                onClick={() => { dirInput.current?.click() }}
              >
                <span className="csSkillImportChoiceTitle">选择文件夹</span>
                <span className="csSkillImportChoiceHint">目录包：<code>SKILL.md</code> + 可选 <code>references/</code></span>
              </button>
              <button
                type="button"
                className="csSkillImportChoice"
                onClick={() => { fileInput.current?.click() }}
              >
                <span className="csSkillImportChoiceTitle">选择 SKILL.md 文件</span>
                <span className="csSkillImportChoiceHint">单个 .md（内容会落成同名目录包）</span>
              </button>
              <button
                type="button"
                className="csSkillImportChoice csSkillImportChoiceGhost"
                onClick={() => { setDirNotice(skillsRoot) }}
              >
                <span className="csSkillImportChoiceTitle">查看技能目录路径</span>
                <span className="csSkillImportChoiceHint">自己拖文件进去也行（会自动被发现）</span>
              </button>
              {dirNotice !== null && (
                <div className="csSkillImportDirNotice">
                  <code>{dirNotice}</code>
                  <button
                    type="button"
                    className="csSkillImportCopy"
                    onClick={() => { copyTextQuietly(dirNotice) }}
                  >
                    复制路径
                  </button>
                </div>
              )}
              <input
                ref={dirInput}
                type="file"
                multiple
                className="csSkillImportHiddenInput"
                {...{ webkitdirectory: '', directory: '' }}
                onChange={(event) => { void readFiles(event.target.files, '文件夹') }}
              />
              <input
                ref={fileInput}
                type="file"
                accept=".md,text/markdown"
                className="csSkillImportHiddenInput"
                onChange={(event) => { void readFiles(event.target.files, '单个文件') }}
              />
            </div>
          )}

          {step === 2 && (
            <div className="csSkillImportReview">
              <div className="csSkillImportPane">
                <h4 className="csSkillImportPaneTitle">校验清单</h4>
                <dl className="csSkillImportFacts">
                  <dt>来源</dt><dd>{source}</dd>
                  <dt>文件数</dt><dd>{pending.length} 个（文本 {textCount}）</dd>
                  <dt>落点</dt><dd><code>{skillsRoot}</code></dd>
                </dl>
                <ul className="csSkillImportFiles">
                  {pending.slice(0, FILE_COUNT_HINT).map(file => (
                    <li key={file.path}>
                      <code>{file.path}</code>
                      <span className="csSkillImportSize">{Math.max(1, Math.round(file.bytes / 1024))}KB</span>
                    </li>
                  ))}
                </ul>
                {skipped.length > 0 && (
                  <p className="csSkillImportSkip">
                    非文本文件已跳过（{skipped.length} 个）：{skipped.map(file => file.path).join('、')}
                  </p>
                )}
              </div>
              <div className="csSkillImportPane">
                <h4 className="csSkillImportPaneTitle">结构校验</h4>
                <p className="csSkillImportNote">
                  判定由宿主的校验器给出（与导入用的是同一份规则），前端不重算。
                </p>
                {error !== null && <p className="csSkillImportError"><RichText text={error} /></p>}
                {verdict?.advisories !== undefined && <AdvisoryList advisories={verdict.advisories} />}
                {overwrite && (
                  <label className="csSkillImportOverwrite">
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(event) => { setOverwrite(event.target.checked) }}
                    />
                    覆盖同名技能（旧版本先移入回收站，可恢复）
                  </label>
                )}
              </div>
            </div>
          )}

          {step === 3 && verdict?.ok === true && (
            <div className="csSkillImportDone">
              <p className="csSkillImportDoneLead">
                已落盘到 <code>{skillsRoot}/{verdict.slug}</code>
              </p>
              <ul className="csSkillImportFiles">
                {(verdict.files ?? []).map(path => <li key={path}><code>{path}</code></li>)}
              </ul>
              {verdict.trashedTo !== undefined && (
                <p className="csSkillImportNote">旧版本已移入回收站：<code>{verdict.trashedTo}</code></p>
              )}
              <AdvisoryList advisories={verdict.advisories ?? []} />
              <p className="csSkillImportNote">
                技能目录刷新通常不到一秒。回到广场即可看到它的<strong>生效状态</strong> ——
                「未装载」表示模型能看到但还没用上，点「装载」后本项目的任务才会按它写。
              </p>
            </div>
          )}
        </div>

        <footer className="csSkillImportFoot">
          {step === 1 && <span className="csSkillImportFootHint">选好来源后进入校验</span>}
          {step === 2 && (
            <>
              <button type="button" className="csSkillImportBack" onClick={() => { setStep(1); setError(null) }}>
                上一步
              </button>
              <button
                type="button"
                className="csSkillImportGo"
                disabled={busy || pending.length === 0}
                onClick={() => { void runImport() }}
              >
                {busy ? '导入中…' : overwrite ? '覆盖并导入' : '开始导入'}
              </button>
            </>
          )}
          {step === 3 && (
            <button type="button" className="csSkillImportGo" onClick={onClose}>完成</button>
          )}
        </footer>
      </div>
    </div>
  )
}
