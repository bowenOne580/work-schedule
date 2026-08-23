# 一键更新失败回滚方案

- 日期：2026-08-23
- 状态：已评审，待实现
- 分支：dev
- 关联代码：`src/createApp.js`（update 接口）、`server.js`

## 1. 背景与目标

当前一键更新（`POST /api/system/update`）流程：获取最新 tag → 下载源码 zip → 解压 → tar 覆盖替换项目文件 → `npm install` → 前端构建 → `process.exit(0)` 交给进程管理器拉起。

存在的问题：

1. 文件替换发生在依赖安装与前端构建**之前**。安装/构建失败时，旧进程虽继续在内存中运行，但磁盘上已是新代码；此后任何一次重启都会以"新后端 + 旧/缺失前端构建"的状态启动，需要人工修复。
2. 更新窗口内进程意外死亡（OOM、断电、`kill -9`）时，同样留下半新半旧的磁盘状态，且没有任何检测与恢复机制。
3. 没有回滚到旧版本代码的能力。

目标：

- 安装/构建/冒烟验证失败时，自动回滚到更新前代码，服务不中断或给出明确提示。
- 进程在更新中途死亡时，下次启动自动检测未完成的更新并恢复。
- 回滚只回滚代码，绝不触碰 `data/` 与 `.env`。

非目标：

- 不做"发布目录 + 符号链接切换"的部署布局改造（对单目录轻量部署收益不足）。
- 不做数据格式迁移与数据回滚（由第 9 节的迁移纪律保证兼容性）。

## 2. 失败场景分析

| 阶段 | 失败后果 | 处理策略 |
| --- | --- | --- |
| 获取版本号 / 下载 / 解压 | 仅影响 `/tmp`，项目文件未变 | 维持现状：报错退出，无需回滚 |
| 文件替换之后：npm install / 前端构建 / 冒烟验证 | 磁盘已新、内存旧，重启即"半新半旧" | 进程内自动回滚（第一层） |
| 更新窗口内进程死亡 | 磁盘半新半旧，无进程可执行回滚 | 启动时自愈（第二层） |
| 新版本启动后运行期崩溃 | 服务反复重启失败 | 不在自动回滚范围（可选 systemd `OnFailure` 人工配置，见第 10 节） |

## 3. 方案总览

**快照 + 状态标记 + 两层恢复 + 启动前冒烟验证**：

1. 替换文件前，将当前代码打包快照（排除 `data/`、`node_modules/`、`.env`、`updates/`、`.git`），并写入状态文件 `updates/state.json`（`status=updating`）。
2. 后续任何一步失败 → 解压快照覆盖回去 + 重跑 `npm install` + `status=rolled_back` → 前端提示"已恢复原版本"。
3. 全部步骤成功且冒烟验证通过 → `status=success` → 退出进程。
4. `server.js` 启动最前面检查状态文件：`status=updating` 说明上次进程死于更新中途 → 恢复快照后再启动。

## 4. 目录结构与状态文件

```
updates/
├── backup/
│   └── pre-update-<timestamp>.tar.gz   # 代码快照，保留最近 2 份
└── state.json                          # 更新状态
```

`state.json` 状态机：

| status | 含义 |
| --- | --- |
| `updating` | 更新进行中（进程死亡后由启动自愈识别） |
| `success` | 更新成功完成 |
| `rolled_back` | 更新失败，已回滚（供前端/日志提示） |

字段：`status`、`startedAt`、`fromVersion`、`toTag`、`backup`。

说明：

- 快照必须放在项目目录内（`updates/`），不能放 `/tmp`（重启即清空）。
- `updates/` 需加入 `.gitignore`。
- 保留最近 2 份快照，与 `data/backups` 的滚动策略风格一致。

## 5. 更新流程改造（src/createApp.js）

改造后的步骤（**加粗**处为新增）：

1. 获取最新 tag（现状不变）
2. 下载、解压到 `/tmp`（现状不变）
3. **快照当前代码**：
   ```bash
   tar czf updates/backup/pre-update-<ts>.tar.gz \
     --exclude=data --exclude=node_modules --exclude=.env \
     --exclude=updates --exclude=.git -C <项目目录> .
   ```
   写 `state.json`（`status=updating`），并清理只保留最近 2 份快照。
4. tar 覆盖替换项目文件（现状不变）
5. `npm install`（现状不变）
6. 前端依赖/构建或预构建检测（现状不变）
7. **冒烟验证**：`node scripts/verifyBoot.js`（见第 7 节），30 秒超时。
8. **成功路径**：`state.json` 置 `success` → 清理临时文件 → `done` 事件 → `exit(0)`。
9. **失败路径**（步骤 3 之后任何一步异常）：
   1. `send("rollback", "更新失败，正在回滚到原版本...")`
   2. `tar xzf <快照> -C <项目目录>` 覆盖恢复
   3. 重跑 `npm install`（`node_modules` 不在快照内，需与恢复后的 `package.json` 对齐）
   4. `state.json` 置 `rolled_back`
   5. `send("error", "更新失败，已恢复到原版本：<原因>")`
   6. 服务**不退出**，继续以内存中的旧代码运行

实现细节：

- SSE 事件新增 `step=rollback`，命令输出沿用 `log` 事件流式转发。
- 回滚本身失败（快照损坏等）：如实上报"回滚失败，需手动处理"，不吞异常、不静默。
- 快照/恢复命令失败要有明确错误信息进日志与 SSE。

## 6. 启动自愈（server.js）

`main()` 最前面（创建 `JsonStorage` **之前**）执行：

1. 读取 `updates/state.json`；文件不存在或 `status != updating` → 正常启动。
2. `status == updating` → 上次更新未完成，进程死于更新中途：
   - 解压 `state.backup` 指向的快照覆盖项目目录
   - 重跑 `npm install`
   - `state.json` 置 `rolled_back`
   - 记录日志（供事后排查）
3. 快照缺失或解压失败 → 降级为直接尝试启动（维持现状），日志告警。

自愈逻辑放在独立模块 `src/updateGuard.js`，`server.js` 只做调用，保持入口干净。

## 7. 冒烟验证脚本（scripts/verifyBoot.js）

在标记成功、退出进程之前拦截"装完才发现在启动即崩"的问题：

- `require("../src/createApp")` 并构造 Express 实例（不 `listen`）
- `new JsonStorage(<临时目录>).initialize()` 验证存储层可初始化（**不碰真实 `data/`**）
- 校验 `frontend/dist/index.html` 存在（预构建产物或刚构建的结果）
- 以退出码 0/1 表示通过/失败

## 8. 前端配合（SettingsPage.tsx）

- SSE 新增 `step=rollback` → 更新进度弹窗显示"正在回滚到原版本..."
- 失败提示区分两种：
  - 已回滚：中性/绿色提示"已恢复原版本，服务未中断"
  - 回滚失败：红色提示，需人工处理
- 更新确认弹窗文案补充一行："如更新失败将自动回滚到当前版本"

## 9. 数据与配置保护原则（本方案的关键不变量）

1. **回滚只回滚代码**：`data/` 与 `.env` 永不进快照、永不被回滚触碰。快照仅包含代码。
2. **数据迁移只加字段**：数据格式变更只允许"新增字段 + 默认值"（沿用 `schedulerService` 中 `#ensureTaskDefaults` 的读时补全机制），**禁止重命名/删除旧字段**；确需清理旧字段时，须与下线间隔至少一个发布版本（expand-contract）。该原则保证任意回滚代码后，旧代码始终能读懂数据（`JSON.parse` 忽略多余字段，旧字段全部保留）。
3. `statistics_cache.json` 为派生缓存，随时可删可重算，不参与任何迁移与保护。
4. 例外流程：若未来某次发布必须做破坏性数据迁移，须在迁移执行前由代码自动备份 `data/`，并在更新确认弹窗中明示风险——该流程需单独出方案评审，不在本方案范围内。

## 10. 边界情况

- **overlay 恢复的残留文件**：tar 覆盖解压不会删除"新版新增、旧版没有"的文件，回滚后可能残留少量孤儿文件。旧代码不引用它们，风险可忽略；如需绝对干净，可在快照时附文件清单并在回滚后删除清单外文件（本期不做）。
- **更新期间的用户写入**：旧进程在更新窗口内继续响应 API，写入落在 `data/`，回滚不影响它们。
- **`/tmp` 被清理**：下载/解压仍在 `/tmp`（允许丢失，丢失即失败走回滚）；快照在项目内 `updates/`，不受影响。
- **并发防护**：沿用现有 `updating` 内存标志，`state.json` 仅作持久化状态，不承担并发控制。
- **运行期崩溃（第三类失败）**：应用层无能为力（进程已死）。可在 Usage.md 提供 systemd `OnFailure` 配置示例（触发一个执行恢复脚本的 oneshot unit）作为可选的人工配置项，不写入代码。

## 11. 测试与验收

测试场景：

1. 模拟 `npm install` 失败（PATH 注入假 npm）→ 验证文件被恢复、旧接口仍可用、`state=rolled_back`
2. 模拟前端构建失败 → 同上
3. 模拟冒烟验证失败（注入坏的 dist）→ 同上
4. 在文件替换完成后 `kill -9` 进程 → 重启 → 验证启动自愈完成恢复、服务正常
5. 正常路径回归：成功更新、`state=success`、服务重启后版本为新 tag
6. 数据不变性断言：所有失败场景前后 `data/` 与 `.env` 逐字节一致

验收标准：

- 上述全部场景通过
- 除"进程死亡"场景的重启间隔外，回滚全程服务不中断
- 任何场景下 `data/` 与 `.env` 未被触碰

## 12. 涉及文件与预估工作量

| 文件 | 改动 |
| --- | --- |
| `src/createApp.js` | update 接口：快照、回滚、冒烟验证接入 |
| `src/updateGuard.js` | 新增：启动自愈 |
| `server.js` | `main()` 前置调用 `updateGuard` |
| `scripts/verifyBoot.js` | 新增：启动冒烟验证 |
| `frontend/src/pages/SettingsPage.tsx` | `rollback` 步骤展示、失败文案区分 |
| `.gitignore` | 增加 `updates/` |

预估：后端约 150 行、前端约 30 行，另附测试脚本。
