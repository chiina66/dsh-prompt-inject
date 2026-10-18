/**
 * 客户端半区冒烟测试：不开浏览器，用最小 stub 验证 bundle 形状与 slot 注册。
 * 运行：node test/client-smoke.mjs
 */
import { readFileSync } from 'node:fs'

let passed = 0
let failed = 0
function check(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (ok) { passed += 1; console.log('  ok   ' + label) }
  else { failed += 1; console.log('  FAIL ' + label + '\n         期望: ' + JSON.stringify(expected) + '\n         实际: ' + JSON.stringify(actual)) }
}

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const react = {
  createElement: (...args) => ({ args }),
  useSyncExternalStore: () => ({}),
  useCallback: (fn) => fn,
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
}

let registration
const windowStub = { __ModuleLoader__: { load(r) { registration = r } } }
const requireStub = (spec) => {
  if (spec === 'react') return react
  throw new Error('客户端 bundle 只能 require 平台模块，出现了: ' + spec)
}

new Function('window', 'require', source)(windowStub, requireStub)

console.log('bundle 形状')
check('注册了一次', Boolean(registration), true)
check('id 是包名', registration.id, 'dsh-prompt-inject')
check('factory 是函数', typeof registration.factory, 'function')

const exported = registration.factory(requireStub)
check('导出 apply', typeof exported.apply, 'function')
check('导出 inject', Array.isArray(exported.inject), true)
check('inject 是 slots+configForms', exported.inject.join(','), 'slots,configForms')

console.log('apply 注册设置分区')
const registered = []
let injectedInto = ''
let formRequested = ''
const fakeForm = {
  getSnapshot: () => ({ status: 'ready', value: { content: '', enabled: true, contentFile: '' }, writable: true }),
  subscribe: () => () => {},
  set: async () => true,
  mutate: async () => true,
}
const ctx = {
  configForms: {
    get(namespace) { formRequested = namespace; return fakeForm },
  },
  slots: {
    inject(name, callback) { injectedInto = name; callback(); return () => {} },
    register(options, component) { registered.push({ options, component }); return () => {} },
  },
}
exported.apply(ctx)

check('等 settings.section 槽位', injectedInto, 'settings.section')
check('注册了一个分区', registered.length, 1)
check('分区 id', registered[0].options.id, 'prompt-inject')
check('分区 kind 名', registered[0].options.name, 'settings.section')
check('order 是数字', typeof registered[0].options.order, 'number')
check('label 是函数且返回中文标题', registered[0].options.label(), '提示词注入')
check('组件是函数', typeof registered[0].component, 'function')
check('configForms 用条目 id 取表单', formRequested, 'prompt-inject')

console.log('注入给组件的 props')
const props = registered[0].options.inject()
check('props 带 form', props.form, fakeForm)

console.log('\n' + passed + ' 通过，' + failed + ' 失败')
if (failed > 0) process.exitCode = 1
