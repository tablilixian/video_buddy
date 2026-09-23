/**
 * 统一错误系统的**静态守卫**（§6「后续开发约束」的机器化版本）。
 *
 * 守什么：
 *  1. 禁止裸抛 —— `src/**` 里不得再出现 `throw new Error('<中文文案>')`，
 *     必须走 `throwError(code)`（oracle 是 error-system 自己的防呆断言，白名单放行）。
 *  2. 先登记后使用 —— 源码里出现的每个字面量错误码都必须在 catalog 登记，
 *     否则运行时会抛「未注册的错误码」这个**开发期**错误。
 *  3. 全码可路由 —— 遍历 catalog 每一条，断言 `routeError` 的处置与
 *     `audience`/`recoverability` 自洽（auto→不 surface；无 user→hidden；
 *     含 user→surface），并断言元数据完整（recoveryHint 齐全、code 命名合规、
 *     userMessage 不含敏感痕迹）。
 *
 * 直连 `lib/`（Host 侧 tsc 产物），不引 dsh 运行时依赖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  asCanvasError,
  CanvasStudioError,
  codeIsUserFacing,
  getErrorSpec,
  isStudioErrorCode,
  listErrorSpecs,
  routeError,
  sanitizeForUser,
} from '../lib/error-system.js'
import '../lib/errors/catalog.js'

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url))

/** 递归收集 `src/**` 下的 .ts / .tsx 源文件。 */
function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * 剥掉注释后再做静态检查。
 *
 * ⚠️ 只剥块注释与**整行**注释：行内注释（`code // throw new Error(...)`）不剥 ——
 * 否则 `https://` 这类字面量会被当成块注释开头，连后面的代码一起吃掉
 * （本仓踩过一次，见 PROJECT-NOTES「守卫读源码须剥注释」）。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

/** 允许保留裸抛的文件（error-system 自身的注册表防呆断言）。 */
const BARE_THROW_ALLOWED = ['error-system.ts']

test('静态守卫：src/ 不再有裸抛（除 error-system 自身防呆断言）', () => {
  const offenders = []
  for (const file of sourceFiles(SRC_DIR)) {
    const rel = relative(SRC_DIR, file)
    if (BARE_THROW_ALLOWED.includes(rel)) continue
    const code = stripComments(readFileSync(file, 'utf8'))
    const matches = code.match(/throw new (?:Error|TypeError|RangeError)\(/g)
    if (matches !== null) offenders.push(`${rel}: ${matches.length} 处`)
  }
  assert.deepEqual(
    offenders,
    [],
    `以下文件仍有裸抛，必须改为 throwError(code) 或收进 error-system：\n${offenders.join('\n')}`,
  )
})

test('静态守卫：源码里出现的每个错误码都已在 catalog 登记', () => {
  const registered = new Set(listErrorSpecs().map((spec) => spec.code))
  const missing = []
  for (const file of sourceFiles(SRC_DIR)) {
    const rel = relative(SRC_DIR, file)
    if (rel === 'errors/catalog.ts') continue
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const match of code.matchAll(/(?:throwError|reportError)\(\s*'(CS-[A-Z]+-\d+)'/g)) {
      if (!registered.has(match[1])) missing.push(`${rel}: ${match[1]}`)
    }
  }
  assert.deepEqual(missing, [], `未登记却直接使用的错误码（运行时必抛开发期错误）：\n${missing.join('\n')}`)
})

test('全码遍历：每条错误码的元数据完整且命名合规', () => {
  const specs = listErrorSpecs()
  assert.ok(specs.length >= 50, `catalog 条目过少（${specs.length}），疑似被截断`)
  for (const spec of specs) {
    assert.ok(isStudioErrorCode(spec.code), `${spec.code} 不符合 CS-<MODULE>-<后缀> 命名`)
    assert.ok(spec.audience.length > 0, `${spec.code}: audience 不能为空`)
    assert.ok(spec.userMessage.length > 0, `${spec.code}: userMessage 不能为空`)
    assert.ok(spec.module.length > 0, `${spec.code}: module 不能为空`)
    // 必填恢复指引（§6-7）：guided / fatal 必须给出「怎么办」。
    if (spec.recoverability !== 'auto') {
      assert.ok(
        typeof spec.recoveryHint === 'string' && spec.recoveryHint.length > 0,
        `${spec.code}: recoverability=${spec.recoverability} 必须提供 recoveryHint`,
      )
    }
    // 文案脱敏（§6-5）：userMessage 不得含绝对路径 / 内网地址 / stack 痕迹，
    // 即「过一遍 sanitizeForUser 不应发生变化」。
    assert.equal(
      sanitizeForUser(spec.userMessage),
      spec.userMessage,
      `${spec.code}: userMessage 含敏感痕迹（路径 / 地址 / stack），请移入 devMessage`,
    )
  }
})

test('全码遍历：routeError 的处置与 audience / recoverability 自洽', () => {
  for (const spec of listErrorSpecs()) {
    const err = new CanvasStudioError(spec)
    const prod = routeError(err, { devMode: false })
    const dev = routeError(err, { devMode: true })
    const userFacing = codeIsUserFacing(spec.code)

    if (spec.recoverability === 'auto') {
      // 自动恢复：绝不打扰用户 —— 生产静默重试，开发期只落日志。
      assert.equal(prod.kind, 'silent-retry', `${spec.code}: auto 错误生产环境应静默重试`)
      assert.equal(dev.kind, 'log-only', `${spec.code}: auto 错误开发期应只落日志`)
      assert.equal(userFacing, false, `${spec.code}: auto 错误不得被判为面向用户`)
      continue
    }
    if (!userFacing) {
      // 非用户受众（agent / developer）：两种环境都只落日志。
      assert.equal(prod.kind, 'log-only', `${spec.code}: 非用户受众应仅日志`)
      assert.equal(dev.kind, 'log-only', `${spec.code}: 非用户受众在开发环境也应仅日志（受众判定不随 devMode 变）`)
      continue
    }
    // 含 user 受众且非 auto：必须展示，且按 channel 路由。
    assert.equal(prod.kind, 'surface', `${spec.code}: 面向用户的错误必须展示`)
    assert.equal(dev.kind, 'surface', `${spec.code}: 面向用户的错误在开发环境也必须展示`)
    assert.equal(prod.channel, spec.channel, `${spec.code}: 应按注册的 channel 路由`)
    assert.ok(!prod.message.includes('[dev]'), `${spec.code}: 生产文案不得含 dev 细节`)
    // devMessage 存在时才该出现 [dev]（没有 dev 细节可附的错误不该凭空多一行）。
    assert.equal(
      dev.message.includes('[dev]'),
      spec.devMessage !== undefined,
      `${spec.code}: 开发文案是否附 [dev] 应与 devMessage 是否存在一致`,
    )
  }
})

test('未登记码按「展示」处理（宁可多显示，不静默吞掉真错误）', () => {
  assert.equal(codeIsUserFacing('CS-NOPE-999'), true)
  assert.equal(codeIsUserFacing('TOOL_ABORTED'), true)
})

test('系统自造的兜底码必须已登记 —— 否则边界两侧结论相反', () => {
  // 回归：`CS-UNC-000` 曾只以常量形式存在、没进注册表 ⇒
  // 实例侧 `routeError` 读规格判 log-only，而码字符串侧 `codeIsUserFacing`
  // 走「未登记按展示处理」的 fail-open 分支判 true ⇒ 未收敛的内部异常会在
  // 客户端画出红标。跨进程时 Client 手里**只有码字符串**（拿不到实例），
  // 所以两侧结论必须由同一份注册数据得出。
  for (const err of [asCanvasError(new Error('boom')), CanvasStudioError.fromJSON({})]) {
    assert.ok(isStudioErrorCode(err.code), `系统自造的码应合命名规范，实际 ${err.code}`)
    assert.notEqual(
      getErrorSpec(err.code),
      undefined,
      `${err.code} 未登记：codeIsUserFacing 会 fail-open 判为「展示」，与实例侧 routeError 相反`,
    )
    const prod = routeError(err, { devMode: false })
    assert.equal(
      prod.kind === 'surface',
      codeIsUserFacing(err.code),
      `${err.code}: 实例侧与码侧的「要不要给用户看」结论必须一致`,
    )
  }
})

test('错误码命名空间判定只认 CS-<MODULE>-<NN>', () => {
  assert.equal(isStudioErrorCode('CS-NET-009'), true)
  assert.equal(isStudioErrorCode('TOOL_ABORTED'), false)
  assert.equal(isStudioErrorCode('CS-net-1'), false)
  assert.equal(isStudioErrorCode(undefined), false)
  assert.equal(isStudioErrorCode(42), false)
})
