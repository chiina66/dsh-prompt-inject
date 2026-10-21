/**
 * dsh-prompt-inject —— 给 DeepSeek Harness 注入一段全局系统提示词
 *
 * 做的事只有两件：
 *
 * 1. 往 `ctx.systemPrompt` 注册一个**全局**提示词段（`prompt-inject:user`）。
 *    全局段对所有作用域生效，所以当前会话、子代理、工作流内部派生的子代理
 *    都会拿到同一段文字。段的 `text` 是一个函数，每次组装提示词时才求值，
 *    因此改文件（默认 `~/.dsh/system-prompt.md`）就能**下一回合立刻生效**，
 *    不需要重启 Harness。
 *
 * 2. 注册一个 `prompt_inject` 工具，让模型自己读/写这段注入内容。
 *    写入优先落到当前实例的内存覆盖层（立刻生效），再去 `configEditor`
 *    把值持久化进 profile 的 `cordis.patch.yml`（重启后仍然在）。
 *
 * 位置：`order` 默认 10300，排在系统提示词**最下面**——本家最后一个固定段是
 * 部署人格后缀（10200），所以 10300 保证落在所有 DSH 自带段落之后。
 * `complete: true` 时这一段会**取代**整份系统提示词（会连工具说明一起吃掉，
 * 非必要别开）。
 *
 * 安全阀：默认 `interpolate: false`，正文里的 `{{...}}` 原样保留。
 * 系统提示词段默认会做变量插值，遇到未注册的变量会让整次组装抛错，
 * 用户粘一段带花括号的提示词就会把 agent 弄崩；关掉插值可以避免这种事故。
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** 稳定插件名（与 cordis.patch.yml 里的 name 一致）。 */
export const name = 'dsh-prompt-inject'

/** `systemPrompt` 是硬依赖：没有提示词注册表就没什么可注入的。 */
export const inject = ['systemPrompt']

/** 段名。全局层唯一，重复注册会抛错，所以用一个不会和别人撞的名字。 */
const SECTION_NAME = 'prompt-inject:user'

/** 默认插入位置：排在所有 DSH 自带段之后（最大的是部署人格后缀 10200）。 */
export const DEFAULT_ORDER = 10300

/** 默认正文文件：空串表示默认用内联 `content`（设置页里编辑的那个）。 */
export const DEFAULT_CONTENT_FILE = ''

/**
 * 优先用宿主自带的 schemastery（版本与宿主完全一致，volatile 字段才能被
 * 设置页识别），解析不到时退回随包 vendor 的同版本副本（离线可用）。
 * @returns schemastery 的 Schema 构造器，拿不到时为 undefined。
 */
async function loadSchema() {
  for (const spec of ['@deepseek-ai/schemastery', './vendor/schemastery.mjs']) {
    try {
      const mod = await import(spec)
      const schema = mod?.default ?? mod
      if (typeof schema === 'function' && typeof schema.object === 'function') return schema
    } catch {
      // 换下一个候选
    }
  }
  return undefined
}

/**
 * `defineTool` 是可选依赖：装在本 profile 里通常能解析到，独立放置时解析不到
 * 就只跳过工具部分，注入本身照常工作。
 */
async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    return mod?.defineTool ?? mod?.default?.defineTool
  } catch {
    return undefined
  }
}

const z = await loadSchema()

/**
 * 插件配置。标了 `.volatile()` 的字段属于「改了不用重挂」的字段，
 * 会被 Settings 的通用表单识别；`order` / `complete` 参与注册本身，
 * 改了要重载条目，所以不是 volatile。
 */
export const Config = z?.object
  ? z.object({
    enabled: z.boolean().default(true).volatile()
      .description('是否注入。关掉后这一整段从系统提示词里消失。'),
    content: z.string().default('').volatile()
      .description('内联正文，就是「设置 → 提示词注入」里那个文本框。contentFile 为空或文件不存在时用这段。'),
    contentFile: z.string().default(DEFAULT_CONTENT_FILE).volatile()
      .description('可选：正文文件路径，支持 ~ / $VAR / ${VAR} / %VAR%。文件存在时优先于 content，每回合实时读，改文件即生效。'),
    order: z.number().default(DEFAULT_ORDER)
      .description('插入位置：越大越靠后。默认 10300 = 系统提示词最下面（DSH 最后一档固定段是部署人格后缀 10200）；想放最前面可设 -900。'),
    complete: z.boolean().default(false)
      .description('true 时用这段正文取代整份系统提示词（会丢掉工具说明等，慎用）。'),
    interpolate: z.boolean().default(false)
      .description('是否对正文做 {{变量}} 插值。默认关闭，避免正文里的花括号让提示词组装失败。'),
    trim: z.boolean().default(true).volatile()
      .description('是否去掉正文首尾空白。'),
    tool: z.boolean().default(true)
      .description('是否注册 prompt_inject 工具，让模型自己读写这段提示词。'),
  })
  : undefined

/** volatile 引用解包；普通值原样返回。 */
function unwrap(value) {
  if (value && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/** 收敛成字符串。 */
function asText(value, fallback = '') {
  const plain = unwrap(value)
  if (typeof plain === 'string') return plain
  if (plain === undefined || plain === null) return fallback
  return String(plain)
}

/** 收敛成布尔。 */
function asBool(value, fallback) {
  const plain = unwrap(value)
  return typeof plain === 'boolean' ? plain : fallback
}

/** 收敛成有限数字。 */
function asNumber(value, fallback) {
  const plain = Number(unwrap(value))
  return Number.isFinite(plain) ? plain : fallback
}

/** 解析 `~`、`$VAR`、`${VAR}`、`%VAR%`、`$DSH_HOME`；相对路径按 DSH home 解析。 */
export function expandPath(raw) {
  let text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return ''
  const home = homedir()
  const dshHome = process.env.DSH_HOME || join(home, '.dsh')
  text = text.replace(/^~(?=$|[\\/])/, () => home)
  text = text.replace(/^\$DSH_HOME(?=$|[\\/])/, () => dshHome)
  text = text.replace(/\$\{DSH_HOME\}/g, () => dshHome)
  text = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key) => process.env[key] ?? match)
  text = text.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, key) => process.env[key] ?? match)
  return isAbsolute(text) ? text : resolve(dshHome, text)
}

/** (mtime, size) 命中就复用上次读到的文本，避免每个回合都重新读盘。 */
const fileCache = new Map()

function readCachedFile(path) {
  const stats = statSync(path)
  const cached = fileCache.get(path)
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.text
  const text = readFileSync(path, 'utf8')
  fileCache.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, text })
  return text
}

/**
 * 求出当前生效的注入状态。
 * 文件优先；文件不存在或为空时退回内联 content。
 * @param config - 插件配置（可以带 volatile 引用）。
 * @param logger - 可选日志器。
 * @returns `{ enabled, text, source, file }`。
 */
export function resolveState(config, logger) {
  const options = config ?? {}
  const enabled = asBool(options.enabled, true)
  const file = expandPath(asText(options.contentFile, ''))
  let text = ''
  let source = 'none'
  if (file) {
    try {
      text = readCachedFile(file)
      source = 'file'
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        logger?.warn?.('[dsh-prompt-inject] 读取正文文件失败: ' + file + ' —— ' + String(error?.message ?? error))
      }
    }
  }
  if (!text) {
    const inline = asText(options.content, '')
    if (inline) {
      text = inline
      source = 'inline'
    }
  }
  if (asBool(options.trim, true)) text = text.trim()
  return { enabled, text, source, file }
}

/**
 * 插件入口。
 * @param ctx - cordis 上下文。
 * @param config - 插件配置。
 */
export function apply(ctx, config) {
  const options = config ?? {}

  let logger
  try {
    logger = typeof ctx.logger === 'function' ? ctx.logger('prompt-inject') : ctx.logger
  } catch {
    logger = undefined
  }

  const order = asNumber(options.order, DEFAULT_ORDER)
  const complete = asBool(options.complete, false)
  const interpolate = asBool(options.interpolate, false)

  /**
   * 工具写入的内存覆盖层：`configEditor` 写入是异步的，而这里要保证
   * 「说改就改」。条目被重载后配置本身已经带上新值，覆盖层自然失效。
   */
  let override

  /** 当前配置快照（解包后的普通值），写回配置文件时用作底稿。 */
  const snapshot = () => ({
    enabled: asBool(options.enabled, true),
    content: asText(options.content, ''),
    contentFile: asText(options.contentFile, ''),
    order: asNumber(options.order, DEFAULT_ORDER),
    complete: asBool(options.complete, false),
    interpolate: asBool(options.interpolate, false),
    trim: asBool(options.trim, true),
    tool: asBool(options.tool, true),
  })

  /** 叠加覆盖层后的有效配置。 */
  const effective = () => (override === undefined ? options : { ...snapshot(), ...override })

  /** 每次组装提示词时求值；空串会被组装流程直接丢掉。 */
  const sectionText = () => {
    const state = resolveState(effective(), logger)
    return state.enabled ? state.text : ''
  }

  ctx.effect(
    () => ctx.systemPrompt.section({
      name: SECTION_NAME,
      order,
      complete,
      interpolate,
      text: sectionText,
    }),
    'dsh-prompt-inject: 全局系统提示词段',
  )

  const startup = resolveState(effective(), logger)
  logger?.info?.(
    '[dsh-prompt-inject] 已挂载全局段 '
    + SECTION_NAME
    + '（order=' + order + (complete ? ', complete' : '') + '）：'
    + (startup.enabled
      ? (startup.text ? '注入中，来源 ' + (startup.source === 'file' ? startup.file : 'content') + '，' + startup.text.length + ' 字符' : '已启用但正文为空')
      : '已停用'),
  )

  if (!asBool(options.tool, true)) return

  void (async () => {
    const defineTool = await loadDefineTool()
    if (typeof defineTool !== 'function') {
      logger?.warn?.('[dsh-prompt-inject] 找不到 @deepseek-ai/dsh-tools，prompt_inject 工具未注册（注入本身不受影响）')
      return
    }

    /** 写回配置：先落内存覆盖层，再尽力持久化到 profile 补丁。 */
    const save = async (next) => {
      override = { ...(override ?? snapshot()), ...next }
      const entry = ctx.fiber?.entry
      let editor
      try {
        editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
      } catch {
        editor = undefined
      }
      if (!editor || !entry) {
        logger?.warn?.('[dsh-prompt-inject] 没有 configEditor，改动只在本次运行内生效')
        return false
      }
      try {
        await editor.edit(entry, () => ({ ...snapshot(), ...next }))
        return true
      } catch (error) {
        logger?.warn?.('[dsh-prompt-inject] 写入 profile 配置失败: ' + String(error?.message ?? error))
        return false
      }
    }

    const describe = (state) => {
      const lines = [
        '状态: ' + (state.enabled ? '启用' : '停用'),
        '来源: ' + (state.source === 'file'
          ? '文件 ' + state.file
          : state.source === 'inline'
            ? '内联 content'
            : '（无正文）'),
        '字符数: ' + state.text.length,
        '位置: order ' + order + (complete ? '（complete：取代整份系统提示词）' : '（越大越靠后，10300 = 最下面）'),
      ]
      if (state.file && state.source !== 'file') lines.push('提示: 文件 ' + state.file + ' 不存在或为空，当前使用内联 content')
      if (state.text) {
        lines.push('', state.text.length > 4000 ? state.text.slice(0, 4000) + '\n…（已截断）' : state.text)
      }
      return lines.join('\n')
    }

    const run = async (args) => {
      const action = String(args?.action ?? 'read').trim().toLowerCase()

      if (action === 'read' || action === 'status' || action === '') {
        return describe(resolveState(effective(), logger))
      }

      if (action === 'enable' || action === 'disable') {
        const enabled = action === 'enable'
        const persisted = await save({ enabled })
        return (enabled ? '已启用' : '已停用')
          + (persisted ? '，并已写入 profile 配置（下个回合起生效）。' : '，本次运行内生效（配置未持久化）。')
      }

      if (action === 'set' || action === 'replace') {
        const text = String(args?.content ?? '')
        if (!text.trim()) return '没有收到 content，什么都没改。'
        const persisted = await save({ content: text, contentFile: '' })
        return '已改为内联注入，' + text.length + ' 字符'
          + (persisted ? '，并已写入 profile 配置。' : '，本次运行内生效（配置未持久化）。')
      }

      if (action === 'append') {
        const extra = String(args?.content ?? '')
        if (!extra.trim()) return '没有收到 content，什么都没改。'
        const current = resolveState(effective(), logger)
        const merged = current.text ? current.text + '\n\n' + extra : extra
        const persisted = await save({ content: merged, contentFile: '' })
        return '已追加到当前正文末尾，现共 ' + merged.length + ' 字符'
          + (persisted ? '，并已写入 profile 配置。' : '，本次运行内生效（配置未持久化）。')
      }

      if (action === 'file') {
        const path = String(args?.path ?? args?.content ?? '').trim()
        if (!path) return '没有收到 path，什么都没改。'
        const persisted = await save({ contentFile: path, content: '' })
        const state = resolveState(effective(), logger)
        return '已改为文件来源: ' + expandPath(path)
          + (persisted ? '（已写入 profile 配置）' : '（本次运行内生效）')
          + '\n' + describe(state)
      }

      if (action === 'clear') {
        const persisted = await save({ content: '', contentFile: '' })
        return '已清空注入内容'
          + (persisted ? '，并已写入 profile 配置。' : '，本次运行内生效（配置未持久化）。')
      }

      return '未知 action: ' + action + '（可用: read / set / append / file / clear / enable / disable）'
    }

    try {
      ctx.inject(['tools'], (tctx) => {
        try {
          tctx.tools.register(defineTool({
            name: 'prompt_inject',
            description:
              'Read or change the system-prompt injection owned by the dsh-prompt-inject plugin. '
              + 'action=read shows the effective text, its source, and whether injection is on; '
              + 'action=set replaces it with `content` (switching to inline text); '
              + 'action=append adds `content` to the end of the current effective text; '
              + 'action=file points the injection at a file path (`path`), read live on every turn; '
              + 'action=clear empties it; action=enable and action=disable toggle it. '
              + 'Changes take effect from the next turn and are persisted to the profile configuration when a config editor is present.',
            parameters: {
              action: {
                type: 'string',
                required: true,
                description: 'One of: read, set, append, file, clear, enable, disable.',
              },
              content: {
                type: 'string',
                description: 'Text for set/append (or a path alias for file).',
              },
              path: {
                type: 'string',
                description: 'File path for action=file. Supports ~ and environment variables.',
              },
            },
            output: {
              schema: { type: 'string' },
              render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            async execute(args) {
              return run(args)
            },
          }))
          logger?.info?.('[dsh-prompt-inject] prompt_inject 工具已注册')
        } catch (error) {
          logger?.warn?.('[dsh-prompt-inject] 工具注册失败: ' + String(error?.message ?? error))
        }
      })
    } catch (error) {
      logger?.warn?.('[dsh-prompt-inject] 无法挂载工具服务: ' + String(error?.message ?? error))
    }
  })()
}
