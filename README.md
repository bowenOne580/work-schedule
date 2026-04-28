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

## 界面概览

项目采用前后端分离架构，前端为 React 单页应用。

### 登录页

简洁的居中登录表单，包含用户名、密码输入框和"记住我"复选框。登录后跳转至仪表盘。

### 仪表盘（今日）

顶部显示当前日期，主要分为三个区域：

- **当前进行中** — 正在进行的任务卡片，可一键暂停或完成，显示进度条和估时/实际用时对比。
- **各分类推荐** — 每个分类下评分最高的待办任务，可一键开始，显示优先级、估时、截止日期和推荐评分。
- **今日摘要** — 三个指标卡片：今日用时、本周用时、今日完成任务数。

### 任务列表 / 看板

左侧为分类侧边栏（全部 + 各分类），右侧为主区域：

- **视图切换** — 列表视图（紧凑行式）与看板视图（待开始 / 进行中 / 已暂停三列）。
- **排序方式** — 按评分、优先级、截止日期、剩余时间。
- **新建任务** — 弹出模态框，填写标题、分类、优先级（P1-P5）、截止日期、估时。
- **任务行** — 左侧优先级色条、标题、状态徽章、截止日期、进度条。异常任务有 ⚠ 标记。

### 任务详情

点击任意任务进入详情页，功能包括：

- 点击标题直接编辑
- 分类、优先级、截止日期的下拉/输入修改（完成后只读）
- 估时 vs 实际用时的对比条形图
- 标签展示
- 进度条
- 操作按钮：开始 / 暂停 / 继续 / 完成 / 推迟（按状态动态显示）
- 完成时弹出模态框填写实际花费时间
- 推迟时选择"延期天数"或"指定日期"
- 检查点管理：添加、完成、跳过、取消完成/跳过、删除

### 统计分析

六个摘要指标卡片：今日用时、本周用时、本周完成数、完成率、准时率、平均超时比。

三个图表：

- **分类用时对比** — 柱状图，每个分类的预计 vs 实际时间
- **优先级完成分布** — 环形饼图，各优先级完成任务数占比
- **每日用时趋势** — 折线图，近 7 天每日学习时间

### 异常任务

列出所有带异常标记的任务（已推迟、跳过检查点），可点击查看详情或标记为已忽略。

### 归档

按分类筛选已完成任务，每行显示省时 / 准时 / 超时状态及用时百分比。

### 设置 — 分类管理

自定义分类的增删，并列出系统内置只读分类（默认分类、异常任务桶、归档桶）。

## 技术栈

- **后端**：Node.js + Express
- **前端**：React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + Recharts 3 + Lucide React
- **存储**：服务器本地 JSON（`data/`），串行写入队列 + 原子文件替换 + 自动备份回滚
- **认证**：单用户登录，密码 scrypt 哈希，HttpOnly Cookie（支持会话与自动登录）
- **运行模式**：默认 API-only（前后端分离），可选兼容旧静态页面

## 快速启动（本地开发）

### 前置要求

- Node.js 18+
- npm

### 1. 安装依赖

```bash
# 后端依赖
npm install

# 前端依赖
cd frontend && npm install && cd ..
```

### 2. 初始化登录凭据

```bash
npm run auth:init
```

按提示输入用户名和密码；留空则随机生成。生成的 `config/auth.json` 不应提交到版本库。

### 3. 启动开发服务

使用一键脚本同时启动后端（8998 端口）和前端（5173 端口）：

```bash
./start.sh
```

或分别启动：

```bash
# 终端 1：后端
WORK_SCHEDULE_CORS_ORIGINS=http://localhost:5173 npm start

# 终端 2：前端
cd frontend && npm run dev
```

### 4. 访问应用

打开浏览器访问 `http://localhost:5173`，使用刚才初始化的凭据登录。

### 停止服务

```bash
./stop.sh
```

## 环境变量

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8998` | 后端监听端口 |
| `WORK_SCHEDULE_CORS_ORIGINS` | 空 | 允许跨域的前端源，多个以逗号分隔 |
| `WORK_SCHEDULE_COOKIE_SAMESITE` | `Lax` | 登录 Cookie 的 SameSite |
| `WORK_SCHEDULE_COOKIE_SECURE` | 继承 auth.json | 是否强制 Secure Cookie |
| `WORK_SCHEDULE_COOKIE_DOMAIN` | 空 | Cookie Domain |
| `WORK_SCHEDULE_SERVE_STATIC` | `false` | 设为 `true` 可兼容旧静态页面 |
| `VITE_API_BASE`（前端） | `http://localhost:8998` | API 地址，可在 `frontend/.env` 中设置 |

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
- `data/backups/`

## 部署

详细部署指南请参阅 [Usage.md](./Usage.md)。
