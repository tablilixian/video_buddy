/**
 * REQ-034 · O-11：`qc_shot` 的逐镜基准（`deriveQcContext` / `buildQcPrompt`）。
 *
 * 真机症状：手部微距被判 FAIL，理由是「未呈现面部与发型」「与期望的中长焦中景交替、
 * 固定机位不符」—— 那是**另一镜**的语汇。根因是提示词只有全局资产卡基准，没有
 * 「本镜自己长什么样」。这两条断言分别守「读得到本镜基准」与「提示词真的用了它」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQcPrompt, deriveQcContext } from '../lib/quality-check.js'

const CARD = [
  '【镜 3】指腹压在木纹桌面上，微距，指甲边缘有一道浅划痕',
  '【运镜】固定机位，微距推近',
  '【声音】—',
  '【面部】无（不做外貌核对）',
].join('\n')

test('deriveQcContext：从分镜卡正文取本镜运镜/视觉，并识别「不看脸」标记', () => {
  const ctx = deriveQcContext(CARD)
  assert.match(ctx.shotFocus, /运镜：固定机位，微距推近/)
  assert.match(ctx.shotFocus, /视觉：指腹压在木纹桌面上/)
  assert.equal(ctx.noFace, true)
})

test('deriveQcContext：普通卡（无【面部】行）⇒ noFace=false，只看脸该看', () => {
  const ctx = deriveQcContext('【镜 1】苏婉站在门口\n【运镜】Push in')
  assert.equal(ctx.noFace, false)
  assert.match(ctx.shotFocus, /运镜：Push in/)
})

test('deriveQcContext：全是「—」的空卡 ⇒ 空 shotFocus（调用方据此不写本镜基准段）', () => {
  const ctx = deriveQcContext('【镜 2】—\n【运镜】—\n【声音】雨声')
  assert.equal(ctx.shotFocus, '')
  assert.equal(ctx.noFace, false)
})

test('buildQcPrompt：传了 shotFocus ⇒ 写「本镜基准」并禁止拿别的镜的景别评价本镜', () => {
  const prompt = buildQcPrompt('【角色】苏婉，短发', { shotFocus: '运镜：固定机位，微距推近' })
  assert.match(prompt, /【本镜基准（这一镜自己的景别与机位）】运镜：固定机位，微距推近/)
  assert.match(prompt, /不要套用其它镜的描述/)
})

test('buildQcPrompt：facesVisible=false ⇒ 去掉外貌核对项，并写明「没有脸是正常的」', () => {
  const prompt = buildQcPrompt('【角色】苏婉，短发', { facesVisible: false })
  assert.match(prompt, /不要核对人物外貌/)
  assert.match(prompt, /没有脸、发型、五官是正常的/)
  assert.doesNotMatch(prompt, /逐项核对画面中的固定要素：人物外貌/)
})

test('buildQcPrompt：缺省（facesVisible 未传）仍核对外貌，且不写本镜基准段（老行为逐字不变）', () => {
  const legacy = buildQcPrompt('【角色】苏婉，短发')
  assert.match(legacy, /人物外貌（脸型\/发型\/发色）/)
  assert.doesNotMatch(legacy, /【本镜基准/)
  assert.doesNotMatch(legacy, /没有脸、发型、五官是正常的/)
})
