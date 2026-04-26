#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { DEFAULT_AUTH_CONFIG_PATH, hashPassword } = require("../src/auth");

function randomCredential(bytes = 12) {
  return crypto.randomBytes(bytes).toString("base64url");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const configPath = process.env.WORK_SCHEDULE_AUTH_CONFIG || DEFAULT_AUTH_CONFIG_PATH;
  const relativePath = path.relative(process.cwd(), configPath);

  if (await exists(configPath)) {
    const rl = readline.createInterface({ input, output });
    const answer = (await rl.question(`${relativePath} 已存在，是否覆盖？输入 yes 确认: `)).trim();
    rl.close();
    if (answer !== "yes") {
      console.log("已取消。");
      return;
    }
  }

  const rl = readline.createInterface({ input, output });
  const usernameInput = (await rl.question("用户名（留空随机生成）: ")).trim();
  const passwordInput = (await rl.question("密码（留空随机生成）: ")).trim();
  const rememberInput = (await rl.question("自动登录有效天数（默认 30）: ")).trim();
  const secureInput = (await rl.question("是否仅允许 HTTPS Cookie？输入 yes 启用（默认 no）: ")).trim();
  rl.close();

  const username = usernameInput || `user_${randomCredential(6)}`;
  const password = passwordInput || randomCredential(18);
  const rememberDays = Number(rememberInput || 30);
  const cookieSecure = secureInput.toLowerCase() === "yes";

  const config = {
    username,
    passwordHash: hashPassword(password),
    sessionSecret: crypto.randomBytes(32).toString("base64url"),
    rememberDays: Number.isFinite(rememberDays) && rememberDays > 0 ? rememberDays : 30,
    cookieSecure,
  };

  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(configPath, 0o600);

  console.log("");
  console.log(`认证配置已写入: ${relativePath}`);
  console.log("请保存以下登录凭据，密码不会再次以明文显示：");
  console.log(`用户名: ${username}`);
  console.log(`密码: ${password}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
