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
