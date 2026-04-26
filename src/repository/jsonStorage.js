const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_FILES = {
  tasks: {
    file: "tasks.json",
    defaultValue: [],
  },
  checkpoints: {
    file: "checkpoints.json",
    defaultValue: [],
  },
  categories: {
    file: "categories.json",
    defaultValue: [],
  },
  statisticsCache: {
    file: "statistics_cache.json",
    defaultValue: {
      dateKey: "",
      dailyMinutes: 0,
      weeklyMinutes: 0,
      completionRate: 0,
      categoryTimeShare: {},
      doneByPriority: {},
    },
  },
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

class JsonStorage {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.backupCount = Number(options.backupCount || 5);
    this.backupDir = path.join(this.dataDir, "backups");
    this.queue = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.backupDir, { recursive: true });

    const keys = Object.keys(DATA_FILES);
    for (const key of keys) {
      await this.#ensureFile(key);
      await this.#recoverIfCorrupted(key);
    }
  }

  async runExclusive(work) {
    const run = this.queue.then(async () => {
      const state = await this.#readAll();
      const draft = deepClone(state);
      let shouldCommit = false;

      const ctx = {
        commit: () => {
          shouldCommit = true;
        },
      };

      const result = await work(draft, ctx);

      if (shouldCommit) {
        await this.#writeAll(draft);
      }

      return result;
    });

    this.queue = run.catch(() => undefined);
    return run;
  }

  async #ensureFile(key) {
    const meta = DATA_FILES[key];
    const filePath = this.#filePath(key);

    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(meta.defaultValue, null, 2), "utf8");
    }
  }

  async #recoverIfCorrupted(key) {
    const filePath = this.#filePath(key);

    try {
      const text = await fs.readFile(filePath, "utf8");
      JSON.parse(text);
    } catch {
      const restored = await this.#restoreLatestBackup(key);
      if (!restored) {
        const meta = DATA_FILES[key];
        await fs.writeFile(filePath, JSON.stringify(meta.defaultValue, null, 2), "utf8");
      }
    }
  }

  async #restoreLatestBackup(key) {
    const dir = this.#backupKeyDir(key);
    try {
      const files = (await fs.readdir(dir)).sort();
      if (!files.length) {
        return false;
      }

      for (let i = files.length - 1; i >= 0; i -= 1) {
        const backupPath = path.join(dir, files[i]);
        try {
          const text = await fs.readFile(backupPath, "utf8");
          JSON.parse(text);
          await fs.writeFile(this.#filePath(key), text, "utf8");
          return true;
        } catch {
          // keep trying older backups
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  async #readAll() {
    const entries = await Promise.all(
      Object.keys(DATA_FILES).map(async (key) => {
        const filePath = this.#filePath(key);
        const content = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(content);
        return [key, parsed];
      }),
    );

    return Object.fromEntries(entries);
  }

  async #writeAll(state) {
    const keys = Object.keys(DATA_FILES);
    for (const key of keys) {
      await this.#writeAtomic(key, state[key]);
    }
  }

  async #writeAtomic(key, value) {
    const filePath = this.#filePath(key);
    const tmpPath = `${filePath}.tmp`;
    const content = JSON.stringify(value, null, 2);

    await fs.writeFile(tmpPath, content, "utf8");
    await fs.rename(tmpPath, filePath);
    await this.#writeBackup(key, content);
  }

  async #writeBackup(key, content) {
    const dir = this.#backupKeyDir(key);
    await fs.mkdir(dir, { recursive: true });

    const backupName = `${Date.now()}.json`;
    const backupPath = path.join(dir, backupName);
    await fs.writeFile(backupPath, content, "utf8");

    const files = (await fs.readdir(dir)).sort();
    const removeCount = Math.max(0, files.length - this.backupCount);

    for (let i = 0; i < removeCount; i += 1) {
      await fs.unlink(path.join(dir, files[i]));
    }
  }

  #filePath(key) {
    return path.join(this.dataDir, DATA_FILES[key].file);
  }

  #backupKeyDir(key) {
    return path.join(this.backupDir, key);
  }
}

module.exports = {
  JsonStorage,
};
