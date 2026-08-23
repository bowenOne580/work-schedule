const path = require("node:path");
// 注意：其余模块必须在 main() 中、recoverInterruptedUpdate() 之后加载，
// 否则上次更新损坏的模块会先被 require 缓存，自愈恢复磁盘也来不及
const { recoverInterruptedUpdate } = require("./src/updateGuard");

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main() {
  // 必须在加载其余模块、初始化存储之前执行：若上次更新中途进程死亡，先回滚代码再启动
  recoverInterruptedUpdate();

  const { createApp } = require("./src/createApp");
  const { JsonStorage } = require("./src/repository/jsonStorage");
  const { SchedulerService } = require("./src/services/schedulerService");

  const dataDir = path.join(__dirname, "data");
  const storage = new JsonStorage(dataDir, { backupCount: 5 });
  await storage.initialize();

  const service = new SchedulerService(storage);
  const serveStatic = parseBoolean(process.env.WORK_SCHEDULE_SERVE_STATIC, false);
  const corsOrigins = parseList(process.env.WORK_SCHEDULE_CORS_ORIGINS);
  const app = createApp(service, {
    serveStatic,
    corsOrigins,
  });

  const port = Number(process.env.PORT || 8998);
  app.listen(port, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(
      `Work Schedule server running on port ${port} (mode=${serveStatic ? "hybrid" : "api-only"}, corsOrigins=${corsOrigins.length ? corsOrigins.join("|") : "none"})`,
    );
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
