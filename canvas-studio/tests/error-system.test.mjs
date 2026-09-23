import assert from 'node:assert/strict'
import test from 'node:test'
import {
  registerError,
  throwError,
  asCanvasError,
  routeError,
  sanitizeForUser,
  getErrorSpec,
  CanvasStudioError,
  isDevMode,
  setDevMode,
} from '../lib/error-system.js'
// 触发 catalog 自注册
import '../lib/errors/catalog.js'

// 固定开发模式，避免环境差异影响断言
setDevMode(false)

test('catalog 已登记代表错误码', () => {
  assert.ok(getErrorSpec('CS-GEN-204'), 'CS-GEN-204 应已注册')
  assert.ok(getErrorSpec('CS-PROV-001'), 'CS-PROV-001 应已注册')
  assert.ok(getErrorSpec('CS-FFMPEG-001'), 'CS-FFMPEG-001 应已注册')
})

test('auto 恢复错误：生产环境对用户静默，仅开发期记日志', () => {
  // CS-NET-002: audience=[developer], recoverability=auto
  const err = asCanvasError(new CanvasStudioError(getErrorSpec('CS-NET-002'), { detail: 'x' }))
  const prod = routeError(err, { devMode: false })
  assert.equal(prod.kind, 'silent-retry', '生产环境应静默重试，不报用户')
  const dev = routeError(err, { devMode: true })
  assert.equal(dev.kind, 'log-only', '开发期应落到日志')
})

test('仅 developer 受众错误：对用户完全隐藏', () => {
  // CS-FFMPEG-001: audience=[developer], recoverability=fatal
  const err = asCanvasError(new CanvasStudioError(getErrorSpec('CS-FFMPEG-001'), { detail: 'missing' }))
  const prod = routeError(err, { devMode: false })
  assert.equal(prod.kind, 'log-only', '生产环境应仅日志，用户无感知')
  const dev = routeError(err, { devMode: true })
  assert.equal(dev.kind, 'log-only')
})

test('面向用户的 guided 错误：按 channel 展示，开发期附 dev 细节', () => {
  // CS-COMP-001: audience=[user], channel=toast（无 devMessage）
  const toastSpec = getErrorSpec('CS-COMP-001')
  const toastErr = new CanvasStudioError(toastSpec)
  const prod = routeError(toastErr, { devMode: false })
  assert.equal(prod.kind, 'surface')
  assert.equal(prod.channel, 'toast')
  assert.ok(!prod.message.includes('[dev]'), '生产文案不应含 dev 细节')

  // CS-PROV-001: 带 devMessage，验证开发期附细节
  const spec = getErrorSpec('CS-PROV-001')
  const err = new CanvasStudioError(spec, { detail: 'missing key' })
  const dev = routeError(err, { devMode: true })
  assert.ok(dev.kind === 'surface' && dev.message.includes('[dev]'), '开发期文案应附 dev 细节')
  assert.ok(dev.message.includes('missing key'), 'dev 细节应含原始诊断')
})

test('throwError 按码抛结构错误', () => {
  let thrown
  try {
    throwError('CS-GEN-204', { n: '700', note: '后端当前有 3 个任务' })
  } catch (e) {
    thrown = e
  }
  assert.ok(thrown instanceof CanvasStudioError)
  assert.equal(thrown.code, 'CS-GEN-204')
  assert.equal(thrown.recoverableBy, 'user')
  assert.ok(thrown.userMessage.includes('700'), '模板变量应被填充')
})

test('asCanvasError 收敛遗留裸异常', () => {
  const err = asCanvasError(new Error('boom at /secret/path 127.0.0.1:8082'))
  assert.ok(err instanceof CanvasStudioError)
  assert.equal(err.code, 'CS-UNC-000')
})

test('validateSpec 拒绝 auto + 面向用户', () => {
  assert.throws(() => {
    registerError({
      code: 'CS-BAD-001',
      module: 'BAD',
      severity: 'S2',
      audience: ['user', 'developer'],
      recoverability: 'auto',
      channel: 'log',
      userMessage: 'x',
    })
  }, /recoverability=auto/)
})

test('sanitizeForUser 抹掉地址与路径', () => {
  const dirty = 'connect to http://117.50.108.73:8082 failed at /Users/x/secret/file.ts:12:3'
  const clean = sanitizeForUser(dirty)
  assert.ok(!clean.includes('117.50.108.73'), '内网地址应被隐藏')
  assert.ok(!clean.includes('http://'), 'URL 应被隐藏')
  assert.ok(!clean.includes('/Users/x'), '绝对路径应被隐藏')
})

test('开发模式开关生效', () => {
  setDevMode(true)
  assert.equal(isDevMode(), true)
  setDevMode(false)
  assert.equal(isDevMode(), false)
})
