/**
 * error-kind 错误分级纯函数冒烟测试（brand-identity-proposal.md §6.1）。
 * 直连 Host tsc 编译产物 lib/error-kind.js。
 *
 * 两条路径分开测：`classifyStudioFailure`（有码，读注册表）是主路径，
 * `classifyStudioError`（无码，猜文案）只作兜底。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyStudioError, classifyStudioFailure, studioErrorCodeOf } from '../lib/error-kind.js'
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

test('CS-STORY-002：落地冻结是终态分级（不是可重试）—— 卡片要给「知道了」而不是「重试」', () => {
  // 会话 18 真机 §13：这条错误此前复用通用 CS-USER-ERR（未声明 uiKind ⇒ retryable），
  // 前端把它渲染成「出错了，重试一次？」，而那张卡唯一的按钮「重试」只刷项目列表，
  // 再点一次同样的操作同一张卡立刻回来。终态错误必须在登记时就声明 terminal。
  assert.equal(
    classifyStudioFailure('CS-STORY-002', '本项目已落地（live），版本写操作已冻结。'),
    'terminal',
  )
})

test('studioErrorCodeOf：从抛出的错误里取回 CS-* 码（前端 catch 曾把码丢掉）', () => {
  // 会话 18 §13 的真缺口：`StudioFrame` 十几个 catch 只把 message 交给 setFailed，码被
  // 丢掉 ⇒ 注册表里声明的 uiKind 全成死配置，终态错误照样显示「出错了，重试一次？」。
  assert.equal(studioErrorCodeOf({ code: 'CS-STORY-002' }), 'CS-STORY-002')
  assert.equal(studioErrorCodeOf(Object.assign(new Error('x'), { code: 'CS-STORY-002' })), 'CS-STORY-002')
  // 非本系统码 / 没有码 / 非对象：一律 undefined（交给启发式兜底，与改动前一致）
  assert.equal(studioErrorCodeOf({ code: 'TOOL_ABORTED' }), undefined)
  assert.equal(studioErrorCodeOf(new Error('x')), undefined)
  assert.equal(studioErrorCodeOf(undefined), undefined)
  assert.equal(studioErrorCodeOf(null), undefined)
  assert.equal(studioErrorCodeOf('CS-STORY-002'), undefined)
  // 端到端：抛出的错误 → 取码 → 分级（这条把「码丢了」这个真缺口钉死）
  assert.equal(classifyStudioFailure(studioErrorCodeOf({ code: 'CS-STORY-002' }), '本项目已落地'), 'terminal')
})
