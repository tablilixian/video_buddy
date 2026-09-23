/**
 * error-kind 错误分级纯函数冒烟测试（brand-identity-proposal.md §6.1）。
 * 直连 Host tsc 编译产物 lib/error-kind.js。
 *
 * 两条路径分开测：`classifyStudioFailure`（有码，读注册表）是主路径，
 * `classifyStudioError`（无码，猜文案）只作兜底。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyStudioError, classifyStudioFailure } from '../lib/error-kind.js'
import { listErrorSpecs } from '../lib/error-system.js'
import '../lib/errors/catalog.js'

test('classifyStudioError：空消息一律可重试', () => {
  assert.equal(classifyStudioError(undefined), 'retryable')
  assert.equal(classifyStudioError(null), 'retryable')
  assert.equal(classifyStudioError(''), 'retryable')
})

test('classifyStudioError：服务不可达（fetch 失败 / 连接拒绝 / 超时）', () => {
  assert.equal(classifyStudioError('fetch failed: connect ECONNREFUSED 117.50.108.73:8082'), 'unreachable')
  assert.equal(classifyStudioError('getaddrinfo ENOTFOUND drama.local'), 'unreachable')
  assert.equal(classifyStudioError('NetworkError: Failed to fetch'), 'unreachable')
  assert.equal(classifyStudioError('请求超时：30s 无响应'), 'unreachable')
  assert.equal(classifyStudioError('socket hang up'), 'unreachable')
})

test('classifyStudioError：配置缺失（密钥 / 基址 / 未授权）', () => {
  assert.equal(classifyStudioError('Drama API Key 未配置'), 'config')
  assert.equal(classifyStudioError('401 Unauthorized'), 'config')
  assert.equal(classifyStudioError('invalid api base url'), 'config')
  assert.equal(classifyStudioError('credential missing: CANVAS_STUDIO_DRAMA_API_KEY'), 'config')
})

test('classifyStudioError：其它业务错误一律可重试', () => {
  assert.equal(classifyStudioError('图片尺寸必须为 1:1'), 'retryable')
  assert.equal(classifyStudioError('prompt 不能为空'), 'retryable')
  assert.equal(classifyStudioError('something went wrong'), 'retryable')
})

test('classifyStudioError：不可达优先于配置（连接被拒/DNS 失败先提示服务）', () => {
  // 硬性网络信号（ECONNREFUSED 等）即使混着 api key 词也归不可达——服务确实没起来。
  assert.equal(classifyStudioError('ECONNREFUSED: api key check failed'), 'unreachable')
  assert.equal(classifyStudioError('fetch failed: ENOTFOUND api.example.com'), 'unreachable')
})

test('CR-032：软性信号与配置关键词同现时归 config（不误判为后端不可达）', () => {
  assert.equal(classifyStudioError('连接失败：invalid api key'), 'config')
  assert.equal(classifyStudioError('未配置密钥导致连接失败'), 'config')
  assert.equal(classifyStudioError('请求超时：401 unauthorized'), 'config')
})

test('CR-032：软性信号单独出现时仍归不可达', () => {
  assert.equal(classifyStudioError('请求超时：30s 无响应'), 'unreachable')
  assert.equal(classifyStudioError('无法连接后端服务'), 'unreachable')
})

// ── 主路径：有 CS-* 码时读注册表的 uiKind，不猜文案 ──────────────────────────

test('classifyStudioFailure：有码时以注册表声明为准，文案完全不影响结果', () => {
  // 文案像「服务不可达」，但该码登记为 config ⇒ 必须是 config（否则会把用户
  // 带去检查后端，而真正要做的是去设置里配 Key —— 正是 CR-032 那类误导）。
  assert.equal(classifyStudioFailure('CS-PROV-001', 'fetch failed: ECONNREFUSED 10.0.0.1:8082'), 'config')
  // 反向对照：文案中性，但该码登记为 unreachable ⇒ 必须跟着码走。
  assert.equal(classifyStudioFailure('CS-GEN-204', '操作未完成'), 'unreachable')
})

test('classifyStudioFailure：已登记但未声明 uiKind ⇒ retryable（省略即默认，不再看文案）', () => {
  // CS-USER-001 没声明 uiKind；文案故意填「未配置密钥」这种启发式会判 config 的串，
  // 结果仍必须是 retryable —— 证明主路径**没有**偷偷退回字符串匹配。
  assert.equal(classifyStudioFailure('CS-USER-001', '未配置密钥，401 unauthorized'), 'retryable')
})

test('classifyStudioFailure：无码 / 非本系统码 / 未登记码 才退回启发式', () => {
  assert.equal(classifyStudioFailure(undefined, 'fetch failed: ENOTFOUND drama.local'), 'unreachable')
  assert.equal(classifyStudioFailure(null, 'Drama API Key 未配置'), 'config')
  assert.equal(classifyStudioFailure('TOOL_ABORTED', '请求超时：30s 无响应'), 'unreachable')
  assert.equal(classifyStudioFailure('CS-NOPE-999', 'prompt 不能为空'), 'retryable')
  // 空码 + 空文案：任一路径都不得抛，落 retryable。
  assert.equal(classifyStudioFailure(undefined, undefined), 'retryable')
})

test('全码遍历：每个码的分级与 catalog 声明严格一致', () => {
  const specs = listErrorSpecs()
  assert.ok(specs.length >= 50, `catalog 条目过少（${specs.length}），疑似被截断`)
  for (const spec of specs) {
    assert.equal(
      classifyStudioFailure(spec.code, spec.userMessage),
      spec.uiKind ?? 'retryable',
      `${spec.code}: 三态卡分级与 catalog 声明不一致`,
    )
    // 声明了 uiKind 的码必须面向用户 —— 否则是永远读不到的死配置。
    if (spec.uiKind !== undefined) {
      assert.ok(spec.audience.includes('user'), `${spec.code}: 声明了 uiKind 却不在 user 受众，属死配置`)
    }
  }
})
