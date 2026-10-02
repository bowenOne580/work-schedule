const { SchedulerService } = require("./schedulerService");
const { AppError } = require("../errors");
const { CATEGORY } = require("../constants");
const { publicEntity, checkpointView, taskView } = require("../agent/identity");

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

class AgentService {
  constructor(scheduler) {
    this.storage = scheduler.storage;
    this.now = scheduler.now;
  }

  // 在同一个存储事务内复用现有业务方法；任何一步失败都会丢弃整个 draft。
  #run(work) {
    return this.storage.runExclusive(async (state, tx) => {
      const scheduler = new SchedulerService({
        runExclusive: async (nestedWork) => nestedWork(state, tx),
      }, { now: this.now });
      await scheduler.getTasks();
      return work(scheduler, state, tx);
    });
  }

  #taskView(state, task) {
    return taskView({ ...task, checkpoints: state.checkpoints.filter((cp) => cp.taskId === task.id) });
  }

  getContext() {
    return this.#run((_scheduler, state) => ({
      serverTime: new Date(this.now()).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      defaultCategoryId: CATEGORY.GENERAL_ID,
      categories: state.categories.map(publicEntity),
      tasks: state.tasks.filter((task) => task.status !== "done").map((task) => this.#taskView(state, task)),
    }));
  }

  getTasks(filters = {}) {
    return this.#run((_scheduler, state) => {
      const tasks = state.tasks.filter((task) =>
        (!filters.status || task.status === filters.status) &&
        (!filters.categoryId || task.categoryId === filters.categoryId) &&
        (!filters.manualPriority || task.manualPriority === Number(filters.manualPriority)) &&
        (!filters.deadlineFrom || (task.deadline && task.deadline >= filters.deadlineFrom)) &&
        (!filters.deadlineTo || (task.deadline && task.deadline <= filters.deadlineTo)));
      tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return tasks.map((task) => this.#taskView(state, task));
    });
  }

  getTask(id) {
    return this.#run(async (scheduler) => taskView(await scheduler.getTaskById(id)));
  }

  getCheckpoint(id) {
    return this.#run((_scheduler, state) => checkpointView(this.#checkpoint(state, id)));
  }

  getCategories() {
    return this.#run((_scheduler, state) => state.categories.map(publicEntity));
  }

  #checkpoint(state, id) {
    const checkpoint = state.checkpoints.find((item) => item.id === id);
    if (!checkpoint) throw new AppError(404, "CHECKPOINT_NOT_FOUND", "检查点不存在");
    return checkpoint;
  }

  #editable(task) {
    if (!task || task.status === "done") throw new AppError(409, "TASK_NOT_EDITABLE", "已完成任务不能通过 agent 修改");
  }

  #checkRevision(actual, expected) {
    if (actual !== expected) throw new AppError(412, "REVISION_CONFLICT", "资源已变化，请重新读取后再修改");
  }

  #create(collection, identity, create, view) {
    return this.#run(async (scheduler, state, tx) => {
      if (identity) {
        const previous = state[collection].find((item) =>
          item._agentRequest?.keyDigest === identity.keyDigest && item._agentRequest.expiresAt > this.now());
        if (previous) {
          if (previous._agentRequest.bodyDigest !== identity.bodyDigest) {
            throw new AppError(409, "IDEMPOTENCY_CONFLICT", "同一个 Idempotency-Key 已用于不同请求内容");
          }
          return { item: await view(scheduler, previous), replayed: true };
        }
      }
      const created = await create(scheduler, state);
      if (identity) {
        const stored = state[collection].find((item) => item.id === created.id);
        stored._agentRequest = { ...identity, expiresAt: this.now() + IDEMPOTENCY_TTL_MS };
        tx.commit();
      }
      return { item: await view(scheduler, created), replayed: false };
    });
  }

  createTask(payload, identity) {
    return this.#create("tasks", identity, async (scheduler) => {
      const { checkpoints = [], ...fields } = payload;
      const task = await scheduler.createTask(fields);
      for (const checkpoint of checkpoints) await scheduler.createCheckpoint(task.id, checkpoint);
      return task;
    }, async (scheduler, task) => taskView(await scheduler.getTaskById(task.id)));
  }

  createCheckpoint(taskId, payload, identity) {
    return this.#create("checkpoints", identity, async (scheduler) => {
      this.#editable(await scheduler.getTaskById(taskId));
      return scheduler.createCheckpoint(taskId, payload);
    }, (_scheduler, checkpoint) => checkpointView(checkpoint));
  }

  createCategory(payload, identity) {
    return this.#create("categories", identity,
      (scheduler) => scheduler.createCategory(payload),
      (_scheduler, category) => publicEntity(category));
  }

  updateTask(id, payload, revision) {
    return this.#run(async (scheduler) => {
      const task = await scheduler.getTaskById(id);
      this.#editable(task);
      this.#checkRevision(taskView(task).revision, revision);
      await scheduler.updateTask(id, payload);
      return taskView(await scheduler.getTaskById(id));
    });
  }

  updateCheckpoint(id, payload, revision) {
    return this.#run(async (scheduler, state) => {
      const checkpoint = this.#checkpoint(state, id);
      this.#editable(await scheduler.getTaskById(checkpoint.taskId));
      this.#checkRevision(checkpointView(checkpoint).revision, revision);
      return checkpointView(await scheduler.updateCheckpoint(id, payload));
    });
  }
}

module.exports = { AgentService };
