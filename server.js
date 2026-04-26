const path = require("node:path");
const { createApp } = require("./src/createApp");
const { JsonStorage } = require("./src/repository/jsonStorage");
const { SchedulerService } = require("./src/services/schedulerService");

async function main() {
  const dataDir = path.join(__dirname, "data");
  const storage = new JsonStorage(dataDir, { backupCount: 5 });
  await storage.initialize();

  const service = new SchedulerService(storage);
  const app = createApp(service);

  const port = Number(process.env.PORT || 8998);
  app.listen(port, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`Work Schedule server running on port ${port}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
