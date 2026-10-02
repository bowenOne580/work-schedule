const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { JsonStorage } = require("../src/repository/jsonStorage");
const { SchedulerService } = require("../src/services/schedulerService");
const { WeeklyScheduleService } = require("../src/services/weeklyScheduleService");
const { createApp } = require("../src/createApp");
const { hashPassword } = require("../src/auth");
const { createAgentToken } = require("../src/agent/auth");

const course = { title: "test_高等数学", type: "busy", weekdays: [3, 1], startTime: "08:05", endTime: "09:40" };
const free = { title: "test_自习", type: "free", weekdays: [1], startTime: "09:40", endTime: "10:30" };

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "weekly-schedule-test-"));
  const previousConfig = process.env.WORK_SCHEDULE_AUTH_CONFIG;
  let server;
  try {
    const config = { username: "demo_user", passwordHash: hashPassword("123456"), secret: "isolated-schedule-test-secret" };
    const configPath = path.join(temp, "auth.json");
    await fs.writeFile(configPath, JSON.stringify({ ...config, sessionSecret: config.secret }));
    process.env.WORK_SCHEDULE_AUTH_CONFIG = configPath;
    const dataDir = path.join(temp, "data");
    const storage = new JsonStorage(dataDir);
    await storage.initialize();
    const schedule = new WeeklyScheduleService(storage);
    const scheduler = new SchedulerService(storage);
    const task = await scheduler.createTask({ title: "test_独立任务" });
    const before = await scheduler.exportAllData();
    assert.deepEqual(await schedule.list(), []);

    const created = await schedule.create(course);
    assert.deepEqual(created.weekdays, [1, 3]);
    assert.equal(created.startTime, "08:05");
    await schedule.create(free); // 相邻时间不算重叠。
    await schedule.create({ ...course, weekdays: [2] }); // 不同星期允许相同时间。
    const overlap = { ...free, weekdays: [3, 7], startTime: "09:35" };
    await assert.rejects(schedule.create(overlap), error => error.status === 409 && error.details.weekdays[0] === 3);
    await assert.rejects(schedule.update(created.id, { endTime: "09:45" }), error => error.code === "SCHEDULE_OVERLAP");
    const updated = await schedule.update(created.id, { title: "test_数学课", weekdays: [1, 4] });
    assert.equal(updated.startTime, "08:05");
    assert.deepEqual(updated.weekdays, [1, 4]);
    assert.equal((await schedule.list()).length, 3);

    const invalid = [
      null, [], {}, { ...course, title: " " }, { ...course, title: "x".repeat(101) },
      { ...course, type: "unknown" }, { ...course, weekdays: [] }, { ...course, weekdays: [0] },
      { ...course, weekdays: [8] }, { ...course, weekdays: ["1"] }, { ...course, weekdays: [1, 1] },
      { ...course, weekdays: [1.5] }, { ...course, startTime: "08:01" }, { ...course, endTime: "09:41" },
      { ...course, startTime: "8:05" }, { ...course, startTime: "24:00" }, { ...course, endTime: "24:05" },
      { ...course, startTime: "09:40" }, { ...course, startTime: "23:00", endTime: "01:00" },
      { ...course, startTime: 485 }, { ...course, endTime: null }, { ...course, taskId: task.id },
    ];
    for (const payload of invalid) {
      await assert.rejects(async () => schedule.create(payload), error => error.status === 400, JSON.stringify(payload));
    }
    await assert.rejects(async () => schedule.update(created.id, { id: "forged" }), error => error.status === 400);
    await assert.rejects(schedule.update("missing", { title: "x" }), error => error.status === 404);
    await assert.rejects(schedule.delete("missing"), error => error.status === 404);

    const midnight = await schedule.create({ ...free, weekdays: [7], startTime: "23:55", endTime: "24:00" });
    const dawn = await schedule.create({ ...free, weekdays: [7], startTime: "00:00", endTime: "00:05" });
    const simultaneous = await Promise.allSettled([
      schedule.create({ ...course, weekdays: [6] }), schedule.create({ ...free, weekdays: [6], startTime: "08:15" }),
    ]);
    assert.equal(simultaneous.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(simultaneous.find(result => result.status === "rejected").reason.code, "SCHEDULE_OVERLAP");

    const originalFiles = ["tasks.json", "checkpoints.json", "categories.json", "statistics_cache.json"];
    for (const file of originalFiles) {
      const key = ({ "tasks.json": "tasks", "checkpoints.json": "checkpoints", "categories.json": "categories", "statistics_cache.json": "statisticsCache" })[file];
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, file), "utf8")), before.data[key], "日程操作不改变任务数据");
    }
    await scheduler.importData(before);
    assert.equal((await schedule.list()).length, 6, "原有任务导入保留独立课表");
    const reloaded = new JsonStorage(dataDir);
    await reloaded.initialize();
    assert.deepEqual(await new WeeklyScheduleService(reloaded).list(), await schedule.list());
    await schedule.delete(dawn.id);
    // 损坏文件恢复日程备份，保留 24:00 的边界数据。
    await fs.writeFile(path.join(dataDir, "schedule_slots.json"), "invalid json");
    const recovered = new JsonStorage(dataDir);
    await recovered.initialize();
    assert.ok((await new WeeklyScheduleService(recovered).list()).some(item => item.id === midnight.id));
    assert.equal((await new WeeklyScheduleService(recovered).list()).length, 5);

    server = createApp(scheduler).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie;
    async function request(endpoint, method = "GET", body, headers = {}) {
      const response = await fetch(base + endpoint, {
        method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, headers: response.headers, ...(await response.json()) };
    }
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      assert.equal((await request("/api/schedule/slots" + (["PATCH", "DELETE"].includes(method) ? "/missing" : ""), method, method === "POST" ? course : undefined)).status, 401);
    }
    assert.equal((await request("/api/schedule/slots", "GET", undefined, { Authorization: "Bearer " + createAgentToken(config.username, config) })).status, 401);
    const login = await request("/api/auth/login", "POST", { username: "demo_user", password: "123456" });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await request("/api/schedule/slots")).data.length, 5);
    const added = await request("/api/schedule/slots", "POST", { ...free, weekdays: [5] });
    assert.equal(added.status, 200);
    assert.equal((await request(`/api/schedule/slots/${added.data.id}`, "PATCH", { title: "test_API修改" })).data.title, "test_API修改");
    assert.equal((await request("/api/schedule/slots", "POST", { ...free, weekdays: [5] })).status, 409);
    assert.equal((await request("/api/schedule/slots", "POST", { ...free, startTime: "09:42" })).status, 400);
    assert.equal((await request(`/api/schedule/slots/${added.data.id}`, "DELETE")).data.deleted, true);
    assert.equal((await scheduler.getTaskById(task.id)).status, "todo");
    console.log("Weekly schedule tests passed (5-minute boundaries, overlap, concurrency, persistence, recovery, isolation, authenticated API)");
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (previousConfig === undefined) delete process.env.WORK_SCHEDULE_AUTH_CONFIG;
    else process.env.WORK_SCHEDULE_AUTH_CONFIG = previousConfig;
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
