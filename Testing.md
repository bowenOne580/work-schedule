# 测试说明

## 测试账号

所有测试（浏览器端到端测试、接口测试、手动验证）统一使用以下账号：

- **用户名**：`demo_user`
- **密码**：`123456`

## 约定

1. 测试前先确认该账号已初始化（即 `config/auth.json` 存在且用户名为 `demo_user`）；若不存在，参考下方命令重新初始化。
2. 测试数据尽量使用带 `test_` 前缀的任务（如 `test_no_time`），便于与真实数据区分，测试完成后可删除。
3. 涉及登录态的自动化测试（如 Playwright）应通过登录页使用该账号登录，或在测试脚本中用 `config/auth.json` 的 `sessionSecret` 生成会话 Cookie。

## 重新初始化测试账号

```bash
npm run auth:init
# 按提示输入 demo_user / 123456
```

## 前端访问入口

- 本地开发：`http://localhost:5173`（后端 API：`http://localhost:8998`）
