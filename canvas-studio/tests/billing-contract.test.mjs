/**
 * 计费协议层纯函数（`src/drama-management.ts` 尾部 + `contracts/billing.ts`）。
 *
 * 锁三件事，都是**实测暴露过会出事**的地方：
 *   1. 上游 409 的 code 恒为 `conflict`，真实原因只在 message ⇒ 分类器必须覆盖全部分支，
 *      且未知 message 落到 `unknown` 而不是抛错；
 *   2. 交给渲染层的 URL 必须 host 全等（`endsWith` 会被 `checkout.stripe.com.evil.com`
 *      绕过 —— 这条 URL 最终会进 `shell.openExternal`）；
 *   3. 幂等键的字节与字符集约束（上游 1–200 可打印 ASCII），本地先拦能给出准确文案。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertTrustedUrl, classifyCheckoutConflict, isValidIdempotencyKey,
} from '../lib/drama-management.js'

test('classifyCheckoutConflict：五类 409 message 各归其位', () => {
  assert.equal(classifyCheckoutConflict('idempotency key conflict'), 'idem_mismatch')
  assert.equal(classifyCheckoutConflict('subscription checkout already pending'), 'pending')
  assert.equal(classifyCheckoutConflict('checkout expired'), 'expired')
  assert.equal(classifyCheckoutConflict('checkout failed'), 'expired')
  assert.equal(classifyCheckoutConflict('checkout already complete'), 'expired')
  assert.equal(classifyCheckoutConflict('subscription already active'), 'subscribed')
  assert.equal(classifyCheckoutConflict('stripe price not configured'), 'not_purchasable')
})

test('classifyCheckoutConflict：大小写不敏感 + 未知 message 落 unknown（不抛）', () => {
  assert.equal(classifyCheckoutConflict('IDEMPOTENCY KEY CONFLICT'), 'idem_mismatch')
  assert.equal(classifyCheckoutConflict('something exploded'), 'unknown')
  assert.equal(classifyCheckoutConflict(''), 'unknown')
})

test('assertTrustedUrl：只认 https + host 全等', () => {
  const ok = 'https://checkout.stripe.com/c/pay/cs_test_x#fid=1'
  assert.equal(assertTrustedUrl(ok, ['checkout.stripe.com'], 'checkout_url'), ok)
  // 后缀伪装必须被拒（endsWith 写法会放过它）。
  assert.throws(() => assertTrustedUrl('https://checkout.stripe.com.evil.com/x', ['checkout.stripe.com'], 'u'),
    /不可信地址/)
  // 协议必须是 https。
  assert.throws(() => assertTrustedUrl('http://checkout.stripe.com/x', ['checkout.stripe.com'], 'u'), /不可信地址/)
  // 非 URL / 缺失 / 非字符串。
  assert.throws(() => assertTrustedUrl('not a url', ['checkout.stripe.com'], 'u'), /不是合法 URL/)
  assert.throws(() => assertTrustedUrl(undefined, ['checkout.stripe.com'], 'u'), /缺少 u/)
  assert.throws(() => assertTrustedUrl(123, ['checkout.stripe.com'], 'u'), /缺少 u/)
})

test('isValidIdempotencyKey：1–200 可打印 ASCII', () => {
  assert.equal(isValidIdempotencyKey('3f2504e0-4f89-41d3-9a0c-0305e82c3301'), true)
  assert.equal(isValidIdempotencyKey('!'), true)
  assert.equal(isValidIdempotencyKey(''), false, '空键必须被拦')
  assert.equal(isValidIdempotencyKey('has space'), false, '空格（0x20）不在 33–126')
  assert.equal(isValidIdempotencyKey('换行\n'), false)
  assert.equal(isValidIdempotencyKey('中文键'), false)
  assert.equal(isValidIdempotencyKey('a'.repeat(200)), true)
  assert.equal(isValidIdempotencyKey('a'.repeat(201)), false, '超过 200 字节上游会 400')
  assert.equal(isValidIdempotencyKey(undefined), false)
})
