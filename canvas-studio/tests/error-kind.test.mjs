/**
 * error-kind 错误分级纯函数冒烟测试（brand-identity-proposal.md §6.1）。
 * 直连 Host tsc 编译产物 lib/error-kind.js。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyStudioError } from '../lib/error-kind.js'

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

test('classifyStudioError：不可达优先于配置（连接失败先提示服务）', () => {
  assert.equal(classifyStudioError('ECONNREFUSED: api key check failed'), 'unreachable')
})
