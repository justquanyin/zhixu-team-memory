#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "请先安装 Node.js 22.12 或更新版本，再运行此文件。"
  read -r "reply?按回车关闭"
  exit 1
fi
if [ ! -d node_modules ]; then npm ci --cache .runtime/npm-cache --registry=https://registry.npmjs.org; fi
if [ ! -f dist/index.html ]; then npm run build; fi
echo "知序将在 http://127.0.0.1:4317 启动。首次启动后，初始密码保存在 .runtime/admin-password.txt。"
echo "使用 Ctrl+C 停止服务。请勿同时启动第二个实例。"
npm start
