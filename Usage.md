# Usage: 部署、启动与停止指南

本文档说明如何将本项目部署到云服务器，并完成安装、启动、停止、升级和数据迁移。

## 1. 部署方案概览

### 方案一：Nginx 反代 + 前端构建产物（推荐）

```
用户浏览器
  |
  | HTTP/HTTPS
  v
Nginx（域名、HTTPS、反向代理）
  |                   |
  | /api/*            | /*（静态文件）
  v                   v
Node.js 后端 :8998    前端构建产物（dist/）
```

### 方案二：后端直接托管前端构建产物

```
用户浏览器
  |
  | HTTP/HTTPS
  v
Nginx（可选）
  |
  v
Node.js + Express（托管 API + 前端静态文件）
```

### 方案三：纯 API 模式（前端独立部署）

前端可独立部署在任何位置（Vercel、另一台服务器等），通过 API 通信。

## 2. 服务器环境要求

- Ubuntu 22.04/24.04 LTS 或其他主流 Linux 发行版
- Node.js 18+
- npm
- git
- 可选：Nginx

安装依赖：

```bash
sudo apt update
sudo apt install -y git curl nginx
```

安装 Node.js 20 LTS：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 3. 获取代码

```bash
sudo mkdir -p /opt/work-schedule
sudo chown -R "$USER":"$USER" /opt/work-schedule
git clone <你的仓库地址> /opt/work-schedule
cd /opt/work-schedule
```

安装依赖（后端 + 前端）：

```bash
npm install
cd frontend && npm install && cd ..
```

## 4. 构建前端

```bash
cd /opt/work-schedule/frontend
npm run build
```

构建产物在 `frontend/dist/` 目录。

默认 API 地址为空（同源请求），适用于 Nginx 同域反代。如需修改：

```bash
# 构建时指定 API 地址
VITE_API_BASE=https://your-domain.com/api npm run build
```

也可在 `frontend/.env` 文件中设置：

```
VITE_API_BASE=https://your-domain.com/api
```

## 5. 配置后端

初始化登录凭据：

```bash
cd /opt/work-schedule
npm run auth:init
```

脚本会要求输入用户名和密码：

- 用户名留空：随机生成
- 密码留空：随机生成强密码
- 自动登录有效天数留空：默认 30 天
- HTTPS Cookie 留空：默认不启用

生成的配置文件在 `config/auth.json`，权限自动设为 `600`。

## 6. 使用 systemd 托管后端

创建服务文件：

```bash
sudo nano /etc/systemd/system/work-schedule.service
```

```ini
[Unit]
Description=Work Schedule Learning Planner
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/work-schedule
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=8998
Environment=WORK_SCHEDULE_CORS_ORIGINS=https://your-domain.com

[Install]
WantedBy=multi-user.target
```

**注意**：如果使用 Nginx 同域反代（方案一）、或使用 Vite proxy + Nginx 反代开发服务器（方案一 B），前后端同源，无需设置 `CORS_ORIGINS`。如果前后端不同源，需要正确配置此变量。

```bash
sudo systemctl daemon-reload
sudo systemctl start work-schedule
sudo systemctl enable work-schedule
```

查看状态：

```bash
sudo systemctl status work-schedule
```

查看日志：

```bash
journalctl -u work-schedule -f
```

## 7. Nginx 配置

### 方案一：同域部署（推荐）

前端构建产物 + API 反代都在同一个域名下：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    root /opt/work-schedule/frontend/dist;
    index index.html;

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:8998;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA 路由：所有非文件请求返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**关键**：最后一行 `try_files $uri $uri/ /index.html` 确保 React 路由（如 `/app/tasks`）刷新时不会 404。

### 方案一 B：Nginx 反代至 Vite 开发服务器

开发或调试阶段，可将前端请求转发至 Vite 开发服务器（热更新支持）：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 后端 API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:8998;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 前端 Vite 开发服务器代理
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

使用此方案时，启动服务需指定 `ALLOWED_HOSTS` 环境变量（`start.sh` 已集成）：

```bash
ALLOWED_HOSTS=your-domain.com ./start.sh
```

多个域名用逗号分隔：

```bash
ALLOWED_HOSTS=your-domain.com,your-backup-domain.com ./start.sh
```

### 方案二：同域部署（后端托管前端文件）

如果希望后端同时托管前端构建产物，把构建产物复制到 `public/` 目录，然后设置 `WORK_SCHEDULE_SERVE_STATIC=true`。

不过更推荐使用方案一（Nginx 托管静态文件），性能更好且配置灵活。

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/work-schedule /etc/nginx/sites-enabled/work-schedule
sudo nginx -t
sudo systemctl reload nginx
```

## 8. HTTPS（可选）

有域名时推荐用 Certbot 配置 HTTPS：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 9. 登录与使用

### 登录

浏览器访问 `https://your-domain.com`（或 `http://服务器IP`），进入登录页。

输入 `npm run auth:init` 时设置的用户名和密码。

勾选"记住我"可保存登录会话，有效期内免密访问。

### 页面导航

左侧侧边栏（手机端为底部导航栏）包含：

| 页面 | 说明 |
| --- | --- |
| 今日 | 仪表盘：当前任务、各分类推荐、今日摘要 |
| 任务 | 任务列表/看板，按分类筛选、多维度排序 |
| 统计 | 分析面板：完成率、按时率、分类用时、优先级分布、每日趋势 |
| 异常 | 审查被推迟或跳过检查点的任务 |
| 归档 | 已完成任务回顾，显示省时/准时/超时标记 |
| 设置 | 管理自定义分类 |

### 退出登录

点击侧边栏底部的"退出登录"按钮。

## 10. 数据文件与迁移

核心数据在 `data/` 目录：

```
data/tasks.json
data/checkpoints.json
data/categories.json
data/statistics_cache.json
data/backups/
config/auth.json
```

迁移到新服务器时：

```bash
cd /opt/work-schedule
tar -czf work-schedule-data.tar.gz data config/auth.json
```

上传到新服务器项目目录后：

```bash
cd /opt/work-schedule
tar -xzf work-schedule-data.tar.gz
sudo systemctl restart work-schedule
```

建议定期备份：

```bash
cd /opt/work-schedule
tar -czf "backup-$(date +%F-%H%M%S).tar.gz" data config/auth.json
```

## 11. 升级部署

```bash
cd /opt/work-schedule
git pull
npm install
cd frontend && npm install && npm run build && cd ..
sudo systemctl restart work-schedule
```

如果前端无变化，可跳过前端构建步骤：

```bash
cd /opt/work-schedule
git pull
npm install
sudo systemctl restart work-schedule
```

## 12. 本地开发

### 启动

开发时使用 `start.sh` 脚本同时启动后端和前端开发服务器：

```bash
./start.sh
```

- 后端：`http://localhost:8998`
- 前端：`http://localhost:5173`（支持热更新）

Vite 开发服务器已配置 proxy，将 `/api/` 请求自动转发到后端（8998 端口），前端 API 请求走同源路径，无需 CORS。配置见 [frontend/vite.config.ts](frontend/vite.config.ts)。

### 环境变量说明

| 变量 | 用途 | 示例 |
|---|---|---|
| `VITE_API_BASE` | 前端 API 基地址（默认空=同源） | `http://localhost:8998` |
| `ALLOWED_HOSTS` | Vite 开发服务器允许的域名（逗号分隔） | `todo.example.com` |
| `WORK_SCHEDULE_CORS_ORIGINS` | 后端允许的跨域来源 | `http://localhost:5173` |
| `WORK_SCHEDULE_SERVE_STATIC` | 后端托管静态文件模式 | `true` |

### 停止

```bash
./stop.sh
```

## 13. 防火墙与安全组

### 使用 Nginx（推荐）

- 开放端口：`80`（HTTP）和 `443`（HTTPS）
- 无需对公网开放 `8998`

```bash
sudo ufw allow "Nginx Full"
```

### 直接访问 8998

- 云服务器安全组开放 TCP `8998`
- 系统防火墙允许 `8998`

```bash
sudo ufw allow 8998/tcp
```

### 前端开发服务器（5173）

本地开发时需要开放：

```bash
sudo ufw allow 5173/tcp
```

## 14. 常见问题

### 端口被占用

```text
EADDRINUSE: address already in use 0.0.0.0:8998
```

```bash
sudo lsof -i :8998
sudo systemctl stop work-schedule
```

或换端口启动。

### 前端页面刷新后 404

检查 Nginx 配置中是否包含：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

这是 React SPA 路由必需的配置。

### API 请求 401

- 登录会话已过期，重新登录即可
- 前后端时间不同步可能导致令牌验证失败
- Cookie 跨域配置不正确（检查 CORS_ORIGINS 和 SameSite）

### API 请求跨域错误

- 确认后端的 `WORK_SCHEDULE_CORS_ORIGINS` 包含了前端实际访问地址
- 使用同域部署（Nginx 反代 + 静态文件）可避免跨域问题
- 本地开发时 Vite proxy 已将 `/api/` 转发至后端，不会产生跨域

### 数据丢失

```bash
# 检查当前运行目录
sudo systemctl status work-schedule

# 查看 data 目录
ls -lah /opt/work-schedule/data
```

本项目在 `data/backups/` 下保留最近 5 份备份，可用于手动恢复。

### 服务反复重启

```bash
journalctl -u work-schedule -n 100 --no-pager
```

常见原因：Node.js 版本过低、端口占用、目录权限不正确、JSON 文件损坏。

## 15. 正式部署检查清单

- [ ] Node.js 版本为 18+
- [ ] 后端 `npm install` 成功
- [ ] 前端 `npm install` 成功
- [ ] 前端 `npm run build` 成功
- [ ] 已运行 `npm run auth:init`
- [ ] 已妥善保存用户名和密码
- [ ] `curl http://127.0.0.1:8998/api/health` 成功
- [ ] `systemd` 服务正常启动
- [ ] 已设置开机自启
- [ ] 前端页面可正常访问，无 404
- [ ] 登录、任务 CRUD、统计等功能正常
- [ ] 安全组和防火墙已正确配置
- [ ] 如使用域名，Nginx 配置正确
- [ ] 如使用 HTTPS，证书配置正常
- [ ] 已建立数据备份流程
- [ ] 如使用 Vite 开发服务器 + Nginx 反代，已设置 `ALLOWED_HOSTS`
