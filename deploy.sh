#!/usr/bin/env bash
# 生产环境启动脚本（供 systemd 等进程管理器调用）。
# 本地开发请使用 start.sh / stop.sh（Vite 热更新），两者职责互不替代。
# 设计约束见 doc/dev/2026-08-23/production-deploy-plan.md：
#   - 不在启动路径上现场构建前端：dist 由 release 包（CI 预构建）或一键更新保证
#   - exec 交给 node，让进程管理器直接管理服务进程（信号、退出码、MainPID）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f frontend/dist/index.html ]]; then
  if [[ "${1:-}" == "--build" ]]; then
    echo "deploy: frontend/dist 缺失，执行一次性构建..."
    (cd frontend && npm install --include=dev && npm run build)
  else
    echo "Error: frontend/dist/index.html 不存在，拒绝启动。" >&2
    echo "  首次部署: ./deploy.sh --build" >&2
    echo "  或在网页端触发一次一键更新（release 包自带预构建产物）" >&2
    exit 1
  fi
fi

if [[ ! -f config/auth.json ]]; then
  echo "Error: config/auth.json 不存在，请先执行 npm run auth:init" >&2
  exit 1
fi

export NODE_ENV=production
export PORT="${PORT:-8998}"
# 后端托管 dist 作为兜底（nginx 全反代场景）；nginx 直接托管静态文件时不会命中
export WORK_SCHEDULE_SERVE_STATIC="${WORK_SCHEDULE_SERVE_STATIC:-true}"

exec node server.js
