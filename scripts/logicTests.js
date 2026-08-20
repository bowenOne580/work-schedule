#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { JsonStorage } = require("../src/repository/jsonStorage");
const { SchedulerService } = require("../src/services/schedulerService");

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

async function main() {
  await testRecommendationPriorityAndStatus();
  await testCompleteTaskWithCheckpoints();
  await testSkippedCheckpointResolvesTask();
  await testZeroMinuteDoneCountsToday();
  await testImportValidationRejectsOrphans();
  console.log("Logic tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
