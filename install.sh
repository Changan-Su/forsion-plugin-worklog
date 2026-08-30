#!/usr/bin/env bash
# 装/更新「汇报生成器」捆绑包(bundle)到 Forsion 家目录。
#   用法:sh install.sh [dev|prod]     缺省 dev(~/.forsion-dev);prod=~/.forsion
# 本仓即 bundle 本体:整目录拷到 <home>/plugins/worklog-reporter/ 一处即完成——
#   桌面识别 manifest.json(UI 插件)+ spaces/(内嵌 Space「汇报台」);
#   引擎(tangu-agent bundles.ts)原地扫描 skills/(全局技能 worklog-report)。
# 本包**不含 agents/**,也不写 ~/.tangu —— 重装不影响任何 agent 活体。
set -euo pipefail
MODE="${1:-dev}"
case "$MODE" in
  dev)  HOME_DIR="$HOME/.forsion-dev" ;;
  prod) HOME_DIR="$HOME/.forsion" ;;
  *) echo "用法:sh install.sh [dev|prod]" >&2; exit 2 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME_DIR/plugins/worklog-reporter"

# 不许从已安装目录内自更新:下面的 rm -rf 会先删掉复制源(自己),把插件卸成空壳
if [ "$HERE" = "$(cd "$DEST" 2>/dev/null && pwd || true)" ]; then
  echo "❌ 正在从已安装目录运行,请从源码仓的 forsion-plugin-worklog/ 目录执行 install.sh" >&2
  exit 2
fi

mkdir -p "$HOME_DIR/plugins"
rm -rf "$DEST"
cp -R "$HERE" "$DEST"

# 迁移:若曾把 Space 装在顶层 spaces/worklog-desk,会以「用户 Space 优先」遮蔽 bundle 内嵌版。
# 只在它确是本插件配方(引用 plugin:worklog-reporter: 视图)时改名备份令其不再注册——
# 目录与用户其他文件原样保留,绝不无差别删除同名用户资产。
OLD_SPACE="$HOME_DIR/spaces/worklog-desk/space.json"
if grep -q 'plugin:worklog-reporter:' "$OLD_SPACE" 2>/dev/null; then
  mv "$OLD_SPACE" "$OLD_SPACE.pre-bundle.bak"
  echo "   (旧版顶层 Space 配方已备份为 space.json.pre-bundle.bak,不再遮蔽 bundle 内嵌版)"
fi

echo "✅ 已安装 bundle → $DEST"
echo "重开 Forsion(dev:重启 desktop)后:命令面板「汇报生成器:打开」,或工作台切到「汇报台」Space。"
