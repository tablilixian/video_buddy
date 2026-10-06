/**
 * REQ-005 v1.4（CV-261）首页素材暂存链路守卫。
 *
 * 用户反馈起点：「上传文字/mp4/mp3 显示了『仅支持 PNG、JPG、WebP、GIF』」——
 * 宿主附件通道固定只收图片，而首页又没有项目（`/canvas-studio/upload*` 全要 projectId），
 * 于是四类素材在首页「既传不了、也看不见」。诉求原话：「不上传后台，显示出来即可，
 * 等点击开始对话后，再直接落到画布上…可以理解为是暂存并展示」。
 *
 * 这条链路跨四个文件、三个时刻（拖入 → 发送认领 → 落盘），任何一环脱落，表象都是
 * 「素材不见了」或「又弹不支持」—— 真机不点一遍看不出来。故本文件按**时刻**分四组守：
 *
 * 1. 登记（lobby-stash + store）：分类与限额单一来源、File 句柄在模块级表里；
 * 2. 入口（StudioFrame 拖放 + LobbyHero 选择器）：两条入口汇到同一份登记；
 * 3. 展示（LobbyStashBar）：只在首页、空则不占位、读数不说谎（「已暂存」≠「已就绪」）；
 * 4. 落地（index.ts 认领分支）：**先等画布载入再落素材**，令牌并进正文后放行；
 *    失败件留在清单里（不静默吞掉 —— 那正是本题的起点）。
 *
 * 与其余 client 守卫同一立场：客户端代码打成单包（无 lib/client/*.js 可 import），
 * 所以读源码 + 剥注释，并守住「判定对了但没接上 = 等于没做」。
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** 只剥块注释与整行注释（叮嘱会长在注释里，别让它们替实现挡枪）。 */
function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const STASH = readSource('../src/client/lobby-stash.ts')
const STORE = readSource('../src/client/project-store.ts')
const FRAME = readSource('../src/client/StudioFrame.tsx')
const HERO = readSource('../src/client/LobbyHero.tsx')
const BAR = readSource('../src/client/LobbyStashBar.tsx')
const INDEX = readSource('../src/client/index.ts')
const STYLES = readSource('../src/client/styles.ts')
/**
 * 剥掉 CSS 注释的样式源码（只用于「材料纪律」那一条）。
 *
 * 必须剥：注释里**引用**效果图的 rgba(255,255,255,.075) 恰恰是在说明「为什么不这么写」，
 * 拿原文去判会把最该留下的那段说明判成违规 —— 反过来，不剥就会漏掉真写在规则里的字面量。
 */
const STYLES_CODE = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

test('CV-261 登记：分类与限额必须复用四类白名单（不得另写一套）', () => {
  // 白名单/限额/标签的唯一来源是 media-extension.ts（Host 侧落盘校验同源）——
  // 首页自己再列一遍扩展名，就会出现「首页肯收、Host 拒收」这种只会在真机踩到的分叉。
  assert.match(STASH, /classifyFile\(file\.name\)/, '分类必须走 classifyFile')
  assert.match(STASH, /MEDIA_UPLOAD_LIMITS\[kind\]/, '限额必须取四类限额表（本地先判，别等落盘失败）')
  assert.match(STASH, /MEDIA_KIND_LABEL\[kind\]/, '超限文案的类别名必须取共用标签表')
  assert.match(STASH, /mediaAcceptAttribute\(\)/, 'accept 必须是四类白名单并集')
  assert.doesNotMatch(STASH, /'\.mp4'|'\.mp3'|'\.png'/,
    '不得在首页暂存里硬写扩展名字面量（白名单只有一份）')
  // 未知扩展与超限**分开**两类结论：用户此前收到的是一句把所有类别都排除掉的提示，
  // 含糊的「不支持」正是困惑的来源。
  assert.match(STASH, /unknown: string\[\]/, '未知扩展必须单独归类（文案要说清是哪一类问题）')
  assert.match(STASH, /oversized: string\[\]/, '超限必须单独归类')
})

test('CV-261 登记：File 句柄留在模块级表，store 只存展示事实', () => {
  // File 不可序列化，而 store 快照会被订阅层/日志层读取 —— 与 index.ts 的
  // pendingBriefs 同一手法：store 存事实，模块级表存句柄，两边用 id 关联。
  assert.match(STASH, /const files = new Map<string, File>\(\)/, '必须有模块级 File 表')
  assert.match(STASH, /files\.set\(id, file\)/, '登记时必须把 File 放进表里')
  assert.match(STASH, /files\.get\(item\.id\)/, '取出时必须按 id 回查 File')
  assert.match(STASH, /URL\.createObjectURL\(file\)/, '图片/视频必须有本地预览 URL（否则图位是空的）')
  // objectURL 的生命周期绑在条目上：消费/摘除时回收，组件不做（组件卸载≠条目消失）。
  assert.match(STASH, /URL\.revokeObjectURL\(item\.objectUrl\)/, '回收必须成对出现（否则整个会话都在漏 blob）')
  assert.doesNotMatch(STASH, /projectId/, '登记侧不得出现 projectId —— 首页根本没有项目，这正是它存在的理由')
})

test('CV-261 store：lobbyStash 三件动作 + 初值空 + 落盘后可清', () => {
  assert.match(STORE, /lobbyStash: readonly LobbyStashItem\[\]/, 'state 必须有 lobbyStash')
  assert.match(STORE, /lobbyStash: \[\],/, '初值必须是空数组（暂存不跨重启复活）')
  assert.match(STORE, /stashLobbyFiles: \(draft, items\) =>/, '必须实现登记动作')
  assert.match(STORE, /dismissLobbyStash: \(draft, id\) =>/, '必须实现摘除动作')
  assert.match(STORE, /clearLobbyStash: \(draft\) => \{ draft\.lobbyStash = \[\] \}/, '必须实现清空动作')
  assert.doesNotMatch(STORE, /lobbyStash: Readonly<Record<string,/,
    '暂存是**全局一条**（首页无 projectId 可分桶），不得按项目分桶')
})

test('CV-261 入口（REQ-028 重塑）：拖放 / 参考内容方框 / 粘贴三条路汇到同一份登记', () => {
  // 三条入口（拖入 / 方框「本地文件」选 / Ctrl+V 粘贴）必须共用分类、限额与拒收
  // 提示 —— 各写一套迟早分叉。REQ-028 后显式入口从 LobbyHero 的 📎 按钮迁到
  // LobbyStashBar 的「参考内容」方框（入口唯一，D4 纪律）。
  assert.match(FRAME, /const handleStashedFiles = /, '首页暂存必须只有一个登记实现')
  assert.match(FRAME, /stashLobbyFiles\(files, actions\)/, '登记必须走 lobby-stash 的纯函数')
  assert.match(FRAME, /不支持的文件类型：\$\{result\.unknown\.join\('、'\)\}/,
    '未知扩展必须给用户可见提示（绝不静默 —— 与 handleDroppedFiles 同一纪律）')
  assert.match(FRAME, /超出大小限制：\$\{result\.oversized\.join\('、'\)\}/,
    '超限必须当场告诉用户（落盘失败时首页已卸载，提示没有出口）')
  // 参考内容方框与 StudioFrame 分属两棵树（dock 组件经 index.ts 注册）：
  // 组件只 dispatch 事件，登记/提示仍只有 StudioFrame 一份实现。
  assert.match(BAR, /LOBBY_STASH_FILES_EVENT/, '「本地文件」来源项必须发暂存事件（不自带第二份登记）')
  assert.match(BAR, /LOBBY_OPEN_LIBRARY_EVENT/, '「资产库」来源项必须发开浮层事件')
  assert.match(BAR, /LOBBY_STASH_ACCEPT/, 'accept 必须取四类白名单并集')
  assert.match(BAR, /type="file"/, '必须有原生文件选择器')
  assert.match(BAR, /multiple/, '必须支持多选（一次拖不动就一次选完）')
  assert.match(BAR, /event\.target\.value = ''/, '选完必须清空 input.value（否则同一个文件选第二次不触发 change）')
  assert.match(FRAME, /addEventListener\(LOBBY_STASH_FILES_EVENT, onStashFiles\)/,
    'StudioFrame 必须接暂存事件（组件只发不登记）')
  assert.match(FRAME, /addEventListener\(LOBBY_OPEN_LIBRARY_EVENT, onOpenLibrary\)/,
    'StudioFrame 必须接开浮层事件')
  assert.match(FRAME, /addEventListener\('paste', onPaste, true\)/,
    'lobby 态必须接管 document paste（文件进暂存，与拖放同一纪律）')
  // 入口唯一：LobbyHero 不再有第二枚素材入口（📎 按钮随 REQ-028 退役）。
  assert.doesNotMatch(HERO, /onStashFiles|添加素材/, 'LobbyHero 不得残留素材入口（入口唯一，迁往参考内容方框）')
})

test('CV-261 展示（REQ-028 v2 形态）：参考内容方框常驻、缩略图排队、读数不说谎', () => {
  // v2 的 ＋ 方框**就是**常驻入口（v1.4「空则不渲染」会让空态没有任何可点的地方
  // ——那正是「不知道能传视频」的成因）；work 态仍一个 DOM 都不出。
  assert.match(BAR, /if \(projectId !== null\) return null/, '非首页必须返回 null')
  assert.match(BAR, /csLobbyAttach/, '必须用 v2 的方框队列形态（58×58 虚线方框 + 缩略图）')
  assert.match(BAR, /参考内容/, '方框文案必须是「参考内容」（演示逐字）')
  // 双来源（拍板：先选素材来源再落盘）。
  assert.match(BAR, /本地文件…/, '来源项一：本地文件（多选）')
  assert.match(BAR, /资产库/, '来源项二：资产库')
  // CV-261 的「未上传 / 发送后落画布」说明收进弹出框脚注 —— 形态变了，
  // 「发出去之后会发生什么」的出口不能丢（这正是上一次用户反馈的焦点）。
  assert.match(BAR, /发送第一句话后自动落进画布/, '脚注必须写明发送后会发生什么')
  assert.doesNotMatch(BAR, /已就绪/,
    '不得写「已就绪」（那是 .csUploadBar 的读数，用在这里会在随后落盘失败时自相矛盾）')
  assert.match(BAR, /dismissStash\(item\.id\)/, '移除必须接上回调')
})

test('CV-261 落地：四类各有落卡动作，且先载画布再落素材再放行', () => {
  // 四类各自的落卡动作（节点形态不同：图片有框、视频有框+时长、音频窄条、文本便签）。
  assert.match(INDEX, /const landStudioFiles = async \(/, '必须抽出一份四类落盘实现')
  assert.match(INDEX, /actions\.addImportNode\(projectId, item\.url/, '图片必须落 addImportNode')
  assert.match(INDEX, /actions\.addVideoNode\(projectId, \{/, '视频必须落 addVideoNode')
  assert.match(INDEX, /actions\.addAudioNode\(projectId, item\.url/, '音频必须落 addAudioNode')
  assert.match(INDEX, /actions\.addTextAssetNode\(projectId, item\.url/, '文本必须落 addTextAssetNode')
  // 附件改道与首页暂存共用同一份落盘实现（同一个文件两条入口必须得到同一个节点）。
  assert.match(INDEX, /const divertAttachments = async \([\s\S]{0,900}?await landStudioFiles\(projectId, files, signal\)/,
    '对话附件旁路必须复用 landStudioFiles（不得留第二份落盘实现）')

  const claimAt = INDEX.indexOf('const claimAndSend')
  assert.ok(claimAt > 0, '找不到认领分支')
  const claimBody = INDEX.slice(claimAt, INDEX.indexOf('conversation.sendSession = (', claimAt))
  const reloadAt = claimBody.indexOf('await reloadCanvasQueued(project.id)')
  const landAt = claimBody.indexOf('await landLobbyStash(project.id')
  const mergeAt = claimBody.indexOf('const merged =')
  const divertAt = claimBody.indexOf('return divertSend(args)')
  // 顺序即正确性：addImportNode 一族在 nodes[projectId] 尚未建立时直接 return
  //（节点表是载入才建的），抢在重载前面落 = 素材静默不落卡。
  assert.ok(reloadAt > 0, '认领后必须**等**画布载入完成（不能 void 掉就往下走）')
  assert.ok(landAt > reloadAt, '素材必须在画布载入完成之后落')
  assert.ok(mergeAt > landAt, '正文合并必须在落盘之后（令牌是落盘产物）')
  assert.ok(divertAt > mergeAt, '必须先把暂存令牌并进正文，再经 divertSend 放行')
  assert.match(claimBody, /args = \[session, merged, attachmentIds, mode, args\[4\]\]/,
    '合并后的正文必须回写到 args（否则 @ref 不会进消息）')

  // 失败件留在清单里：只摘落成的那几条。
  assert.match(INDEX, /const kept = pairs\.filter\(\(_, index\) => outcome\.landed\[index\] !== true\)/,
    '落盘失败的条目必须留在清单里（回首页还能看见、还能重发）')
  assert.match(INDEX, /const done = pairs\.filter\(\(_, index\) => outcome\.landed\[index\] === true\)/,
    '只有确认落成（节点回查命中）的条目才摘掉 —— 谎报成功会让用户的文件静默消失')
})

test('CV-261 接线：暂存条必须挂宿主槽、在规格行之后、带 id', () => {
  assert.match(INDEX, /id: 'canvas-studio-lobby-stash'/, 'input.dock 上的暂存条槽必须带 id（缺了运行时抛）')
  assert.match(INDEX, /\}, LobbyStashBar\)/, '暂存条必须注册到宿主槽')
  // order -4：排在规格行（-5）之后 ⇒ 紧贴对话卡，与效果图的次序一致
  // [规格 deck][暂存条][对话卡]。它讲的是「这条消息带什么」，贴着输入框才读得通。
  const at = INDEX.indexOf("id: 'canvas-studio-lobby-stash'")
  const block = INDEX.slice(at, INDEX.indexOf('}, LobbyStashBar)', at))
  assert.match(block, /order: -4/, '暂存条必须排在规格行之后（order -4）')
  assert.match(block, /dismissStash: \(id: string\) => \{ dismissLobbyStashItem\(id, storeInstance\.actions\) \}/,
    '移除必须同时收尾文件侧（只少一条 store 记录 = 文件句柄泄漏）')
})

test('CV-261 样式（REQ-028 v2）：参考内容方框与卡内容左缘对齐，且不写死白色叠加', () => {
  const barAt = STYLES.indexOf('.csLobbyAttach {')
  assert.ok(barAt > 0, '必须有 .csLobbyAttach 规则（v2 方框队列的 dock 行）')
  const bar = STYLES.slice(barAt, STYLES.indexOf('.csLobbyThumb {', barAt))
  assert.match(bar, /max-width: var\(--dsh-chat-content-width, 748px\)/,
    '盒宽必须与对话卡内容左缘对齐（attach 条读作「卡片的第一行」）')
  assert.match(bar, /padding: 0;/, '不得自带侧内边距 —— 否则与卡片内容左缘错开')
  assert.doesNotMatch(bar, /clearance/,
    '不得抄 .csUploadBar 的 clearance 内边距（那条永不与本条同框，抄了只会错开）')
  // 58×58 双件套（方框与缩略图同高，加素材不跳高度 —— 演示规格注记原文）。
  for (const cls of ['csLobbyThumb', 'csLobbyAttachAdd', 'csLobbyThumbMedia', 'csLobbyThumbExt',
    'csLobbyThumbFn', 'csLobbyThumbRm', 'csLobbyAttachLb', 'csLobbyPicker']) {
    assert.ok(STYLES.includes(`.${cls} {`), `styles.ts 缺少 .${cls} 规则`)
    assert.ok(BAR.includes(cls), `.${cls} 有规则无消费者（class 与样式必须双向配对）`)
  }
  // 材料纪律：styles.ts 的**规则体**里零 rgba(255,255,255,…) 字面量
  //（那些在浅色主题下是看不见的白；走 --cs-line / --cs-line-hi 的 color-mix）。
  assert.doesNotMatch(STYLES_CODE, /rgba\(255,\s*255,\s*255/,
    'styles.ts 的规则体不得出现白色字面量叠加（注释里引用效果图色值不算）')
})
