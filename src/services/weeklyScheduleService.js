const { randomUUID } = require("node:crypto");
const { AppError } = require("../errors");

const FIELDS = new Set(["title", "type", "weekdays", "startTime", "endTime"]);
const DAYS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function invalid(message) {
  throw new AppError(400, "INVALID_SCHEDULE_SLOT", message);
}

function timeMinutes(value, allowMidnightEnd = false) {
  if (allowMidnightEnd && value === "24:00") return 1440;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    invalid("时间必须为 HH:mm 格式，结束时间也可使用 24:00");
  }
  const [hours, minutes] = value.split(":").map(Number);
  if (minutes % 5 !== 0) invalid("开始和结束时间必须以 5 分钟为单位");
  return hours * 60 + minutes;
}

function validateFields(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Object.keys(payload).length) {
    invalid("请填写时间段信息");
  }
  for (const key of Object.keys(payload)) if (!FIELDS.has(key)) invalid(`不支持字段：${key}`);
}

function normalize(payload) {
  if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 100) {
    invalid("名称不能为空，且不能超过 100 个字符");
  }
  if (!["busy", "free"].includes(payload.type)) invalid("请选择固定占用或固定空闲");
  if (!Array.isArray(payload.weekdays) || !payload.weekdays.length || payload.weekdays.length > 7 ||
      payload.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
      new Set(payload.weekdays).size !== payload.weekdays.length) {
    invalid("请至少选择一个星期，取值为 1 至 7 且不能重复");
  }
  const start = timeMinutes(payload.startTime);
  const end = timeMinutes(payload.endTime, true);
  if (end <= start) invalid("结束时间必须晚于开始时间；跨午夜的安排请拆成两段");
  return {
    title: payload.title.trim(), type: payload.type,
    weekdays: [...payload.weekdays].sort((a, b) => a - b),
    startTime: payload.startTime, endTime: payload.endTime,
  };
}

class WeeklyScheduleService {
  constructor(storage, { now = () => Date.now() } = {}) {
    this.storage = storage;
    this.now = now;
  }

  list() {
    return this.storage.runExclusive((state) => [...state.scheduleSlots].sort((a, b) =>
      a.weekdays[0] - b.weekdays[0] || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id)));
  }

  #checkOverlap(slots, candidate, excludedId) {
    const start = timeMinutes(candidate.startTime);
    const end = timeMinutes(candidate.endTime, true);
    for (const slot of slots) {
      if (slot.id === excludedId) continue;
      const sharedDays = candidate.weekdays.filter((day) => slot.weekdays.includes(day));
      if (sharedDays.length && start < timeMinutes(slot.endTime, true) && end > timeMinutes(slot.startTime)) {
        throw new AppError(409, "SCHEDULE_OVERLAP",
          `${sharedDays.map((day) => DAYS[day]).join("、")}的时间与“${slot.title}”（${slot.startTime}–${slot.endTime}）重叠，请调整时间或星期`,
          { conflictingId: slot.id, weekdays: sharedDays });
      }
    }
  }

  create(payload) {
    validateFields(payload);
    const fields = normalize(payload);
    return this.storage.runExclusive((state, tx) => {
      this.#checkOverlap(state.scheduleSlots, fields);
      const timestamp = new Date(this.now()).toISOString();
      const slot = { id: randomUUID(), ...fields, createdAt: timestamp, updatedAt: timestamp };
      state.scheduleSlots.push(slot);
      tx.commit();
      return slot;
    });
  }

  update(id, payload) {
    validateFields(payload);
    return this.storage.runExclusive((state, tx) => {
      const slot = state.scheduleSlots.find((item) => item.id === id);
      if (!slot) throw new AppError(404, "SCHEDULE_SLOT_NOT_FOUND", "时间段不存在，请刷新后重试");
      const fields = normalize({ ...slot, ...payload });
      this.#checkOverlap(state.scheduleSlots, fields, id);
      Object.assign(slot, fields, { updatedAt: new Date(this.now()).toISOString() });
      tx.commit();
      return slot;
    });
  }

  delete(id) {
    return this.storage.runExclusive((state, tx) => {
      const index = state.scheduleSlots.findIndex((item) => item.id === id);
      if (index < 0) throw new AppError(404, "SCHEDULE_SLOT_NOT_FOUND", "时间段不存在，请刷新后重试");
      state.scheduleSlots.splice(index, 1);
      tx.commit();
      return { id, deleted: true };
    });
  }
}

module.exports = { WeeklyScheduleService };
