---
name: work-schedule
description: 通过 Work Schedule 的 Agent API 查询、创建和修改学习任务，设置优先级与截止日期，管理检查点和分类。用户要求在该应用中记录任务或安排学习计划时使用。
---

# Work Schedule

通过 HTTP JSON 接口操作任务，用优先级和截止日期落实用户的学习计划。当前接口不能安排具体起止时间，也不能操作独立日程表、计时、完成状态、删除或系统管理。

## 连接与登录

- 从用户或运行环境取得应用地址、账号、密码。约定环境变量为 `WORK_SCHEDULE_URL`、`WORK_SCHEDULE_USERNAME`、`WORK_SCHEDULE_PASSWORD`；不要将凭据写入 skill、任务或日志。
- 默认 API 基地址为应用地址去掉末尾 `/` 后加 `/api/agent/v1`，例如 `https://todo.example.com/api/agent/v1`。前后端分开部署时使用用户提供的后端地址；若提供完整 API 基地址则直接使用，避免重复追加路径。
- 远程连接使用 HTTPS，本机开发可用 HTTP。使用具备网络访问能力的 HTTP 工具或自行编写临时调用代码，无需浏览器登录或 MCP。
- `POST /auth/login`，JSON 请求体为 `{"username":"…","password":"…"}`。从响应 `data.access_token` 取得 Token，之后携带 `Authorization: Bearer <token>`；有效期一小时。网页 Cookie 不适用于此接口。
- JSON 请求使用 `Content-Type: application/json`。业务响应读取 `data`；错误读取 `error.code`、`error.message`、`error.details`。

以下路径均相对于 API 基地址。详细参数按需读取公开的 `GET /openapi.json`，该响应直接是 OpenAPI 文档，不包在 `data` 中。

## 规划与写入

1. 登录后 `GET /context`，读取未完成任务、检查点、分类、`defaultCategoryId`、`serverTime` 与 `timeZone`。先检查已有任务，避免重复创建；优先复用现有分类，不使用系统异常桶或归档桶。
2. 按用户意图创建任务或修改已有任务，只提交规划所需字段。未要求估时就省略；不要从估时推断实际用时。
3. 依据当前时间和用户时区解析“明天”等相对日期，提交明确的 `YYYY-MM-DD`。截止日期在服务器 `timeZone` 当天结束时到期；用户与服务器时区不一致且影响计划时说明差异并确认日期含义。
4. 创建后保存返回的 ID；修改后采用新的 `revision`。向用户简洁报告实际写入的任务、优先级和日期，调用失败时说明哪些未完成。

### 任务

- `GET /tasks` 包含已完成任务，支持 `status`、`categoryId`、`manualPriority`、`deadlineFrom`、`deadlineTo` 筛选；`GET /tasks/:id` 读取详情和版本。
- `POST /tasks` 创建；`PATCH /tasks/:id` 修改未完成任务。可修改字段：`title`、`categoryId`、`tags`、`manualPriority`、`deadline`、`estimatedMinutes`。
- 创建必填非空 `title`（最多 500 字符）；分类省略使用默认分类，优先级省略为 P3。`manualPriority` 为整数 1–5，**P1 最高，P5 最低**。
- `deadline` 为有效日期，省略表示无截止日期，PATCH 传 `null` 清除。`estimatedMinutes` 为选填的非负整数分钟，`null` 表示未估算。`tags` 在 PATCH 时整体替换。
- 创建任务可附 `checkpoints` 数组（最多 100 项）；PATCH 任务不能附带该字段。不要提交 ID、状态、进度、实际用时或计时字段，未知字段会报错。

创建示例（日期按用户要求确定）：

```json
{
  "title": "复习操作系统进程章节",
  "manualPriority": 2,
  "deadline": "2026-10-09",
  "checkpoints": [{"title": "阅读章节"}, {"title": "完成习题"}]
}
```

### 检查点与分类

- `POST /tasks/:id/checkpoints` 添加检查点；`GET /checkpoints/:id` 读取；`PATCH /checkpoints/:id` 修改。字段为 `title`、`order`（正整数）、`estimatedMinutes`；创建必填标题，省略顺序则追加。修改需要检查点自己的版本。
- `GET /categories` 查询；`POST /categories` 创建，必填 `name`、选填 `description`。接口不会按名称自动去重。
- 已完成任务及其检查点不能修改。检查点估时完整时任务估时取其总和，否则使用任务级估时。

## 版本与重试

- **创建防重复：**每次新的 POST 创建操作生成 UUID 作为 `Idempotency-Key`，保留原请求体。网络超时重试必须复用同键、同内容；首次成功为 201，重复为 200。同键不同内容返回 409 `IDEMPOTENCY_CONFLICT`，不要通过换键掩盖结果不明的创建。去重期限 24 小时；超过期限或资源已删除、恢复旧备份时，先查询现状再决定是否创建。
- **修改防覆盖：**PATCH 前读取资源的 `revision`，请求头必须为 `If-Match: "<revision>"`（包含双引号）。只发送需要修改的字段。428 表示缺少版本；412 表示版本已变化，重新读取并协调已有改动，不能盲目覆盖。任务版本也包含其检查点变化。
- **认证：**业务请求 401 时重新登录一次并重试；登录报 `INVALID_CREDENTIALS` 时报告凭据错误，停止猜测。429 遵循 `Retry-After`，不要循环登录。
- **失败：**400 按错误详情修正参数；404 重新查询或核对 OpenAPI；409 按具体错误处理，已完成任务保持只读。网络错误或 5xx 最多退避重试两次。PATCH 结果不明时先读取资源确认目标字段是否已生效，再决定后续修改。持续失败则报告已知结果及未完成操作。
