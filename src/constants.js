const TASK_STATUS = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  PAUSED: "paused",
  DONE: "done",
};

const ACTION = {
  START: "start",
  PAUSE: "pause",
  RESUME: "resume",
  COMPLETE: "complete",
  POSTPONE: "postpone",
};

const CATEGORY = {
  GENERAL_ID: "cat-general",
  ANOMALY_ID: "cat-anomaly",
  ARCHIVED_ID: "cat-archived",
};

const ANOMALY_FLAGS = {
  POSTPONED: "postponed",
  CHECKPOINT_SKIPPED: "checkpoint_skipped",
};

module.exports = {
  TASK_STATUS,
  ACTION,
  CATEGORY,
  ANOMALY_FLAGS,
};
