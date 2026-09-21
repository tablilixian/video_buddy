// 负向用例判定自测 + 用例表完整性护栏。
//
// 判定逻辑是「期望被挡住」的镜像判定，写反了会把「后端放行坏请求」判成通过 ——
// 比正向漏判更危险，所以这里正/反两侧都要钉住。
//
// 用法：node scripts/test-negative.mjs   （需 Node >= 22.18）

const [maj, min] = process.versions.node.split('.').map(Number)
if (maj < 22 || (maj === 22 && min < 18)) {
  console.error(`✗ 需要 Node >= 22.18（原生 TS 类型剥离），当前 ${process.versions.node}`)
  process.exit(2)
}

const { NEGATIVE_CASES, judgeNegative, negativePath } = await import('../src/negative.ts')
const { getEndpoint } = await import('../src/endpoints.ts')

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

const byId = (id) => NEGATIVE_CASES.find((c) => c.id === id)
const judge = (id, status, json) => judgeNegative(byId(id), status, json)

console.log('\n=== 负向用例判定自测 ===\n')

console.log('必须拦住的错误判法：')
{
  const r = judge('neg.missing-prompt', 200, { full_url: 'http://x/a.png' })
  check('后端放行坏请求（200）→ 判失败', r.pass === false, JSON.stringify(r))
  check('放行时的措辞点明「被放行」', (r.failures[0] || '').includes('放行'))
}
{
  const r = judge('neg.missing-prompt', 422, { detail: [{ loc: ['body', 'width'], msg: 'x' }] })
  check('422 但 loc 指错字段 → 判失败', r.pass === false, JSON.stringify(r))
  check('指错字段时把实际定位说出来', (r.failures[0] || '').includes('width'))
}
{
  const r = judge('neg.missing-prompt', 422, { detail: 'Validation Error' })
  check('422 但无 detail 数组 → 判失败', r.pass === false)
  check('无定位时说明「未解析出任何字段」', (r.failures[0] || '').includes('未解析出任何字段'))
}
{
  const r = judge('neg.missing-prompt', 422, {})
  check('422 空体 → 判失败', r.pass === false)
}
{
  const r = judge('neg.bad-aspect-enum', 500, null)
  check('该 422 却 500（崩溃而非校验）→ 判失败', r.pass === false, JSON.stringify(r))
  check('措辞区分「挡住的方式不符预期」', (r.failures[0] || '').includes('挡住的方式不符预期'))
}
{
  const r = judge('neg.product-name-as-handle', 200, { full_url: 'http://x/a.png' })
  check('产物名当句柄却成功 → 判失败', r.pass === false)
}
{
  const r = judge('neg.missing-prompt', 0, null)
  check('后端不可达（status 0）→ 判失败', r.pass === false)
  check('不可达时不误判成「被挡住」', (r.failures[0] || '').includes('没有拿到 HTTP 响应'))
}

console.log('\n必须放行的正确判法：')
{
  const r = judge('neg.missing-prompt', 422, { detail: [{ loc: ['body', 'prompt'], msg: 'Field required', type: 'missing' }] })
  check('422 且 loc 命中 prompt → 通过', r.pass === true, JSON.stringify(r))
  check('通过摘要写明命中字段', r.note.includes('prompt'))
}
{
  const r = judge('neg.product-name-as-handle', 500, null)
  check('期望 500 且实际 500 → 通过', r.pass === true, JSON.stringify(r))
}
{
  const r = judge('neg.nonexistent-handle', 404, { detail: 'Not Found' })
  check('可接受集合内的 404 → 通过', r.pass === true, JSON.stringify(r))
}
{
  const r = judge('neg.bad-duration-type', 422, { detail: [{ loc: ['body', 'duration'], msg: 'Input should be a valid integer', type: 'int_parsing' }] })
  check('duration 类型错被精确定位 → 通过', r.pass === true, JSON.stringify(r))
}
{
  const r = judge('neg.upload-without-file', 422, { detail: [{ loc: ['body', 'file'], msg: 'Field required', type: 'missing' }] })
  check('上传不带文件被定位到 file → 通过', r.pass === true, JSON.stringify(r))
}
{
  // expectField 但状态码不是 422 时不该强求 loc（如后端改报 400）——显式钉住这个有意的宽松
  const loose = { ...byId('neg.missing-prompt'), expectStatus: [400] }
  const r = judgeNegative(loose, 400, { detail: 'bad request' })
  check('非 422 的 4xx 不强求 loc 定位', r.pass === true, JSON.stringify(r))
}
{
  const loose = { ...byId('neg.missing-prompt'), expectStatus: [] }
  const r = judgeNegative(loose, 503, { detail: 'down' })
  check('expectStatus 为空 = 任何非 2xx 都算挡住', r.pass === true, JSON.stringify(r))
}

console.log('\n用例表完整性护栏：')
{
  const ids = NEGATIVE_CASES.map((c) => c.id)
  check('用例 id 唯一', new Set(ids).size === ids.length)
  check('用例数 ≥ 8', NEGATIVE_CASES.length >= 8, `实际 ${NEGATIVE_CASES.length}`)
  const badWhy = NEGATIVE_CASES.filter((c) => !c.why || c.why.trim().length < 10).map((c) => c.id)
  check('每条用例都写了依据 why（防无据断言）', badWhy.length === 0, badWhy.join(', '))
  const badEp = NEGATIVE_CASES.filter((c) => getEndpoint(c.endpoint) === undefined).map((c) => c.id)
  check('每条用例的 endpoint 都能解析', badEp.length === 0, badEp.join(', '))
  const badPath = NEGATIVE_CASES.filter((c) => negativePath(c) === '').map((c) => c.id)
  check('每条用例都能取到 path', badPath.length === 0, badPath.join(', '))
  const noExpect = NEGATIVE_CASES.filter((c) => c.expectStatus.length === 0).map((c) => c.id)
  check('每条用例都声明了可接受状态码', noExpect.length === 0, noExpect.join(', '))
  const bad422 = NEGATIVE_CASES.filter((c) => c.expectStatus.includes(422) && !c.expectField).map((c) => c.id)
  check('期望 422 的用例必须声明 expectField（否则只验了状态码）', bad422.length === 0, bad422.join(', '))
  // 不该出现「时长 > 15」这种无契约依据的用例
  const durCase = NEGATIVE_CASES.filter((c) => JSON.stringify(c.body ?? {}).includes('"duration":2') || JSON.stringify(c.body ?? {}).includes('"duration":1'))
  check('没有基于「时长上限 15」的用例（契约里无 maximum）', durCase.length === 0, durCase.map((c) => c.id).join(', '))
}

console.log('\n=== 汇总 ===')
console.log(`通过 ${pass}  失败 ${failures.length}`)
if (failures.length > 0) {
  console.log('\n失败项：')
  for (const f of failures) console.log(`  · ${f}`)
}
process.exit(failures.length === 0 ? 0 : 1)
