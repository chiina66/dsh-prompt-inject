/**
 * profile-register.mjs —— 在 profile 清单里登记 / 撤销本插件的组合包身份。
 *
 * 为什么需要它：DSH 的「插件」页面列的是 **profile 声明并选中的组合包**
 * （`package.json` 的 `dependencies` + `dsh.profile.bundles`），行本身由组合包
 * 自己的 `cordis.patch.yml` 提供。只往 `node_modules` 拷文件 + 手写 insert，
 * 插件能加载，但管理器不认识它。
 *
 * 既可以被 install.mjs import，也可以单独跑：
 *   node profile-register.mjs add    <profileDir> <packageName> <sourceDir>
 *   node profile-register.mjs remove <profileDir> <packageName>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 读取并解析 profile 清单；不存在时给一份最小骨架。 */
function readManifest(profileDir) {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
    : { name: 'dsh-profile-' + profileDir.split(/[\\/]/).pop(), private: true }
  manifest.dependencies ??= {}
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  manifest.dsh.profile.bundles ??= []
  return manifest
}

/** 按 DSH 的格式写回清单：2 空格缩进 + 结尾换行。 */
function writeManifest(profileDir, manifest) {
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 把早期「手写 insert」式安装留下的标记段去掉（避免插件行出现两份）。 */
function stripLegacyPatch(profileDir, packageName) {
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return false
  const before = readFileSync(patchPath, 'utf8')
  const pattern = new RegExp(`^# >>> ${escapeRe(packageName)} >>>.*?^# <<< ${escapeRe(packageName)} <<<[^\\r\\n]*\\r?\\n?`, 'ms')
  if (!pattern.test(before)) return false
  writeFileSync(patchPath, before.replace(pattern, ''), 'utf8')
  return true
}

/**
 * 登记为组合包。
 * @param options - `{ profileDir, packageName, sourceDir }`。
 * @returns 变更过的字段名列表。
 */
export function registerProfile({ profileDir, packageName, sourceDir }) {
  const manifest = readManifest(profileDir)
  const spec = 'link:' + resolve(sourceDir).replace(/\\/g, '/')
  const changed = []
  if (manifest.dependencies[packageName] !== spec) {
    manifest.dependencies[packageName] = spec
    changed.push('dependencies')
  }
  if (!manifest.dsh.profile.bundles.includes(packageName)) {
    manifest.dsh.profile.bundles.push(packageName)
    changed.push('bundles')
  }
  if (changed.length > 0) writeManifest(profileDir, manifest)
  const stripped = stripLegacyPatch(profileDir, packageName)
  return { changed, stripped }
}

/**
 * 撤销组合包登记。
 * @param options - `{ profileDir, packageName }`。
 * @returns 变更过的字段名列表。
 */
export function unregisterProfile({ profileDir, packageName }) {
  if (!existsSync(join(profileDir, 'package.json'))) return { changed: [], stripped: false }
  const manifest = readManifest(profileDir)
  const changed = []
  if (Object.hasOwn(manifest.dependencies, packageName)) {
    delete manifest.dependencies[packageName]
    changed.push('dependencies')
  }
  const index = manifest.dsh.profile.bundles.indexOf(packageName)
  if (index >= 0) {
    manifest.dsh.profile.bundles.splice(index, 1)
    changed.push('bundles')
  }
  if (changed.length > 0) writeManifest(profileDir, manifest)
  const stripped = stripLegacyPatch(profileDir, packageName)
  return { changed, stripped }
}

/* ---------------------------------- CLI --------------------------------- */

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const [action, profileDir, packageName, sourceDir] = process.argv.slice(2)
  if (!action || !profileDir || !packageName) {
    console.error('用法: node profile-register.mjs add|remove <profileDir> <packageName> [sourceDir]')
    process.exit(2)
  }
  if (action === 'add') {
    if (!sourceDir) {
      console.error('add 需要 sourceDir（插件源码目录）')
      process.exit(2)
    }
    const { changed, stripped } = registerProfile({ profileDir, packageName, sourceDir })
    console.log((changed.length ? '已更新 ' + changed.join(' + ') : '清单里已经登记过，无需改动')
      + (stripped ? '，并清掉了旧的 cordis.patch.yml 记录' : ''))
  } else if (action === 'remove') {
    const { changed, stripped } = unregisterProfile({ profileDir, packageName })
    console.log((changed.length ? '已移除 ' + changed.join(' + ') : '清单里本来就没有登记')
      + (stripped ? '，并清掉了 cordis.patch.yml 记录' : ''))
  } else {
    console.error('未知动作: ' + action)
    process.exit(2)
  }
}
