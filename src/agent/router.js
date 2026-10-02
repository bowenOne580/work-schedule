const express = require("express");
const { AppError } = require("../errors");
const { safeEqual, verifyPassword } = require("../auth");
const { AgentService } = require("../services/agentService");
const { digest } = require("./identity");
const { validateInput } = require("./schema");
const { AGENT_TOKEN_TTL_SECONDS, createAgentToken, verifyAgentToken, createLoginLimiter } = require("./auth");
const openapi = require("./openapi");

function endpoint(work) {
  return async (req, res, next) => {
    try {
      const item = await work(req, res);
      if (item?.revision) res.setHeader("ETag", `"${item.revision}"`);
      res.json({ data: item });
    } catch (error) { next(error); }
  };
}

function requestIdentity(req) {
  const key = req.headers["idempotency-key"];
  if (key === undefined) return null;
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
    throw new AppError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 必须为 1 至 128 个字母、数字或 . _ : -");
  }
  return {
    keyDigest: digest([req.agentUser.username, req.method, req.baseUrl + req.path, key]),
    bodyDigest: digest(req.body),
  };
}

function expectedRevision(req) {
  const value = req.headers["if-match"];
  if (value === undefined) throw new AppError(428, "PRECONDITION_REQUIRED", "修改前请读取资源，并通过 If-Match 提交带双引号的 revision");
  if (typeof value !== "string" || !/^"[a-f0-9]{64}"$/.test(value)) {
    throw new AppError(400, "INVALID_REVISION", "If-Match 必须为带双引号的资源 revision");
  }
  return value.slice(1, -1);
}

function createdResponse(res, result) {
  res.status(result.replayed ? 200 : 201);
  res.setHeader("Idempotency-Replayed", String(result.replayed));
  return result.item;
}

function createAgentRouter(scheduler, { authConfig, now } = {}) {
  const router = express.Router();
  const service = new AgentService(scheduler);
  const limiter = createLoginLimiter({ now });
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/openapi.json", (_req, res) => res.json(openapi));

  router.post("/auth/login", endpoint(async (req, res) => {
    const retryAfter = limiter.retryAfter(req.ip);
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter));
      throw new AppError(429, "LOGIN_RATE_LIMITED", "登录失败次数过多，请稍后重试");
    }
    validateInput("Login", req.body);
    const { username, password } = req.body;
    // 无论用户名是否匹配都执行密码验证，返回相同的凭据错误。
    const usernameValid = safeEqual(username, authConfig.username);
    const passwordValid = verifyPassword(password, authConfig.passwordHash);
    if (!usernameValid || !passwordValid) {
      limiter.failed(req.ip);
      throw new AppError(401, "INVALID_CREDENTIALS", "账号或密码错误");
    }
    limiter.succeeded(req.ip);
    return {
      access_token: createAgentToken(username, authConfig),
      token_type: "Bearer",
      expires_in: AGENT_TOKEN_TTL_SECONDS,
    };
  }));

  router.use((req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9._-]+)$/i.exec(req.headers.authorization || "");
    req.agentUser = match && verifyAgentToken(match[1], authConfig);
    if (!req.agentUser) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="work-schedule-agent"');
      return next(new AppError(401, "AUTH_REQUIRED", "需要有效的 Agent Bearer Token"));
    }
    next();
  });

  router.get("/context", endpoint(() => service.getContext()));
  router.get("/tasks", endpoint((req) => {
    validateInput("TaskFilters", req.query, "query");
    if (req.query.deadlineFrom && req.query.deadlineTo && req.query.deadlineFrom > req.query.deadlineTo) {
      throw new AppError(400, "VALIDATION_ERROR", "deadlineFrom 不能晚于 deadlineTo", { field: "query.deadlineFrom" });
    }
    return service.getTasks(req.query);
  }));
  router.get("/tasks/:id", endpoint((req) => service.getTask(req.params.id)));
  router.post("/tasks", endpoint(async (req, res) => {
    validateInput("TaskCreate", req.body);
    return createdResponse(res, await service.createTask(req.body, requestIdentity(req)));
  }));
  router.patch("/tasks/:id", endpoint((req) => {
    validateInput("TaskPatch", req.body);
    return service.updateTask(req.params.id, req.body, expectedRevision(req));
  }));
  router.post("/tasks/:id/checkpoints", endpoint(async (req, res) => {
    validateInput("CheckpointCreate", req.body);
    return createdResponse(res, await service.createCheckpoint(req.params.id, req.body, requestIdentity(req)));
  }));
  router.get("/checkpoints/:id", endpoint((req) => service.getCheckpoint(req.params.id)));
  router.patch("/checkpoints/:id", endpoint((req) => {
    validateInput("CheckpointPatch", req.body);
    return service.updateCheckpoint(req.params.id, req.body, expectedRevision(req));
  }));
  router.get("/categories", endpoint(() => service.getCategories()));
  router.post("/categories", endpoint(async (req, res) => {
    validateInput("CategoryCreate", req.body);
    return createdResponse(res, await service.createCategory(req.body, requestIdentity(req)));
  }));
  router.use((_req, _res, next) => next(new AppError(404, "AGENT_ROUTE_NOT_FOUND", "Agent 接口不存在或不支持此操作")));
  return router;
}

module.exports = { createAgentRouter };
