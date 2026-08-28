const path = require("node:path");
const fs = require("node:fs");
const { execSync, spawn } = require("node:child_process");
const express = require("express");
const { AppError } = require("./errors");
const { ACTION } = require("./constants");
const {
  AUTH_COOKIE,
  SESSION_HOURS,
  buildCookie,
  clearCookie,
  createAuthToken,
  getAuthConfig,
  safeEqual,
  verifyAuthToken,
  verifyPassword,
} = require("./auth");
const { writeUpdateState, createSnapshot, restoreSnapshot } = require("./updateGuard");

function parseCookies(header) {
  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, part) => {
    const idx = part.indexOf("=");
    if (idx < 0) {
      return cookies;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
    return cookies;
  }, {});
}

function parseOriginList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return source.map((item) => String(item).trim()).filter(Boolean);
}

function mergeVary(current, key) {
  const values = String(current || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!values.includes(key)) {
    values.push(key);
  }

  return values.join(", ");
}

function isPageRequest(req) {
  if (req.method !== "GET" || req.path.startsWith("/api/")) {
    return false;
  }
  if (req.path === "/" || req.path.endsWith(".html")) {
    return true;
  }
  const accept = req.headers.accept || "";
  return !path.extname(req.path) && accept.includes("text/html");
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      const result = await handler(req, res, next);
      if (!res.headersSent) {
        res.json({ data: result });
      }
    } catch (error) {
      next(error);
    }
  };
}

const GH_REPO = "bowenOne580/work-schedule";

function normalizeTag(version) {
  const trimmed = String(version).trim();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

// 语义化版本比较：a 比 b 新返回正数；tag 可带可不带 v 前缀
function compareVersionsDesc(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

// 版本列表不保证有序（GitHub tags 按提交时间、jsDelivr 数据可能滞后），一律取语义化最大值
function newestTag(versions) {
  return [...versions].sort((a, b) => compareVersionsDesc(b, a))[0];
}

async function fetchLatestTagFromGitHubApi() {
  const response = await fetch(`https://api.github.com/repos/${GH_REPO}/tags?per_page=30`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub tags responded with ${response.status}`);
  }

  const tags = await response.json();
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error("No release tags found");
  }

  return newestTag(tags.map((t) => String(t?.name || "")).filter(Boolean));
}

async function fetchLatestTagFromJsDelivr() {
  const response = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${GH_REPO}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`jsDelivr responded with ${response.status}`);
  }

  const data = await response.json();
  const versions = Array.isArray(data?.versions)
    ? data.versions.map((v) => String(v?.version || "")).filter(Boolean)
    : [];
  if (versions.length === 0) {
    throw new Error("No release tags found on jsDelivr");
  }

  return normalizeTag(newestTag(versions));
}

// 镜像模式优先走国内可达源；任一源失败自动降级到另一个
async function fetchLatestTag({ mirror = false } = {}) {
  const chain = mirror
    ? [fetchLatestTagFromJsDelivr, fetchLatestTagFromGitHubApi]
    : [fetchLatestTagFromGitHubApi, fetchLatestTagFromJsDelivr];

  let lastError = null;
  for (const source of chain) {
    try {
      return await source();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("Failed to fetch latest tag");
}

const STAT_RANGES = ["week", "month", "all", "custom"];
const STAT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 解析统计范围查询参数；无 range 参数返回 null（沿用持久化快照的默认口径，仪表盘/旧调用零影响）
function parseStatRangeQuery(query) {
  const type = query.range == null || query.range === "" ? null : String(query.range);
  if (type === null) {
    return null;
  }
  if (!STAT_RANGES.includes(type)) {
    throw new AppError(400, "INVALID_STAT_RANGE", "未知的统计范围");
  }
  if (type !== "custom") {
    return { type, from: null, to: null };
  }
  const from = String(query.from || "");
  const to = String(query.to || "");
  if (
    !STAT_DATE_RE.test(from) ||
    !STAT_DATE_RE.test(to) ||
    Number.isNaN(new Date(`${from}T00:00:00`).getTime()) ||
    Number.isNaN(new Date(`${to}T00:00:00`).getTime())
  ) {
    throw new AppError(400, "INVALID_STAT_RANGE", "自定义统计范围需要有效的起止日期（YYYY-MM-DD）");
  }
  if (from > to) {
    throw new AppError(400, "INVALID_STAT_RANGE", "统计范围起始日期不能晚于结束日期");
  }
  return { type, from, to };
}

// 更新包解压后的源目录：GitHub 源码包（zipball/archive）带一层 <repo>-<sha>/ 包装目录，
// CI 构建的 Release 附件则直接是项目根。仅当解压结果为唯一子目录时才剥掉包装层。
function resolveUpdateSourceDir(tmpDir) {
  const entries = fs.readdirSync(tmpDir);
  if (entries.length === 1) {
    const only = path.join(tmpDir, entries[0]);
    if (fs.statSync(only).isDirectory()) {
      return only;
    }
  }
  return tmpDir;
}

// 更新包下载地址：assetUrl 指向 CI 预构建的 Release 附件（含 frontend/dist，更新时
// 可跳过服务器端前端构建）；sourceUrl 为 GitHub 源码包（无 dist，需现场构建），
// 用于 Release 无附件（v1.1.11 之前）或附件下载失败的回退。
function buildUpdateZipUrls(tag, mirror) {
  const encodedTag = encodeURIComponent(tag);
  const ghPrefix = mirror ? "https://ghfast.top/https://github.com" : "https://github.com";
  return {
    assetUrl: `${ghPrefix}/${GH_REPO}/releases/download/${encodedTag}/work-schedule-${encodedTag}.zip`,
    sourceUrl: mirror
      ? `${ghPrefix}/${GH_REPO}/archive/refs/tags/${encodedTag}.zip`
      : `https://api.github.com/repos/${GH_REPO}/zipball/${encodedTag}`,
  };
}

function createApp(service, options = {}) {
  const app = express();
  const authConfig = getAuthConfig();
  const serveStatic = Boolean(options.serveStatic);
  const allowedOrigins = new Set(parseOriginList(options.corsOrigins));
  const hasCorsPolicy = allowedOrigins.size > 0;
  const cookieSameSite = authConfig.cookieSameSite;
  const cookieSecure = authConfig.secureCookie || cookieSameSite === "None";

  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Vary", mergeVary(res.getHeader("Vary"), "Origin"));
    }

    if (hasCorsPolicy && req.method === "OPTIONS") {
      return res.status(204).end();
    }

    return next();
  });

  app.use((req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie || "");
    req.authUser = verifyAuthToken(cookies[AUTH_COOKIE], authConfig);
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ data: { ok: true, service: "work-schedule" } });
  });

  app.get("/api/auth/status", (req, res) => {
    res.json({
      data: {
        authenticated: Boolean(req.authUser),
        username: req.authUser?.username || null,
      },
    });
  });

  app.post(
    "/api/auth/login",
    asyncRoute(async (req, res) => {
      const username = String(req.body?.username || "");
      const password = String(req.body?.password || "");
      const remember = Boolean(req.body?.remember);

      if (!safeEqual(username, authConfig.username) || !verifyPassword(password, authConfig.passwordHash)) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password");
      }

      const maxAgeSeconds = remember ? authConfig.rememberDays * 24 * 60 * 60 : SESSION_HOURS * 60 * 60;
      const token = createAuthToken(username, maxAgeSeconds, authConfig.secret);
      res.setHeader(
        "Set-Cookie",
        buildCookie(AUTH_COOKIE, token, {
          maxAgeSeconds: remember ? maxAgeSeconds : null,
          secure: cookieSecure,
          sameSite: cookieSameSite,
          domain: authConfig.cookieDomain,
        }),
      );

      return {
        authenticated: true,
        username,
      };
    }),
  );

  app.post("/api/auth/logout", (req, res) => {
    res.setHeader(
      "Set-Cookie",
      clearCookie(AUTH_COOKIE, {
        secure: cookieSecure,
        sameSite: cookieSameSite,
        domain: authConfig.cookieDomain,
      }),
    );
    res.json({ data: { authenticated: false } });
  });

  app.use("/api", (req, _res, next) => {
    if (!req.authUser) {
      return next(new AppError(401, "AUTH_REQUIRED", "Login is required"));
    }
    return next();
  });

  app.get(
    "/api/tasks",
    asyncRoute(async () => {
      return service.getTasks();
    }),
  );

  app.get(
    "/api/tasks/anomalies",
    asyncRoute(async () => {
      return service.getAnomalyTasks();
    }),
  );

  app.get(
    "/api/tasks/:id",
    asyncRoute(async (req) => {
      return service.getTaskById(req.params.id);
    }),
  );

  app.post(
    "/api/tasks",
    asyncRoute(async (req) => {
      return service.createTask(req.body || {});
    }),
  );

  app.patch(
    "/api/tasks/:id",
    asyncRoute(async (req) => {
      return service.updateTask(req.params.id, req.body || {});
    }),
  );

  app.delete(
    "/api/tasks/:id",
    asyncRoute(async (req) => {
      return service.deleteTask(req.params.id);
    }),
  );

  app.post(
    "/api/tasks/:id/start",
    asyncRoute(async (req) => {
      return service.runTaskAction(req.params.id, ACTION.START);
    }),
  );

  app.post(
    "/api/tasks/:id/pause",
    asyncRoute(async (req) => {
      return service.runTaskAction(req.params.id, ACTION.PAUSE);
    }),
  );

  app.post(
    "/api/tasks/:id/resume",
    asyncRoute(async (req) => {
      return service.runTaskAction(req.params.id, ACTION.RESUME);
    }),
  );

  app.post(
    "/api/tasks/:id/complete",
    asyncRoute(async (req) => {
      return service.runTaskAction(req.params.id, ACTION.COMPLETE, req.body || {});
    }),
  );

  app.post(
    "/api/tasks/:id/postpone",
    asyncRoute(async (req) => {
      return service.runTaskAction(req.params.id, ACTION.POSTPONE);
    }),
  );

  app.patch(
    "/api/tasks/:id/anomaly-ignore",
    asyncRoute(async (req) => {
      return service.setTaskAnomalyIgnored(req.params.id, req.body?.ignored);
    }),
  );

  app.post(
    "/api/tasks/:id/checkpoints",
    asyncRoute(async (req) => {
      return service.createCheckpoint(req.params.id, req.body || {});
    }),
  );

  app.patch(
    "/api/checkpoints/:id",
    asyncRoute(async (req) => {
      return service.updateCheckpoint(req.params.id, req.body || {});
    }),
  );

  app.post(
    "/api/checkpoints/:id/complete",
    asyncRoute(async (req) => {
      return service.completeCheckpoint(req.params.id, req.body || {});
    }),
  );

  app.post(
    "/api/checkpoints/:id/skip",
    asyncRoute(async (req) => {
      return service.skipCheckpoint(req.params.id);
    }),
  );

  app.post(
    "/api/checkpoints/:id/uncomplete",
    asyncRoute(async (req) => {
      return service.uncompleteCheckpoint(req.params.id);
    }),
  );

  app.delete(
    "/api/checkpoints/:id",
    asyncRoute(async (req) => {
      return service.deleteCheckpoint(req.params.id);
    }),
  );

  app.get(
    "/api/recommendations/by-category",
    asyncRoute(async () => {
      return service.getRecommendationsByCategory();
    }),
  );

  app.get(
    "/api/statistics/overview",
    asyncRoute(async (req) => {
      return service.getStatisticsOverview(parseStatRangeQuery(req.query));
    }),
  );

  app.post("/api/system/stop", (_req, res) => {
    res.json({ data: { message: "Server is stopping" } });

    setTimeout(() => {
      process.exit(0);
    }, 200);
  });

  app.get(
    "/api/system/export",
    asyncRoute(async () => {
      return service.exportAllData();
    }),
  );

  app.post(
    "/api/system/import",
    asyncRoute(async (req) => {
      return service.importData(req.body);
    }),
  );

  app.get(
    "/api/system/version",
    asyncRoute(async (req) => {
      const pkg = require("../package.json");
      const info = { version: pkg.version.replace(/^v/, ""), latestVersion: "" };

      if (String(req.query.quick || "") === "1") {
        return info;
      }

      try {
        const mirror = String(req.query.mirror || "") === "1";
        const tag = await fetchLatestTag({ mirror });
        info.latestVersion = tag.replace(/^v/, "");
      } catch {
        // 版本源不可达 — 静默忽略
      }

      return info;
    }),
  );

  let updating = false;

  app.post("/api/system/update", (req, res) => {
    if (updating) {
      return res.status(400).json({
        error: { code: "ALREADY_UPDATING", message: "正在更新中，请勿重复操作", details: null },
      });
    }
    updating = true;

    const cwd = path.join(__dirname, "..");
    const tmpZip = "/tmp/work-schedule-update.zip";
    const tmpDir = "/tmp/work-schedule-update";
    const mirror = req.body?.mirror === true;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (step, message, extra = {}) => {
      res.write(`data: ${JSON.stringify({ step, message, ...extra })}\n\n`);
    };

    // Run a command and stream each output line as an SSE log message
    const runStreaming = (cmd, args, opts) => new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
      const onLine = (line) => {
        if (line.trim()) send("log", line);
      };
      child.stdout.on("data", (d) => d.toString().split("\n").forEach(onLine));
      child.stderr.on("data", (d) => d.toString().split("\n").forEach(onLine));
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)));
    });

    (async () => {
      // 快照成功后非空；标记"已进入需回滚区间"，失败时据此决定是否回滚
      let relBackup = "";
      let stateBase = null;
      try {
        send("downloading", "正在获取最新发布版本...");
        const latestTag = await fetchLatestTag({ mirror });

        // 版本源可能滞后（镜像源曾返回过期列表导致"更新"到旧版本），禁止降级更新
        const currentVersion = String(require("../package.json").version || "").replace(/^v/, "");
        if (compareVersionsDesc(latestTag, currentVersion) <= 0) {
          throw new Error(
            `版本源返回的最新版本 ${latestTag} 不高于当前版本 v${currentVersion}，已取消更新。` +
              "镜像版本源的数据可能滞后，可稍后重试或改用非镜像更新。",
          );
        }

        const { assetUrl, sourceUrl } = buildUpdateZipUrls(latestTag, mirror);

        send("downloading", `正在${mirror ? "通过镜像" : "从 GitHub"}下载 ${latestTag}（预构建包）...`);
        console.log(`[update] Downloading ${latestTag} release asset...`);
        let response = await fetch(assetUrl, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
          send("downloading", `预构建包不可用（${response.status}），改用源码包...`);
          console.log(`[update] Release asset unavailable (${response.status}), falling back to source archive.`);
          response = await fetch(sourceUrl, {
            signal: AbortSignal.timeout(60_000),
          });
        }
        if (!response.ok) {
          throw new Error(`GitHub responded with ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(tmpZip, buffer);
        console.log("[update] Download complete.");

        send("extracting", "正在解压文件...");
        console.log("[update] Extracting zip...");
        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true });
        }
        fs.mkdirSync(tmpDir, { recursive: true });
        execSync(`unzip -q "${tmpZip}" -d "${tmpDir}"`, { timeout: 30_000, encoding: "utf8" });
        fs.rmSync(tmpZip);

        const sourceDir = resolveUpdateSourceDir(tmpDir);

        send("snapshot", "正在备份当前版本...");
        console.log("[update] Creating snapshot...");
        relBackup = createSnapshot();
        stateBase = {
          startedAt: new Date().toISOString(),
          fromVersion: require("../package.json").version,
          toTag: latestTag,
          backup: relBackup,
        };
        writeUpdateState({ ...stateBase, status: "updating" });

        send("copying", "正在替换文件...");
        console.log("[update] Copying files...");
        execSync(
          `cd "${sourceDir}" && tar cf - --exclude='data' --exclude='node_modules' --exclude='.env' . | tar xf - -C "${cwd}"`,
          { timeout: 30_000, encoding: "utf8" },
        );

        // Check if the release zip already contains a pre-built frontend/dist
        const hasDist = fs.existsSync(path.join(sourceDir, "frontend", "dist", "index.html"));

        send("installing", "正在安装后端依赖...");
        console.log("[update] Installing backend dependencies...");
        await runStreaming("npm", ["install"], { cwd, timeout: 300_000 });

        if (hasDist) {
          send("installing", "Release 包含预构建前端，跳过 build 步骤");
          console.log("[update] Pre-built dist found, skipping frontend build.");
        } else {
          send("installing", "正在安装前端依赖...");
          console.log("[update] Installing frontend dependencies...");
          await runStreaming("npm", ["install", "--include=dev"], { cwd: path.join(cwd, "frontend"), timeout: 300_000 });

          send("building", "正在构建前端...");
          console.log("[update] Building frontend...");
          await runStreaming("npm", ["run", "build"], { cwd: path.join(cwd, "frontend"), timeout: 300_000 });
        }

        send("verifying", "正在验证新版本...");
        console.log("[update] Verifying...");
        await runStreaming("node", ["scripts/verifyBoot.js"], { cwd, timeout: 60_000 });

        send("cleanup", "正在清理临时文件...");
        fs.rmSync(tmpDir, { recursive: true });
        writeUpdateState({
          ...stateBase,
          status: "success",
          finishedAt: new Date().toISOString(),
        });
        updating = false;

        send("done", "更新完成，服务即将重启...");
        console.log("[update] Update complete. Restarting...");
        res.end();
        setTimeout(() => process.exit(0), 1000);
      } catch (err) {
        console.error("[update] Failed:", err.stderr || err.message);
        try { fs.rmSync(tmpZip, { force: true }); } catch {}
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

        const reason = err.message || "更新失败";
        try {
          if (relBackup && stateBase) {
            send("rollback", "更新失败，正在回滚到原版本...");
            console.log("[update] Rolling back...");
            restoreSnapshot(relBackup);

            send("rollback", "正在恢复依赖...");
            await runStreaming("npm", ["install"], { cwd, timeout: 300_000 });

            writeUpdateState({
              ...stateBase,
              status: "rolled_back",
              error: reason,
              finishedAt: new Date().toISOString(),
            });
            send("error", `更新失败，已恢复到原版本：${reason}`, { rolledBack: true });
          } else {
            send("error", reason);
          }
        } catch (rollbackErr) {
          // 状态保持 updating，下次重启由启动自愈重试恢复
          console.error("[update] Rollback failed:", rollbackErr.message);
          send(
            "error",
            `更新失败且回滚未完成，重启后将自动重试恢复。原因：${reason}；回滚错误：${rollbackErr.message}`,
          );
        } finally {
          updating = false;
        }
        res.end();
      }
    })();
  });

  app.get(
    "/api/categories",
    asyncRoute(async () => {
      return service.getCategories();
    }),
  );

  app.post(
    "/api/categories",
    asyncRoute(async (req) => {
      return service.createCategory(req.body || {});
    }),
  );

  app.delete(
    "/api/categories/:id",
    asyncRoute(async (req) => {
      return service.deleteCategory(req.params.id);
    }),
  );

  if (serveStatic) {
    const publicDir = path.join(__dirname, "..", "public");
    const frontendDistDir = path.join(__dirname, "..", "frontend", "dist");
    const hasFrontendDist = fs.existsSync(path.join(frontendDistDir, "index.html"));
    const publicLooksLikeViteDist =
      fs.existsSync(path.join(publicDir, "index.html")) && fs.existsSync(path.join(publicDir, "assets"));

    if (hasFrontendDist || publicLooksLikeViteDist) {
      const spaDir = hasFrontendDist ? frontendDistDir : publicDir;

      app.use((req, res, next) => {
        if (req.path === "/login" && req.authUser) {
          return res.redirect("/app");
        }

        if (isPageRequest(req) && req.path !== "/login" && !req.authUser) {
          const nextPath = encodeURIComponent(req.originalUrl || "/app");
          return res.redirect(`/login?next=${nextPath}`);
        }

        return next();
      });

      app.use(express.static(spaDir));

      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api/")) {
          return next(new AppError(404, "API_NOT_FOUND", "API route not found"));
        }
        if (!req.authUser && isPageRequest(req) && req.path !== "/login") {
          const nextPath = encodeURIComponent(req.originalUrl || "/app");
          return res.redirect(`/login?next=${nextPath}`);
        }
        return res.sendFile(path.join(spaDir, "index.html"));
      });
    } else {
      app.use((req, res, next) => {
        if (req.path === "/login.html" && req.authUser) {
          return res.redirect("/index.html");
        }

        if (req.path === "/login.html" || req.path === "/styles.css" || req.path.startsWith("/js/")) {
          return next();
        }

        if (isPageRequest(req) && !req.authUser) {
          const nextPath = encodeURIComponent(req.originalUrl || "/index.html");
          return res.redirect(`/login.html?next=${nextPath}`);
        }

        return next();
      });
      app.use(express.static(publicDir));

      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api/")) {
          return next(new AppError(404, "API_NOT_FOUND", "API route not found"));
        }
        if (!req.authUser) {
          const nextPath = encodeURIComponent(req.originalUrl || "/index.html");
          return res.redirect(`/login.html?next=${nextPath}`);
        }
        return res.sendFile(path.join(publicDir, "index.html"));
      });
    }
  } else {
    app.get("/", (_req, res) => {
      res.json({
        data: {
          service: "work-schedule-api",
          mode: "api-only",
        },
      });
    });

    app.use((req, _res, next) => {
      if (req.path.startsWith("/api/")) {
        return next(new AppError(404, "API_NOT_FOUND", "API route not found"));
      }
      return next(new AppError(404, "RESOURCE_NOT_FOUND", "Resource not found"));
    });
  }

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    const code = error.code || "INTERNAL_ERROR";
    const message = error.message || "Internal server error";
    const details = error.details || null;

    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(error);
    }

    res.status(status).json({
      error: {
        code,
        message,
        details,
      },
    });
  });

  return app;
}

module.exports = {
  createApp,
  fetchLatestTag,
  buildUpdateZipUrls,
  resolveUpdateSourceDir,
  parseStatRangeQuery,
  compareVersionsDesc,
  newestTag,
};
