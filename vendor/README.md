# vendor

宿主包解析不到时的兜底副本，保证插件在「不在 profile 里」的位置也能加载。

| 文件 | 来源 | 说明 |
|---|---|---|
| `schemastery.mjs` | `@deepseek-ai/schemastery` 3.18.5（`lib/index.mjs`），取自当前安装的 DSH `app.asar` | 只把首行 `from "@deepseek-ai/cosmokit"` 改成本目录的 `./cosmokit.mjs`，其余逐字未改 |
| `cosmokit.mjs` | `@deepseek-ai/cosmokit` 1.8.6（`lib/index.js`） | 无任何 import，可直接作为 ESM 使用 |

`index.js` 的加载顺序是 **先宿主、后 vendor**：

```js
for (const spec of ['@deepseek-ai/schemastery', './vendor/schemastery.mjs']) { ... }
```

装在 profile 的 `node_modules` 里时走宿主那份（版本与运行中的 Harness 完全一致，
volatile 配置才能被设置页识别）；放在工作目录里直接跑时走这里的副本。
