const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

// 更新回滚的持久化状态与快照管理。
// 设计约束（见 doc/dev/2026-08-23/update-rollback-plan.md 第 9 节）：
// 快照只包含代码，data/、.env、node_modules/、updates/、.git 永不进快照。
const ROOT = path.join(__dirname, "..");
const UPDATES_DIR = path.join(ROOT, "updates");
const BACKUP_DIR = path.join(UPDATES_DIR, "backup");
const STATE_FILE = path.join(UPDATES_DIR, "state.json");
const BACKUP_NAME_RE = /^pre-update-\d+\.tar\.gz$/;
const KEEP_BACKUPS = 2;
const SNAPSHOT_TIMEOUT = 120_000;
const NPM_INSTALL_TIMEOUT = 300_000;

function readUpdateState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!state || typeof state !== "object" || typeof state.status !== "string") {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function writeUpdateState(state) {
  fs.mkdirSync(UPDATES_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function createSnapshot() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `pre-update-${Date.now()}.tar.gz`;
  const backupPath = path.join(BACKUP_DIR, name);
  execSync(
    `tar czf "${backupPath}" --exclude=./data --exclude=./node_modules --exclude=./.env --exclude=./updates --exclude=./.git -C "${ROOT}" .`,
    { timeout: SNAPSHOT_TIMEOUT, encoding: "utf8" },
  );

  const backups = fs.readdirSync(BACKUP_DIR).filter((f) => BACKUP_NAME_RE.test(f)).sort();
  for (const stale of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) {
    fs.unlinkSync(path.join(BACKUP_DIR, stale));
  }

  return `updates/backup/${name}`;
}

function restoreSnapshot(relativeBackup) {
  const backupPath = path.join(ROOT, relativeBackup);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`备份文件不存在：${relativeBackup}`);
  }
  execSync(`tar xzf "${backupPath}" -C "${ROOT}"`, { timeout: SNAPSHOT_TIMEOUT, encoding: "utf8" });
}

// node_modules 不在快照内，恢复代码后需重新对齐依赖
function installDependencies() {
  execSync("npm install", {
    cwd: ROOT,
    timeout: NPM_INSTALL_TIMEOUT,
    stdio: "inherit",
  });
}

// 启动自愈：上次更新中途进程死亡（status 停留在 updating）时，先恢复快照再启动。
// 必须在初始化 JsonStorage 之前调用。
function recoverInterruptedUpdate() {
  const state = readUpdateState();
  if (!state || state.status !== "updating") {
    return;
  }
  if (!state.backup) {
    console.warn("[updateGuard] 检测到未完成的更新但没有可用备份，跳过恢复");
    return;
  }

  console.warn("[updateGuard] 检测到未完成的更新，正在恢复更新前版本...");
  try {
    restoreSnapshot(state.backup);
    installDependencies();
    writeUpdateState({
      ...state,
      status: "rolled_back",
      error: "进程于更新中途退出，已自动回滚",
      finishedAt: new Date().toISOString(),
    });
    console.warn("[updateGuard] 已回滚到更新前版本");
  } catch (err) {
    // 状态保持 updating，下次重启会再次尝试恢复
    console.error("[updateGuard] 自动恢复失败，尝试直接启动：", err.message);
  }
}

module.exports = {
  readUpdateState,
  writeUpdateState,
  createSnapshot,
  restoreSnapshot,
  installDependencies,
  recoverInterruptedUpdate,
};
