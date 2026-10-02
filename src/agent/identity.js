const { createHash } = require("node:crypto");

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function publicEntity(entity) {
  const { _agentRequest, revision, checkpoints, ...result } = entity;
  return result;
}

function checkpointView(checkpoint) {
  const result = publicEntity(checkpoint);
  return { ...result, revision: digest(result) };
}

function taskView(task) {
  const result = publicEntity(task);
  const checkpoints = (task.checkpoints || []).map(checkpointView)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { ...result, checkpoints, revision: digest({ task: result, checkpoints }) };
}

module.exports = { canonicalJson, digest, publicEntity, checkpointView, taskView };
