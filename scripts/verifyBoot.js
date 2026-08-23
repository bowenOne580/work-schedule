// 更新完成前的启动冒烟验证：能加载新代码、构造 Express 应用、
// 在临时目录初始化存储层，并确认前端构建产物存在。
// 不监听端口、不触碰真实 data/。退出码 0 = 通过。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function main() {
  const root = path.join(__dirname, "..");

  const distIndex = path.join(root, "frontend", "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    throw new Error("缺少前端构建产物 frontend/dist/index.html");
  }

  const { JsonStorage } = require("../src/repository/jsonStorage");
  const { SchedulerService } = require("../src/services/schedulerService");
  const { createApp } = require("../src/createApp");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "work-schedule-verify-"));
  try {
    const storage = new JsonStorage(tmpDir);
    await storage.initialize();
    const service = new SchedulerService(storage);
    const app = createApp(service, {});
    if (!app || typeof app.listen !== "function") {
      throw new Error("Express 应用构建失败");
    }
    await service.getCategories();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("verifyBoot: ok");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("verifyBoot failed:", err.message);
    process.exit(1);
  },
);
