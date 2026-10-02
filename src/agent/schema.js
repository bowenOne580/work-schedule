const { AppError } = require("../errors");

const title = { type: "string", minLength: 1, maxLength: 500, pattern: "\\S" };
const estimatedMinutes = { type: "integer", minimum: 0, maximum: 1_000_000, nullable: true };
const taskFields = {
  title,
  categoryId: { type: "string", minLength: 1, maxLength: 128 },
  tags: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 64 } },
  manualPriority: { type: "integer", minimum: 1, maximum: 5, description: "P1 最高，P5 最低；新建时默认 P3。" },
  estimatedMinutes,
  deadline: { type: "string", format: "date", nullable: true, description: "YYYY-MM-DD；该日结束时截止，使用服务器本地时区。null 清除截止日期。" },
};
const checkpointFields = {
  title,
  order: { type: "integer", minimum: 1, maximum: 1_000_000 },
  estimatedMinutes,
};

const schemas = {
  Login: {
    type: "object", additionalProperties: false, required: ["username", "password"],
    properties: {
      username: { type: "string", minLength: 1, maxLength: 256 },
      password: { type: "string", minLength: 1, maxLength: 1024, format: "password" },
    },
  },
  CheckpointCreate: {
    type: "object", additionalProperties: false, required: ["title"], properties: checkpointFields,
  },
  CheckpointPatch: {
    type: "object", additionalProperties: false, minProperties: 1, properties: checkpointFields,
  },
  TaskCreate: {
    type: "object", additionalProperties: false, required: ["title"],
    properties: { ...taskFields, checkpoints: { type: "array", maxItems: 100, items: { $ref: "#/components/schemas/CheckpointCreate" } } },
  },
  TaskPatch: {
    type: "object", additionalProperties: false, minProperties: 1, properties: taskFields,
  },
  CategoryCreate: {
    type: "object", additionalProperties: false, required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 100, pattern: "\\S" },
      description: { type: "string", maxLength: 2000 },
    },
  },
  TaskFilters: {
    type: "object", additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["todo", "in_progress", "paused", "done"] },
      categoryId: taskFields.categoryId,
      manualPriority: { type: "string", pattern: "^[1-5]$" },
      deadlineFrom: { type: "string", format: "date" },
      deadlineTo: { type: "string", format: "date" },
    },
  },
};

function invalid(field, reason) {
  throw new AppError(400, "VALIDATION_ERROR", "请求参数无效", { field, reason });
}

function validate(schema, value, field = "body") {
  if (schema.$ref) return validate(schemas[schema.$ref.split("/").pop()], value, field);
  if (value === null && schema.nullable) return;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field, "必须为对象");
    if (Object.keys(value).length < (schema.minProperties || 0)) invalid(field, "至少提交一个可修改字段");
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) invalid(`${field}.${key}`, "必填");
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) invalid(`${field}.${key}`, "不支持的字段");
      validate(schema.properties[key], item, `${field}.${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) invalid(field, "必须为数组");
    if (value.length > schema.maxItems) invalid(field, `最多 ${schema.maxItems} 项`);
    value.forEach((item, index) => validate(schema.items, item, `${field}[${index}]`));
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) {
      invalid(field, `必须为 ${schema.minimum} 至 ${schema.maximum} 的整数`);
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string") invalid(field, "必须为字符串");
    if (value.length < (schema.minLength || 0) || value.length > schema.maxLength) invalid(field, "长度超出允许范围");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) invalid(field, "格式无效");
    if (schema.enum && !schema.enum.includes(value)) invalid(field, `允许值：${schema.enum.join(", ")}`);
    if (schema.format === "date") {
      const timestamp = Date.parse(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
        invalid(field, "必须为有效的 YYYY-MM-DD 日期");
      }
    }
  }
}

function validateInput(name, value, field) {
  validate(schemas[name], value, field);
}

module.exports = { schemas, validateInput };
