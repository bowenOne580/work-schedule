const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { JsonStorage } = require("../src/repository/jsonStorage");
const { SchedulerService } = require("../src/services/schedulerService");
const { AgentService } = require("../src/services/agentService");
const { createApp } = require("../src/createApp");
const { hashPassword, createAuthToken } = require("../src/auth");
const { createAgentToken } = require("../src/agent/auth");
const openapi = require("../src/agent/openapi");
const prefix = "/api/agent/v1";

async function withFixture(test) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-schedule-agent-"));
  const previousConfig = process.env.WORK_SCHEDULE_AUTH_CONFIG;
  const config = { username: "demo_user", passwordHash: hashPassword("123456"), secret: "isolated-agent-test-secret" };
  const configPath = path.join(dir, "auth.json");
  await fs.writeFile(configPath, JSON.stringify({ ...config, sessionSecret: config.secret }));
  process.env.WORK_SCHEDULE_AUTH_CONFIG = configPath;
  let now = Date.now();
  const storage = new JsonStorage(path.join(dir, "data"));
  await storage.initialize();
  const scheduler = new SchedulerService(storage, { now: () => now });
  let server;
  let token;
  let base;
  async function start() {
    server = createApp(scheduler, { corsOrigins: ["https://agent.example.com"], agentAuth: { now: () => now } }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  async function request(endpoint, { method = "GET", body, headers = {}, bearer = token } = {}) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json();
    return { status: response.status, data: json.data, error: json.error, json, headers: response.headers };
  }
  async function login() {
    const result = await request(prefix + "/auth/login", {
      method: "POST", body: { username: "demo_user", password: "123456" }, bearer: null,
    });
    assert.equal(result.status, 200);
    token = result.data.access_token;
    return result;
  }
  const fixture = {
    dir, scheduler, config, request, login,
    advance: (milliseconds) => { now += milliseconds; },
    restart: async () => { await stop(); await start(); },
    raw: async (body) => {
      const response = await fetch(base + prefix + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      return { status: response.status, ...(await response.json()) };
    },
  };
  try {
    await start();
    await test(fixture);
  } finally {
    if (server) await stop();
    if (previousConfig === undefined) delete process.env.WORK_SCHEDULE_AUTH_CONFIG;
    else process.env.WORK_SCHEDULE_AUTH_CONFIG = previousConfig;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testAuthAndIsolation() {
  await withFixture(async ({ request, login, config }) => {
    assert.equal((await request(prefix + "/context")).status, 401);
    const result = await login();
    assert.equal(result.data.expires_in, 3600);
    assert.equal(result.data.token_type, "Bearer");
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("set-cookie"), null);
    assert.equal((await request(prefix + "/context")).status, 200);
    const token = result.data.access_token;
    const signatureStart = token.lastIndexOf(".") + 1;
    const tampered = token.slice(0, signatureStart) + (token[signatureStart] === "A" ? "B" : "A") + token.slice(signatureStart + 1);
    for (const invalid of [token + ".extra", token.slice(0, -1) + "!", tampered,
      createAgentToken(config.username, config, -1), createAgentToken("another_user", config)]) {
      assert.equal((await request(prefix + "/context", { bearer: invalid })).status, 401);
    }
    const webToken = createAuthToken(config.username, 3600, config.secret);
    assert.equal((await request(prefix + "/context", { bearer: webToken })).status, 401);
    assert.equal((await request(prefix + "/context", { bearer: "agent-v1." + webToken })).status, 401, "添加前缀不能把网页 Token 转为 Agent Token");
    assert.equal((await request(prefix + "/context", { bearer: null, headers: { Cookie: `work_schedule_auth=${webToken}` } })).status, 401);
    assert.equal((await request("/api/tasks")).status, 401, "Agent Bearer 不能访问网页接口");
    assert.equal((await request("/api/system/export", { bearer: null, headers: { Cookie: `work_schedule_auth=${token}` } })).status, 401);
    assert.equal((await request("/api/tasks", { bearer: null, headers: { Cookie: `work_schedule_auth=${token.slice("agent-v1.".length)}` } })).status, 401, "移除前缀不能把 Agent Token 转为网页 Token");
    assert.equal((await request("/api/tasks", { bearer: null, headers: { Cookie: `work_schedule_auth=${webToken}` } })).status, 200, "原有网页鉴权仍可用");
    assert.equal((await request(prefix + "/tasks/missing/start", { method: "POST" })).status, 404);
    assert.equal((await request(prefix + "/system/update", { method: "POST" })).status, 404);
  });
}

async function testLoginLimits() {
  await withFixture(async ({ request, login, advance }) => {
    for (let count = 0; count < 5; count++) {
      const result = await request(prefix + "/auth/login", { method: "POST", body: { username: "demo_user", password: "wrong" } });
      assert.equal(result.status, 401);
      assert.equal(result.error.code, "INVALID_CREDENTIALS");
    }
    const blocked = await request(prefix + "/auth/login", { method: "POST", body: { username: "demo_user", password: "123456" } });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.error.code, "LOGIN_RATE_LIMITED");
    assert.equal(blocked.headers.get("retry-after"), "900");
    advance(15 * 60_000);
    await login();
  });
}

async function testPlanningAndVersions() {
  await withFixture(async ({ request, login, scheduler }) => {
    await login();
    const category = await request(prefix + "/categories", { method: "POST", body: { name: "操作系统" }, headers: { "Idempotency-Key": "category-1" } });
    assert.equal(category.status, 201);
    const repeatedCategory = await request(prefix + "/categories", { method: "POST", body: { name: "操作系统" }, headers: { "Idempotency-Key": "category-1" } });
    assert.equal(repeatedCategory.data.id, category.data.id);
    assert.equal(repeatedCategory.status, 200);
    const created = await request(prefix + "/tasks", { method: "POST", body: {
      title: "进程章节", categoryId: category.data.id, manualPriority: 1, deadline: "2026-10-09",
      checkpoints: [{ title: "阅读" }, { title: "习题", estimatedMinutes: 20 }],
    } });
    assert.equal(created.status, 201);
    const task = created.data;
    assert.equal(task.manualPriority, 1);
    assert.equal(task.deadline, "2026-10-09");
    assert.equal(task.status, "todo");
    assert.equal(task.timerStartedAt, null);
    assert.equal(task.estimatedMinutes, null);
    assert.equal(task.actualMinutes, 0);
    assert.equal(task.checkpoints.length, 2);
    assert.equal(created.headers.get("etag"), `"${task.revision}"`);
    const context = await request(prefix + "/context");
    assert.equal(context.data.defaultCategoryId, "cat-general");
    assert.ok(context.data.timeZone);
    assert.equal(context.data.tasks[0].revision, task.revision);
    const queried = await request(prefix + `/tasks?status=todo&categoryId=${category.data.id}&manualPriority=1&deadlineFrom=2026-10-01&deadlineTo=2026-10-09`);
    assert.equal(queried.data[0].id, task.id);
    assert.equal((await request(prefix + "/tasks?manualPriority=5")).data.length, 0);
    const url = prefix + "/tasks/" + task.id;
    assert.equal((await request(url, { method: "PATCH", body: { manualPriority: 2 } })).status, 428);
    const updated = await request(url, { method: "PATCH", body: { manualPriority: 2, deadline: null }, headers: { "If-Match": `"${task.revision}"` } });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.title, task.title);
    assert.equal(updated.data.deadline, null);
    assert.notEqual(updated.data.revision, task.revision, "同一毫秒的修改也应有不同 revision");
    const stale = await request(url, { method: "PATCH", body: { manualPriority: 3 }, headers: { "If-Match": `"${task.revision}"` } });
    assert.equal(stale.status, 412);
    assert.equal(stale.error.code, "REVISION_CONFLICT");
    const cp = task.checkpoints[0];
    const cpUpdate = await request(prefix + "/checkpoints/" + cp.id, { method: "PATCH", body: { title: "阅读并总结", order: 3 }, headers: { "If-Match": `"${cp.revision}"` } });
    assert.equal(cpUpdate.status, 200);
    assert.equal((await request(prefix + "/checkpoints/" + cp.id)).data.revision, cpUpdate.data.revision);
    assert.notEqual((await request(url)).data.revision, updated.data.revision, "任务版本包含检查点修改");
    await scheduler.runTaskAction(task.id, "complete");
    const done = (await request(url)).data;
    assert.equal((await request(url, { method: "PATCH", body: { manualPriority: 4 }, headers: { "If-Match": `"${done.revision}"` } })).status, 409);
    assert.equal((await request(prefix + `/tasks/${task.id}/checkpoints`, { method: "POST", body: { title: "归档后添加" } })).status, 409);
    assert.equal((await request(prefix + "/context")).data.tasks.length, 0);
    assert.equal((await request(prefix + "/tasks?status=done")).data.length, 1);
  });
}

async function testRetryAndConcurrency() {
  await withFixture(async ({ request, login, restart, scheduler, advance }) => {
    await login();
    const body = { title: "不重复创建", manualPriority: 2, checkpoints: [{ title: "步骤" }] };
    const headers = { "Idempotency-Key": "task-retry-1" };
    const results = await Promise.all([
      request(prefix + "/tasks", { method: "POST", body, headers }),
      request(prefix + "/tasks", { method: "POST", body, headers }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
    assert.equal(results[0].data.id, results[1].data.id);
    assert.equal((await scheduler.getTasks()).length, 1);
    await restart();
    const replay = await request(prefix + "/tasks", { method: "POST", body: { checkpoints: body.checkpoints, manualPriority: 2, title: body.title }, headers });
    assert.equal(replay.status, 200, "重启和 JSON 键顺序不影响防重复");
    assert.equal(replay.headers.get("idempotency-replayed"), "true");
    assert.equal(JSON.stringify(replay.data).includes("_agentRequest"), false);
    const conflict = await request(prefix + "/tasks", { method: "POST", body: { ...body, title: "不同任务" }, headers });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
    const id = replay.data.id;
    const concurrentHeaders = { "If-Match": `"${replay.data.revision}"` };
    const patches = await Promise.all([
      request(prefix + `/tasks/${id}`, { method: "PATCH", body: { manualPriority: 3 }, headers: concurrentHeaders }),
      request(prefix + `/tasks/${id}`, { method: "PATCH", body: { manualPriority: 4 }, headers: concurrentHeaders }),
    ]);
    assert.deepEqual(patches.map((result) => result.status).sort(), [200, 412]);
    const checkpointBody = { title: "新增检查点" };
    const cpUrl = prefix + `/tasks/${id}/checkpoints`;
    const cpHeaders = { "Idempotency-Key": "cp-retry" };
    const firstCp = await request(cpUrl, { method: "POST", body: checkpointBody, headers: cpHeaders });
    const repeatedCp = await request(cpUrl, { method: "POST", body: checkpointBody, headers: cpHeaders });
    assert.equal(repeatedCp.data.id, firstCp.data.id);
    assert.equal((await request(prefix + `/tasks/${id}`)).data.checkpoints.length, 2);
    const exported = await scheduler.exportAllData();
    await scheduler.importData(exported);
    assert.equal((await request(prefix + "/tasks", { method: "POST", body, headers })).data.id, id);
    advance(24 * 60 * 60_000);
    assert.equal((await request(prefix + "/tasks", { method: "POST", body, headers })).status, 201, "幂等键在 24 小时后失效");
  });
}

async function testValidationAndRollback() {
  await withFixture(async ({ request, login, raw, scheduler }) => {
    await login();
    const invalid = [
      { title: "" }, { title: "   " }, { title: 123 }, { title: "x", manualPriority: 0 },
      { title: "x", manualPriority: "1" }, { title: "x", deadline: "2026-02-30" },
      { title: "x", deadline: "2026-10-09T14:00:00+08:00" }, { title: "x", status: "in_progress" },
      { title: "x", accumulatedMs: 5 }, { title: "x", actualMinutes: 20 },
      { title: "x", checkpoints: [{ title: "valid" }, { title: "" }] },
      { title: "x", checkpoints: [{ title: "y", completed: true }] },
    ];
    for (const body of invalid) {
      const result = await request(prefix + "/tasks", { method: "POST", body });
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.equal(result.error.code, "VALIDATION_ERROR");
    }
    assert.equal((await scheduler.getTasks()).length, 0);
    const invalidCategory = await request(prefix + "/tasks", { method: "POST", body: { title: "x", categoryId: "missing" } });
    assert.equal(invalidCategory.error.code, "INVALID_CATEGORY_ID");
    assert.equal((await request(prefix + "/tasks?unknown=1")).status, 400);
    assert.equal((await request(prefix + "/tasks?status=todo&status=done")).status, 400);
    assert.equal((await request(prefix + "/tasks?deadlineFrom=2026-10-10&deadlineTo=2026-10-09")).status, 400);
    const malformed = await raw('{"password":"do-not-echo"');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.error.code, "INVALID_JSON");
    assert.equal(JSON.stringify(malformed).includes("do-not-echo"), false);
    const agent = new AgentService(scheduler);
    await assert.rejects(() => agent.createTask({ title: "整体回退", checkpoints: [{ title: "第一步" }, { title: "" }] }), (error) => error.code === "INVALID_CHECKPOINT_TITLE");
    assert.equal((await scheduler.getTasks()).length, 0, "后续检查点业务校验失败也不留下半个任务");
    const task = (await request(prefix + "/tasks", { method: "POST", body: { title: "选填估时", estimatedMinutes: null } })).data;
    assert.equal(task.estimatedMinutes, null);
    assert.equal((await request(prefix + `/tasks/${task.id}`, { method: "PATCH", body: { title: "x" }, headers: { "If-Match": "*" } })).status, 400);
    assert.equal((await request(prefix + "/tasks", { method: "POST", body: { title: "键无效" }, headers: { "Idempotency-Key": "invalid key" } })).status, 400);
    assert.equal((await request(prefix + "/tasks/missing")).status, 404);
    assert.equal((await request(prefix + `/tasks/${task.id}`, { method: "DELETE" })).status, 404);
  });
}

async function testSchemaAndCors() {
  await withFixture(async ({ request }) => {
    const response = await request(prefix + "/openapi.json");
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, openapi);
    const staticDocument = JSON.parse(await fs.readFile(path.join(__dirname, "..", "doc", "agent-api.openapi.json"), "utf8"));
    assert.deepEqual(staticDocument, openapi, "静态和在线 OpenAPI 同步");
    function checkRefs(value) {
      if (!value || typeof value !== "object") return;
      if (value.$ref) {
        const target = value.$ref.slice(2).split("/").reduce((item, key) => item?.[key], openapi);
        assert.ok(target, `未解析的 schema ${value.$ref}`);
      }
      Object.values(value).forEach(checkRefs);
    }
    checkRefs(openapi);
    const cors = await request(prefix + "/openapi.json", { headers: { Origin: "https://agent.example.com" } });
    assert.ok(cors.headers.get("access-control-allow-headers").includes("If-Match"));
    assert.ok(cors.headers.get("access-control-expose-headers").includes("ETag"));
    assert.equal(cors.headers.get("access-control-allow-origin"), "https://agent.example.com");
  });
}

async function main() {
  await testAuthAndIsolation();
  await testLoginLimits();
  await testPlanningAndVersions();
  await testRetryAndConcurrency();
  await testValidationAndRollback();
  await testSchemaAndCors();
  console.log("Agent API tests passed (auth, limits, planning, concurrency, retries, validation, OpenAPI)");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
