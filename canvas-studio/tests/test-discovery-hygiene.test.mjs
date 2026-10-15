/**
 * 测试发现卫生守卫 —— 2026-10-15 事故的复盘闸。
 *
 * **事故**：一次**裸 `node --test`**（不带路径）把 `scripts/video-backend-test.mjs`
 * 当成测试文件执行了 —— 它的名字命中 Node 默认发现规则里的 `**\/*-test.mjs`，而它
 * 是**真机探针**：于是它真的打了生产后端（health + 上传 3 张自造参考图 + 提交
 * ref2va / fl2va 两个真实视频任务），产物落进 `docs/api-probe/video-backend-test-<ms>/`。
 *
 * 本仓的测试入口是 `yarn test:smoke`（`scripts/run-smoke.mjs` → 显式 glob
 * `tests/*.test.mjs`），裸 `node --test` 从来不是入口 —— 但工具链 / IDE 会替你跑它，
 * 所以**文件名本身必须出圈**，不能靠「记得带路径」。
 *
 * 本守卫钉四件事（都是「结构性」判据，不依赖行为）：
 * 1. `scripts/` 下不得出现会被默认发现命中的文件名 —— 真机探针/工具脚本带副作用，
 *    这是唯一能造成「误跑 → 打生产」的一类；
 * 2. 探针脚本自带**运行时护栏**（万一有人改回 `*-test.mjs` 或另建别名）—— 用**行为**
 *    断言（真跑一个命中模式的临时副本 + 测试上下文），不是「源码里有这行字」那种空断言；
 *    且旧名确已不存在；
 * 3. `src/` 下被命中的文件**收敛为已知集合**（ratchet：新文件进不来，现存的一个在案）；
 * 4. `package.json` 里不得出现**不带路径**的 `node --test`，smoke 包装器必须用显式 glob。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 与 Node 默认测试发现对齐的模式（`node --test` 不带路径时生效）：
 *   `**\/*.test.EXT` · `**\/*-test.EXT` · `**\/*_test.EXT` · `**\/test-*.EXT` · `**\/test.EXT`
 * EXT 含 `.ts/.mts/.cts` —— Node 22.18 起类型剥离默认开启，这些也会被当测试跑
 * （事故里 `src/test-driver.ts` 就是这么被执行的）。
 */
const EXT = '(?:mjs|cjs|js|mts|cts|ts)'
const NAME_PATTERNS = [
  new RegExp(`^.*\\.test\\.${EXT}$`),
  new RegExp(`^.*-test\\.${EXT}$`),
  new RegExp(`^.*_test\\.${EXT}$`),
  new RegExp(`^test-.*\\.${EXT}$`),
  new RegExp(`^test\\.${EXT}$`),
]

// `tests/` 是唯一测试目录；`lib/` 是构建产物（文件名由 src 决定，且 clean 会重建）。
const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'tests'])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...walk(full))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

/** 全仓（除 tests/ 与 lib/）会被 `node --test` 默认发现命中的文件，仓库相对路径、已排序。 */
const HITS = walk(ROOT)
  .filter((p) => NAME_PATTERNS.some((re) => re.test(basename(p))))
  .map((p) => relative(ROOT, p).split(sep).join('/'))
  .sort()

test('scripts/ 下不得出现会被 node --test 默认发现命中的文件名', () => {
  const inScripts = HITS.filter((p) => p.startsWith('scripts/'))
  assert.deepEqual(
    inScripts,
    [],
    '真机探针/工具脚本一旦命中测试发现模式，裸 `node --test` 就会执行它（2026-10-15 事故：'
      + 'scripts/video-backend-test.mjs 被误跑，提交了两个真实视频任务）。请改用 probe-* 家族命名：'
      + inScripts.join('、'),
  )
})

test('src/ 下被测试发现命中的文件收敛为已知集合（ratchet）', () => {
  // 唯一在案的一个：`src/test-driver.ts` —— 被类型剥离下的默认发现命中，仅
  // import 解析失败（零副作用、不碰网络），故暂留；它的名字锚在 5 份历史文档
  // （tracking-closed / archive-cv / effect-tests 报告）里，改名会制造 doc 漂移。
  // 若将来要清掉它，**改这个名单即可**（改名后本断言会要求名单同步收紧）。
  const KNOWN = ['src/test-driver.ts']
  const inSrc = HITS.filter((p) => p.startsWith('src/'))
  assert.deepEqual(
    inSrc,
    KNOWN,
    'src/ 下被命中的文件集合变了：新增的必须改名或在此在案（说明为什么零副作用），'
      + '已消失的请同步收紧名单 —— 名单是 ratchet，不是豁免。',
  )
})

test('探针脚本：新名就位、旧名不存在', () => {
  const NEW_NAME = 'scripts/probe-video-backend.mjs'
  const OLD_NAME = 'scripts/video-backend-test.mjs'
  assert.ok(existsSync(join(ROOT, NEW_NAME)), `${NEW_NAME} 必须存在`)
  assert.ok(!existsSync(join(ROOT, OLD_NAME)),
    `${OLD_NAME} 必须已改名 —— 该名字命中 \`**\/*-test.mjs\`，是事故的直接成因`)
})

test('探针护栏：被当成测试文件执行时立刻退出、零请求（行为断言）', () => {
  // 为什么必须真跑：只断言源码里「有 NODE_TEST_CONTEXT / 有 exit(0)」是**空的** ——
  // 把护栏短路成 `if (false && AS_TEST_FILE)` 照样通过（实测）。所以这里造一个
  // **命中测试发现模式的文件名**的副本，带上测试上下文执行，断言它：
  //   ① 以 0 退出（不制造假红）② 打印「不得被测试运行器执行」③ **一个请求都没发**
  // 副本落在系统临时目录，且 DRAMA_API_BASE 指向本地死端口 —— 即使护栏失效也
  // **不会碰到生产后端**（此时会因连不上而退出 1，断言恰好因此变红）。
  const tmpDir = mkdtempSync(join(tmpdir(), 'cs-probe-guard-'))
  const asTestFile = join(tmpDir, 'probe-video-backend-test.mjs') // 命中 `*-test.mjs`
  try {
    copyFileSync(join(ROOT, 'scripts', 'probe-video-backend.mjs'), asTestFile)
    const res = spawnSync(process.execPath, [asTestFile], {
      cwd: tmpDir,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NODE_TEST_CONTEXT: 'child', DRAMA_API_BASE: 'http://127.0.0.1:1' },
    })
    const both = `${res.stdout ?? ''}${res.stderr ?? ''}`
    assert.equal(res.status, 0,
      `被当作测试文件执行时必须以 0 退出（实测 status=${res.status}）——\n${both.slice(0, 600)}`)
    assert.match(both, /不得被测试运行器执行/, '护栏必须打印可读原因')
    assert.doesNotMatch(res.stdout ?? '', /health|upload|ref2va/, '护栏必须拦在任何步骤之前（零请求）')

    // 反向：护栏**不得误伤合法调用** —— 同一个文件、同样带测试上下文（测试里
    // spawn 探针做真机复验就是这形状），仅文件名换成 `probe-*` ⇒ 必须照常执行。
    // 这里把目标指向本地死端口：它应当「跑起来但因连不上而失败」，而不是被拦下。
    const asProbe = join(tmpDir, 'probe-video-backend.mjs')
    copyFileSync(join(ROOT, 'scripts', 'probe-video-backend.mjs'), asProbe)
    const res2 = spawnSync(process.execPath, [asProbe, '--skip-video'], {
      cwd: tmpDir,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NODE_TEST_CONTEXT: 'child', DRAMA_API_BASE: 'http://127.0.0.1:1' },
    })
    assert.doesNotMatch(res2.stderr ?? '', /不得被测试运行器执行/,
      'probe-* 名字下护栏不得触发 —— 否则测试里 spawn 真机探针会被静默空跑')
    assert.match(res2.stdout ?? '', /health/, 'probe-* 名字下应当照常执行（本次因后端不可达而失败，属预期）')
  } finally {
    if (tmpDir.startsWith(tmpdir())) rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('测试入口必须是显式 glob：package.json 禁裸 `node --test`，smoke 包装器用 tests/*.test.mjs', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const bare = Object.entries(pkg.scripts).filter(([, cmd]) => /\bnode\s+--test\b/.test(cmd) && !cmd.includes('tests/'))
  assert.deepEqual(bare, [],
    '不带路径的 `node --test` 会按默认模式扫全仓（事故成因）。脚本里请显式写 tests/*.test.mjs')

  const smoke = readFileSync(join(ROOT, 'scripts', 'run-smoke.mjs'), 'utf8')
  assert.match(smoke, /'tests\/\*\.test\.mjs'/,
    'run-smoke 必须把显式 glob 传给 node --test（唯一入口，别退回默认发现）')
})
