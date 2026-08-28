#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { JsonStorage } = require("../src/repository/jsonStorage");
const { SchedulerService } = require("../src/services/schedulerService");
const { buildUpdateZipUrls, resolveUpdateSourceDir, parseStatRangeQuery } = require("../src/createApp");
const { AppError } = require("../src/errors");

async function createService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-schedule-test-"));
  const storage = new JsonStorage(dir, { backupCount: 1 });
  await storage.initialize();
  return new SchedulerService(storage);
}

async function testRecommendationPriorityAndStatus() {
  const service = await createService();
  const high = await service.createTask({ title: "P1 high", manualPriority: 1, estimatedMinutes: 60 });
  const low = await service.createTask({ title: "P5 low", manualPriority: 5, estimatedMinutes: 60 });
  await service.runTaskAction(high.id, "start");
  await service.runTaskAction(high.id, "pause");

  let recs = await service.getRecommendationsByCategory();
  assert.equal(recs[0].task.id, low.id, "paused tasks should not be recommended with a start button");

  await service.runTaskAction(high.id, "resume");
  await service.runTaskAction(high.id, "complete");
  const replacement = await service.createTask({ title: "P1 replacement", manualPriority: 1, estimatedMinutes: 60 });
  recs = await service.getRecommendationsByCategory();
  assert.equal(recs[0].task.id, replacement.id, "P1 should outrank P5 when both are todo");
}

async function testCompleteTaskWithCheckpoints() {
  const service = await createService();
  const task = await service.createTask({ title: "checkpoint task", estimatedMinutes: 30 });
  const checkpoint = await service.createCheckpoint(task.id, { title: "cp", estimatedMinutes: 30 });

  await service.runTaskAction(task.id, "start");
  await service.runTaskAction(task.id, "complete", { actualMinutes: 45 });

  const detail = await service.getTaskById(task.id);
  assert.equal(detail.status, "done");
  assert.equal(detail.actualMinutes, 45);
  assert.equal(detail.checkpoints[0].id, checkpoint.id);
  assert.equal(detail.checkpoints[0].completed, true);
  assert.equal(detail.checkpoints[0].actualMinutes, 45);
}

async function testSkippedCheckpointResolvesTask() {
  const service = await createService();
  const task = await service.createTask({ title: "skip task" });
  const cp1 = await service.createCheckpoint(task.id, { title: "cp1", estimatedMinutes: 10 });
  const cp2 = await service.createCheckpoint(task.id, { title: "cp2", estimatedMinutes: 10 });

  await service.runTaskAction(task.id, "start");
  await service.completeCheckpoint(cp1.id, { actualMinutes: 5 });
  await service.skipCheckpoint(cp2.id);

  const detail = await service.getTaskById(task.id);
  assert.equal(detail.status, "done");
  assert.equal(detail.progress, 100);
}

async function testZeroMinuteDoneCountsToday() {
  const service = await createService();
  const task = await service.createTask({ title: "zero actual", estimatedMinutes: 30 });
  await service.runTaskAction(task.id, "complete", { actualMinutes: 0 });

  const stats = await service.getStatisticsOverview();
  assert.equal(stats.dailyDoneCount, 1);
  assert.equal(stats.weeklyDoneCount, 1);
  assert.equal(stats.dailyMinutes, 0);
}

async function testImportValidationRejectsOrphans() {
  const service = await createService();
  await assert.rejects(
    () =>
      service.importData({
        version: "test",
        exportedAt: new Date().toISOString(),
        data: {
          tasks: [],
          checkpoints: [{ id: "cp-1", taskId: "missing-task", title: "orphan" }],
          categories: [],
          statisticsCache: {},
        },
      }),
    /不存在的任务/,
  );
}

function testUpdateZipUrls() {
  const direct = buildUpdateZipUrls("v1.1.12", false);
  assert.equal(
    direct.assetUrl,
    "https://github.com/bowenOne580/work-schedule/releases/download/v1.1.12/work-schedule-v1.1.12.zip",
  );
  assert.equal(
    direct.sourceUrl,
    "https://api.github.com/repos/bowenOne580/work-schedule/zipball/v1.1.12",
  );

  const mirror = buildUpdateZipUrls("v1.1.12", true);
  assert.equal(
    mirror.assetUrl,
    "https://ghfast.top/https://github.com/bowenOne580/work-schedule/releases/download/v1.1.12/work-schedule-v1.1.12.zip",
  );
  assert.equal(
    mirror.sourceUrl,
    "https://ghfast.top/https://github.com/bowenOne580/work-schedule/archive/refs/tags/v1.1.12.zip",
  );
}

async function testResolveUpdateSourceDir() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ws-sourcedir-"));

  // GitHub zipball：唯一包装目录 → 剥掉
  const wrapped = path.join(base, "wrapped");
  const wrapperName = "bowenOne580-work-schedule-abc123";
  await fs.mkdir(path.join(wrapped, wrapperName, "src"), { recursive: true });
  assert.equal(resolveUpdateSourceDir(wrapped), path.join(wrapped, wrapperName));

  // CI Release 附件：扁平的项目根 → 直接使用解压根
  const flat = path.join(base, "flat");
  await fs.mkdir(path.join(flat, "src"), { recursive: true });
  await fs.mkdir(path.join(flat, "frontend"), { recursive: true });
  await fs.writeFile(path.join(flat, "server.js"), "");
  assert.equal(resolveUpdateSourceDir(flat), flat);

  await fs.rm(base, { recursive: true, force: true });
}

// 范围统计口径（doc/dev/2026-08-28/stats-range-filter-plan.md 第 4 节）：
// 用时/完成/准时率/超时比按完成日入组；完成率按创建日入组。
// 通过直接写 tasks.json 回填历史日期（服务层无法构造过去的 createdAt/finishedAt）。
async function testStatRanges() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-schedule-range-"));
  const storage = new JsonStorage(dir, { backupCount: 1 });
  await storage.initialize();
  const service = new SchedulerService(storage);
  await service.getCategories(); // 触发默认分类持久化

  const daysAgoIso = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  };
  const daysAgoDate = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const mkTask = (id, { priority, createdDaysAgo, finishedDaysAgo = null, actual = 0, estimated = 0, deadline = null }) => {
    const createdAt = daysAgoIso(createdDaysAgo);
    return {
      id,
      title: `t-${id}`,
      categoryId: "cat-general",
      tags: [],
      manualPriority: priority,
      directEstimatedMinutes: estimated,
      estimatedMinutes: estimated,
      deadline,
      status: finishedDaysAgo == null ? "todo" : "done",
      progress: finishedDaysAgo == null ? 0 : 100,
      checkpointIds: [],
      directMinutes: actual,
      actualMinutes: actual,
      anomalyFlags: [],
      anomalyIgnored: false,
      createdAt,
      updatedAt: finishedDaysAgo == null ? createdAt : daysAgoIso(finishedDaysAgo),
      ...(finishedDaysAgo == null ? {} : { finishedAt: daysAgoIso(finishedDaysAgo) }),
    };
  };

  // A: 10 天前创建、2 天前完成、准时（截止=昨天）；B: 3 天前创建、今天完成、超时一倍；
  // C: 2 天前创建的待办；D: 40 天前创建、20 天前完成
  const tasks = [
    mkTask("a", { priority: 1, createdDaysAgo: 10, finishedDaysAgo: 2, actual: 60, estimated: 60, deadline: daysAgoDate(1) }),
    mkTask("b", { priority: 2, createdDaysAgo: 3, finishedDaysAgo: 0, actual: 120, estimated: 60 }),
    mkTask("c", { priority: 3, createdDaysAgo: 2, estimated: 30 }),
    mkTask("d", { priority: 5, createdDaysAgo: 40, finishedDaysAgo: 20, actual: 30, estimated: 30 }),
  ];
  await fs.writeFile(path.join(dir, "tasks.json"), JSON.stringify(tasks));

  const week = await service.getStatisticsOverview({ type: "week", from: null, to: null });
  assert.equal(week.range, "week");
  assert.equal(week.rangeDoneCount, 2, "week: A(2d前) + B(今天)");
  assert.equal(week.rangeMinutes, 180);
  assert.equal(week.dailyMinutes, 120, "今日用时固定为今天（B）");
  assert.equal(week.completionRate, 0.5, "week 完成率：范围内创建 B(3d前) C(2d前)，完成 1 个");
  assert.equal(week.onTimeRate, 1, "week 准时率：仅 A 有截止日期且准时");
  assert.equal(week.avgOverdueRatio, 0.5, "week 超时比：(A 的 0 + B 的 +1) / 2");
  assert.deepEqual(week.doneByPriority, { 1: 1, 2: 1 });
  assert.equal(week.dailyHistory.length, 7);
  assert.equal(week.dailyHistory[6].minutes, 120, "趋势最后一天=今天");
  assert.equal(week.dailyHistory[4].minutes, 60, "趋势 2 天前=A");
  assert.equal(week.dailyHistory[5].minutes, 0, "趋势昨天=无完成");

  const month = await service.getStatisticsOverview({ type: "month", from: null, to: null });
  assert.equal(month.rangeDoneCount, 3, "month: A + B + D(20d前)");
  assert.equal(month.rangeMinutes, 210);
  assert.equal(month.completionRate, 0.6667, "month 完成率：范围内创建 A/B/C，完成 2 个");
  assert.equal(month.dailyHistory.length, 30);
  assert.equal(month.doneByPriority[5], 1);

  const all = await service.getStatisticsOverview({ type: "all", from: null, to: null });
  assert.equal(all.rangeDoneCount, 3);
  assert.equal(all.completionRate, 0.75, "all 完成率退化为全量口径：4 个任务完成 3 个");
  assert.equal(all.onTimeRate, 1);
  assert.equal(all.dailyHistory.length, 21, "全部趋势从最早完成日（20 天前）起");
  assert.equal(all.rangeStart, daysAgoDate(20));
  assert.equal(all.rangeEnd, daysAgoDate(0));

  const custom = await service.getStatisticsOverview({ type: "custom", from: daysAgoDate(2), to: daysAgoDate(0) });
  assert.equal(custom.rangeDoneCount, 2);
  assert.equal(custom.rangeMinutes, 180);
  assert.equal(custom.completionRate, 0, "custom 完成率：范围内创建仅 C（待办）");
  assert.equal(custom.dailyHistory.length, 3);

  // 自定义结束日期为未来 → 自动收敛到今天，与 [2 天前, 今天] 等价
  const futureTo = await service.getStatisticsOverview({ type: "custom", from: daysAgoDate(2), to: daysAgoDate(-5) });
  assert.equal(futureTo.rangeDoneCount, 2);
  assert.equal(futureTo.rangeEnd, daysAgoDate(0), "未来结束日期被 clamp 到今天");

  // 默认（无范围）返回持久化快照：不含范围字段，仪表盘口径不受影响
  const legacy = await service.getStatisticsOverview();
  assert.equal(legacy.range, undefined);
  assert.equal(typeof legacy.weeklyMinutes, "number");

  await fs.rm(dir, { recursive: true, force: true });
}

function testParseStatRangeQuery() {
  assert.equal(parseStatRangeQuery({}), null);
  assert.equal(parseStatRangeQuery({ range: "" }), null);
  assert.deepEqual(parseStatRangeQuery({ range: "week" }), { type: "week", from: null, to: null });
  assert.deepEqual(
    parseStatRangeQuery({ range: "custom", from: "2026-08-01", to: "2026-08-28" }),
    { type: "custom", from: "2026-08-01", to: "2026-08-28" },
  );
  assert.throws(() => parseStatRangeQuery({ range: "year" }), (err) => err instanceof AppError && err.code === "INVALID_STAT_RANGE");
  assert.throws(() => parseStatRangeQuery({ range: "custom" }), (err) => err instanceof AppError && err.code === "INVALID_STAT_RANGE");
  assert.throws(
    () => parseStatRangeQuery({ range: "custom", from: "2026-08-10", to: "2026-08-01" }),
    (err) => err instanceof AppError && err.code === "INVALID_STAT_RANGE",
  );
}

async function main() {
  await testRecommendationPriorityAndStatus();
  await testCompleteTaskWithCheckpoints();
  await testSkippedCheckpointResolvesTask();
  await testZeroMinuteDoneCountsToday();
  await testImportValidationRejectsOrphans();
  await testResolveUpdateSourceDir();
  await testStatRanges();
  testUpdateZipUrls();
  testParseStatRangeQuery();
  console.log("Logic tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
