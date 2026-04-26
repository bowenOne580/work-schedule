const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const AUTH_COOKIE = "work_schedule_auth";
const SESSION_HOURS = 12;
const DEFAULT_AUTH_CONFIG_PATH = path.join(__dirname, "..", "config", "auth.json");
const SCRYPT_KEY_LENGTH = 64;

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEY_LENGTH).toString("base64url");
  return {
    algorithm: "scrypt",
    salt,
    hash,
  };
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || passwordHash.algorithm !== "scrypt" || !passwordHash.salt || !passwordHash.hash) {
    return false;
  }
  const next = hashPassword(password, passwordHash.salt);
  return safeEqual(next.hash, passwordHash.hash);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeAuthConfig(raw, source) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid auth config in ${source}`);
  }

  if (!raw.username || typeof raw.username !== "string") {
    throw new Error(`Auth config ${source} must include username`);
  }

  if (!raw.passwordHash) {
    throw new Error(`Auth config ${source} must include passwordHash`);
  }

  if (!raw.sessionSecret || typeof raw.sessionSecret !== "string") {
    throw new Error(`Auth config ${source} must include sessionSecret`);
  }

  const rememberDays = Number(raw.rememberDays || 30);

  return {
    username: raw.username,
    passwordHash: raw.passwordHash,
    secret: raw.sessionSecret,
    rememberDays: Number.isFinite(rememberDays) && rememberDays > 0 ? rememberDays : 30,
    secureCookie: Boolean(raw.cookieSecure),
    source,
  };
}

function getAuthConfig(configPath = process.env.WORK_SCHEDULE_AUTH_CONFIG || DEFAULT_AUTH_CONFIG_PATH) {
  if (fs.existsSync(configPath)) {
    return normalizeAuthConfig(readJsonFile(configPath), configPath);
  }

  throw new Error(
    `Auth config not found. Run "npm run auth:init" to create ${path.relative(process.cwd(), configPath)}.`,
  );
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createAuthToken(username, maxAgeSeconds, secret) {
  const payload = Buffer.from(
    JSON.stringify({
      u: username,
      exp: Date.now() + maxAgeSeconds * 1000,
    }),
  ).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

function verifyAuthToken(token, config) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payload, signature] = token.split(".");
  const expected = signPayload(payload, config.secret);
  if (!safeEqual(signature, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.u !== config.username || !Number.isFinite(parsed.exp) || parsed.exp < Date.now()) {
      return null;
    }
    return {
      username: parsed.u,
    };
  } catch {
    return null;
  }
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAgeSeconds) {
    parts.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function clearCookie(name, secure) {
  return [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", secure ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");
}

module.exports = {
  AUTH_COOKIE,
  DEFAULT_AUTH_CONFIG_PATH,
  SESSION_HOURS,
  buildCookie,
  clearCookie,
  createAuthToken,
  getAuthConfig,
  hashPassword,
  safeEqual,
  verifyAuthToken,
  verifyPassword,
};
