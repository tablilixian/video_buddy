import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// 两层验证：
// ① 注册层 —— bundle 恰好注册一个 id=canvas-studio 的 Loader 模块；
// ② 执行层 —— 真实调用 factory(stub require)（2026-10-15 新增）。tsdown 默认把
//    package.json dependencies externalize，漏打进 bundle 的依赖只有在 factory
//    执行到 require() 时才会炸（运行时表现为 renderer boot failed 且无错误消息，
//    实证：@supabase/supabase-js）。只查注册抓不住这一类回归。

const artifact = new URL('../lib/client.js', import.meta.url)
const registrations = []
const window = {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration)
    },
  },
}

/** 宿主 loader 实际 provide 的模块前缀（与 tsdown.config.ts 的 external 列表同源）。 */
const HOST_PROVIDED_PREFIXES = ['react', '@deepseek-ai/']
const stubModule = (id) => new Proxy(function () {}, {
  get: (target, prop) => {
    if (prop === Symbol.toPrimitive) return () => `[stub ${id}]`
    if (prop === 'default') return stubModule(id)
    return stubModule(`${id}.${String(prop)}`)
  },
  // rolldown 的外部 CJS interop 是 `__toESM(mod, 1)`：它先 `Object.create(getPrototypeOf(mod))`
  // 再把 mod 的**自有键**拷到新对象上。Proxy 只有 get 陷阱时，自有键只剩函数自带的
  // length/name/prototype，于是 `react.Component` 在 factory 执行层变 undefined——真实宿主
  // 提供的是真 react，这里只是 stub 没仿真好。让 proto 指回自身，属性查找就会落到 get 陷阱，
  // stub 才像真模块（本条只放宽「属性访问」，未打包模块的检查仍在 requireStub 里拦）。
  getPrototypeOf: () => stubModule(id),
  apply: () => stubModule(id),
})
const requireStub = (id) => {
  if (!HOST_PROVIDED_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    throw new Error(
      `client bundle require() 了宿主不提供的模块 "${id}" —— 它被 tsdown externalize 却不在 ` +
      'external 白名单里。请把它加进 tsdown.config.ts 的 noExternal（打进 bundle），' +
      '或确认宿主 loader 会 provide 它（同步更新本脚本的 HOST_PROVIDED_PREFIXES）。',
    )
  }
  return stubModule(id)
}

const source = readFileSync(artifact, 'utf8')
const sandbox = { window, document: { addEventListener() {}, visibilityState: 'visible' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, require: requireStub }
sandbox.globalThis = sandbox
runInNewContext(source, sandbox, { filename: artifact.pathname })

if (registrations.length !== 1) {
  throw new Error(`canvas-studio client registered ${String(registrations.length)} Loader modules`)
}
const [registration] = registrations
if (registration?.id !== 'canvas-studio' || typeof registration.factory !== 'function') {
  throw new Error('canvas-studio client did not register the expected Loader module')
}

// ② 执行层：factory 里任何未打包的 require / 顶层副作用异常都在这里变红。
registration.factory(requireStub)

process.stdout.write('verify-canvas-studio-loader: registered one client module and factory executes clean\n')
