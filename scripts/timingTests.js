const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { JsonStorage } = require("../src/repository/jsonStorage");
const { SchedulerService } = require("../src/services/schedulerService");
const { createApp } = require("../src/createApp");
const { hashPassword } = require("../src/auth");

async function withFixture(test) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-schedule-timer-"));
  let now = Date.now();
  const storage = new JsonStorage(dir);
  await storage.initialize();
  const options = { now: () => now };
  const service = new SchedulerService(storage, options);
  try {
    await test({
      dir, storage, service, options,
      advance: (milliseconds) => { now += milliseconds; },
      now: () => now,
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testMultipleRoundsAndReload() {
  await withFixture(async ({ dir, service, options, advance, now }) => {
    const task = await service.createTask({ title: "多轮学习" });
    assert.equal(task.estimatedMinutes, null);
    assert.equal(task.actualMinutes, 0);
    assert.equal(task.timerStartedAt, null);
    await service.runTaskAction(task.id, "start");
    advance(20_123);
    let result = await service.runTaskAction(task.id, "pause");
    assert.equal(result.accumulatedMs, 20_123);
    assert.equal(result.actualMinutes, 20_123 / 60_000);
    assert.equal(result.timerStartedAt, null);
    advance(10 * 60_000);
    await service.runTaskAction(task.id, "resume");
    const startedAt = new Date(now()).toISOString();
    advance(15_234);

    // 新建存储和服务，模拟重启；读取和修改标题都不应重置计时起点。
    const reloadedStorage = new JsonStorage(dir);
    await reloadedStorage.initialize();
    const reloaded = new SchedulerService(reloadedStorage, options);
    result = await reloaded.getTaskById(task.id);
    assert.equal(result.timerStartedAt, startedAt);
    assert.equal(result.accumulatedMs, 20_123);
    await reloaded.updateTask(task.id, { title: "重载后继续学习" });
    assert.equal((await reloaded.getTaskById(task.id)).timerStartedAt, startedAt);
    advance(30_345);
    result = await reloaded.runTaskAction(task.id, "complete");
    assert.equal(result.accumulatedMs, 65_702, "短轮次保留毫秒，暂停的十分钟不计入");
    assert.equal(result.actualMinutes, 65_702 / 60_000);
    assert.equal(result.timerStartedAt, null);
    assert.equal(result.status, "done");
    assert.equal((await reloaded.getStatisticsOverview()).dailyMinutes, result.actualMinutes);
    assert.equal((await reloaded.getStatisticsOverview({ type: "all" })).rangeMinutes, result.actualMinutes);
    advance(60_000);
    assert.equal((await reloaded.getTaskById(task.id)).accumulatedMs, 65_702);
  });
}

async function testPausedCompleteAndPostpone() {
  await withFixture(async ({ service, advance }) => {
    const task = await service.createTask({ title: "暂停后完成" });
    await service.runTaskAction(task.id, "start");
    advance(10_000);
    await service.runTaskAction(task.id, "pause");
    advance(120_000);
    assert.equal((await service.runTaskAction(task.id, "complete")).accumulatedMs, 10_000);

    const postponed = await service.createTask({ title: "推迟后重开" });
    await service.runTaskAction(postponed.id, "start");
    advance(15_000);
    let result = await service.runTaskAction(postponed.id, "postpone");
    assert.equal(result.accumulatedMs, 15_000);
    assert.equal(result.timerStartedAt, null);
    advance(60_000);
    await service.runTaskAction(postponed.id, "start");
    advance(25_000);
    result = await service.runTaskAction(postponed.id, "complete");
    assert.equal(result.accumulatedMs, 40_000);

    const unstarted = await service.createTask({ title: "未开始完成" });
    assert.equal((await service.runTaskAction(unstarted.id, "complete")).accumulatedMs, 0);
  });
}

async function testCheckpointCompletionAndEstimates() {
  await withFixture(async ({ service, advance }) => {
    const task = await service.createTask({ title: "检查点自动完成" });
    const first = await service.createCheckpoint(task.id, { title: "未估时" });
    const last = await service.createCheckpoint(task.id, { title: "有估时", estimatedMinutes: 30 });
    assert.equal((await service.getTaskById(task.id)).estimatedMinutes, null);
    await service.runTaskAction(task.id, "start");
    advance(20_000);
    await service.completeCheckpoint(first.id);
    let detail = await service.getTaskById(task.id);
    assert.equal(detail.progress, 50, "估时不完整时按检查点数量计算进度");
    assert.equal(detail.status, "in_progress");
    advance(25_000);
    await service.skipCheckpoint(last.id);
    detail = await service.getTaskById(task.id);
    assert.equal(detail.status, "done");
    assert.equal(detail.accumulatedMs, 45_000);
    assert.equal(detail.timerStartedAt, null);
    await service.deleteCheckpoint(first.id);
    assert.equal((await service.getTaskById(task.id)).accumulatedMs, 45_000);

    const allDone = await service.createTask({ title: "逐个完成" });
    const cp = await service.createCheckpoint(allDone.id, { title: "最后一个" });
    await service.runTaskAction(allDone.id, "start");
    advance(30_000);
    await service.completeCheckpoint(cp.id);
    assert.equal((await service.getTaskById(allDone.id)).accumulatedMs, 30_000);

    const estimated = await service.createTask({ title: "可清除估时", estimatedMinutes: 20 });
    assert.equal((await service.updateTask(estimated.id, { estimatedMinutes: null })).estimatedMinutes, null);
  });
}

async function testConcurrentTransitions() {
  await withFixture(async ({ service, advance }) => {
    const task = await service.createTask({ title: "重复操作" });
    const starts = await Promise.allSettled([
      service.runTaskAction(task.id, "start"), service.runTaskAction(task.id, "start"),
    ]);
    assert.equal(starts.filter((r) => r.status === "fulfilled").length, 1);
    advance(35_000);
    const stops = await Promise.allSettled([
      service.runTaskAction(task.id, "pause"), service.runTaskAction(task.id, "pause"),
    ]);
    assert.equal(stops.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await service.getTaskById(task.id)).accumulatedMs, 35_000);
    await service.runTaskAction(task.id, "resume");
    advance(10_000);
    const finish = await Promise.allSettled([
      service.runTaskAction(task.id, "complete"), service.runTaskAction(task.id, "complete"),
    ]);
    assert.equal(finish.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await service.getTaskById(task.id)).accumulatedMs, 45_000);
  });
}

async function testLegacyDataAndImport() {
  await withFixture(async ({ dir, service, storage, options, advance, now }) => {
    await service.getCategories();
    const base = {
      title: "历史任务", categoryId: "cat-general", manualPriority: 3,
      actualMinutes: 12, directMinutes: 3, estimatedMinutes: null,
      createdAt: new Date(now() - 86_400_000).toISOString(),
      updatedAt: new Date(now() - 86_400_000).toISOString(),
    };
    await fs.writeFile(path.join(dir, "tasks.json"), JSON.stringify([
      { ...base, id: "legacy-active", status: "in_progress" },
      { ...base, id: "legacy-done", status: "done" },
    ]));
    await fs.writeFile(path.join(dir, "checkpoints.json"), JSON.stringify([
      { id: "legacy-cp", taskId: "legacy-active", title: "旧检查点", order: 1,
        estimatedMinutes: null, actualMinutes: 12, completed: false, skipped: false },
    ]));
    let active = await service.getTaskById("legacy-active");
    assert.equal(active.actualMinutes, 12);
    assert.equal(active.timerStartedAt, new Date(now()).toISOString());
    assert.equal((await service.getTaskById("legacy-done")).timerStartedAt, null);
    await service.deleteCheckpoint("legacy-cp");
    assert.equal((await service.getTaskById("legacy-active")).actualMinutes, 12);
    advance(30_000);
    const exported = await service.exportAllData();
    await service.importData(exported);
    active = await service.runTaskAction("legacy-active", "pause");
    assert.equal(active.actualMinutes, 12.5);
    // 再次迁移/重载不会将 directMinutes 和检查点时间重复加到累计用时。
    const reloaded = new SchedulerService(storage, options);
    assert.equal((await reloaded.getTaskById("legacy-active")).actualMinutes, 12.5);
    const invalid = JSON.parse(JSON.stringify(exported));
    invalid.data.tasks[0].accumulatedMs = -1;
    await assert.rejects(() => service.importData(invalid), (err) => err.code === "INVALID_IMPORT_DATA");
  });
}

async function testAuthenticatedApi() {
  await withFixture(async ({ dir, service, advance }) => {
    const configPath = path.join(dir, "auth.json");
    await fs.writeFile(configPath, JSON.stringify({
      username: "demo_user", passwordHash: hashPassword("123456"),
      sessionSecret: "isolated-timing-test-secret",
    }));
    const previousConfig = process.env.WORK_SCHEDULE_AUTH_CONFIG;
    process.env.WORK_SCHEDULE_AUTH_CONFIG = configPath;
    const server = createApp(service).listen(0, "127.0.0.1");
    try {
      await new Promise((resolve) => server.once("listening", resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      const login = await fetch(`${base}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "demo_user", password: "123456" }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      async function request(url, method = "GET", body) {
        const response = await fetch(base + url, {
          method, headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, ...(await response.json()) };
      }
      const created = await request("/api/tasks", "POST", { title: "test_automatic_time" });
      const id = created.data.id;
      assert.equal(created.data.estimatedMinutes, null);
      await request(`/api/tasks/${id}/start`, "POST");
      advance(61_000);
      const done = await request(`/api/tasks/${id}/complete`, "POST");
      assert.equal(done.data.accumulatedMs, 61_000);
      assert.equal(done.data.timerStartedAt, null);
      assert.equal((await request(`/api/tasks/${id}/complete`, "POST")).status, 409);
      const manual = await request(`/api/tasks/${id}`, "PATCH", { actualMinutes: 500 });
      assert.equal(manual.status, 400);
      assert.equal(manual.error.code, "ACTUAL_TIME_READ_ONLY");
      const protectedTimer = await request(`/api/tasks/${id}`, "PATCH", { accumulatedMs: 500 });
      assert.equal(protectedTimer.status, 400);
      assert.equal((await request("/api/tasks", "POST", { title: "manual", actualMinutes: 1 })).status, 400);
      const parent = await request("/api/tasks", "POST", { title: "checkpoints" });
      const cp = await request(`/api/tasks/${parent.data.id}/checkpoints`, "POST", { title: "optional" });
      assert.equal(cp.data.estimatedMinutes, null);
      assert.equal((await request(`/api/checkpoints/${cp.data.id}/complete`, "POST", { actualMinutes: 5 })).status, 400);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (previousConfig === undefined) delete process.env.WORK_SCHEDULE_AUTH_CONFIG;
      else process.env.WORK_SCHEDULE_AUTH_CONFIG = previousConfig;
    }
  });
}

async function main() {
  await testMultipleRoundsAndReload();
  await testPausedCompleteAndPostpone();
  await testCheckpointCompletionAndEstimates();
  await testConcurrentTransitions();
  await testLegacyDataAndImport();
  await testAuthenticatedApi();
  console.log("Automatic timing tests passed (6 scenarios, including authenticated API)");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
