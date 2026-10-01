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

## 自动计时验证

- `npm run test:logic`：现有业务回归。
- `npm run test:timing`：可控时钟验证多轮累计、暂停/推迟、最后一轮、毫秒精度、重载、并发重复操作、检查点自动完成、历史数据和认证 API。使用临时数据与临时认证配置。
- `cd frontend && npx tsc -b && npm run lint && npm run build`：类型、代码规范及构建检查。
- 使用 `cd frontend && VITE_API_BASE= npm run build` 同源构建后，在仓库根目录执行 `python3 scripts/e2e/test_dashboard_complete.py`：浏览器验证选填估时、开始/暂停/继续/完成、刷新恢复以及检查点自动完成。脚本启动独立的本地服务，使用临时数据和上述测试账号，并阻止发往其他服务的 API 请求，不读写真实任务或修改当前服务。
