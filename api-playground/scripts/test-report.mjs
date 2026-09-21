// 报告导出格式自测。
//
// 导出是报告离开页面后的**唯一形态**（贴群 / 贴 issue），读的人只能靠它判断结论：
//   · JSON 少一个 summary 字段，接收方就得自己数；
//   · Markdown 表格里漏转义一个 `|`，整张表错位（响应体里到处是 `|`）。
// 所以格式本身要有断言。
//
// 用法：node scripts/test-report.mjs   （需 Node >= 22.18）

const [maj, min] = process.versions.node.split('.').map(Number)
if (maj < 22 || (maj === 22 && min < 18)) {
  console.error(`✗ 需要 Node >= 22.18，当前 ${process.versions.node}`)
  process.exit(2)
}

const { buildExportJson, buildExportMarkdown, exportStamp, truncBody } = await import('../src/report.ts')

let pass = 0
const failures = []
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  [PASS] ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 一份典型的混合报告：1 通过 + 1 断言失败 + 1 负向通过 + 1 跳过 + 1 产物。 */
const ROWS = [
  { id: 'health', title: '健康检查', ok: true, status: 200, ms: 12, note: 'OK', input: 'GET /api/v1/health', output: '{"status":"ok"}' },
  {
    id: 'image2fix',
    title: '图内文字修复（中文）',
    ok: false,
    status: 200,
    ms: 68000,
    note: '缺少产物 URL',
    failures: ['缺少产物 URL：full_url 与 data[0].url 均为空'],
    input: '{"prompt":"改成|竖线|试试"}',
    output: '{"prompt_id":"x"}',
    serverDuration: 68.46,
  },
  { id: 'neg.missing-prompt', title: '缺必填 prompt', ok: true, status: 422, ms: 3, note: 'HTTP 422 如期挡下 · loc 命中 prompt', expect: '期望 422 · loc=prompt', input: '{"width":1}' },
  {
    // 真实场景：错误消息与响应体里**到处是换行**，而片段还带着 truncBody 的 `\n…(已省略)`。
    // 不压成空格就会把 Markdown 表格截断 —— 这条用例就是为它准备的。
    id: 'image2vl',
    title: '图片理解 VL',
    ok: false,
    status: 500,
    ms: 52,
    note: 'HTTP 500 · Internal Server Error',
    failures: ['HTTP 500 · Internal Server Error'],
    input: '{\n  "filename": "krea2_00140_.png"\n}',
    output: 'Internal Server Error\n…(已省略 12 字)',
  },
  { id: 'videoFl2va', title: '首帧视频', ok: false, skip: true, status: 0, ms: 0, note: '--skip-video 已跳过' },
]
const ASSETS = [
  { id: 'a1', kind: 'handle', mediaType: null, label: 'ref-abc.png', handle: 'ref-abc.png', fromEndpoint: 'upload' },
  { id: 'a2', kind: 'url', mediaType: 'image', label: 'krea2_1.png', url: 'http://x/view?filename=krea2_1.png', fromEndpoint: 'txt2image', prompt: 'p' },
]
const META = { ts: Date.UTC(2026, 8, 21, 1, 2, 3), baseUrl: 'http://117.50.108.73:8082', rows: ROWS, assets: ASSETS }

console.log('\n=== 报告导出自测 ===\n')

console.log('① JSON 导出：')
let J
{
  const text = buildExportJson(META)
  J = JSON.parse(text)
  check('是合法 JSON', typeof J === 'object' && J !== null)
  check('带 tool / exportedAt / baseUrl', J.tool === 'Drama API Playground' && typeof J.exportedAt === 'string' && J.baseUrl === META.baseUrl)
  check('exportedAt 是 ISO 时间', /^\d{4}-\d{2}-\d{2}T/.test(J.exportedAt))
  check('summary 计数正确（含跳过不算失败）', J.summary.total === 5 && J.summary.passed === 2 && J.summary.failed === 2 && J.summary.skipped === 1, JSON.stringify(J.summary))
  check('通过率按总用例算', J.summary.passRate === 40, String(J.summary.passRate))
  check('totalMs 跳过不计入', J.summary.totalMs === 12 + 68000 + 3 + 52, String(J.summary.totalMs))
  check('判定口径写进产物（报告脱离上下文仍可读）', typeof J.verdictRule === 'string' && J.verdictRule.includes('断言'))
  check('rows 原样带上（含 failures / expect / serverDuration）', J.rows[1].failures.length === 1 && J.rows[2].expect.includes('422') && J.rows[1].serverDuration === 68.46)
  check('assets 做了投影且含 URL', J.assets.length === 2 && J.assets[1].url.includes('krea2_1.png'))
  check('assets 不含内部字段 label（投影干净）', !('label' in J.assets[0]))
}
{
  const empty = JSON.parse(buildExportJson({ ...META, rows: [], assets: [] }))
  check('零用例不崩且通过率为 0', empty.summary.total === 0 && empty.summary.passRate === 0)
}

console.log('\n② Markdown 导出：')
let MD
{
  MD = buildExportMarkdown(META)
  check('有标题', MD.startsWith('# Drama API Playground'))
  check('有汇总行', MD.includes('**用例 5 · 通过 2 · 失败 2 · 跳过 1**'))
  check('有判定口径', MD.includes('判定口径'))
  check('有表格表头', MD.includes('| 接口 | 结果 | HTTP | 耗时 | 服务端 | 预期 | 摘要 |'))
  check('每个用例一行', ROWS.every((r) => MD.includes(`\`${r.id}\``)))
  check('结果标记正确', MD.includes('| `health` | PASS |') && MD.includes('| `image2fix` | FAIL |') && MD.includes('| `videoFl2va` | SKIP |'))
  check('服务端耗时带上', MD.includes('68.46s'))

  // 关键：表格结构完整性 —— **每张表内部**的竖线数必须一致，否则渲染错位。
  // 注意不能把两张表混在一起比：主表 7 列、产物表 3 列，混起来比会误报。
  const lines = MD.split('\n')
  const blocks = []
  let cur = []
  for (const l of lines) {
    if (/^\|.*\|$/.test(l)) cur.push(l)
    else if (cur.length > 0) { blocks.push(cur); cur = [] }
  }
  if (cur.length > 0) blocks.push(cur)
  check('至少两张表（用例表 + 产物表）', blocks.length >= 2, `实际 ${blocks.length}`)
  const bad = blocks
    .map((b, i) => ({ i, pipes: new Set(b.map((l) => (l.match(/(?<!\\)\|/g) || []).length)) }))
    .filter((x) => x.pipes.size !== 1)
  check('每张表内部竖线数一致（无错位）', bad.length === 0, JSON.stringify(bad))
  const first = blocks[0]
  check('用例表是 7 列（8 个竖线）', (first[0].match(/(?<!\\)\|/g) || []).length === 8, String((first[0].match(/(?<!\\)\|/g) || []).length))
  check('请求体里的 `|` 被转义', MD.includes('改成\\|竖线\\|试试') && !/\| 改成\|竖线/.test(MD))

  check('有失败明细小节', MD.includes('## 失败明细') && MD.includes('缺少产物 URL：full_url 与 data[0].url 均为空'))
  check('失败明细含请求体与响应', MD.includes('请求体') && MD.includes('响应'))
  check('有产物小节', MD.includes('## 本次产物') && MD.includes('ref-abc.png'))
  // 换行不压平会怎样：明细行会被拆断，续行不再以 `- 请求体：` 开头，
  // 于是「同一行里既有键又有值」的断言立刻失败（验过，能咬住）。
  check('用例表数据行数 = 用例数', first.length === 5 + 2, `表头+分隔+5 行，实际 ${first.length}`)
  {
    const inputLines = MD.split('\n').filter((l) => l.startsWith('- 请求体：'))
    const outputLines = MD.split('\n').filter((l) => l.startsWith('- 响应：'))
    check(
      '失败明细里的多行请求体被压成单行',
      inputLines.some((l) => l.includes('krea2_00140_.png') && l.includes('"filename"')),
      inputLines.slice(0, 2).join(' ‖ '),
    )
    check(
      '失败明细里的多行响应被压成单行（含截断标记）',
      outputLines.some((l) => l.includes('Internal Server Error') && l.includes('(已省略 12 字')),
      outputLines.slice(0, 2).join(' ‖ '),
    )
  }
}
{
  const md = buildExportMarkdown({ ...META, rows: [ROWS[0]], assets: [] })
  check('无失败时不输出失败明细小节', !md.includes('## 失败明细'))
  check('无产物时不输出产物小节', !md.includes('## 本次产物'))
}

console.log('\n③ 文件名时间戳：')
check('exportStamp 形如 YYYYMMDD-HHMMSS', /^\d{8}-\d{6}$/.test(exportStamp(META.ts)), exportStamp(META.ts))
check('同一时刻可复现（不依赖本地时区以外的东西）', exportStamp(META.ts) === exportStamp(META.ts))

console.log('\n④ truncBody：')
check('短文本不变', truncBody('abc') === 'abc')
check('恰好等于上限不变', truncBody('x'.repeat(1600)) === 'x'.repeat(1600))
{
  const t = truncBody('x'.repeat(2000))
  check('超长被截断', t.length < 2000 && t.startsWith('x'.repeat(1600)))
  check('截断处标明省略了多少字', t.includes('已省略 400 字'))
}
check('可自定义上限', truncBody('x'.repeat(50), 10).includes('已省略 40 字'))

console.log('\n=== 汇总 ===')
console.log(`通过 ${pass}  失败 ${failures.length}`)
if (failures.length > 0) {
  console.log('\n失败项：')
  for (const f of failures) console.log(`  · ${f}`)
}
process.exit(failures.length === 0 ? 0 : 1)
