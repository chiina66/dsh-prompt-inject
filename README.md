# dsh-prompt-inject

给 **DeepSeek Harness（DSH）0.2.1-rc.2 / cordis 4** 用的系统提示词注入插件：把一段文本作为**全局**提示词段塞进每一个模型回合，当前会话、子代理、工作流派生的子代理都能拿到。

装好后在 **设置 → 提示词注入** 里写内容、点保存，**下一回合就生效**，不用重启。也可以用文件模式：把 `contentFile` 指到一个 `.md`，改文件即生效。

```
┌──────────────┐   每回合组装时取值   ┌───────────────────────────────┐
│ system-prompt │ ◄────────────────── │ dsh-prompt-inject             │
│  注册表       │  prompt-inject:user │  设置页里的文本框 / contentFile │
└──────────────┘   order = -900      └───────────────────────────────┘
```

## 安装（DSH 里填一行）

**设置 → 插件 → 安装**，填下面任意一种，然后重启 DSH：

```
github:chiina66/dsh-prompt-inject#v1.1.0
https://github.com/chiina66/dsh-prompt-inject
```

## 它插在哪里

DSH 的系统提示词按 `order` 从小到大拼。本插件默认 `-900`：

| order | 段 |
|---|---|
| `-1000` | Harness 身份（`You are an AI agent powered by DeepSeek Harness.`） |
| **`-900`** | **本插件注入的段** |
| `0` | 部署人格前缀（personaPrefix） |
| `500` … `3100` | 计划模式、工具说明（bash / read / write / …）、MCP |
| `5000` | 工具 SDK |
| `10200` | 部署人格后缀 |

也就是「紧跟身份、排在其他一切之前」。改 `order` 就能换位置（例如 `700` 挪到工具说明中间、`10300` 挪到最后）。

## 从 GitHub 一键安装

把本仓库推到 GitHub（public）之后，别人在 DSH 里：**设置 → 插件 → 安装**，填下面任意一种：

```
https://github.com/chiina66/dsh-prompt-inject
github:chiina66/dsh-prompt-inject
github:chiina66/dsh-prompt-inject#v1.1.0     # 锁到某个 tag / commit
```

装完**重启 DSH**，设置里就出现「提示词注入」。

几个前提，踩了会装不上：

| 要求 | 说明 |
|---|---|
| 仓库根目录就是插件包 | DSH 只认 `https://github.com/<用户>/<仓库>` 这种两段式地址，不认 monorepo 子目录 |
| 仓库 public | 私有仓库要带 token，普通人填链接装不了 |
| `package.json` 里有 `dsh.bundle.patch` | 本仓库有，这是它出现在「设置 → 插件」里的前提 |
| 网络能访问 GitHub | 管理器会先 `git ls-remote` 探一下，连不上会直接报错 |

更新插件：改完代码把 `version` 抬一下、打 tag 再推，别人在插件管理里重装即可（pnpm 对 git 依赖有缓存，想强制取最新可以用 `github:<用户>/<仓库>#<新 tag>`）。

## 装到别人的电脑上

对方只需要先装好官方 DeepSeek Harness 并启动过一次（这样才有 profile 目录），然后二选一：

### A. 用 DSH 插件页面装（最省事）

1. 把这个目录（或 `dsh-prompt-inject-1.1.0.tgz`）拷到对方机器任意位置，路径别带删除动作
2. 打开 DSH → **设置 → 插件 → 安装**
3. 填插件目录的**绝对路径**，例如 `D:\dsh-prompt-inject`，或者 tarball 的绝对路径
   `D:\dsh-prompt-inject-1.1.0.tgz`
4. 装上后**重启 DSH**，设置里会出现「提示词注入」

管理器会自己跑 `pnpm add`、把包名追加进 `dsh.profile.bundles`。注意两点：

- 目录方式安装后，那个目录**不能删**（`link:` 依赖指向它）；想删就先跑一次安装脚本把它搬进 `~/.dsh/plugins`
- tarball 方式装的是副本，原件可以删

### B. 用自带脚本装（不联网、不动 pnpm）

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

```sh
# macOS / Linux
sh ./install.sh
```

脚本做的事：把插件复制到 `<DSH_HOME>/plugins/dsh-prompt-inject`（稳定位置）→ 再复制一份到
`<profile>/node_modules/`（Loader 从这儿加载）→ 在 `<profile>/package.json` 里登记组合包。
可重复执行；`--profile web` 指定 profile，`--home` 指定 DSH 家目录。

装完都要**重启 DSH**。

## 安装（本机开发/维护）

这个插件被 DSH 视为**组合包（bundle）**：包里带 `dsh.bundle.patch`，把它登记进 profile 的
`package.json`（`dependencies` + `dsh.profile.bundles`）之后，它插入的插件行由包自己的
`cordis.patch.yml` 提供。只有这样「设置 → 插件」里的管理页面才认得它。

### 方式一：插件管理器（推荐）

DSH 设置 → 插件 → 安装 → 填本地路径：

```
C:\Users\陈生\.dsh\plugins\dsh-prompt-inject
```

管理器会跑一次 `pnpm add`、把包名追加进 `dsh.profile.bundles`，并在完成后提示重启。

### 方式二：一键脚本

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\陈生\.dsh\plugins\dsh-prompt-inject\install.ps1"
```

脚本做三件事（不跑 pnpm，所以离线可用）：

1. 把目录复制到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-prompt-inject`
2. 用 `scripts/profile-register.mjs` 在 profile 的 `package.json` 里登记：
   `dependencies["dsh-prompt-inject"] = "link:C:/Users/陈生/.dsh/plugins/dsh-prompt-inject"`，
   并把 `dsh-prompt-inject` 追加进 `dsh.profile.bundles`
3. 清掉早期「手写 insert」式安装残留在 `cordis.patch.yml` 里的记录（避免插件行出现两份）

可重复执行；已经登记过就只刷新文件副本。

### 手动登记（不想跑脚本时）

编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`：

```json
{
  "dependencies": {
    "dsh-prompt-inject": "link:C:/Users/陈生/.dsh/plugins/dsh-prompt-inject"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-prompt-inject"]
    }
  }
}
```

`node_modules` 里必须有这个包（复制一份或 `pnpm install` 建链接）。**不要**再往
`cordis.patch.yml` 里手动写 insert —— 组合包自己的 patch 已经插了同一行，写两次会得到
两个同名条目，第二个注册提示词段时会因为段名重复而报错。

装完**重启 DeepSeek Harness**（完全退出再打开）。日志里出现这一行就说明挂上了：

```
[dsh-prompt-inject] 已挂载全局段 prompt-inject:user（order=-900）：已启用但正文为空
```

## 「设置 → 插件」为什么一开始看不见它

DSH 的插件界面是两套列表，来源完全不同：

| 界面 | 数据来源 | 早期手写 insert 式安装的结果 |
|---|---|---|
| **插件管理**（安装 / 卸载 / 开关、bundle 列表） | profile `package.json` 里**声明并选中**的组合包 | ❌ 不显示：它只在 `node_modules` 里，`package.json` 不认识它 |
| **插件列表**标签页 | 运行中 Loader 条目的只读投影 | ✅ 显示：条目确实加载了，标题是模块名 `dsh-prompt-inject`（设置页会缩写成 `prompt-inject`） |

而且**插件列表**里 agent 预设分组默认展开、**全局分组默认收起**，本插件是全局条目，
所以在不展开「全局」、也不搜索的情况下第一眼看着就是空的 —— 搜 `prompt` 或展开全局分组即可。

现在装法是组合包式的，两个列表都能看到它。

## 在 DSH 里改：设置 → 提示词注入

重启后设置面板左侧会多出一个 **提示词注入** 分区（`client.js` 注册的 `settings.section`），里面有：

- 状态胶囊：已启用 / 已停用
- 一个大文本框：直接写要被注入的系统提示词
- 按钮：**保存修改** / **停用注入** / **清空** / **重新读取**
- 右下角实时字符数

保存走 `ctx.configForms.get('prompt-inject')` → Host 的 volatile 配置 → 写进 profile 的
`cordis.patch.yml`，条目重配后**下一回合就生效**，不用刷新页面也不用重启。点「保存」时会把
`contentFile` 一并清空，保证界面里的文字就是实际注入的文字。

宿主没起设置服务、或配置被上层 patch 覆盖时，页面会明确显示原因、按钮置灰，不会静默失败。

## 也可以继续用文件

把 `contentFile` 指到一个 `.md`，插件每回合实时读它（改文件即生效，不用点保存）：

```powershell
'回答尽量简短。' | Set-Content "$env:USERPROFILE\.dsh\system-prompt.md" -Encoding UTF8
```

再在配置里设 `contentFile: ~/.dsh/system-prompt.md`。文件存在时它优先于界面里的文本框；
界面上一保存会把 `contentFile` 清空、切回内联正文。默认值为空，也就是**默认只用界面里的内容**。

## 配置

写进 profile 的 `cordis.patch.yml`，或者在设置页改（`.volatile()` 字段支持不重挂热改）：

```yaml
- id: prompt-inject
  name: dsh-prompt-inject
  config:
    enabled: true
    content: ''                                  # 内联正文（设置页文本框里的内容）
    contentFile: ''                              # 可选：正文文件，支持 ~ / $VAR / ${VAR} / %VAR%
    order: -900                                  # 插入位置
    complete: false                              # true = 用它取代整份系统提示词（会吃掉工具说明，慎用）
    interpolate: false                           # 是否做 {{变量}} 插值，默认关
    trim: true                                   # 去掉首尾空白
    tool: true                                   # 注册 prompt_inject 工具
```

| 字段 | 默认 | 热改 | 说明 |
|---|---|---|---|
| `enabled` | `true` | ✅ | 关掉后这一段从提示词里彻底消失 |
| `content` | `''` | ✅ | 内联正文，设置页文本框绑定的就是它 |
| `contentFile` | `''` | ✅ | 可选的文件正文，非空且文件存在时优先于 `content` |
| `order` | `-900` | ❌ 需重载 | 插入位置 |
| `complete` | `false` | ❌ 需重载 | 取代整份系统提示词 |
| `interpolate` | `false` | ❌ 需重载 | 默认关：正文里的 `{{…}}` 原样保留，不会因为未注册变量把提示词组装搞崩 |
| `trim` | `true` | ✅ | 去掉首尾空白 |
| `tool` | `true` | ❌ 需重载 | 是否注册 `prompt_inject` 工具 |

「热改 ✅」的意思是改完存盘，下一个回合就换文本，不用重启。

## 让模型自己改这段提示词

开启 `tool: true`（默认）后，模型会多一个 `prompt_inject` 工具：

| action | 作用 |
|---|---|
| `read` | 看当前生效正文、来源（文件 / 内联）、是否启用 |
| `set` | 用 `content` 替换正文（并切到内联） |
| `append` | 把 `content` 追加到当前生效正文末尾 |
| `file` | 把正文来源换成 `path` 指向的文件（每回合实时读） |
| `clear` | 清空 |
| `enable` / `disable` | 开关 |

写入先落内存覆盖层（立刻生效），再经 `configEditor` 持久化进 profile 的 `cordis.patch.yml`；没有 `configEditor`（例如无头运行）时只在本次运行内生效，工具输出里会说明。

于是「把注入内容改成 XXX」这种话，模型自己就能办。

## 和 dsh-purge 的关系

`dsh-purge` 也读 `~/.dsh/prompt-inject.md` 做注入。两者互不干扰，但如果两边的正文写的是同一段话，模型会收到**两遍**。

建议：`dsh-purge` 继续用它自己的 `prompt-inject.md`，本插件用 `system-prompt.md`（默认就是分开的）。想让本插件接管同一个文件，把 `contentFile` 指过去即可，同时把 `dsh-purge` 的注入关掉。

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\陈生\.dsh\plugins\dsh-prompt-inject\uninstall.ps1"
```

三件事：从 `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 里撤掉登记、删掉
`node_modules` 里的副本、清掉早期手写 insert 留下的标记段（只认自己那段，不碰别的配置）。
卸完重启。

## 自检

```powershell
$node = "C:\Users\陈生\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
& $node "C:\Users\陈生\.dsh\plugins\dsh-prompt-inject\test\smoke.mjs"        # 宿主半区，20 项
& $node "C:\Users\陈生\.dsh\plugins\dsh-prompt-inject\test\client-smoke.mjs" # 客户端半区，15 项
```

两个都不需要 Harness：

- `smoke.mjs`：假 ctx 调 `apply()`，覆盖注册、内联、文件优先、热改、停用、order/complete 透传、路径展开
- `client-smoke.mjs`：stub 掉 `window.__ModuleLoader__` 与 `react`，验证 bundle 形状、
  `apply/inject` 导出、`settings.section` 注册参数、`configForms.get('prompt-inject')` 的入参

## 实现要点

- **只有全局层**：`ctx.systemPrompt.section()` 在插件自己的 fiber 里注册，属于全局层，所以对所有作用域生效（含子代理与工作流）。
- **文本是函数**：`text: () => …` 在每次组装时求值 → 改配置或改文件都不需要重挂插件。
- **空段自动丢弃**：返回空串等于这一段不存在，所以「清空内容」就是干净的关闭。
- **不抛错**：文件读不到、没有 `dsh-tools`、没有 `configEditor`、工具注册失败，都只记日志并降级，不影响 Harness 启动。
- **`interpolate: false`**：DSH 默认对段文本做 `{{变量}}` 插值，遇到未注册变量会让整次组装抛错。用户粘进来一段带花括号的提示词就会把 agent 弄崩，所以这里默认关掉插值。
- **界面半边**：`client.js` 是手写 bundle（`window.__ModuleLoader__.load`），只 `require('react')`；
  页面数据走 `ctx.configForms.get('prompt-inject')` 的共享表单控制器（`getSnapshot/subscribe/mutate`），
  不自己实现传输层。

## 兼容性

| 项 | 值 |
|---|---|
| DSH | `0.2.1-rc.2`（cordis `~4.0.5`，schemastery `~3.18.5`） |
| Host API | `ctx.systemPrompt.section()`、volatile 配置、`ctx.tools.register(defineTool())`、`configEditor.edit()` |
| Client API | `dsh.client.platform: web`、`slots.inject('settings.section')`、`configForms.get(entryId)` |
| Node | ≥ 20（宿主自带 24.21.0） |
| 依赖 | 无硬依赖；`@deepseek-ai/schemastery` 解析不到时用 `vendor/` 下的同版本副本 |

**不兼容**：旧版 `ctx.settings.register(ns, schema)` + `settingsScope.bind()` 那套设置 API 在 0.2.1 已移除（`dsh-djy-xttsc` 用的就是旧的），本插件改用 volatile 配置 + `configForms`。
