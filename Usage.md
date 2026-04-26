# Usage: 部署、启动与停止指南

本文档说明如何把本项目部署到另一台云服务器，并完成安装、启动、停止、升级和数据迁移。

## 1. 部署方案概览

推荐部署结构：

```text
用户浏览器
  |
  | HTTP/HTTPS
  v
Nginx（可选，负责域名、HTTPS、反向代理）
  |
  | http://127.0.0.1:8998
  v
Node.js + Express 应用
  |
  v
服务器本地 data/*.json
```

首选方案：

- 应用运行在服务器本地 `8998` 端口。
- 使用 `systemd` 管理应用进程，支持开机自启、崩溃重启、日志查看。
- 如果只通过服务器 IP 访问，可以不安装 Nginx。
- 如果需要域名、HTTPS 或隐藏内部端口，建议使用 Nginx 反向代理。
- 数据保存在项目目录下的 `data/`，迁移服务器时复制该目录即可。
- 应用要求登录访问，正式部署时必须配置访问凭据。

## 2. 服务器环境要求

建议系统：

- Ubuntu 22.04/24.04 LTS，或其他主流 Linux 发行版

依赖：

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

选择一个部署目录，例如 `/opt/work-schedule`：

```bash
sudo mkdir -p /opt/work-schedule
sudo chown -R "$USER":"$USER" /opt/work-schedule
git clone <你的仓库地址> /opt/work-schedule
cd /opt/work-schedule
```

如果不是 Git 仓库，也可以直接上传项目目录到 `/opt/work-schedule`。

安装依赖：

```bash
npm install
```

## 4. 本地试运行

默认端口是 `8998`：

```bash
npm start
```

看到类似输出表示启动成功：

```text
Work Schedule server running on port 8998
```

测试接口：

```bash
curl http://127.0.0.1:8998/api/health
```

浏览器访问：

```text
http://<服务器公网IP>:8998
```

如果云服务器安全组没有开放 `8998`，外部无法访问。可以临时开放该端口，或使用后文的 Nginx 反向代理。

停止试运行：

```bash
Ctrl+C
```

## 5. 使用 systemd 托管服务

推荐用 `systemd` 作为正式运行方式。

正式部署前，先初始化访问凭据：

```bash
npm run auth:init
```

脚本会要求输入用户名和密码：

- 用户名留空：随机生成用户名
- 密码留空：随机生成强密码
- 自动登录有效天数留空：默认 30 天
- HTTPS Cookie 留空：默认不启用

生成的配置文件在：

```text
config/auth.json
```

该文件保存的是密码哈希和 Cookie 签名密钥，不保存明文密码。脚本会把文件权限设置为 `600`。请妥善保存脚本输出的用户名和密码，密码不会再次以明文显示。

创建服务文件：

```bash
sudo nano /etc/systemd/system/work-schedule.service
```

写入：

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

[Install]
WantedBy=multi-user.target
```

如果你把认证配置放在其他位置，可以额外设置：

```ini
Environment=WORK_SCHEDULE_AUTH_CONFIG=/path/to/auth.json
```

加载服务：

```bash
sudo systemctl daemon-reload
```

启动：

```bash
sudo systemctl start work-schedule
```

设置开机自启：

```bash
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

停止：

```bash
sudo systemctl stop work-schedule
```

重启：

```bash
sudo systemctl restart work-schedule
```

## 6. 使用页面内停止按钮

应用顶部有 `停止软件` 按钮，会调用：

```text
POST /api/system/stop
```

如果应用由 `npm start` 直接运行，点击后进程会退出。

如果应用由 `systemd` 托管，点击停止按钮后进程会退出，但 `systemd` 因为配置了 `Restart=always`，会自动重新拉起服务。因此正式部署时建议使用：

```bash
sudo systemctl stop work-schedule
```

如果你希望页面内停止按钮能真正停止服务，需要把服务文件中的：

```ini
Restart=always
```

改成：

```ini
Restart=on-failure
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart work-schedule
```

## 7. 登录与退出

浏览器访问应用时会先进入登录页：

```text
http://<服务器公网IP>:8998/login.html
```

输入 `npm run auth:init` 初始化时生成或填写的用户名和密码即可登录。

如果勾选 `自动登录`，浏览器会保存一个签名 Cookie。这个 Cookie 不保存明文密码，只保存服务器可校验的登录令牌；在有效期内再次访问无需输入凭据。

退出当前用户：

- 点击页面顶部 `退出登录`
- 或请求接口：

```bash
curl -X POST http://127.0.0.1:8998/api/auth/logout
```

退出后浏览器中的登录 Cookie 会被清除。

## 8. Nginx 反向代理（可选但推荐）

如果你希望通过 `80/443` 端口访问，而不是暴露 `8998`，可以使用 Nginx。

创建配置：

```bash
sudo nano /etc/nginx/sites-available/work-schedule
```

写入：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8998;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果没有域名，只想用 IP，可以临时写：

```nginx
server_name _;
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/work-schedule /etc/nginx/sites-enabled/work-schedule
sudo nginx -t
sudo systemctl reload nginx
```

此时访问：

```text
http://<服务器公网IP>
```

或：

```text
http://your-domain.com
```

## 9. HTTPS（可选）

如果有域名，推荐用 Certbot 配置 HTTPS：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

证书续期通常会自动配置。可检查：

```bash
sudo systemctl status certbot.timer
```

## 10. 数据文件与迁移

核心数据在：

```text
data/tasks.json
data/checkpoints.json
data/categories.json
data/statistics_cache.json
data/backups/
config/auth.json
```

迁移到新服务器时，在旧服务器执行：

```bash
cd /opt/work-schedule
tar -czf work-schedule-data.tar.gz data config/auth.json
```

把压缩包上传到新服务器项目目录后：

```bash
cd /opt/work-schedule
tar -xzf work-schedule-data.tar.gz
```

然后重启服务：

```bash
sudo systemctl restart work-schedule
```

建议定期备份：

```bash
cd /opt/work-schedule
tar -czf "backup-$(date +%F-%H%M%S).tar.gz" data config/auth.json
```

## 11. 升级部署

如果使用 Git：

```bash
cd /opt/work-schedule
git pull
npm install
sudo systemctl restart work-schedule
```

如果通过上传文件升级：

1. 停止服务：

```bash
sudo systemctl stop work-schedule
```

2. 备份数据：

```bash
cd /opt/work-schedule
tar -czf "backup-$(date +%F-%H%M%S).tar.gz" data config/auth.json
```

3. 覆盖代码，但不要删除 `data/`。

4. 安装依赖并启动：

```bash
npm install
sudo systemctl start work-schedule
```

## 12. 防火墙与安全组

如果直接访问 `8998`：

- 云服务器安全组需要开放 TCP `8998`
- 系统防火墙也需要允许该端口

Ubuntu UFW 示例：

```bash
sudo ufw allow 8998/tcp
sudo ufw status
```

如果使用 Nginx：

- 云服务器安全组开放 `80` 和 `443`
- 不需要对公网开放 `8998`

UFW 示例：

```bash
sudo ufw allow "Nginx Full"
sudo ufw status
```

## 13. 常见问题

### 端口被占用

错误示例：

```text
EADDRINUSE: address already in use 0.0.0.0:8998
```

查看占用：

```bash
sudo lsof -i :8998
```

解决方式：

```bash
sudo systemctl stop work-schedule
```

或换端口：

```bash
PORT=9000 npm start
```

systemd 中换端口则修改：

```ini
Environment=PORT=9000
```

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl restart work-schedule
```

### 外网无法访问

依次检查：

```bash
sudo systemctl status work-schedule
curl http://127.0.0.1:8998/api/health
sudo ufw status
```

还要检查云厂商安全组是否开放对应端口。

### 数据没有了

先确认当前运行目录是否正确：

```bash
sudo systemctl status work-schedule
```

检查 `WorkingDirectory` 是否是项目目录。

再查看：

```bash
ls -lah /opt/work-schedule/data
```

本项目会在 `data/backups/` 下保留最近备份，可用于人工恢复。

### 服务反复重启

查看日志：

```bash
journalctl -u work-schedule -n 100 --no-pager
```

常见原因：

- Node.js 版本过低
- 端口占用
- 项目目录权限不正确
- `data/*.json` 文件损坏

## 14. 推荐的正式部署检查清单

- [ ] Node.js 版本为 18+
- [ ] `npm install` 成功
- [ ] 已运行 `npm run auth:init`
- [ ] 已确认 `config/auth.json` 权限为 `600`
- [ ] 已妥善保存初始化脚本输出的用户名和密码
- [ ] `curl http://127.0.0.1:8998/api/health` 成功
- [ ] `systemd` 服务能启动
- [ ] 已设置开机自启
- [ ] 已确认 `data/` 目录存在且有写权限
- [ ] 已确认云服务器安全组开放正确端口
- [ ] 如使用域名，Nginx 反代正常
- [ ] 如使用 HTTPS，证书配置正常
- [ ] 已建立 `data/` 备份流程
