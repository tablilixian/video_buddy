// 判定层自测（无框架，零依赖）。
//
// 为什么必须有：断言层是「判定别人对错」的代码，它自己错了会把整份报告的可信度
// 一起带走。这里用**实测留档里的真实响应体**做正例（image2fix-20260918/report.md、
// video-backend-test 留档的 {"status":"ok"}），用「只把关键字段抠掉」的变体做反例 ——
// 反例必须报错，否则断言等于没写。
//
// 用法：node scripts/test-verdict.mjs        （需 Node >= 22.18 原生剥离 TS）

const [maj, min] = process.versions.node.split('.').map(Number)
if (maj < 22 || (maj === 22 && min < 18)) {
  console.error(`✗ 需要 Node >= 22.18（原生 TS 类型剥离），当前 ${process.versions.node}`)
  process.exit(2)
}

const { ENDPOINTS } = await import('../src/endpoints.ts')
const { evaluate, extractValidationFields, describeHttpError, resolveAssertTarget, hasAssertion } = await import('../src/verdict.ts')

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

/** 期望「通过」。 */
function ok(name, id, json) {
  const v = evaluate(id, 200, json)
  check(name, v.pass === true, v.failures.join('；'))
}
/** 期望「断言失败」，且可选的失败关键词命中其一。 */
function bad(name, id, json, keyword) {
  const v = evaluate(id, 200, json)
  const hit = v.pass === false && (!keyword || v.failures.some((f) => f.includes(keyword)))
  check(name, hit, `pass=${v.pass} failures=${JSON.stringify(v.failures)}`)
}

console.log('\n=== 判定层自测 ===\n')

// —— 正例：全部取自实测留档 ——
console.log('正例（实测留档的原始响应体）：')
// image2fix-20260918/report.md 原文
ok('txt2image 真实响应', 'txt2image', {
  prompt_id: 'd34044ac-13f6-4554-97c1-dcda9ce66c8d',
  filename: 'krea2_00140_.png',
  full_url: 'http://117.50.108.73:8082/view?filename=krea2_00140_.png',
  duration: 14.94,
})
ok('image2fix 真实响应', 'image2fix', {
  prompt_id: 'ced073c7-eda9-427d-a373-03064916f242',
  filename: 'boogu_00009_.png',
  full_url: 'http://117.50.108.73:8082/view?filename=boogu_00009_.png',
  duration: 68.46,
})
ok('upload 真实响应（subfolder 为空串是正常的）', 'upload', {
  name: 'ref-a8035d1b.png',
  subfolder: '',
  type: 'input',
})
ok('image2vl 真实响应', 'image2vl', { prompt_id: 'abe45e45-03c3-4032-be25-1b1363e4f5a9', output: 'SUMMER SALE 50% OFF', duration: 4.39 })
ok('health 真实响应', 'health', { status: 'ok' })
ok('生成类回退形态 data[0].url', 'image2image', { data: [{ url: 'http://x/a.png' }] })
ok('合成 id 能映射回真端点（#fix）', 'txt2image#fix', { full_url: 'http://x/a.png' })
ok('合成 id 能映射回真端点（矩阵后缀）', 'image2image#480p/16:9', { full_url: 'http://x/a.png' })

// —— 反例：只抠掉关键字段，必须报错 ——
console.log('\n反例（抠掉关键字段，必须判失败）：')
bad('200 但缺产物 URL', 'txt2image', { prompt_id: 'x', filename: 'krea2_00140_.png' }, '缺少产物 URL')
bad('200 但 full_url 为空串', 'txt2image', { full_url: '' }, '缺少产物 URL')
bad('200 但 data[0].url 为空串', 'image2image', { data: [{ url: '' }] }, '缺少产物 URL')
bad('200 但 duration 类型错', 'txt2image', { full_url: 'http://x/a.png', duration: '68.46' }, 'duration 应为 number')
bad('200 但 filename 为空串', 'image2image', { full_url: 'http://x/a.png', filename: '  ' }, 'filename 存在但为空串')
bad('响应体不是对象', 'txt2image', 'Internal Server Error', '不是 JSON 对象')
bad('响应体是数组', 'txt2image', [1, 2], '不是 JSON 对象')
bad('200 但 upload 缺 name', 'upload', { subfolder: '', type: 'input' }, '缺少 name')
bad('200 但 name 是空串', 'upload', { name: '' }, '缺少 name')
bad('200 但 VL 无 output', 'image2vl', { prompt_id: 'x' }, '缺少文本结果')
bad('200 但 output 为空串', 'image2vl', { output: '   ' }, '缺少文本结果')
bad('200 但 health 非 ok', 'health', { status: 'down' }, 'status 应为 "ok"')
bad('200 但 health 空对象', 'health', {}, '空对象')
bad('200 但 health 含非字符串值', 'health', { status: 'ok', uptime: 123 }, '非字符串值')

// —— HTTP 层 ——
console.log('\nHTTP 层（非 2xx 一律 FAIL，并把后端错误抽成人话）：')
const v500 = evaluate('image2fix', 500, null)
check('500 → FAIL', v500.pass === false)
check('500 → 摘要含 500', (v500.httpError || '').includes('500'))
const v422 = evaluate('txt2image', 422, {
  detail: [{ loc: ['body', 'duration'], msg: 'Input should be a valid integer', type: 'int_parsing' }],
})
check('422 → FAIL', v422.pass === false)
check('422 → 摘要点名字段 duration', (v422.httpError || '').includes('duration'))
check('422 → 摘要保留 msg', (v422.httpError || '').includes('valid integer'))
check('422 → 摘要去掉 body 前缀', !(v422.httpError || '').includes('body.'))
const v0 = evaluate('health', 0, null)
check('status 0（超时/中断）→ FAIL', v0.pass === false)
check('status 0 → 不报误导性的 "HTTP 0"', !(v0.failures[0] || '').includes('HTTP 0'))
const v0t = evaluate('health', 0, null, 'connect ECONNREFUSED 127.0.0.1:5189')
check('status 0 → 摘要带出真实传输层原因', (v0t.failures[0] || '').includes('ECONNREFUSED'))
check('status 0 + 无原因 → 仍可读', (v0.failures[0] || '').includes('没有拿到 HTTP 响应'))

// —— loc 抽取 ——
console.log('\n422 loc 抽取（负向用例靠它验证「定位准不准」）：')
check('抽出 duration', JSON.stringify(extractValidationFields({ detail: [{ loc: ['body', 'duration'] }] })) === '["duration"]')
check('抽出 aspect', JSON.stringify(extractValidationFields({ detail: [{ loc: ['body', 'aspect'] }] })) === '["aspect"]')
check('抽出嵌套字段 image1', JSON.stringify(extractValidationFields({ detail: [{ loc: ['body', 'image1'] }] })) === '["image1"]')
check('多错误去重', JSON.stringify(extractValidationFields({ detail: [{ loc: ['body', 'a'] }, { loc: ['body', 'a'] }, { loc: ['body', 'b'] }] })) === '["a","b"]')
check('非 body 段（query）也能抽', JSON.stringify(extractValidationFields({ detail: [{ loc: ['query', 'x'] }] })) === '["x"]')
check('无 detail → 空数组', extractValidationFields({ msg: 'boom' }).length === 0)
check('detail 是字符串 → 空数组', extractValidationFields({ detail: 'Not Found' }).length === 0)

// —— 描述函数自身 ——
console.log('\ndescribeHttpError：')
check('detail 为字符串时直接回显', describeHttpError(404, { detail: 'Not Found' }).includes('Not Found'))
check('error.message 形态也能读出', describeHttpError(500, { error: { message: 'boom' } }).includes('boom'))

// —— 契约护栏：新加端点忘记写断言必须被拦下 ——
console.log('\n契约护栏：')
const noAssert = ENDPOINTS.filter((e) => !hasAssertion(e.id)).map((e) => e.id)
check(`全部 ${ENDPOINTS.length} 个端点都声明了结构断言`, noAssert.length === 0, `缺断言的端点：${noAssert.join(', ')}`)
check('合成 id 前缀解析不掉字', resolveAssertTarget('upload#fix')?.id === 'upload')
check('fetch-to-upload 归并为 upload 的断言', resolveAssertTarget('fetch-to-upload')?.id === 'upload')
check('fetch-to-upload#fix 也归并', resolveAssertTarget('fetch-to-upload#fix')?.id === 'upload')
check('未知 id 返回 undefined', resolveAssertTarget('nope#x') === undefined)
// fetch-to-upload 是句柄链路的关键一跳，不能退化成「仅 HTTP」
check('/api/fetch-to-upload 的响应体会被真判', hasAssertion('fetch-to-upload'))

console.log('\n=== 汇总 ===')
console.log(`通过 ${pass}  失败 ${failures.length}`)
if (failures.length > 0) {
  console.log('\n失败项：')
  for (const f of failures) console.log(`  · ${f}`)
}
process.exit(failures.length === 0 ? 0 : 1)
