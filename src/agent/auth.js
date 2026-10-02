const crypto = require("node:crypto");
const { createAuthToken, verifyAuthToken } = require("../auth");

const AGENT_TOKEN_TTL_SECONDS = 3600;

function agentSecret(secret) {
  return crypto.createHmac("sha256", secret).update("work-schedule/agent/v1").digest("hex");
}

function createAgentToken(username, config, ttlSeconds = AGENT_TOKEN_TTL_SECONDS) {
  return `agent-v1.${createAuthToken(username, ttlSeconds, agentSecret(config.secret))}`;
}

function verifyAgentToken(token, config) {
  if (typeof token !== "string" || !/^agent-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  return verifyAuthToken(token.slice("agent-v1.".length), { ...config, secret: agentSecret(config.secret) });
}

// 失败窗口按服务观察到的客户端 IP 记录，不信任未经配置的 X-Forwarded-For。
function createLoginLimiter({ now = () => Date.now() } = {}) {
  const failures = new Map();
  const windowMs = 15 * 60 * 1000;
  return {
    retryAfter(ip) {
      const entry = failures.get(ip);
      if (!entry || entry.until <= now()) {
        failures.delete(ip);
        return 0;
      }
      return entry.count >= 5 ? Math.ceil((entry.until - now()) / 1000) : 0;
    },
    failed(ip) {
      for (const [key, entry] of failures) if (entry.until <= now()) failures.delete(key);
      if (!failures.has(ip)) {
        if (failures.size >= 1000) failures.delete(failures.keys().next().value);
        failures.set(ip, { count: 0, until: now() + windowMs });
      }
      failures.get(ip).count += 1;
    },
    succeeded(ip) { failures.delete(ip); },
  };
}

module.exports = { AGENT_TOKEN_TTL_SECONDS, createAgentToken, verifyAgentToken, createLoginLimiter };
