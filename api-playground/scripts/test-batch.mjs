// 批量运行纯逻辑自测：草稿合并 / 参数矩阵展开 / 前置依赖解析。
//
// 这些函数决定「实际会发多少次请求、每次发什么值」。错了的后果不是报错，
// 而是「跑了 20 分钟才发现参数没生效」或「提示 8 次实际跑了 24 次」——
// 只能靠单测钉住。
//
// 用法：node scripts/test-batch.mjs   （需 Node >= 22.18）

const [maj, min] = process.versions.node.split('.').map(Number)
if (maj < 22 || (maj === 22 && min < 18)) {
  console.error(`✗ 需要 Node >= 22.18（原生 TS 类型剥离），当前 ${process.versions.node}`)
  process.exit(2)
}

const {
  EMPTY_MATRIX,
  MATRIX_DURATIONS,
  MATRIX_IMG_ASPECT,
  TXT2IMAGE_FIX_ID,
  UPLOAD_FIX_ID,
  CHAR_BASE_EPS,
  comboLabel,
  comboIdSuffix,
  expandMatrix,
  initialValues,
  mergeVals,
  resolveEffective,
  estimateCalls,
} = await import('../src/batch.ts')
const { ENDPOINTS, getEndpoint } = await import('../src/endpoints.ts')

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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ep = (id) => getEndpoint(id)

console.log('\n=== 批量运行纯逻辑自测 ===\n')

console.log('① 参数矩阵展开（笛卡尔积）：')
check('空矩阵 → 只有一个空组合', eq(expandMatrix(EMPTY_MATRIX), [{}]))
check('单轴 2 值 → 2 组合', eq(expandMatrix({ resolution: ['480p', '736p'], aspectRatio: [], duration: [] }), [{ resolution: '480p' }, { resolution: '736p' }]))
{
  const c = expandMatrix({ resolution: ['480p', '2k'], aspectRatio: ['16:9', '9:16'], duration: [] })
  check('2×2 → 4 组合', c.length === 4, `实际 ${c.length}`)
  check('组合键齐全', c.every((x) => x.resolution && x.aspectRatio && !x.duration))
}
{
  const c = expandMatrix({ resolution: ['480p', '736p', '2k'], aspectRatio: ['16:9', '9:16'], duration: ['5', '10'] })
  check('3×2×2 = 12 组合', c.length === 12, `实际 ${c.length}`)
  check('12 个组合互不重复', new Set(c.map((x) => JSON.stringify(x))).size === 12)
  check('键顺序稳定（报告 id 才不会跳）', c[0].resolution === '480p' && c[0].aspectRatio === '16:9' && c[0].duration === '5')
}
check('组合顺序是「后面的轴先动」', eq(expandMatrix({ resolution: ['a', 'b'], duration: ['1', '2'] })[1], { resolution: 'a', duration: '2' }))

console.log('\n② 组合标签与 id 后缀：')
check('空组合标签 = 默认', comboLabel({}) === '默认')
check('空组合不加后缀', comboIdSuffix({}) === '')
check('有值组合拼成 档位/宽高比/时长', comboLabel({ resolution: '480p', aspectRatio: '16:9', duration: '5' }) === '480p/16:9/5')
check('缺轴时跳过该段', comboLabel({ aspectRatio: '9:16' }) === '9:16')
check('id 后缀带 #', comboIdSuffix({ resolution: '2k' }) === '#2k')
check('不同组合后缀不碰撞', new Set(expandMatrix({ resolution: ['480p', '736p'], duration: ['5', '10'] }).map(comboIdSuffix)).size === 4)

console.log('\n③ 表单草稿合并优先级（注入值 > 矩阵 > 草稿 > 默认）：')
{
  const e = ep('txt2image')
  const v = mergeVals(e, {}, {}, 'ROLE', 'txt2image')
  check('无草稿 → 用端点默认（角色驱动字段取全局角色）', v.prompt === 'ROLE' && v.resolution === '736p', JSON.stringify(v))
}
{
  const e = ep('txt2image')
  const v = mergeVals(e, { txt2image: { prompt: '我手改的', resolution: '2k' } }, {}, 'ROLE', 'txt2image')
  check('有草稿 → 草稿覆盖默认', v.prompt === '我手改的' && v.resolution === '2k', JSON.stringify(v))
}
{
  const e = ep('txt2image')
  const v = mergeVals(e, { txt2image: { prompt: '我手改的', resolution: '2k' } }, { resolution: '480p' }, 'ROLE', 'txt2image')
  check('矩阵覆盖草稿', v.resolution === '480p', JSON.stringify(v))
}
{
  const e = ep('image2image')
  const v = mergeVals(e, {}, { resolution: '2k' }, 'R', 'image2image', { image1: 'ref-abc.png' })
  check('注入值最高优先（句柄不被矩阵/草稿挤掉）', v.image1 === 'ref-abc.png')
  check('注入值也挡住矩阵覆盖同名字段', mergeVals(e, {}, {}, 'R', 'image2image', { prompt: 'X' }).prompt === 'X')
}
{
  // 关键：矩阵只覆盖端点**真的有**的字段
  const e = ep('image2fix')
  const v = mergeVals(e, {}, { resolution: '2k', duration: '10' }, 'R', 'image2fix')
  check('矩阵不会给 image2fix 塞不存在的 resolution/duration', !('resolution' in v) && !('duration' in v), JSON.stringify(v))
}
{
  const e = ep('videoFl2va')
  const v = mergeVals(e, {}, { resolution: '2k', aspectRatio: '9:16', duration: '10' }, 'R', 'videoFl2va')
  check('视频端点三个矩阵轴都生效', v.resolution === '2k' && v.aspectRatio === '9:16' && v.duration === '10', JSON.stringify(v))
}
{
  const e = ep('txt2audio')
  const v = mergeVals(e, {}, {}, 'R', 'txt2audio')
  check('草稿按端点 id 隔离（不串味）', v.caption_prompt !== undefined && v.lyrics_prompt === '')
}
{
  // 每个端点都能生成一份不含 undefined 的值（防 initialValues 漏字段）
  const bad = ENDPOINTS.filter((e) => Object.values(mergeVals(e, {}, {}, 'R', e.id)).some((x) => x === undefined))
  check('全部端点生成的字段值无 undefined', bad.length === 0, bad.map((e) => e.id).join(', '))
  const missing = ENDPOINTS.filter((e) => e.fields.some((f) => !(f.key in mergeVals(e, {}, {}, 'R', e.id))))
  check('全部端点的字段都能被覆盖到', missing.length === 0, missing.map((e) => e.id).join(', '))
}

console.log('\n④ initialValues：')
{
  const v = initialValues(ep('image2vl'), 'ROLE')
  check('角色驱动字段取全局角色，非角色字段取 default', v.filename === '' && v.system_prompt.length > 0)
}
check('characterDriven 的端点提示词 = 传入角色', initialValues(ep('txt2image'), 'ZZZ').prompt === 'ZZZ')

console.log('\n⑤ 前置依赖解析：')
{
  const r = resolveEffective(new Set(['health']))
  check('只跑 health → 无前置', r.effective.size === 1 && r.prereq.length === 0)
}
{
  const r = resolveEffective(new Set(['image2image']))
  check('image2image 自动补 upload + txt2image', r.effective.has('upload') && r.effective.has('txt2image'))
  check('前置被标记（报告里要显示「自动前置」）', r.prereq.includes('upload') && r.prereq.includes('txt2image'))
}
{
  const r = resolveEffective(new Set(['image2fix']))
  check('image2fix → 文字场景基图链路', r.effective.has(TXT2IMAGE_FIX_ID) && r.effective.has(UPLOAD_FIX_ID))
  check('image2fix 不拉角色基图', !r.effective.has('txt2image'))
}
{
  const r = resolveEffective(new Set(['image2fix', 'image2image']))
  check('两条基图链路可共存且互不覆盖', r.effective.has(TXT2IMAGE_FIX_ID) && r.effective.has('txt2image'))
}
{
  const r = resolveEffective(new Set(['upload']))
  check('只跑 upload → 仍需 txt2image 供图', r.effective.has('txt2image'))
}
{
  const r = resolveEffective(new Set(['image2vl']))
  check('image2vl 是句柄依赖但不算 CHAR_BASE_EPS（任意图皆可）', !CHAR_BASE_EPS.includes('image2vl'))
  check('所以只跑 image2vl 不自动生成基图', r.prereq.length === 0, JSON.stringify(r.prereq))
}
{
  const r = resolveEffective(new Set(['videoFl2va', 'videoRef2va']))
  check('视频端点 → 角色基图链路', r.effective.has('upload') && r.effective.has('txt2image'))
  check('计数值 = 4（两视频 + upload + txt2image）', estimateCalls(new Set(['videoFl2va', 'videoRef2va'])) === 4)
}
check('estimates 与 effective 一致', estimateCalls(new Set(['image2image'])) === resolveEffective(new Set(['image2image'])).effective.size)

console.log('\n⑥ 与 UI 提示数的契约：')
{
  // UI 提示 = combos.length × estimateCalls(selected)，这里复算一遍防止两处漂移
  const selected = new Set(['image2image', 'image2fix'])
  const combos = expandMatrix({ resolution: ['480p', '736p'], aspectRatio: [], duration: [] })
  const shown = combos.length * estimateCalls(selected)
  const actual = combos.length * resolveEffective(selected).effective.size
  check('矩阵调用次数估算与实际一致', shown === actual, `${shown} vs ${actual}`)
  // 2 个勾选端点 + 两条基图链路各自的 2 步前置 = 6
  const members = [...resolveEffective(selected).effective].sort()
  check(
    '每组实际跑 6 个端点（勾选 2 + 前置 4）',
    eq(members, ['image2fix', 'image2image', 'txt2image', 'txt2image#fix', 'upload', 'upload#fix']),
    members.join(', '),
  )
}
check('MATRIX_DURATIONS 不含 15 以上（契约无 maximum，代价不成比例）', MATRIX_DURATIONS.every((d) => Number(d) <= 15) && !MATRIX_DURATIONS.includes('15'))
check('MATRIX_IMG_ASPECT 含方形但 VID 不支持 1:1', MATRIX_IMG_ASPECT.includes('1:1'))

console.log('\n=== 汇总 ===')
console.log(`通过 ${pass}  失败 ${failures.length}`)
if (failures.length > 0) {
  console.log('\n失败项：')
  for (const f of failures) console.log(`  · ${f}`)
}
process.exit(failures.length === 0 ? 0 : 1)
