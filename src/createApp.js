const path = require("node:path");
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
    asyncRoute(async () => {
      return service.getStatisticsOverview();
    }),
  );

  app.post("/api/system/stop", (_req, res) => {
    res.json({ data: { message: "Server is stopping" } });

    setTimeout(() => {
      process.exit(0);
    }, 200);
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
};
