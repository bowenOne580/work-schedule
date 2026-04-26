const { randomUUID } = require("node:crypto");
const { AppError } = require("../errors");
const { ACTION, ANOMALY_FLAGS, CATEGORY, TASK_STATUS } = require("../constants");

function nowIso() {
  return new Date().toISOString();
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) {
    return Math.max(0, Math.round(n));
  }
  return fallback;
}

function clampProgress(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function dateDistanceDays(iso) {
  if (!iso) {
    return null;
  }
  const t = toDeadlineTimestamp(iso);
  if (Number.isNaN(t)) {
    return null;
  }
  const diff = t - Date.now();
  return diff / (24 * 60 * 60 * 1000);
}

function toDeadlineTimestamp(deadline) {
  if (!deadline) {
    return Number.NaN;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return new Date(`${deadline}T23:59:59.999`).getTime();
  }
  return new Date(deadline).getTime();
}

function isIncompleteStatus(status) {
  return [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS, TASK_STATUS.PAUSED].includes(status);
}

function isPositiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}

class SchedulerService {
  constructor(storage) {
    this.storage = storage;
  }

  async getTasks() {
    return this.storage.runExclusive((state, tx) => {
      const changed = this.#prepareState(state);
      if (changed) {
        tx.commit();
      }
      return [...state.tasks].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    });
  }

  async getTaskById(taskId) {
    return this.storage.runExclusive((state, tx) => {
      const changed = this.#prepareState(state);
      if (changed) {
        tx.commit();
      }
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new AppError(404, "TASK_NOT_FOUND", "Task does not exist");
      }
      const checkpoints = state.checkpoints
        .filter((cp) => cp.taskId === taskId)
        .sort((a, b) => a.order - b.order);
      return { ...task, checkpoints };
    });
  }

  async createTask(payload) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);
      const title = (payload.title || "").trim();
      if (!title) {
        throw new AppError(400, "INVALID_TASK_TITLE", "Task title is required");
      }

      const categoryId = this.#resolveCategoryId(state, payload.categoryId);
      const createdAt = nowIso();
      const estimatedMinutes = payload.estimatedMinutes == null ? null : toInt(payload.estimatedMinutes, 0);
      const task = {
        id: randomUUID(),
        title,
        categoryId,
        tags: Array.isArray(payload.tags) ? payload.tags.filter((t) => typeof t === "string") : [],
        manualPriority: this.#normalizePriority(payload.manualPriority),
        directEstimatedMinutes: estimatedMinutes,
        estimatedMinutes,
        deadline: this.#normalizeDeadline(payload.deadline),
        status: TASK_STATUS.TODO,
        progress: clampProgress(payload.progress ?? 0),
        checkpointIds: [],
        directMinutes: toInt(payload.actualMinutes, 0),
        actualMinutes: toInt(payload.actualMinutes, 0),
        anomalyFlags: [],
        anomalyIgnored: false,
        createdAt,
        updatedAt: createdAt,
      };

      state.tasks.push(task);
      this.#prepareState(state);
      tx.commit();
      return task;
    });
  }

  async updateTask(taskId, payload) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new AppError(404, "TASK_NOT_FOUND", "Task does not exist");
      }

      if (payload.status) {
        throw new AppError(400, "STATUS_UPDATE_FORBIDDEN", "Use action endpoints to update status");
      }

      if (payload.title !== undefined) {
        const title = String(payload.title || "").trim();
        if (!title) {
          throw new AppError(400, "INVALID_TASK_TITLE", "Task title cannot be empty");
        }
        task.title = title;
      }

      if (payload.tags !== undefined) {
        task.tags = Array.isArray(payload.tags) ? payload.tags.filter((t) => typeof t === "string") : [];
      }

      if (payload.categoryId !== undefined) {
        task.categoryId = this.#resolveCategoryId(state, payload.categoryId);
      }

      if (payload.manualPriority !== undefined) {
        task.manualPriority = this.#normalizePriority(payload.manualPriority);
      }

      if (payload.estimatedMinutes !== undefined) {
        const estimatedMinutes = payload.estimatedMinutes == null ? null : toInt(payload.estimatedMinutes, 0);
        task.directEstimatedMinutes = estimatedMinutes;
        if (!task.checkpointIds.length) {
          task.estimatedMinutes = estimatedMinutes;
        }
      }

      if (payload.deadline !== undefined) {
        task.deadline = this.#normalizeDeadline(payload.deadline);
      }

      if (payload.progress !== undefined && !task.checkpointIds.length) {
        task.progress = clampProgress(payload.progress);
      }

      if (payload.actualMinutes !== undefined) {
        task.directMinutes = toInt(payload.actualMinutes, 0);
      }

      task.updatedAt = nowIso();
      this.#prepareState(state);
      tx.commit();
      return task;
    });
  }

  async runTaskAction(taskId, action) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new AppError(404, "TASK_NOT_FOUND", "Task does not exist");
      }

      const transitionMap = {
        [ACTION.START]: {
          from: [TASK_STATUS.TODO],
          to: TASK_STATUS.IN_PROGRESS,
        },
        [ACTION.PAUSE]: {
          from: [TASK_STATUS.IN_PROGRESS],
          to: TASK_STATUS.PAUSED,
        },
        [ACTION.RESUME]: {
          from: [TASK_STATUS.PAUSED],
          to: TASK_STATUS.IN_PROGRESS,
        },
        [ACTION.COMPLETE]: {
          from: [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS, TASK_STATUS.PAUSED],
          to: TASK_STATUS.DONE,
        },
      };

      if (action === ACTION.POSTPONE) {
        if (![TASK_STATUS.IN_PROGRESS, TASK_STATUS.PAUSED].includes(task.status)) {
          throw new AppError(409, "INVALID_STATE_TRANSITION", "Task cannot be postponed from current status");
        }
        this.#appendAnomalyFlag(task, ANOMALY_FLAGS.POSTPONED);
        task.categoryId = CATEGORY.ANOMALY_ID;
        task.updatedAt = nowIso();
        this.#prepareState(state);
        tx.commit();
        return task;
      }

      const rule = transitionMap[action];
      if (!rule) {
        throw new AppError(400, "UNKNOWN_ACTION", "Action is not supported");
      }

      if (!rule.from.includes(task.status)) {
        throw new AppError(409, "INVALID_STATE_TRANSITION", "Action is not allowed for current task status");
      }

      task.status = rule.to;
      if (action === ACTION.COMPLETE) {
        task.progress = 100;
        task.categoryId = CATEGORY.ARCHIVED_ID;
      }
      task.updatedAt = nowIso();

      this.#prepareState(state);
      tx.commit();
      return task;
    });
  }

  async deleteTask(taskId) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);
      const idx = state.tasks.findIndex((item) => item.id === taskId);
      if (idx < 0) {
        throw new AppError(404, "TASK_NOT_FOUND", "Task does not exist");
      }

      state.tasks.splice(idx, 1);
      state.checkpoints = state.checkpoints.filter((cp) => cp.taskId !== taskId);

      this.#prepareState(state);
      tx.commit();
      return { id: taskId, deleted: true };
    });
  }

  async createCheckpoint(taskId, payload) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new AppError(404, "TASK_NOT_FOUND", "Task does not exist");
      }

      const title = (payload.title || "").trim();
      if (!title) {
        throw new AppError(400, "INVALID_CHECKPOINT_TITLE", "Checkpoint title is required");
      }

      const taskCheckpoints = state.checkpoints.filter((cp) => cp.taskId === taskId);
      const maxOrder = taskCheckpoints.reduce((max, cp) => Math.max(max, cp.order), 0);
      const checkpoint = {
        id: randomUUID(),
        taskId,
        title,
        order: payload.order == null ? maxOrder + 1 : toInt(payload.order, maxOrder + 1),
        estimatedMinutes: payload.estimatedMinutes == null ? null : toInt(payload.estimatedMinutes, 0),
        actualMinutes: toInt(payload.actualMinutes, 0),
        completed: Boolean(payload.completed),
        skipped: Boolean(payload.skipped),
      };

      if (checkpoint.skipped) {
        this.#appendAnomalyFlag(task, ANOMALY_FLAGS.CHECKPOINT_SKIPPED);
      }
      if (checkpoint.completed) {
        checkpoint.skipped = false;
      }

      task.updatedAt = nowIso();
      state.checkpoints.push(checkpoint);

      this.#prepareState(state);
      tx.commit();
      return checkpoint;
    });
  }

  async updateCheckpoint(checkpointId, payload) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);
      const checkpoint = state.checkpoints.find((item) => item.id === checkpointId);
      if (!checkpoint) {
        throw new AppError(404, "CHECKPOINT_NOT_FOUND", "Checkpoint does not exist");
      }

      const task = state.tasks.find((item) => item.id === checkpoint.taskId);
      if (!task) {
        throw new AppError(404, "TASK_NOT_FOUND", "Parent task does not exist");
      }

      if (payload.title !== undefined) {
        const title = String(payload.title || "").trim();
        if (!title) {
          throw new AppError(400, "INVALID_CHECKPOINT_TITLE", "Checkpoint title cannot be empty");
        }
        checkpoint.title = title;
      }

      if (payload.order !== undefined) {
        checkpoint.order = toInt(payload.order, checkpoint.order);
      }

      if (payload.estimatedMinutes !== undefined) {
        checkpoint.estimatedMinutes = payload.estimatedMinutes == null ? null : toInt(payload.estimatedMinutes, 0);
      }

      if (payload.actualMinutes !== undefined) {
        checkpoint.actualMinutes = toInt(payload.actualMinutes, 0);
      }

      if (payload.completed !== undefined) {
        checkpoint.completed = Boolean(payload.completed);
        if (checkpoint.completed) {
          checkpoint.skipped = false;
        }
      }

      if (payload.skipped !== undefined) {
        checkpoint.skipped = Boolean(payload.skipped);
        if (checkpoint.skipped) {
          checkpoint.completed = false;
          this.#appendAnomalyFlag(task, ANOMALY_FLAGS.CHECKPOINT_SKIPPED);
        }
      }

      task.updatedAt = nowIso();
      this.#prepareState(state);
      tx.commit();
      return checkpoint;
    });
  }

  async completeCheckpoint(checkpointId, payload = {}) {
    const update = { completed: true, skipped: false };
    if (payload.actualMinutes !== undefined) {
      update.actualMinutes = payload.actualMinutes;
    }
    return this.updateCheckpoint(checkpointId, update);
  }

  async skipCheckpoint(checkpointId) {
    return this.updateCheckpoint(checkpointId, { skipped: true, completed: false });
  }

  async uncompleteCheckpoint(checkpointId) {
    return this.updateCheckpoint(checkpointId, { completed: false, skipped: false });
  }

  async deleteCheckpoint(checkpointId) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);
      const idx = state.checkpoints.findIndex((item) => item.id === checkpointId);
      if (idx < 0) {
        throw new AppError(404, "CHECKPOINT_NOT_FOUND", "Checkpoint does not exist");
      }

      const [checkpoint] = state.checkpoints.splice(idx, 1);
      const task = state.tasks.find((item) => item.id === checkpoint.taskId);
      if (task) {
        task.updatedAt = nowIso();
      }

      this.#prepareState(state);
      tx.commit();
      return { id: checkpointId, deleted: true };
    });
  }

  async getRecommendationsByCategory() {
    return this.storage.runExclusive((state, tx) => {
      const changed = this.#prepareState(state);
      if (changed) {
        tx.commit();
      }

      const taskByCategory = new Map();
      for (const task of state.tasks) {
        if (!isIncompleteStatus(task.status)) {
          continue;
        }
        if (this.#isPlanningExcludedCategory(task.categoryId)) {
          continue;
        }
        if (!taskByCategory.has(task.categoryId)) {
          taskByCategory.set(task.categoryId, []);
        }
        taskByCategory.get(task.categoryId).push(task);
      }

      const recommendations = [];
      for (const category of state.categories) {
        const tasks = taskByCategory.get(category.id) || [];
        if (!tasks.length) {
          continue;
        }

        const estimates = tasks
          .map((task) => this.#remainingEstimatedMinutes(task, state.checkpoints))
          .filter(isPositiveFinite);
        const medianEffort = median(estimates) || 60;

        const scored = tasks.map((task) => {
          const remainingEstimated = this.#remainingEstimatedMinutes(task, state.checkpoints);
          const estimated = isNonNegativeFinite(remainingEstimated) ? remainingEstimated : medianEffort;
          const manualScore = this.#normalizePriority(task.manualPriority) / 5;

          const distance = dateDistanceDays(task.deadline);
          let deadlineScore = 0;
          if (distance != null) {
            deadlineScore = distance <= 0 ? 1 : 1 / (1 + distance);
          }

          const effortBaseline = Math.max(medianEffort, 30);
          const effortScore = 1 / (1 + estimated / effortBaseline);
          const score = 0.5 * manualScore + 0.3 * deadlineScore + 0.2 * effortScore;
          return {
            task,
            score,
            scoreDetails: {
              manualScore: Number(manualScore.toFixed(4)),
              deadlineScore: Number(deadlineScore.toFixed(4)),
              effortScore: Number(effortScore.toFixed(4)),
              remainingEstimatedMinutes: Math.round(estimated),
            },
          };
        });

        scored.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }

          const da = a.task.deadline ? toDeadlineTimestamp(a.task.deadline) : Number.POSITIVE_INFINITY;
          const db = b.task.deadline ? toDeadlineTimestamp(b.task.deadline) : Number.POSITIVE_INFINITY;
          if (da !== db) {
            return da - db;
          }

          if (b.task.manualPriority !== a.task.manualPriority) {
            return b.task.manualPriority - a.task.manualPriority;
          }

          return new Date(a.task.createdAt) - new Date(b.task.createdAt);
        });

        recommendations.push({
          category,
          task: scored[0].task,
          score: Number(scored[0].score.toFixed(4)),
          scoreDetails: scored[0].scoreDetails,
        });
      }

      return recommendations;
    });
  }

  async getStatisticsOverview() {
    return this.storage.runExclusive((state, tx) => {
      const changed = this.#prepareState(state);
      if (changed) {
        tx.commit();
      }
      return state.statisticsCache;
    });
  }

  async getAnomalyTasks() {
    return this.storage.runExclusive((state, tx) => {
      const changed = this.#prepareState(state);
      if (changed) {
        tx.commit();
      }

      return state.tasks.filter((task) => this.#isTaskAnomalous(task));
    });
  }

  async setTaskAnomalyIgnored(taskId, ignored) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new AppError(404, "TASK_NOT_FOUND", "Task does not exist");
      }

      task.anomalyIgnored = Boolean(ignored);
      task.updatedAt = nowIso();

      this.#prepareState(state);
      tx.commit();
      return task;
    });
  }

  async getCategories() {
    return this.storage.runExclusive((state, tx) => {
      const changed = this.#prepareState(state);
      if (changed) {
        tx.commit();
      }
      return state.categories;
    });
  }

  async createCategory(payload) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);
      const name = (payload.name || "").trim();
      if (!name) {
        throw new AppError(400, "INVALID_CATEGORY_NAME", "Category name is required");
      }

      const category = {
        id: randomUUID(),
        name,
        description: (payload.description || "").trim(),
        isAnomalyBucket: false,
      };
      state.categories.push(category);
      this.#prepareState(state);
      tx.commit();
      return category;
    });
  }

  async deleteCategory(categoryId) {
    return this.storage.runExclusive((state, tx) => {
      this.#prepareState(state);

      if ([CATEGORY.GENERAL_ID, CATEGORY.ANOMALY_ID, CATEGORY.ARCHIVED_ID].includes(categoryId)) {
        throw new AppError(400, "CATEGORY_DELETE_FORBIDDEN", "Default categories cannot be deleted");
      }

      const idx = state.categories.findIndex((item) => item.id === categoryId);
      if (idx < 0) {
        throw new AppError(404, "CATEGORY_NOT_FOUND", "Category does not exist");
      }

      state.categories.splice(idx, 1);

      let reassignedTaskCount = 0;
      for (const task of state.tasks) {
        if (task.categoryId === categoryId) {
          task.categoryId = CATEGORY.GENERAL_ID;
          task.updatedAt = nowIso();
          reassignedTaskCount += 1;
        }
      }

      this.#prepareState(state);
      tx.commit();
      return {
        id: categoryId,
        deleted: true,
        reassignedTaskCount,
      };
    });
  }

  #prepareState(state) {
    let changed = false;

    changed = this.#ensureDefaultCategories(state) || changed;
    changed = this.#ensureTaskDefaults(state) || changed;
    changed = this.#applyOverdueRule(state) || changed;

    for (const task of state.tasks) {
      changed = this.#recomputeTask(task, state.checkpoints) || changed;
    }

    const stats = this.#computeStatistics(state.tasks, state.categories);
    const previous = JSON.stringify(state.statisticsCache || {});
    const next = JSON.stringify(stats);
    if (previous !== next) {
      state.statisticsCache = stats;
      changed = true;
    }

    return changed;
  }

  #ensureDefaultCategories(state) {
    let changed = false;

    if (!Array.isArray(state.categories)) {
      state.categories = [];
      changed = true;
    }

    if (!state.categories.find((item) => item.id === CATEGORY.GENERAL_ID)) {
      state.categories.push({
        id: CATEGORY.GENERAL_ID,
        name: "General",
        description: "Default study category",
        isAnomalyBucket: false,
      });
      changed = true;
    }

    if (!state.categories.find((item) => item.id === CATEGORY.ANOMALY_ID)) {
      state.categories.push({
        id: CATEGORY.ANOMALY_ID,
        name: "Anomalies",
        description: "Automatically managed anomalous tasks",
        isAnomalyBucket: true,
      });
      changed = true;
    }

    const archivedCategory = state.categories.find((item) => item.id === CATEGORY.ARCHIVED_ID);
    if (!archivedCategory) {
      state.categories.push({
        id: CATEGORY.ARCHIVED_ID,
        name: "Archived",
        description: "Completed tasks kept for reference",
        isAnomalyBucket: false,
        isArchiveBucket: true,
      });
      changed = true;
    } else if (!archivedCategory.isArchiveBucket) {
      archivedCategory.isArchiveBucket = true;
      changed = true;
    }

    return changed;
  }

  #ensureTaskDefaults(state) {
    let changed = false;

    if (!Array.isArray(state.tasks)) {
      state.tasks = [];
      changed = true;
    }

    if (!Array.isArray(state.checkpoints)) {
      state.checkpoints = [];
      changed = true;
    }

    for (const task of state.tasks) {
      if (!Array.isArray(task.tags)) {
        task.tags = [];
        changed = true;
      }
      if (!Array.isArray(task.checkpointIds)) {
        task.checkpointIds = [];
        changed = true;
      }
      if (!Array.isArray(task.anomalyFlags)) {
        task.anomalyFlags = [];
        changed = true;
      }
      if (typeof task.anomalyIgnored !== "boolean") {
        task.anomalyIgnored = false;
        changed = true;
      }
      if (!task.createdAt) {
        task.createdAt = nowIso();
        changed = true;
      }
      if (!task.updatedAt) {
        task.updatedAt = task.createdAt;
        changed = true;
      }
      if (!Object.values(TASK_STATUS).includes(task.status)) {
        task.status = TASK_STATUS.TODO;
        changed = true;
      }
      if (task.manualPriority == null) {
        task.manualPriority = 3;
        changed = true;
      }
      if (!Object.prototype.hasOwnProperty.call(task, "directEstimatedMinutes")) {
        task.directEstimatedMinutes = task.estimatedMinutes == null ? null : toInt(task.estimatedMinutes, 0);
        changed = true;
      }
      if (task.directMinutes == null) {
        task.directMinutes = toInt(task.actualMinutes, 0);
        changed = true;
      }
      if (!task.categoryId) {
        task.categoryId = CATEGORY.GENERAL_ID;
        changed = true;
      }
      if (task.status === TASK_STATUS.DONE && task.categoryId !== CATEGORY.ARCHIVED_ID) {
        task.categoryId = CATEGORY.ARCHIVED_ID;
        changed = true;
      }
      if (task.status !== TASK_STATUS.DONE && task.categoryId === CATEGORY.ARCHIVED_ID) {
        task.categoryId = CATEGORY.GENERAL_ID;
        changed = true;
      }
    }

    return changed;
  }

  #resolveCategoryId(state, candidate) {
    if (!candidate) {
      return CATEGORY.GENERAL_ID;
    }

    const exists = state.categories.find((item) => item.id === candidate);
    if (!exists) {
      throw new AppError(400, "INVALID_CATEGORY_ID", "Category does not exist");
    }

    if (candidate === CATEGORY.ARCHIVED_ID) {
      throw new AppError(400, "ARCHIVE_CATEGORY_FORBIDDEN", "Archived category is managed automatically");
    }

    return candidate;
  }

  #isPlanningExcludedCategory(categoryId) {
    return categoryId === CATEGORY.ARCHIVED_ID;
  }

  #normalizePriority(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return 3;
    }
    return Math.max(1, Math.min(5, Math.round(n)));
  }

  #normalizeDeadline(value) {
    if (value == null || String(value).trim() === "") {
      return null;
    }

    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }

    const t = new Date(raw).getTime();
    if (Number.isNaN(t)) {
      throw new AppError(400, "INVALID_DEADLINE", "Deadline must be a valid date");
    }

    return new Date(t).toISOString().slice(0, 10);
  }

  #appendAnomalyFlag(task, flag) {
    if (!task.anomalyFlags.includes(flag)) {
      task.anomalyFlags.push(flag);
    }
  }

  #setAnomalyFlag(task, flag, enabled) {
    const exists = task.anomalyFlags.includes(flag);
    if (enabled && !exists) {
      task.anomalyFlags.push(flag);
      return true;
    }
    if (!enabled && exists) {
      task.anomalyFlags = task.anomalyFlags.filter((item) => item !== flag);
      return true;
    }
    return false;
  }

  #isTaskAnomalous(task) {
    return task.categoryId === CATEGORY.ANOMALY_ID || (task.anomalyFlags && task.anomalyFlags.length > 0);
  }

  #remainingEstimatedMinutes(task, checkpoints) {
    const related = checkpoints.filter((cp) => cp.taskId === task.id);
    if (related.length > 0) {
      const checkpointEstimates = related.map((cp) => toInt(cp.estimatedMinutes, 0)).filter(isPositiveFinite);
      const checkpointFallback = median(checkpointEstimates);
      let remaining = 0;
      let hasEstimate = false;
      let hasRemainingCheckpoint = false;

      for (const checkpoint of related) {
        if (checkpoint.completed || checkpoint.skipped) {
          continue;
        }

        hasRemainingCheckpoint = true;
        const estimate = toInt(checkpoint.estimatedMinutes, 0);
        if (isPositiveFinite(estimate)) {
          remaining += estimate;
          hasEstimate = true;
        } else if (isPositiveFinite(checkpointFallback)) {
          remaining += checkpointFallback;
          hasEstimate = true;
        }
      }

      if (!hasRemainingCheckpoint) {
        return 0;
      }

      return hasEstimate ? remaining : null;
    }

    if (!isPositiveFinite(task.estimatedMinutes)) {
      return null;
    }

    const remainingRatio = 1 - clampProgress(task.progress) / 100;
    return Math.round(task.estimatedMinutes * remainingRatio);
  }

  #applyOverdueRule(state) {
    const now = Date.now();
    let changed = false;

    for (const task of state.tasks) {
      if (!isIncompleteStatus(task.status)) {
        continue;
      }

      if (!task.deadline) {
        continue;
      }

      const deadlineTs = toDeadlineTimestamp(task.deadline);
      if (Number.isNaN(deadlineTs) || deadlineTs > now) {
        continue;
      }

      const before = JSON.stringify({
        categoryId: task.categoryId,
        anomalyFlags: task.anomalyFlags,
      });

      task.categoryId = CATEGORY.ANOMALY_ID;
      this.#appendAnomalyFlag(task, ANOMALY_FLAGS.POSTPONED);

      const after = JSON.stringify({
        categoryId: task.categoryId,
        anomalyFlags: task.anomalyFlags,
      });

      if (before !== after) {
        task.updatedAt = nowIso();
        changed = true;
      }
    }

    return changed;
  }

  #recomputeTask(task, checkpoints) {
    const related = checkpoints.filter((cp) => cp.taskId === task.id).sort((a, b) => a.order - b.order);
    const nextCheckpointIds = related.map((cp) => cp.id);

    let changed = false;

    if (JSON.stringify(task.checkpointIds) !== JSON.stringify(nextCheckpointIds)) {
      task.checkpointIds = nextCheckpointIds;
      changed = true;
    }

    const cpMinutes = related.reduce((sum, cp) => sum + toInt(cp.actualMinutes, 0), 0);
    const nextActual = related.length > 0 ? cpMinutes : toInt(task.directMinutes, 0);
    if (task.actualMinutes !== nextActual) {
      task.actualMinutes = nextActual;
      changed = true;
    }

    if (related.length > 0) {
      const checkpointEstimated = related.reduce((sum, cp) => sum + toInt(cp.estimatedMinutes, 0), 0);
      const completedEstimated = related
        .filter((cp) => cp.completed)
        .reduce((sum, cp) => sum + toInt(cp.estimatedMinutes, 0), 0);
      const nextEstimated = checkpointEstimated;
      if (task.estimatedMinutes !== nextEstimated) {
        task.estimatedMinutes = nextEstimated;
        changed = true;
      }

      const nextProgress =
        checkpointEstimated > 0
          ? clampProgress((completedEstimated / checkpointEstimated) * 100)
          : clampProgress((related.filter((cp) => cp.completed).length / related.length) * 100);
      if (task.progress !== nextProgress) {
        task.progress = nextProgress;
        changed = true;
      }

      const allCheckpointsCompleted = related.every((cp) => cp.completed);
      if (allCheckpointsCompleted && isIncompleteStatus(task.status)) {
        task.status = TASK_STATUS.DONE;
        task.progress = 100;
        task.categoryId = CATEGORY.ARCHIVED_ID;
        task.updatedAt = nowIso();
        changed = true;
      }
    } else {
      const nextEstimated = task.directEstimatedMinutes == null ? null : toInt(task.directEstimatedMinutes, 0);
      if (task.estimatedMinutes !== nextEstimated) {
        task.estimatedMinutes = nextEstimated;
        changed = true;
      }

      const nextProgress = clampProgress(task.progress);
      if (task.progress !== nextProgress) {
        task.progress = nextProgress;
        changed = true;
      }
    }

    if (task.status === TASK_STATUS.DONE && task.progress !== 100) {
      task.progress = 100;
      changed = true;
    }

    const hasSkippedCheckpoint = related.some((cp) => cp.skipped);
    changed = this.#setAnomalyFlag(task, ANOMALY_FLAGS.CHECKPOINT_SKIPPED, hasSkippedCheckpoint) || changed;

    if (!this.#isTaskAnomalous(task) && task.anomalyIgnored) {
      task.anomalyIgnored = false;
      changed = true;
    }

    return changed;
  }

  #computeStatistics(tasks, categories) {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;

    const statusForTime = new Set([TASK_STATUS.DONE, TASK_STATUS.IN_PROGRESS, TASK_STATUS.PAUSED]);

    let dailyMinutes = 0;
    let weeklyMinutes = 0;

    let totalTaskMinutes = 0;
    const categoryMinutes = {};
    const doneByPriority = {};

    let doneCount = 0;

    for (const task of tasks) {
      const actual = toInt(task.actualMinutes, 0);
      const updatedAt = new Date(task.updatedAt).getTime();

      if (statusForTime.has(task.status) && Number.isFinite(updatedAt)) {
        const diff = now - updatedAt;
        if (diff <= oneDay) {
          dailyMinutes += actual;
        }
        if (diff <= sevenDays) {
          weeklyMinutes += actual;
        }
      }

      totalTaskMinutes += actual;
      categoryMinutes[task.categoryId] = (categoryMinutes[task.categoryId] || 0) + actual;

      if (task.status === TASK_STATUS.DONE) {
        doneCount += 1;
        const key = String(this.#normalizePriority(task.manualPriority));
        doneByPriority[key] = (doneByPriority[key] || 0) + 1;
      }
    }

    const categoryTimeShare = {};
    for (const category of categories) {
      const minutes = categoryMinutes[category.id] || 0;
      categoryTimeShare[category.id] = totalTaskMinutes === 0 ? 0 : Number((minutes / totalTaskMinutes).toFixed(4));
    }

    const completionRate = tasks.length === 0 ? 0 : Number((doneCount / tasks.length).toFixed(4));

    return {
      dateKey: new Date().toISOString().slice(0, 10),
      dailyMinutes,
      weeklyMinutes,
      completionRate,
      categoryTimeShare,
      doneByPriority,
    };
  }
}

module.exports = {
  SchedulerService,
};
