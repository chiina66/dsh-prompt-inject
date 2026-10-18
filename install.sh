#!/bin/sh
# dsh-prompt-inject 安装脚本（macOS / Linux 包装器）
# 逻辑都在 install.mjs 里，这里只负责找到 node 再转过去。
#
#   ./install.sh                    装（自动挑 profile，优先 desktop）
#   ./install.sh --profile web      指定 profile
#   ./install.sh uninstall          卸
set -e
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

NODE="${DSH_NODE_EXE:-}"
if [ -z "$NODE" ]; then
  NODE=$(command -v node 2>/dev/null || true)
fi
if [ -z "$NODE" ]; then
  for candidate in \
    "$HOME/.dsh/runtimes/node/bin/node" \
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
    "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
  do
    if [ -x "$candidate" ]; then NODE="$candidate"; break; fi
  done
fi

if [ -z "$NODE" ]; then
  echo "找不到 node。请装 Node 20+，或设置 DSH_NODE_EXE 指向 DeepSeek Harness 自带的 node。"
  exit 1
fi

exec "$NODE" "$DIR/install.mjs" "$@"
