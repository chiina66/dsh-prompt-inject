#!/usr/bin/env node
/**
 * install.mjs —— 把 dsh-prompt-inject 装进这台机器的 DSH profile。
 *
 * 做什么：
 *   1. 把插件本身放到稳定的家目录：<DSH_HOME>/plugins/dsh-prompt-inject
 *   2. 复制一份到 <profile>/node_modules/dsh-prompt-inject（Loader 从这里加载）
 *   3. 在 <profile>/package.json 里登记组合包（dependencies 的 link: + dsh.profile.bundles）
 *
 * 用法：
 *   node install.mjs                          # 装，自动挑 profile（优先 desktop）
 *   node install.mjs --profile web            # 指定 profile
 *   node install.mjs --home D:\dsh-home       # 指定 DSH 家目录
 *   node install.mjs uninstall                # 卸
 *   node install.mjs uninstall --purge        # 卸，并删掉 plugins 目录里的源码副本
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerProfile, unregisterProfile } from './scripts/profile-register.mjs'

const PACKAGE = 'dsh-prompt-inject'
const here = dirname(fileURLToPath(import.meta.url))

function fail(message) {
  console.error('\n[失败] ' + message + '\n')
  process.exit(1)
}

/** 解析命令行。 */
function parseArgs(argv) {
  const options = { action: 'install', profile: '', home: '', purge: false }
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile') options.profile = argv[++i] ?? ''
    else if (arg === '--home') options.home = argv[++i] ?? ''
    else if (arg === '--purge') options.purge = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (!arg.startsWith('-')) rest.push(arg)
  }
  if (rest[0]) options.action = rest[0]
  return options
}

/** DSH 家目录：--home > $DSH_HOME > ~/.dsh */
function resolveHome(explicit) {
  if (explicit) return resolve(explicit)
  if (process.env.DSH_HOME) return resolve(process.env.DSH_HOME)
  return join(homedir(), '.dsh')
}

/** 列出可用 profile 名。 */
function listProfiles(home) {
  const dir = join(home, 'profiles')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => name !== 'node_modules' && !name.startsWith('.'))
}

/** 选 profile：显式 > $DSH_PROFILE > desktop > 唯一一个。 */
function pickProfile(home, explicit) {
  const available = listProfiles(home)
  if (available.length === 0) {
    fail('没找到任何 profile：' + join(home, 'profiles') + '\n先把 DeepSeek Harness 启动一次，让它生成 profile。')
  }
  const wanted = explicit || process.env.DSH_PROFILE || ''
  if (wanted) {
    if (!available.includes(wanted)) {
      fail('没有名为 "' + wanted + '" 的 profile。可用：' + available.join('、'))
    }
    return wanted
  }
  if (available.includes('desktop')) return 'desktop'
  if (available.length === 1) return available[0]
  fail('有多个 profile（' + available.join('、') + '），请用 --profile 指定一个。')
}

/** 复制插件目录，跳过 node_modules/.git/.DS_Store。 */
function copyPlugin(from, to) {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, {
    recursive: true,
    filter: (src) => !/(^|[\\/])(node_modules|\.git|\.DS_Store)([\\/]|$)/.test(src),
  })
}

const options = parseArgs(process.argv.slice(2))

if (options.help) {
  console.log(`用法: node install.mjs [install|uninstall] [--profile <名>] [--home <目录>] [--purge]

  install      安装（默认）
  uninstall    卸载
  --profile    指定 profile 名，默认优先 desktop
  --home       指定 DSH 家目录，默认 $DSH_HOME 或 ~/.dsh
  --purge      卸载时连 <家目录>/plugins/${PACKAGE} 一起删掉`)
  process.exit(0)
}

const home = resolveHome(options.home)
const profileName = pickProfile(home, options.profile)
const profileDir = join(home, 'profiles', profileName)
const stableDir = join(home, 'plugins', PACKAGE)
const modulesDir = join(profileDir, 'node_modules', PACKAGE)

console.log('DSH 家目录  : ' + home)
console.log('profile     : ' + profileName + '  (' + profileDir + ')')
console.log('动作        : ' + (options.action === 'uninstall' ? '卸载' : '安装'))
console.log('')

if (options.action === 'uninstall') {
  const { changed, stripped } = unregisterProfile({ profileDir, packageName: PACKAGE })
  console.log('  [1/3] 清单登记  : ' + (changed.length ? '已撤销 ' + changed.join(' + ') : '本来就没有'))
  if (stripped) console.log('        （顺带清掉了 cordis.patch.yml 里的旧标记段）')

  if (existsSync(modulesDir)) {
    rmSync(modulesDir, { recursive: true, force: true })
    console.log('  [2/3] 运行副本  : 已删除 ' + modulesDir)
  }
  else console.log('  [2/3] 运行副本  : 不存在，跳过')

  if (options.purge && existsSync(stableDir)) {
    rmSync(stableDir, { recursive: true, force: true })
    console.log('  [3/3] 源码副本  : 已删除 ' + stableDir)
  }
  else console.log('  [3/3] 源码副本  : 保留在 ' + stableDir + '（加 --purge 可一并删除）')

  console.log('\n卸载完成。完全退出并重新打开 DeepSeek Harness 后生效。')
  process.exit(0)
}

// 1. 放到稳定位置（避免以后删掉下载目录就断链）
if (resolve(here) === resolve(stableDir)) {
  console.log('  [1/3] 源码位置  : 已在 ' + stableDir)
}
else {
  copyPlugin(here, stableDir)
  console.log('  [1/3] 源码位置  : 已复制到 ' + stableDir)
}

// 2. 复制到 profile 的 node_modules（Loader 从这里加载）
if (!existsSync(join(profileDir, 'package.json'))) {
  fail('profile 里没有 package.json：' + profileDir + '\n这个目录看起来不是 DSH profile。')
}
copyPlugin(stableDir, modulesDir)
console.log('  [2/3] 运行副本  : 已安装到 ' + modulesDir)

// 3. 登记组合包
const { changed, stripped } = registerProfile({ profileDir, packageName: PACKAGE, sourceDir: stableDir })
console.log('  [3/3] 清单登记  : ' + (changed.length ? '已更新 ' + changed.join(' + ') : '已经登记过，无需改动'))
if (stripped) console.log('        （顺带清掉了 cordis.patch.yml 里的旧标记段）')

console.log('\n装好了。下一步：')
console.log('  1) 完全退出并重新打开 DeepSeek Harness')
console.log('  2) 打开 设置 → 提示词注入，写内容后点保存')
console.log('  3) 想确认：让模型调用 prompt_inject(action="read")')
console.log('\n卸载：node install.mjs uninstall（可加 --purge）')
