## 背景

我是一名计科专业的大学生，目前在探索诸多方向，时常感到无法合理利用时间，也会有许多不知道该做什么的迷茫时刻。

我希望设计一个软件，能够记录我正在学习的领域，为自己规划任务（包括步骤分解、优先级、估计时间、目前进度），以跟踪我的学习路线。

## 设计

软件的重点在于任务规划模块，我希望为每个任务贴上一些标签，在其中放置一些检查点，实现实时进度跟踪，在每个检查点记录花费的时间。任务的存储方式暂时没想好，但是我希望做一个较轻量的软件，所以不要使用大型数据库，可以尝试用 `json` 等存储数据。

任务应能够分类，同类别的任务分到一起。在主页为我推荐每个类别的任务中优先级最高的一个，供我选择完成。

同时，应实现一个统计模块，包含各种有用的统计信息。（虽然目前还没想好要哪些，你可以建议一些）

## 原则

严格遵循软件设计规范：

1. 需求捕获->设计结构与模块->设计实现方案->编写代码->验证
2. 代码可维护性强、规范、易于扩展。
3. 各个模块之间尽量解耦，通过参数调用等传递信息，修改与扩展的代价要小。
4. 人机交互友好。
5. 选择合适的技术栈，我希望这是一个轻量的，能部署到服务器上的，通过网页能访问的软件。

你在设计与编写的过程中遇到任何需要澄清的问题，尽管问我。

## 当前实现

本仓库已经实现一个单用户学习任务规划 Web 应用，特性如下：

- 服务端：Node.js + Express
- 存储：服务器本地 JSON（`data/`）
- 访问控制：单用户登录，凭据保存在本地 `config/auth.json`，密码使用哈希存储
- 并发写入：写操作串行队列 + 临时文件原子替换 + 自动备份回滚
- 默认端口：`8998`（可通过环境变量 `PORT` 覆盖）
- 运行模式：默认 `API-only`（用于前后端分离），可选兼容旧静态页面
- 鉴权：HttpOnly Cookie（支持会话登录与自动登录）
- API 能力：任务/检查点/分类/推荐/统计/异常/系统控制

## 快速启动（Linux）

1. 安装 Node.js（建议 18+）与 npm
2. 安装依赖：

```bash
npm install
```

3. 初始化登录凭据：

```bash
npm run auth:init
```

按提示输入用户名和密码；留空则随机生成。生成的 `config/auth.json` 不应提交到版本库。

4. 启动服务（默认 8998 端口）：

```bash
npm start
```

5. 验证 API 可用：

```bash
curl http://<服务器IP>:8998/api/health
```

如果要自定义端口：

```bash
PORT=9000 npm start
```

## 前后端分离运行参数

默认模式为 `API-only`。前端建议独立部署（任意框架均可），通过 HTTP 调用本服务 API。

常用环境变量：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8998` | 后端监听端口 |
| `WORK_SCHEDULE_CORS_ORIGINS` | 空 | 允许跨域访问的前端源，多个以英文逗号分隔，例如 `http://localhost:5173,https://app.example.com` |
| `WORK_SCHEDULE_COOKIE_SAMESITE` | `Lax` | 登录 Cookie 的 SameSite，取值 `Lax` / `Strict` / `None` |
| `WORK_SCHEDULE_COOKIE_SECURE` | 继承 `config/auth.json` 的 `cookieSecure` | 是否强制 `Secure` Cookie |
| `WORK_SCHEDULE_COOKIE_DOMAIN` | 空 | Cookie Domain（按需配置） |
| `WORK_SCHEDULE_SERVE_STATIC` | `false` | 设为 `true` 可兼容内置静态页面（旧模式） |

跨域部署建议：

- 浏览器前端与 API 不同源时，设置 `WORK_SCHEDULE_CORS_ORIGINS`。
- 若要跨站携带 Cookie，通常需要 `WORK_SCHEDULE_COOKIE_SAMESITE=None` 且 `WORK_SCHEDULE_COOKIE_SECURE=true`（生产环境配 HTTPS）。
- 前端请求需开启凭据（如 `fetch(..., { credentials: "include" })`）。

## API 概览

- 任务
	- `GET /api/tasks`
	- `GET /api/tasks/:id`
	- `POST /api/tasks`
	- `PATCH /api/tasks/:id`
	- `DELETE /api/tasks/:id`
	- `PATCH /api/tasks/:id/anomaly-ignore`
	- `POST /api/tasks/:id/start`
	- `POST /api/tasks/:id/pause`
	- `POST /api/tasks/:id/resume`
	- `POST /api/tasks/:id/complete`
	- `POST /api/tasks/:id/postpone`
- 检查点
	- `POST /api/tasks/:id/checkpoints`
	- `PATCH /api/checkpoints/:id`
	- `DELETE /api/checkpoints/:id`
	- `POST /api/checkpoints/:id/complete`
	- `POST /api/checkpoints/:id/skip`
	- `POST /api/checkpoints/:id/uncomplete`
- 推荐
	- `GET /api/recommendations/by-category`
- 统计
	- `GET /api/statistics/overview`
- 异常
	- `GET /api/tasks/anomalies`
- 分类
	- `GET /api/categories`
	- `POST /api/categories`
	- `DELETE /api/categories/:id`
- 系统
	- `POST /api/system/stop`

## 数据文件

启动后会自动创建并维护：

- `data/tasks.json`
- `data/checkpoints.json`
- `data/categories.json`
- `data/statistics_cache.json`
- `data/backups/*`
