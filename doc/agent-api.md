# Work Schedule Agent API 调用说明

本接口供 agent 查询、创建和修改学习任务，通过优先级与截止日期安排学习顺序。接口使用 HTTP + JSON，无需浏览器或 MCP。创建的任务直接进入应用现有数据；在网页刷新后可见。

## 1. 地址、账号与权限

应用地址例如 `https://todo.example.com`，API 基路径为 `/api/agent/v1`。服务器初始化账号的方式仍为 `npm run auth:init`，agent 使用与网页相同的账号密码。

精简 skill 见 [skill/work-schedule/SKILL.md](../skill/work-schedule/SKILL.md)，仅依赖 HTTP 调用和在线 OpenAPI，可将整个 `work-schedule` 目录独立复制给 agent。提供 `WORK_SCHEDULE_URL`、`WORK_SCHEDULE_USERNAME`、`WORK_SCHEDULE_PASSWORD` 即可。若前后端使用不同域名，提供后端地址；若通过子路径挂载，提供实际可访问的完整 Agent API 基地址。

域名部署无需修改 skill 内容，但必须能通过该地址访问后端接口。仓库的 [生产 Nginx 配置](../deploy/nginx-work-schedule.conf) 已包含 `/api/` 反向代理；其中只配置 HTTP，远程部署还需配置 HTTPS。代理需保留接口路径及 `Authorization`、`If-Match`、`Idempotency-Key` 请求头，Agent API 路径不能回退为前端 HTML。命令行或服务端 HTTP 调用不受浏览器 CORS 限制，无需为了 skill 额外开放 CORS。

截止日期使用服务器本地时区，可在启动 Node 进程时设置 `TZ=Asia/Shanghai`；`GET /context` 返回实际 `timeZone` 和 `serverTime`。使用其他时区的用户可另行提供自己的时区以解释相对日期。Agent 运行环境须能访问该域名；私有网络需要相应网络连通条件。

远程调用使用 HTTPS；本机开发可使用 `http://localhost:8998`。凭据由使用者通过环境变量或凭据管理器提供，不应写入任务、仓库、调用记录或生成的文档中。

第一版允许：

- 查询规划上下文、分类、任务与检查点。
- 创建任务，可以同时创建检查点；添加或编辑检查点的标题、顺序与估时。
- 修改未完成任务的标题、分类、标签、优先级、估时和截止日期。
- 新建分类。

Agent Token 只适用于这些接口；网页继续使用 Cookie 登录。Agent API 不接受网页 Cookie，也不开放开始/暂停/继续/完成任务、检查点完成/跳过、删除、导入数据、停机或系统更新。

这里的截止日期精确到天，没有具体开始/结束时间段。设置截止日期不会启动计时；任务实际用时通过用户在网页上开始、暂停与完成任务自动累计。

## 2. 登录

`POST /api/agent/v1/auth/login` 不需要 Token，请求头为 `Content-Type: application/json`：

```json
{
  "username": "由使用者提供",
  "password": "由使用者提供"
}
```

成功返回 HTTP 200：

```json
{
  "data": {
    "access_token": "agent-v1.…",
    "token_type": "Bearer",
    "expires_in": 3600
  }
}
```

后续所有业务请求携带 `Authorization: Bearer <access_token>`。有效期为一小时，过期后重新登录，不提供长期刷新 Token。服务重启不会自动失效；更换账号或会话密钥并重启服务会使旧 Token 失效。

同一客户端 IP 在 15 分钟内累计 5 次凭据验证失败，后续登录返回 HTTP 429 和 `Retry-After` 秒数。成功登录清除该 IP 的失败记录。记录保存在进程内，重启清除。反向代理部署下未配置可信代理时，客户端 IP 为代理 IP，失败额度会共享。

## 3. 推荐调用顺序

1. 登录，暂存 Token。
2. `GET /context` 读取分类、未完成任务和检查点，检查是否已有相似任务。
3. 复用现有分类 ID，或通过 `POST /categories` 新建；默认分类为 `cat-general`。不要将任务放入系统异常桶或归档桶。
4. 用新的 `Idempotency-Key` 创建任务和检查点；保存返回的任务 ID。
5. 修改已有任务前，读取 `GET /tasks/:id` 或使用刚读取的上下文，取得 `revision`。
6. 只 PATCH 需要调整的字段，通过 `If-Match` 提交版本，处理冲突后再继续。

所有路径在下表中相对于 `/api/agent/v1`：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/auth/login` | 账号密码登录 |
| GET | `/context` | 服务器时间、时区、默认分类、全部分类与未完成任务 |
| GET | `/tasks` | 查询全部任务，包括已完成任务；无分页 |
| GET | `/tasks/:id` | 任务详情、检查点与版本 |
| POST | `/tasks` | 创建任务，可嵌套检查点 |
| PATCH | `/tasks/:id` | 修改未完成任务 |
| POST | `/tasks/:id/checkpoints` | 添加检查点 |
| GET | `/checkpoints/:id` | 查询检查点与版本 |
| PATCH | `/checkpoints/:id` | 修改检查点规划字段 |
| GET | `/categories` | 查询分类 |
| POST | `/categories` | 新建分类 |
| GET | `/openapi.json` | 公开的机器可读接口描述，无需鉴权 |

业务接口的成功响应使用 `{"data": ...}`，OpenAPI 接口直接返回原始文档。

## 4. 创建和修改任务

```json
{
  "title": "完成操作系统进程章节",
  "categoryId": "cat-general",
  "tags": ["操作系统", "阅读"],
  "manualPriority": 2,
  "deadline": "2026-10-09",
  "checkpoints": [
    { "title": "阅读章节" },
    { "title": "完成习题", "estimatedMinutes": 30 }
  ]
}
```

| 字段 | 类型与规则 |
| --- | --- |
| `title` | 创建必填，非空字符串，最多 500 字符 |
| `categoryId` | 已存在的分类 ID；新建时省略使用默认分类 |
| `tags` | 最多 20 个标签，每个 1–64 字符；创建时默认空数组，PATCH 使用数组整体替换 |
| `manualPriority` | 整数 1–5，**P1 最高、P5 最低**；新建默认 3 |
| `deadline` | 有效的 `YYYY-MM-DD`，按服务器时区在当天结束时截止；省略表示无截止日期，PATCH 使用 null 清除 |
| `estimatedMinutes` | 选填的非负整数分钟数，最多 1,000,000；null 表示未估算 |
| `checkpoints` | 仅创建任务时允许，最多 100 项；和任务在同一存储事务内创建 |

PATCH 至少提交一个可修改字段，未提交的字段保持原值。ID、状态、进度、异常标记、实际用时和计时字段均不能提交，未知字段返回 `VALIDATION_ERROR`，不会被静默忽略。

任务使用原有业务规则：检查点估时完整时任务估时取检查点之和；否则使用任务级估时，未填写时为 null。修改任务级估时不会覆盖检查点估时。已完成任务不能通过 agent 修改。

`GET /tasks` 支持 `status`、`categoryId`、`manualPriority`、`deadlineFrom`、`deadlineTo`。状态为 `todo`、`in_progress`、`paused`、`done`，日期范围含两端，带日期筛选时不包含没有截止日期的任务。例如：

```text
GET /api/agent/v1/tasks?status=todo&manualPriority=1&deadlineTo=2026-10-09
```

## 5. 检查点与分类

创建检查点必填 `title`；`order` 为 1–1,000,000 的整数，省略则追加到末尾；`estimatedMinutes` 与任务相同，为选填。PATCH 仅支持这三个字段，并必须携带该检查点自己的版本。已完成任务下的检查点也不允许 agent 修改。

新建分类示例：`{"name":"操作系统","description":"进程、内存和文件系统"}`。名称非空、最多 100 字符，描述选填、最多 2000 字符。先读取已有分类并尽量复用，接口不会按名称自动合并。

## 6. 修改时的版本检查

任务和检查点响应包含 `revision`；单个资源的 GET、POST、PATCH 响应也返回对应的 `ETag`。

```http
PATCH /api/agent/v1/tasks/任务ID
Authorization: Bearer <access_token>
Content-Type: application/json
If-Match: "读取到的64位revision"

{"manualPriority":1,"deadline":"2026-10-09"}
```

`If-Match` 必须带双引号，不能使用 `*` 或弱 ETag。缺失返回 428；版本变化返回 412。遇到 412 时重新读取，比较用户的新改动并重新规划，不能直接无条件覆盖。任务版本覆盖其检查点变化；修改检查点需要该检查点自己的版本。

## 7. 创建请求的防重复重试

建议为每次新的 POST 创建请求生成 UUID，作为 `Idempotency-Key` 请求头。发生连接中断或超时后，使用**同一个键和相同请求体**重试。

- 首次成功创建返回 HTTP 201，`Idempotency-Replayed: false`。
- 24 小时内且资源仍存在时，同键、同内容重试返回 HTTP 200 与当前资源，`Idempotency-Replayed: true`。请求体对象键的排列顺序不影响比较。
- 同键、不同请求体返回 HTTP 409 `IDEMPOTENCY_CONFLICT`。新的创建操作需要新的键。
- 键按账号、HTTP 方法和路径区分；允许 1–128 个字母、数字以及 `. _ : -`。
- 防重复信息和资源保存在同一个 JSON 文件中，服务重启后仍可重试。删除资源、恢复不含该资源的旧备份或超过 24 小时后，不再保证该键去重，重试前应先查询现状。
- 未提供键也可以创建，但网络超时后直接重发可能重复创建。

保持应用单进程运行；当前 JSON 存储队列不提供多个服务进程之间的互斥。任务与嵌套检查点在业务校验失败时整体回退；现有存储仍是逐文件原子替换，并非跨文件崩溃恢复事务。

## 8. 完整 Python 示例

设置 `WORK_SCHEDULE_URL`、`WORK_SCHEDULE_USERNAME`、`WORK_SCHEDULE_PASSWORD`。下面示例只打印任务 ID，凭据与 Token 保留在内存中。没有第三方 Python 依赖。

```python
import json
import os
import urllib.request
import uuid

base = os.environ["WORK_SCHEDULE_URL"].rstrip("/") + "/api/agent/v1"
token = None

def call(method, path, body=None, **headers):
    request_headers = {"Content-Type": "application/json", **headers}
    if token:
        request_headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(
        base + path,
        data=None if body is None else json.dumps(body).encode("utf-8"),
        headers=request_headers,
        method=method,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)["data"]

login = call("POST", "/auth/login", {
    "username": os.environ["WORK_SCHEDULE_USERNAME"],
    "password": os.environ["WORK_SCHEDULE_PASSWORD"],
})
token = login["access_token"]
context = call("GET", "/context")

# 对一次创建保存这个键及请求体；超时重试时复用它们。
creation_key = str(uuid.uuid4())
task = call("POST", "/tasks", {
    "title": "完成操作系统进程章节",
    "categoryId": context["defaultCategoryId"],
    "manualPriority": 2,
    "checkpoints": [{"title": "阅读章节"}, {"title": "完成习题"}],
}, **{"Idempotency-Key": creation_key})

task = call("PATCH", "/tasks/" + task["id"], {
    "manualPriority": 1,
    "deadline": "2026-10-09",
}, **{"If-Match": '"' + task["revision"] + '"'})
print(task["id"])
```

已取得 Token 时，也可以直接用 curl：

```bash
curl --fail-with-body --silent --show-error \
  "$WORK_SCHEDULE_URL/api/agent/v1/context" \
  -H "Authorization: Bearer $WORK_SCHEDULE_AGENT_TOKEN"
```

实际运行应捕获 HTTP 错误并按下节处理。不要启用输出 Authorization 请求头或登录请求体的调试日志。

## 9. 错误处理

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数无效",
    "details": { "field": "body.manualPriority", "reason": "必须为 1 至 5 的整数" }
  }
}
```

| HTTP / 错误码 | Agent 的处理方式 |
| --- | --- |
| 400 `VALIDATION_ERROR` | 根据 details.field 修正类型、值或未知字段 |
| 400 `INVALID_JSON` | 修正 JSON 编码 |
| 400 `INVALID_IDEMPOTENCY_KEY` / `INVALID_REVISION` | 修正请求头格式 |
| 400 业务错误，如 `INVALID_CATEGORY_ID` / `ARCHIVE_CATEGORY_FORBIDDEN` | 重新读取分类，修正业务参数 |
| 401 `INVALID_CREDENTIALS` | 检查使用者提供的账号密码，不反复猜测 |
| 401 `AUTH_REQUIRED` | 重新登录一次，再重试业务请求；持续失败时报告问题 |
| 404 `TASK_NOT_FOUND` / `CHECKPOINT_NOT_FOUND` | 重新读取上下文，资源可能已删除 |
| 404 `AGENT_ROUTE_NOT_FOUND` | 接口或操作未开放，按 OpenAPI 修正调用 |
| 409 `IDEMPOTENCY_CONFLICT` | 重试必须复用原始请求；新操作使用新键 |
| 409 `TASK_NOT_EDITABLE` | 不修改已完成任务 |
| 412 `REVISION_CONFLICT` | 重新读取并协调用户改动，不能盲目覆盖 |
| 413 `PAYLOAD_TOO_LARGE` | 缩小请求体，最多 1 MB |
| 428 `PRECONDITION_REQUIRED` | 读取资源后补充 If-Match |
| 429 `LOGIN_RATE_LIMITED` | 按 Retry-After 等待 |
| 5xx / 网络错误 | 有限次数退避重试；创建请求必须保留原键和请求体 |

## 10. OpenAPI

在线地址为 `GET /api/agent/v1/openapi.json`，无需登录，内容不包含实际任务或凭据。仓库也提供 [agent-api.openapi.json](./agent-api.openapi.json)，可导入支持 OpenAPI 3.0 的工具。在线描述的 `servers.url` 为相对路径，离线工具需将其替换为实际应用地址加 `/api/agent/v1`。

开发时修改 `src/agent/schema.js` / `src/agent/openapi.js` 后运行 `npm run agent:openapi` 更新静态文档，再运行 `npm run test:agent` 验证接口与文档同步。
