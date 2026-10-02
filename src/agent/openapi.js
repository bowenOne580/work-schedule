const { schemas: inputSchemas } = require("./schema");

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ "application/json": { schema } });
const wrapped = (schema) => ({ type: "object", required: ["data"], properties: { data: schema } });
const errorResponse = { description: "结构化错误，包含 error.code、message、details。", content: json(ref("ErrorResponse")) };
const responses = (schema) => ({
  200: { description: "成功", content: json(wrapped(schema)) },
  400: errorResponse, 401: errorResponse, 404: errorResponse,
});
const body = (name) => ({ required: true, content: json(ref(name)) });
const id = { name: "id", in: "path", required: true, schema: { type: "string" }, description: "资源 ID，作为不透明字符串处理。" };
const idempotency = {
  name: "Idempotency-Key", in: "header", required: false,
  schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
  description: "推荐每次新建生成 UUID，重试使用相同键与相同请求体。24 小时内且资源仍存在时防重复，按账号、方法和请求路径区分。",
};
const ifMatch = {
  name: "If-Match", in: "header", required: true,
  schema: { type: "string", pattern: '^"[a-f0-9]{64}"$' },
  description: '先读取资源，将 revision 用双引号包裹，如 "abc…"；也可直接使用 GET 响应的 ETag。',
};
const entityHeaders = {
  ETag: { description: "带双引号的资源 revision，可用于 If-Match。", schema: { type: "string" } },
};
function getEntity(name, operationId, summary) {
  const result = responses(ref(name));
  result[200].headers = entityHeaders;
  return { operationId, summary, parameters: [id], responses: result };
}
function createEntity(input, output, operationId, summary, parameters = []) {
  const result = responses(ref(output));
  result[200].description = "幂等重试，返回当前资源。";
  result[201] = { description: "已创建", content: json(wrapped(ref(output))) };
  for (const code of [200, 201]) result[code].headers = {
    ...(output === "Category" ? {} : entityHeaders),
    "Idempotency-Replayed": { schema: { type: "string", enum: ["true", "false"] } },
  };
  result[409] = errorResponse;
  return { operationId, summary, parameters: [...parameters, idempotency], requestBody: body(input), responses: result };
}
function patchEntity(input, output, operationId, summary) {
  const result = responses(ref(output));
  result[200].headers = entityHeaders;
  for (const code of [409, 412, 428]) result[code] = errorResponse;
  return { operationId, summary, parameters: [id, ifMatch], requestBody: body(input), responses: result };
}
const nullableDate = { type: "string", format: "date", nullable: true };
const readSchemas = {
  ErrorResponse: {
    type: "object", required: ["error"], properties: {
      error: { type: "object", required: ["code", "message", "details"], properties: {
        code: { type: "string" }, message: { type: "string" }, details: { type: "object", nullable: true, additionalProperties: true },
      } },
    },
  },
  LoginResult: {
    type: "object", required: ["access_token", "token_type", "expires_in"],
    properties: {
      access_token: { type: "string" }, token_type: { type: "string", enum: ["Bearer"] },
      expires_in: { type: "integer", enum: [3600] },
    },
  },
  Checkpoint: {
    type: "object", required: ["id", "taskId", "title", "order", "revision"],
    properties: {
      id: { type: "string" }, taskId: { type: "string" }, title: { type: "string" }, order: { type: "integer" },
      estimatedMinutes: { type: "integer", nullable: true }, actualMinutes: { type: "number", readOnly: true },
      completed: { type: "boolean", readOnly: true }, skipped: { type: "boolean", readOnly: true },
      revision: { type: "string", pattern: "^[a-f0-9]{64}$", readOnly: true },
    },
  },
  Task: {
    type: "object", required: ["id", "title", "revision", "checkpoints"],
    properties: {
      id: { type: "string" }, title: { type: "string" }, categoryId: { type: "string" },
      tags: { type: "array", items: { type: "string" } }, manualPriority: { type: "integer", minimum: 1, maximum: 5 },
      deadline: nullableDate,
      estimatedMinutes: { type: "integer", nullable: true }, directEstimatedMinutes: { type: "integer", nullable: true },
      status: { type: "string", enum: ["todo", "in_progress", "paused", "done"], readOnly: true },
      progress: { type: "integer", minimum: 0, maximum: 100, readOnly: true },
      checkpointIds: { type: "array", items: { type: "string" }, readOnly: true },
      checkpoints: { type: "array", items: ref("Checkpoint"), readOnly: true },
      actualMinutes: { type: "number", readOnly: true }, directMinutes: { type: "number", readOnly: true },
      accumulatedMs: { type: "number", readOnly: true },
      timerStartedAt: { type: "string", format: "date-time", nullable: true, readOnly: true },
      anomalyFlags: { type: "array", items: { type: "string" }, readOnly: true }, anomalyIgnored: { type: "boolean", readOnly: true },
      createdAt: { type: "string", format: "date-time", readOnly: true }, updatedAt: { type: "string", format: "date-time", readOnly: true },
      finishedAt: { type: "string", format: "date-time", readOnly: true },
      revision: { type: "string", pattern: "^[a-f0-9]{64}$", readOnly: true },
    },
  },
  Category: {
    type: "object", required: ["id", "name"],
    properties: {
      id: { type: "string" }, name: { type: "string" }, description: { type: "string" },
      isAnomalyBucket: { type: "boolean" }, isArchiveBucket: { type: "boolean" },
    },
  },
  Context: {
    type: "object", required: ["serverTime", "timeZone", "defaultCategoryId", "tasks", "categories"],
    properties: {
      serverTime: { type: "string", format: "date-time" }, timeZone: { type: "string" }, defaultCategoryId: { type: "string" },
      tasks: { type: "array", items: ref("Task"), description: "全部未完成任务，含检查点及 revision。" },
      categories: { type: "array", items: ref("Category") },
    },
  },
};

module.exports = {
  openapi: "3.0.3",
  info: {
    title: "Work Schedule Agent API", version: "1.0.0",
    description: "通过现有账号密码换取一小时 Agent Token，查询、创建和修改学习任务。优先级 P1 最高，截止日期精确到天。所有修改仅用于规划，不开放任务计时、完成、删除和系统管理。",
  },
  servers: [{ url: "/api/agent/v1" }],
  security: [{ AgentBearer: [] }],
  paths: {
    "/openapi.json": { get: {
      operationId: "getAgentOpenApi", summary: "公开的 OpenAPI 描述", security: [],
      responses: { 200: { description: "原始 OpenAPI 文档，不包裹 data。", content: json({ type: "object" }) } },
    } },
    "/auth/login": { post: {
      operationId: "loginAgent", summary: "使用现有账号密码登录", security: [], requestBody: body("Login"),
      responses: {
        ...responses(ref("LoginResult")),
        429: { ...errorResponse, headers: { "Retry-After": { schema: { type: "integer" }, description: "等待秒数。" } } },
      },
    } },
    "/context": { get: { operationId: "getPlanningContext", summary: "读取规划上下文", responses: responses(ref("Context")) } },
    "/tasks": {
      get: {
        operationId: "listAgentTasks", summary: "查询任务，包括已完成任务；无分页",
        parameters: Object.entries(inputSchemas.TaskFilters.properties).map(([name, schema]) => ({ name, in: "query", required: false, schema })),
        responses: responses({ type: "array", items: ref("Task") }),
      },
      post: createEntity("TaskCreate", "Task", "createAgentTask", "创建任务，可同时创建最多 100 个检查点"),
    },
    "/tasks/{id}": {
      get: getEntity("Task", "getAgentTask", "读取任务及检查点"),
      patch: patchEntity("TaskPatch", "Task", "updateAgentTask", "修改未完成任务的规划字段"),
    },
    "/tasks/{id}/checkpoints": {
      post: createEntity("CheckpointCreate", "Checkpoint", "createAgentCheckpoint", "为未完成任务添加检查点", [id]),
    },
    "/checkpoints/{id}": {
      get: getEntity("Checkpoint", "getAgentCheckpoint", "读取检查点"),
      patch: patchEntity("CheckpointPatch", "Checkpoint", "updateAgentCheckpoint", "修改检查点标题、顺序及估时"),
    },
    "/categories": {
      get: { operationId: "listAgentCategories", summary: "查询分类", responses: responses({ type: "array", items: ref("Category") }) },
      post: createEntity("CategoryCreate", "Category", "createAgentCategory", "新建分类"),
    },
  },
  components: {
    securitySchemes: { AgentBearer: { type: "http", scheme: "bearer", description: "Agent 登录返回的专用 Token；不接受网页 Cookie。" } },
    schemas: { ...inputSchemas, ...readSchemas },
  },
};
