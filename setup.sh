#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo "  Work Schedule - 一键构建脚本"
echo "========================================"
echo ""

# 1. 安装后端依赖
echo "[1/3] 安装后端依赖..."
cd "$ROOT_DIR"
npm install --silent
echo "      完成"

# 2. 安装前端依赖
echo "[2/3] 安装前端依赖..."
cd "$ROOT_DIR/frontend"
npm install --silent
echo "      完成"

# 3. 构建前端
echo "[3/3] 构建前端..."
cd "$ROOT_DIR/frontend"
npm run build
echo "      完成"

echo ""
echo "========================================"
echo "  构建完成，请设置登录凭据"
echo "========================================"
echo ""

# 4. 设置用户名和密码
cd "$ROOT_DIR"
npm run auth:init

echo ""
echo "========================================"
echo "  设置完成！"
echo "========================================"
echo ""
echo "启动服务：  ./start.sh"
echo "访问地址：  http://localhost:5173"
echo ""
echo "首次启动后如需修改密码，重新执行："
echo "  npm run auth:init"
echo ""
