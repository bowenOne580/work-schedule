# 生产环境部署改造方案

- 日期：2026-08-23
- 状态：已评审通过，已实施（nginx 托管静态文件方案）；CI 预构建链路已核实（v1.1.11 起 release zip 自带 dist）
- 分支：dev
- 关联代码：`server.js`、`src/createApp.js`（update 接口 / 静态托管）、`src/updateGuard.js`、`scripts/verifyBoot.js`、`.github/workflows/release.yml`

## 1. 背景与问题

线上 `https://todo.wbwone1.cn` 统计页加载缓慢。实测（登录态、Chromium）：

| 轮次 | 冷加载（清缓存） | 热加载（留缓存） |
| --- | --- | --- |
| 1 | 4.79 s | 4.26 s |
| 2 | 12.41 s | 2.88 s |
| 3 | 4.37 s | 3.05 s |

每次加载固定发出 28 个请求，其中 26 个是 Vite 开发服务器的原始模块请求（`/src/main.tsx`、`/node_modules/.vite/deps/*.js` 等）；单请求 TTFB 350–650ms。**根因：生产环境跑了 Vite dev server（nginx 反代 5173，即 Usage.md "方案一 B"被用于生产），26 个未打包模块在高延迟链路上逐个往返**。缓存只能省传输量，省不掉 304 协商的往返次数。

约束：

- `start.sh` / `stop.sh` 保持不动，继续作为本地开发专用。
- 新增独立的生产启动脚本。
- 方案必须与现有"一键更新"逻辑兼容（见第 2 节）。

## 2. 现状梳理：一键更新是如何启动应用的

`POST /api/system/update`（`src/createApp.js:379`）完整流程：

1. 拉取最新 tag → 从 GitHub（或 ghfast 镜像）下载 release zip；
2. 解压到 `/tmp/work-schedule-update`；
3. `createSnapshot()`：将当前代码打包为 `updates/backup/pre-update-<ts>.tar.gz`（**排除** `data/`、`node_modules/`、`.env/`、`updates/`、`.git/`，**包含** `frontend/dist/`），写 `updates/state.json`（`status=updating`）；
4. tar 覆盖项目文件（排除项同上）；
5. 根目录 `npm install`（后端依赖）；
6. **若 release zip 内含预构建 `frontend/dist/index.html` 则跳过前端构建**，否则 `npm install --include=dev` + `npm run build`；
7. `node scripts/verifyBoot.js` 冒烟验证——显式要求 `frontend/dist/index.html` 存在；
8. `state=success` → **`process.exit(0)`**，靠外部进程管理器重启；
9. 任一步失败 → `restoreSnapshot()` 解回快照（dist 随之恢复）+ `npm install` → `state=rolled_back`。

配套机制：

- `release.yml` 在 CI 中构建前端并把 `frontend/dist` 打进 release zip——**正常一键更新后 dist 一定存在**；
- `server.js` 启动最前面调用 `recoverInterruptedUpdate()`：上次进程死于更新中途（`status=updating`）时先恢复快照再启动。

由此得出生产启动方式的三个硬性要求：

| # | 要求 | 来源 |
| --- | --- | --- |
| R1 | 必须由进程管理器托管且 `Restart=always` | 更新结束靠 `process.exit(0)` 重启 |
| R2 | 启动前假定 `frontend/dist` 已存在，不在启动路径上现场构建 | verifyBoot 同样假设；CI 发布包自带 dist |
| R3 | 启动入口必须是 `node server.js`（而非绕过它） | 启动自愈挂在 server.js 最前面 |

现状的问题：服务器用 `start.sh`（vite dev + node 后台进程）+ `wait` 运行，无进程管理器。一键更新 `process.exit(0)` 后后端退出而 vite 仍在——即使更新成功，API 也是死的，需要人工重启；这也解释了为什么"重启后还是 dev 模式"。

## 3. 目标与非目标

目标：

- 生产环境加载 `/app/stats` 的请求数从 26+ 降到个位数，冷加载进入 1–2s 区间；
- 提供独立生产启动脚本 `deploy.sh` 与 systemd 模板，与一键更新全流程兼容（成功更新、失败回滚、更新中途宕机三种场景）；
- `start.sh` / `stop.sh` 及本地开发流程零改动。

非目标：

- 不改一键更新代码本身（dist 残留清理等列为后续可选项）；
- 不做多实例、蓝绿部署等重型方案；
- 不处理 HTTPS 证书（certbot 流程已有文档）。

## 4. 方案设计

### 4.1 新增 `deploy.sh`（项目根目录，生产启动入口）

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# R2：生产启动不做构建。dist 缺失说明上游（发布包/一键更新）出了问题，fail-fast
# 而不是在生产机上默默编译。--build 仅供首次手工部署使用。
if [[ ! -f frontend/dist/index.html ]]; then
  if [[ "${1:-}" == "--build" ]]; then
    (cd frontend && npm install --include=dev && npm run build)
  else
    echo "Error: frontend/dist/index.html 不存在。" >&2
    echo "  首次部署请执行: ./deploy.sh --build" >&2
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
# 后端托管 dist 作为兜底；nginx 直接托管静态文件时此配置无害（请求到不了后端静态路由）
export WORK_SCHEDULE_SERVE_STATIC="${WORK_SCHEDULE_SERVE_STATIC:-true}"

# 关键：exec 让 systemd 直接管理 node 进程——信号（stop/restart）直达、退出码不丢失
exec node server.js
```

设计要点：

- **不经过 `npm start`**：`package.json` 的 start 脚本硬编码了 `WORK_SCHEDULE_CORS_ORIGINS=http://localhost:5173`（对生产无意义），且 npm 不转发信号、退出码经一层 shell；
- **`exec node server.js`**：满足 R3，且让 systemd 的 `Restart=always`、`MainPID`、日志归属都正确；
- **fail-fast 优于现场构建**：生产机可能没有 `frontend/node_modules`，静默构建既慢又掩盖问题；dist 的存在性由 CI 发布包与 verifyBoot 双重保证。

### 4.2 systemd 模板（`deploy/work-schedule.service`）

```ini
[Unit]
Description=Work Schedule (production)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/work-schedule
ExecStart=/opt/work-schedule/deploy.sh
Restart=always
RestartSec=3
Environment=PORT=8998

[Install]
WantedBy=multi-user.target
```

`Restart=always` + `process.exit(0)` 组合：一键更新成功后 1 秒主动退出 → systemd 3 秒后拉起 `deploy.sh` → 新代码 + 新 dist 上线，全程无需人工。更新中途宕机由 `recoverInterruptedUpdate()` 在重启时自愈，两层保障闭环。

### 4.3 nginx：推荐"方案一"（nginx 托管静态 + API 反代）

```nginx
server {
    listen 80;
    server_name todo.wbwone1.cn;

    root /opt/work-schedule/frontend/dist;
    index index.html;

    gzip on;
    gzip_comp_level 5;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # 带内容哈希的资源：一年长缓存，重建后文件名变化自动失效
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8998;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

选择理由与备选：

- **方案一（推荐）**：nginx 直接发静态文件，gzip / `immutable` 长缓存配置清晰；后端只承担 API。dist 中 hash 文件名与 `immutable` 是天然搭档。
- **备选"方案二"（全反代 8998 + `WORK_SCHEDULE_SERVE_STATIC=true`）**：nginx 只需把 `proxy_pass` 从 5173 改成 8998，改动最小，SPA 回退与登录重定向由 `createApp.js` 内置逻辑处理。缺点是 Express 静态服务无 gzip（未引入 compression 依赖），bundle 以未压缩体积传输。作为过渡或极简部署的选项保留——`deploy.sh` 默认开启 `SERVE_STATIC` 正是为这条路径兜底。
- 现行"方案一 B"（反代 5173）从生产文档中降级为"仅开发调试"，避免再次误用于生产。

### 4.4 与一键更新的兼容性核对

| 更新场景 | 生产模式下的行为 | 结论 |
| --- | --- | --- |
| 更新成功 | 覆盖含新 dist 的代码 → verifyBoot → `exit(0)` → systemd 3s 后拉起 `deploy.sh` → 新版本上线 | 兼容（R1/R2/R3 均满足） |
| release 包无预构建 dist | 更新流程现场 `npm install --include=dev` + build，verifyBoot 仍把关 dist 存在性 | 兼容 |
| 安装/构建/验证失败 | 快照解回（含旧 dist）→ 回滚版重启；nginx 静态目录即 dist，回滚即时生效 | 兼容 |
| 更新中途进程死亡 | systemd 拉起 → `recoverInterruptedUpdate()` 恢复快照 → 再启动 | 兼容 |
| dist 内旧 hash 文件残留 | tar 覆盖同名文件、不删异名文件；index.html 只引用新 hash，正确性无影响；旧 chunk 残留反而让**已打开的旧页面**在更新后仍能懒加载旧 chunk，避免白屏 | 可接受（清理列为可选项） |

唯一的行为差异：`/api/system/stop`（现有停止接口）在 systemd 下会触发自动重启，语义从"停机"变成"重启"。该接口本来主要服务于旧的 nohup 部署，systemd 环境下停机应使用 `systemctl stop work-schedule`——在 Usage.md 中说明即可，不改代码。

## 5. 改动清单

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `deploy.sh` | 新增 | 生产启动脚本（4.1），`chmod +x` |
| `deploy/work-schedule.service` | 新增 | systemd 模板（4.2） |
| `deploy/nginx-work-schedule.conf` | 新增 | nginx 生产配置模板（4.3） |
| `Usage.md` | 修改 | 部署章节改写：生产部署统一走 `deploy.sh` + systemd + nginx 方案一；标注 `start.sh`/`stop.sh` 为开发专用；补充 `systemctl stop` 与 `/api/system/stop` 的语义说明 |
| `nginx.conf`（根目录） | 修改（仅注释） | 文件头加注"开发调试用，生产请使用 deploy/nginx-work-schedule.conf"，内容不动 |
| `start.sh` / `stop.sh` | **不动** | — |

## 6. 服务器迁移步骤（现状 dev 模式 → 生产模式）

1. 拉取包含 `deploy.sh` 的代码（`git pull` 或网页端一键更新一次——release zip 自带 dist）；
2. 停掉现有进程：`./stop.sh`；确认 5173 / 8998 无残留（`lsof -i :5173 -i :8998`）；
3. 若 `frontend/dist/index.html` 不存在：`./deploy.sh --build`（首次）；dist 已存在则跳过；
4. 安装 systemd 单元：复制 `deploy/work-schedule.service` → `systemctl daemon-reload && systemctl enable --now work-schedule`；
5. 替换 nginx 站点配置为 `deploy/nginx-work-schedule.conf`（改 server_name/路径）→ `nginx -t && systemctl reload nginx`；
6. 按第 7 节验收。

## 7. 验收标准

性能（对照第 1 节基线，同一测量脚本）：

- [ ] `/app/stats` 加载网络请求数 ≤ 6（html + css + js×2 + api×2）；
- [ ] 冷加载 wall time < 2.5s（含 650ms 级 RTT）；
- [ ] 静态资源响应含 `Content-Encoding: gzip`；`/assets/*` 含 `Cache-Control: ...immutable`。

功能与更新链路：

- [ ] 登录、各页面（含统计图表）正常；
- [ ] 网页端一键更新：SSE 走到 done → ~4s 内 systemd 自动拉起 → `GET /api/system/version` 返回新版本，页面资源为新 hash；
- [ ] 更新失败回滚场景（可断网模拟）：回滚完成、dist 为旧版本、服务存活；
- [ ] `systemctl stop/start work-schedule` 行为正常；
- [ ] `data/`、`.env`、`config/auth.json` 全程不受影响。

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 服务器上 dist 缺失（如只 `git pull` 了源码） | `deploy.sh` fail-fast 并给出两条修复指引；verifyBoot 同样拦截 |
| nginx `root` 指向的目录权限不足 | 迁移步骤含检查；模板中路径与 WorkingDirectory 一致（/opt/work-schedule） |
| 更新后旧页面请求已删除的 chunk 404 | dist 残留旧 hash 文件天然缓解；前端已开新页签即用新版本 |
| `/api/system/stop` 在 systemd 下变成重启 | 文档说明语义变化，运维用 `systemctl stop` |
| 用户继续误用 start.sh 于生产 | Usage.md 明确分工 + `deploy.sh` 报错信息互指 |

## 9. 后续可选优化（本次不做）

- 更新覆盖前清空 `frontend/dist`（有快照兜底，风险可控），避免 hash 文件无限累积；
- 引入 `compression` 中间件，让"方案二"（纯反代）也具备 gzip；
- `deploy.sh` 增加 `--health` 自检（curl /api/health）供部署脚本/监控调用；
- CI 增加前端构建产物体积预算检查，防止 bundle 膨胀回退到"多请求慢加载"。
