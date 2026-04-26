# 前端重构对接文档（fronted）

本文档用于前后端分离协作：

- 后端保证：接口路径、鉴权方式、响应包结构、错误格式稳定。
- 前端可自由：框架选型、页面结构、组件库、视觉语言、动效策略。

## 1. 协作边界

必须遵守（硬约束）：

- 统一 API 前缀：`/api`。
- 统一成功响应：`{ "data": ... }`。
- 统一失败响应：`{ "error": { "code", "message", "details" } }`。
- 登录态基于 HttpOnly Cookie，前端不能读取 token，只能通过带凭据请求识别登录状态。
- 任务状态变更必须走动作接口（`start/pause/resume/complete/postpone`），不能用 `PATCH /api/tasks/:id` 直接改 `status`。

前端自由（软约束）：

- 可用任意技术栈（React/Vue/Svelte/原生均可）。
- 可重构为单页或多页，信息架构自主决定。
- 可自由定义主题、配色、字体、卡片布局、图表实现。
- 可自由决定是否本地缓存、预加载、乐观更新。

## 2. 运行与网络约定

- 后端默认端口：`8998`。
- 建议前端用环境变量维护 API 基地址：
  - 开发：`http://localhost:8998`
  - 生产：`https://todo.wbwone1.cn`
- 跨域时后端需设置：`WORK_SCHEDULE_CORS_ORIGINS`。
- 前端请求必须携带凭据：
  - `fetch`: `credentials: "include"`
  - `axios`: `withCredentials: true`

## 3. 鉴权流程

1. 前端启动时调用 `GET /api/auth/status`。
2. 若 `authenticated=false`，跳转登录页/登录态。
3. 登录调用 `POST /api/auth/login`，成功后 Cookie 自动下发。
4. 登出调用 `POST /api/auth/logout`，后端清理 Cookie。
5. 对受保护接口返回 `401 AUTH_REQUIRED` 时，统一回到登录态。

## 4. 数据模型（以实际 API 返回为准）

### 4.1 Task

```json
{
  "id": "uuid",
  "title": "string",
  "categoryId": "string",
  "tags": ["string"],
  "manualPriority": 1,
  "directEstimatedMinutes": 120,
  "estimatedMinutes": 120,
  "deadline": "2026-04-30",
  "status": "todo",
  "progress": 0,
  "checkpointIds": ["uuid"],
  "directMinutes": 0,
  "actualMinutes": 0,
  "anomalyFlags": ["postponed"],
  "anomalyIgnored": false,
  "createdAt": "2026-04-26T10:00:00.000Z",
  "updatedAt": "2026-04-26T10:00:00.000Z"
}
```

### 4.2 Checkpoint

```json
{
  "id": "uuid",
  "taskId": "uuid",
  "title": "string",
  "order": 1,
  "estimatedMinutes": 60,
  "actualMinutes": 20,
  "completed": false,
  "skipped": false
}
```

### 4.3 Category

```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "isAnomalyBucket": false,
  "isArchiveBucket": false
}
```

### 4.4 StatisticsOverview

```json
{
  "dateKey": "2026-04-26",
  "dailyMinutes": 0,
  "weeklyMinutes": 0,
  "completionRate": 0,
  "categoryTimeShare": {
    "cat-general": 0
  },
  "doneByPriority": {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0
  }
}
```

## 5. 状态与枚举

任务状态 `status`：

- `todo`
- `in_progress`
- `paused`
- `done`

任务动作：

- `start`
- `pause`
- `resume`
- `complete`
- `postpone`

异常标记 `anomalyFlags`：

- `postponed`
- `checkpoint_skipped`

系统默认分类 ID（请不要写死名称，可根据 ID 识别行为）：

- `cat-general`：默认分类
- `cat-anomaly`：异常任务桶
- `cat-archived`：归档（完成）任务桶

## 6. API 清单（统一接口）

### 6.1 认证

- `GET /api/auth/status`
- `POST /api/auth/login`
  - body: `{ "username": "string", "password": "string", "remember": true }`
- `POST /api/auth/logout`

### 6.2 任务

- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks`
  - body 常用字段：`title, categoryId, tags, manualPriority, estimatedMinutes, deadline, progress, actualMinutes`
- `PATCH /api/tasks/:id`
  - body 可改字段：`title, categoryId, tags, manualPriority, estimatedMinutes, deadline, progress, actualMinutes`
  - 禁止：`status`
- `DELETE /api/tasks/:id`
- `PATCH /api/tasks/:id/anomaly-ignore`
  - body: `{ "ignored": true }`
- `POST /api/tasks/:id/start`
- `POST /api/tasks/:id/pause`
- `POST /api/tasks/:id/resume`
- `POST /api/tasks/:id/complete`
- `POST /api/tasks/:id/postpone`

### 6.3 检查点

- `POST /api/tasks/:id/checkpoints`
  - body 常用字段：`title, order, estimatedMinutes, actualMinutes, completed, skipped`
- `PATCH /api/checkpoints/:id`
- `DELETE /api/checkpoints/:id`
- `POST /api/checkpoints/:id/complete`
  - body 可选：`{ "actualMinutes": 30 }`
- `POST /api/checkpoints/:id/skip`
- `POST /api/checkpoints/:id/uncomplete`

### 6.4 其他业务

- `GET /api/categories`
- `POST /api/categories`
  - body: `{ "name": "string", "description": "string" }`
- `DELETE /api/categories/:id`
- `GET /api/recommendations/by-category`
- `GET /api/statistics/overview`
- `GET /api/tasks/anomalies`
- `POST /api/system/stop`（运维能力，生产环境可隐藏入口）

## 7. 错误处理规范（前端必须统一）

后端错误结构：

```json
{
  "error": {
    "code": "INVALID_TASK_TITLE",
    "message": "Task title is required",
    "details": null
  }
}
```

前端建议：

- 401：进入登录态。
- 404：资源不存在，给用户友好提示。
- 409：状态冲突（例如非法状态流转），提示“当前任务状态不允许此操作”。
- 5xx：统一降级提示 + 重试机制。

## 8. 交互建议（保留高自由度）

必须有：

- 登录态守卫。
- 任务列表/详情编辑。
- 检查点增删改与完成流。
- 分类管理。
- 统计与推荐展示。

可自由发挥：

- 首页信息密度（卡片流、看板、时间轴、分栏均可）。
- 图表库与可视化风格。
- 动效与过渡动画。
- 深浅色主题或品牌主题。
- 移动端优先或桌面优先布局。

## 9. 联调最小清单

- [ ] `GET /api/health` 返回 `ok: true`
- [ ] 登录成功后 `GET /api/auth/status` 为已登录
- [ ] 任务创建/编辑/动作流转闭环通过
- [ ] 检查点完成后任务进度正确联动
- [ ] 统计页可读到 `GET /api/statistics/overview`
- [ ] 跨域部署时 Cookie 可正常携带
