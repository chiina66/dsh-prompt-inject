/**
 * 离线冒烟测试：不需要 Harness，用一个假 ctx 手动调 apply()。
 * 运行：node test/smoke.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const plugin = await import(new URL('../index.js', import.meta.url).href)

let passed = 0
let failed = 0

function check(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (ok) {
    passed += 1
    console.log('  ok   ' + label)
  } else {
    failed += 1
    console.log('  FAIL ' + label + '\n         期望: ' + JSON.stringify(expected) + '\n         实际: ' + JSON.stringify(actual))
  }
}

/** 最小 ctx：只实现本插件用到的四个入口。 */
function createCtx() {
  const sections = []
  const warnings = []
  const ctx = {
    logger: Object.assign(
      () => ctx.logger,
      {
        info() {},
        debug() {},
        warn(message) { warnings.push(String(message)) },
        error(message) { warnings.push(String(message)) },
      },
    ),
    effect(run) { return run() },
    inject(_deps, callback) { callback(ctx) },
    get() { return undefined },
    fiber: {},
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
  }
  return { ctx, sections, warnings }
}

const workdir = mkdtempSync(join(tmpdir(), 'dsh-prompt-inject-'))
const contentFile = join(workdir, 'system-prompt.md')

try {
  console.log('配置 schema')
  check('导出 Config', typeof plugin.Config, 'function')
  check('导出 apply', typeof plugin.apply, 'function')
  check('inject 声明', plugin.inject.join(','), 'systemPrompt')

  console.log('默认配置')
  {
    const { ctx, sections } = createCtx()
    plugin.apply(ctx, {
      enabled: true,
      content: '',
      contentFile: join(workdir, 'missing.md'),
      order: plugin.DEFAULT_ORDER,
      complete: false,
      interpolate: false,
      trim: true,
      tool: false,
    })
    check('注册了一个段', sections.length, 1)
    check('段名', sections[0].name, 'prompt-inject:user')
    check('order 默认 10300（最下面）', sections[0].order, 10300)
    check('默认顺序大于最后一个自带段 10200', sections[0].order > 10200, true)
    check('complete 默认 false', sections[0].complete, false)
    check('interpolate 默认 false', sections[0].interpolate, false)
    check('正文为空时返回空串', sections[0].text(), '')
  }

  console.log('内联正文')
  {
    const { ctx, sections } = createCtx()
    plugin.apply(ctx, { enabled: true, content: '  内联 A  ', contentFile: '', trim: true, tool: false })
    check('trim 生效', sections[0].text(), '内联 A')

    const second = createCtx()
    plugin.apply(second.ctx, { enabled: true, content: '  内联 A  ', contentFile: '', trim: false, tool: false })
    check('trim 关闭保留首尾空白', second.sections[0].text(), '  内联 A  ')

    const off = createCtx()
    plugin.apply(off.ctx, { enabled: false, content: '内联 A', contentFile: '', tool: false })
    check('停用后返回空串', off.sections[0].text(), '')
  }

  console.log('文件正文')
  {
    writeFileSync(contentFile, '文件正文 V1', 'utf8')
    const { ctx, sections } = createCtx()
    plugin.apply(ctx, { enabled: true, content: '内联不该赢', contentFile, tool: false })
    check('文件优先于内联', sections[0].text(), '文件正文 V1')

    // 同一个段对象在两个回合之间重新求值：改文件即生效（大小变化必换缓存）
    writeFileSync(contentFile, '文件正文 V2 更长一些', 'utf8')
    check('改文件后立刻生效', sections[0].text(), '文件正文 V2 更长一些')

    writeFileSync(contentFile, '', 'utf8')
    check('文件为空时退回内联', sections[0].text(), '内联不该赢')
  }

  console.log('插入位置与 complete')
  {
    const { ctx, sections } = createCtx()
    plugin.apply(ctx, { enabled: true, content: 'X', contentFile: '', order: 500, complete: true, tool: false })
    check('自定义 order', sections[0].order, 500)
    check('complete 透传', sections[0].complete, true)
  }

  console.log('路径展开')
  check('相对路径按 DSH_HOME 解析', plugin.expandPath('a.md').endsWith('a.md'), true)
  check('空串保持空串', plugin.expandPath('  '), '')
  const expanded = plugin.expandPath('~/x.md')
  check('~ 展开成用户目录', expanded.includes('x.md') && !expanded.startsWith('~'), true)
}
finally {
  rmSync(workdir, { recursive: true, force: true })
}

console.log('\n' + passed + ' 通过，' + failed + ' 失败')
if (failed > 0) process.exitCode = 1
