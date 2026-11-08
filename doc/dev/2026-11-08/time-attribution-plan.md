# 计时用时按日归属方案（timeSessions 轮次记录）

> 状态：已于 2026-11-08 评审定稿并实施。创建于 2026-11-08。

## 1. 背景与目标

用户反馈：首页“今日用时”与统计页的时间归属不合直觉——**只有在任务完成时，用时才会一次性记入“完成当天”**，跨天学习的时间被整体搬到完成日；暂停中的任务已记录的时间则完全不进日/周统计。

2026-11-08 已用可控时钟 + 临时数据目录复现（未触碰真实数据）：

场景 A（跨天）：昨天 22:00 开始 → 23:00 暂停（60 分钟真实发生在昨天）→ 今天 01:00 继续 → 01:30 完成（30 分钟在今天），累计 90 分钟。

```
快照 dateKey=2026-11-08  dailyMinutes=90
dailyHistory = … 2026-11-07:0 , 2026-11-08:90
范围统计 rangeStart=2026-11-02 rangeEnd=2026-11-08 rangeMinutes=90
```

场景 B（暂停中）：今天 09:00 开始，10:00 暂停，未完成。

```
任务 actualMinutes=60  status=paused
快照 dailyMinutes=0  weeklyMinutes=0
dailyHistory = … 2026-11-07:0 , 2026-11-08:0
分类占比 = { cat-general: { actual: 60, ... } }
```

目标：

1. 用时记录到**实际发生的那一天**，跨午夜按天拆分。
2. 暂停中/进行中的任务已产生的用时进入日/周统计，不再等到完成才入账。
3. 不改变“完成数、完成率、准时率、超时比”的既有口径（见 4.5）。
4. 旧数据不丢失、可导入导出、刷新与重启后行为一致。

> 口径来源说明：`doc/dev/2026-08-28/stats-range-filter-plan.md` 第 4.2 节曾定稿“用时按完成日归账……改变需要按暂停记录做时间分摊，是另一个量级的需求，明确不做”。本方案即为该搁置需求的重新开启，属于**口径变更**而非缺陷修补，需明确评审后再实施。

## 2. 现状梳理：计时与统计链路

### 2.1 数据层没有“轮次”概念

`src/services/schedulerService.js:113` 的 `#settleTimer`：

```js
#settleTimer(task) {
  if (!task.timerStartedAt) return;
  task.accumulatedMs += Math.max(0, this.now() - new Date(task.timerStartedAt).getTime());
  task.timerStartedAt = null;
}
```

暂停、推迟、完成，以及检查点全部完成触发的自动完成（`276` / `296` / `1112` 行）都走它。任务对象只保存 `accumulatedMs`（历史累计总额）与 `timerStartedAt`（当前轮起点），**没有记录任何一轮的起止时刻**。经探针检查，任务字段中不存在 session / round / segment 类字段。这意味着“昨天 60 分钟 + 今天 30 分钟”的拆分信息在暂停那一刻已经不可恢复。

### 2.2 统计只认已完成任务、整块归完成日

- 快照口径 `#computeStatistics`（`1190` 行起）：`const actual = task.actualMinutes` 是累计总额；只有在 `status === DONE` 分支内才执行 `historyMap[localDateKey(finishedAt)] += actual`、`dailyMinutes += actual`、`weeklyMinutes += actual`。未完成任务的用时**不进入**日/周与趋势，却会进入 `categoryTimeShare.actual` 和 `totalActualMinutes`（循环外无条件累加），造成“分类对比”与“今日用时”口径不一致。
- 范围口径 `#computeRangedStatistics`（`1353` 行）：`if (task.status !== TASK_STATUS.DONE) continue;`，之后 `todayMinutes`、`rangeMinutes`、`historyMap[dayKey]` 同样整块归 `finishedAt`。
- `finishedAt` 缺失时回退 `updatedAt`；迁移逻辑在 `887` 行为历史已完成任务补 `finishedAt = updatedAt`。

### 2.3 前端只做展示

`frontend/src/pages/DashboardPage.tsx` 的“今日摘要”直接读 `statsApi.overview()` 的 `dailyMinutes` / `weeklyMinutes` / `dailyDoneCount`；`StatsPage.tsx` 的六张卡与三张图同样来自该响应。`useTaskMinutes` 只负责任务卡片上的实时累计显示，不参与统计。**所以问题全在后端口径。**

### 2.4 测试现状

`scripts/timingTests.js` 用 `withFixture` 注入可控 `now`，能测累计毫秒；`scripts/logicTests.js:172` 注释指出“服务层无法构造过去的 createdAt / finishedAt”，只能回填 `tasks.json` 造历史日期。原因是 `#computeStatistics` / `#computeRangedStatistics` / `#resolveStatRangeWindow` 内部使用 `new Date()`（真实时间），未使用注入的 `this.now`。本方案需顺手修掉这点，否则无法用可控时钟验证跨天归属。

## 3. 问题定义

| 编号 | 现象 | 根因 |
| --- | --- | --- |
| P-1 | 跨天学习的用时全部落在完成日 | 累计值无时间分布信息（2.1） |
| P-2 | 暂停中的任务今日用时为 0 | 统计只遍历 DONE（2.2） |
| P-3 | 同一数据在“分类对比”与“今日用时”口径不一致 | 分类占比无条件累加，日/周只在 DONE 分支累加 |
| P-4 | 统计逻辑无法用可控时钟测试，跨天回归没有自动化保护 | 统计内部写死 `new Date()` |

## 4. 核心决策点（4.1–4.3 已确认，4.4–4.6 见评审状态）

### 4.1 跨午夜轮次如何切分

| 选项 | 说明 | 影响 |
| --- | --- | --- |
| A. 按本地日期拆分（推荐） | 22:00–01:00 拆为昨天 120 分钟 + 今天 60 分钟 | 符合“哪天花的时间算哪天”的直觉；需要与 `localDateKey` 一致的切分函数 |
| B. 整段归结束日 | 一轮落在完成/暂停那一刻的日期 | 实现最简，但用户抱怨的正是这种“搬家” |

**已确认（2026-11-08）：采用 A，按本地日期拆分。** “一天”的边界统一用 `startOfLocalDay` / `localDateKey`（服务器本地时区，与现有 `finishedAt` 判定一致）。

### 4.2 未完成任务的用时是否计入日/周

**已确认（2026-11-08）：计入。** 规则：已结算的每一段按 4.1 归属，不再要求 `status === DONE`。

副作用：历史完成任务的数字会与过去看到的不同（旧数据走 4.4 兜底，见风险）。`weeklyDoneCount`、`dailyDoneCount`、完成率、准时率、超时比仍只看 DONE，不受影响。

### 4.3 进行中的当前未结算轮是否实时计入

**已确认（2026-11-08）：不做实时叠加，只在暂停、推迟、完成（含检查点全部完成触发的自动完成）结算时入账。**

取舍说明：当前轮 `now - timerStartedAt` 不进入任何统计。任务开始后一直不暂停时，首页“今日用时”在结算前保持不变，暂停或完成的那一刻才把整轮计入。好处是统计快照只在写操作后变化，`#prepareState` 不会因为时间流逝而每秒触发 `statisticsCache` 写盘。

不受影响的部分：任务卡片与详情页的实时计时显示仍由 `useTaskMinutes` 按秒刷新，只是不进入日/周统计。

### 4.4 历史数据兜底口径

无法反推历史的真实分布。推荐：无 `timeSessions` 的任务，其 `accumulatedMs` 作为**单条伪 session** 归到 `finishedAt`（无则 `updatedAt`）当天，即沿用旧口径。旧任务数字不变，新数据走新口径，混合存在。

不推荐用 `updatedAt` / `createdAt` 插值分摊——会把不可验证的估算写进历史。

### 4.5 不改变的口径

完成数、完成率（按 `createdAt` 入组）、准时率、平均超时比、优先级完成分布，全部仍按 `finishedAt` 判定。只有“用时类”指标（今日用时、本周用时、范围内用时、每日趋势、分类用时对比）改按发生日归属。

### 4.6 存储粒度

| 选项 | 说明 | 体积 |
| --- | --- | --- |
| A. 原始轮次 `timeSessions`（推荐） | `[{ startAt, endAt, ms }]`，保留可回显、可再切分的能力 | 每段约 110 字节；每天 1–10 段 |
| B. 按日聚合 `dailyMs` | `{ "2026-11-07": 3600000 }` | 最小，但丢失时段信息，将来做时间轴需再次改结构 |

**已确认（2026-11-08）：采用 A，原始轮次。** 两者是同一件事的两种“记账本”。假设昨天 22:00–23:00 学了一小时，今天 01:00–01:30 又学了半小时：

**A. 原始轮次**：记下每一轮的起止时刻。

```json
"timeSessions": [
  { "startAt": "2026-11-07T14:00:00.000Z", "endAt": "2026-11-07T15:00:00.000Z", "ms": 3600000 },
  { "startAt": "2026-11-08T17:00:00.000Z", "endAt": "2026-11-08T17:30:00.000Z", "ms": 1800000 }
]
```

能回答“昨天几点到几点在学”，将来做时间轴、按任意规则重新归属都还有原料。

**B. 按日聚合**：只记每天的总数。

```json
"dailyMs": { "2026-11-07": 3600000, "2026-11-08": 1800000 }
```

只知道昨天共 1 小时、今天共 30 分钟，**不知道具体几点学的**。这个损失不可逆：一旦只存每日总数，将来想回显时段只能从零开始重新记录。

体积差别：A 每段约 110 字节，一天 3 段、一年约 120 KB；B 每天约 20 字节、一年约 7 KB。对单用户 JSON 存储两者都可忽略。

推荐 A：多花一点空间，换“以后还能改主意”的余地。

## 5. 数据结构设计

### 5.1 新增字段

```json
{
  "accumulatedMs": 5400000,
  "timerStartedAt": null,
  "timeSessions": [
    { "startAt": "2026-11-07T14:00:00.000Z", "endAt": "2026-11-07T15:00:00.000Z", "ms": 3600000 },
    { "startAt": "2026-11-08T17:00:00.000Z", "endAt": "2026-11-08T17:30:00.000Z", "ms": 1800000 }
  ]
}
```

- `startAt` / `endAt` 用 `toISOString()`（UTC），与现有 `timerStartedAt`、`finishedAt` 一致；展示与归属计算时转服务器本地时区。
- `ms` 显式保存，而不是用 `endAt - startAt` 派生：系统时钟回拨时 `#settleTimer` 会把时长 clamp 为 0，派生值可能与累加值不一致。
- **不物理拆分跨午夜段**：存储保留原始轮次，统计时按本地日切分。这样切分规则（4.1）将来可调整，且不必为跨天轮次写多条记录。

### 5.2 不变量

对新数据：`accumulatedMs === Σ timeSessions[i].ms`（进行中时再加未结算的当前轮）。

历史数据不满足该不变量（没有 sessions），由 5.3 的兜底分支处理，不做自动回填。

### 5.3 归属计算

新增私有方法 `#attributeSessions(task)`，返回 `Map<dateKey, ms>`：

1. 有 `timeSessions`：逐段用 `[max(startAt, 当日 00:00), min(endAt, 次日 00:00))` 求交，交集按 `localDateKey` 累加。
2. 无 `timeSessions`：若 `accumulatedMs > 0`，生成单条 `{ localDateKey(finishedAt || updatedAt): accumulatedMs }`。
3. `timerStartedAt != null` 的未结算轮：**不进入统计**（见 4.3）。

### 5.4 时间单位：现状与“按秒保存”

**现状是毫秒，不是分钟。** 存储中有两个相关字段：

| 字段 | 单位 | 性质 |
| --- | --- | --- |
| `accumulatedMs` | 毫秒（整数） | 真值，每次结算执行 `+= now - timerStartedAt` |
| `actualMinutes` | 分钟（可含小数） | 派生值 `accumulatedMs / 60000`，供接口与统计读取 |

举例：一轮 20.123 秒 → `accumulatedMs = 20123`，`actualMinutes = 0.33538333…`。前端 `fmtMinutes` 把它换算成秒并显示为 `20s`，所以界面上看不到小数，但落盘数据是精确到毫秒的。

“按秒保存”的三种做法：

| 选项 | 做法 | 代价 |
| --- | --- | --- |
| A. 毫秒存储 + 秒级输出（推荐） | 保留 `accumulatedMs` 与 `timeSessions[].ms` 的精确值，新增 `actualSeconds`（整数秒，四舍五入）供展示与接口使用 | 无精度损失，多一个字段 |
| B. 改为秒存储 | 用 `accumulatedSeconds` 整数替代毫秒，每轮结算 `Math.round(ms / 1000)` | 每次结算最多 0.5 秒误差，多次短轮次会累积漂移；需迁移导出格式、Agent schema、前端类型与测试 |
| C. 维持现状 | 毫秒存储，前端继续按秒显示 | 不改动，但 `actualMinutes` 的长小数在接口与 Agent 响应中可见 |

判断标准：若“按秒”指的是**界面以秒为单位、不要小数分钟**，现状已经满足；若有接口或 Agent 在读 `actualMinutes`，那些长小数需要 A 来规整。B 只有在“秒是唯一且必须落盘的精度”时才值得付出迁移成本。

**已确认（2026-11-08）：采用 C，维持现状。** 内部继续以毫秒保存（`accumulatedMs` 与 `timeSessions[].ms`），`actualMinutes` 保持派生语义，不新增 `actualSeconds`，接口与 Agent 响应字段不变；界面继续由 `fmtMinutes` 换算成秒显示。上面三种做法保留为背景，供日后需要“接口也不出现长小数”时参考。

## 6. 后端改造

### 6.1 `#settleTimer` 记录轮次

```js
#settleTimer(task) {
  if (!task.timerStartedAt) return;
  const startMs = new Date(task.timerStartedAt).getTime();
  const endMs = this.now();
  const ms = Math.max(0, endMs - startMs);
  if (!Array.isArray(task.timeSessions)) task.timeSessions = [];
  if (ms > 0) {
    task.timeSessions.push({
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      ms,
    });
  }
  task.accumulatedMs += ms;
  task.timerStartedAt = null;
}
```

`ms === 0`（时钟回拨或瞬间切换）不写空段，保证不变量成立。私有 `#nowIso()` 仍用于 `updatedAt` / `finishedAt`，两者语义不同，不合并。

### 6.2 统计改造：快照口径

`#computeStatistics`：

- 移除“日/周累计必须在 DONE 分支内”的结构，改为对每个任务调用 `#attributeSessions(task)`，把落在 `[todayStart, tomorrowStart)` 与 `[weekStart, nextWeekStart)` 的份额分别累加到 `dailyMinutes` / `weeklyMinutes`。
- `dailyHistory` 的 7 天窗口同样从归属 Map 取值。
- `categoryTimeShare` 的 `actual` 改为按归属 Map 全量求和（与 `dailyMinutes` 同源），修复 P-3；`share` 分母 `totalActualMinutes` 同步改为同一来源。
- `dailyDoneCount` / `weeklyDoneCount` / 完成率 / 准时率 / 超时比 / `doneByPriority` 的实现不变。

### 6.3 统计改造：范围口径

`#computeRangedStatistics`：

- 删除 `if (task.status !== TASK_STATUS.DONE) continue;` 对用时部分的门控：用时与趋势按归属 Map 落入窗口；`rangeDoneCount`、准时率、超时比、`doneByPriority` 仍只统计 DONE。
- `todayMinutes` 同样按归属计算（不受窗口限制）。
- `earliestFinish`（“全部”趋势起点）：取 `min(已完成任务的 finishedAt, 最早 session 日期)`。原因：4.2 已让未完成任务的用时进入范围合计，若趋势起点仍只看完成记录，趋势首段会缺数据，导致“范围内用时”与趋势图对不上。
- 完成率分母仍按 `createdAt`。

### 6.4 注入时钟

`#computeStatistics`、`#computeRangedStatistics`、`#resolveStatRangeWindow` 内的 `new Date()` 改为 `new Date(this.now())`。生产行为等价（`now` 默认 `Date.now`），换来实现可用可控时钟做跨天测试（修复 P-4）。

### 6.5 迁移与写入保护

- `#normalizeTask`（`880` 行附近）：`if (!Array.isArray(task.timeSessions)) { task.timeSessions = []; changed = true; }`。不填充伪 session，历史兜底留在读取层。
- `#rejectManualTime` 的字段列表加入 `timeSessions`，防止通过 PATCH 手填轮次。
- `#validateImportedData`：`timeSessions` 若存在必须是数组；每段 `startAt` / `endAt` 可解析为时间、`ms` 为非负有限数；缺失时等价于空数组。
- `exportAllData` 无需改动，`tasks` 原样导出即可带上新字段。

## 7. 前端改造

**不需要改动。** 已确认不做实时叠加（见 4.3），`StatisticsOverview` 字段名与语义保持“用时类字段 = 按发生日归属”，`frontend/src/types/index.ts`、`DashboardPage.tsx`、`StatsPage.tsx` 均无需变更。

唯一可见变化：首页“今日用时”在任务暂停或完成后才更新，与“只在结算时叠加”的决定一致。

## 8. 兼容与迁移

| 场景 | 行为 |
| --- | --- |
| 旧任务（无 `timeSessions`） | 走 5.3 兜底，数字与改造前一致 |
| 新任务 | 新口径；`accumulatedMs` 与 sessions 同步增长 |
| 导出 → 导入 | 新字段随 `tasks` 一起往返；`#normalizeTask` 兼容缺失字段 |
| 用新导出文件导入旧版本 | 旧版本忽略未知字段，`accumulatedMs` 仍正确，统计退回完成日口径，不丢数据 |
| 备份 / 回滚 | `jsonStorage` 整文件替换，无需改动 |
| 降级 | 不丢数据，只丢归属精度 |

## 9. 改动清单

| 文件 | 动作 |
| --- | --- |
| `src/services/schedulerService.js` | 改：`#settleTimer` 记录轮次；新增 `#attributeSessions`；改 `#computeStatistics`、`#computeRangedStatistics`；改 `#normalizeTask`、`#rejectManualTime`、`#validateImportedData`；统计时钟改用 `this.now` |
| `scripts/timingTests.js` | 改：新增跨天轮次、跨午夜切分、暂停未完成、历史兜底与不变量用例 |
| `scripts/logicTests.js` | 改：口径注释同步；保留无 sessions 的历史回归 |
| `scripts/e2e/test_dashboard_complete.py` | 改：范围合计断言纳入未完成任务的已结算用时 |
| `Testing.md` | 改：补充跨天归属测试覆盖 |
| `README.md` | 改：自动计时段落补充“用时按实际发生日归属” |
| `doc/dev/2026-11-08/` 本文档 | 新增 |

## 10. 验收标准

1. **跨天**：昨天 22:00–23:00 暂停、今天 01:00–01:30 完成 → 快照 `dailyHistory` 昨天 60、今天 30；`dailyMinutes = 30`；`weeklyMinutes` 视周边界为 90 或 30；范围 `week` / `month` / `all` 的 `dailyHistory` 一致，`rangeMinutes = 90`。
2. **暂停中**：今天 09:00–10:00 暂停 → `dailyMinutes = 60`；`categoryTimeShare` 与之同源。
3. **跨午夜拆段**：23:30–00:30 一轮 → 两天各 30 分钟。
4. **历史回归**：无 `timeSessions` 的旧已完成任务，统计数字与改造前逐字段一致。
5. **不变量**：新数据 `accumulatedMs === Σ timeSessions.ms`；重启、刷新后不变。
6. **接口不变**：默认快照与带 `range` 的响应字段名、字段类型不变。
7. **测试**：`npm run test:timing`、`npm run test:logic`、`npm run test:schedule`、`npm run test:agent` 全绿；`cd frontend && npx tsc -b && npm run lint && npm run build` 通过。
8. **往返**：导出再导入后统计数字不变。
9. **进行中不计入**：任务开始后未暂停/未完成时 `dailyMinutes` 保持不变；暂停或完成的那一刻起该轮计入。

## 11. 风险与开放问题

### 11.1 风险

1. **可见口径变更**：同一批历史数据在升级后可能显示不同数字（仅新数据变化，旧数据兜底不变），需在发布说明中写明。
2. **服务器时区**：归属依赖进程本地时区，换时区会导致归属漂移。这是既有问题（`finishedAt` 判定同样如此），本次不解决，文档注明“截止日期与用时均采用服务器时区”。
3. **数据体积**：sessions 长期增长；单任务数百段时可考虑按日压缩，暂不实现。
4. **一致性缺口**：外部导入或手工编辑可能使 sessions 与 `accumulatedMs` 不一致。约定：展示用 `accumulatedMs`，归属用 sessions，偏差只影响统计；不自动修复。
5. **进行中不计入**：任务未结算前今日用时不变，这是 4.3 决定的直接后果；若日后反悔，只需在前端叠加当前轮，已存数据无需改动。

### 11.2 评审状态

已确认（2026-11-08），可作为实施依据：

1. 4.1 跨午夜：按本地日期拆分。
2. 4.2 未完成任务的用时：计入日/周。
3. 4.3 实时叠加：不做，只在暂停、推迟、完成结算时入账。
4. 4.6 存储粒度：原始轮次 `timeSessions`。
5. 5.4 时间单位：维持现状（毫秒存储、`actualMinutes` 派生、前端按秒显示）。
6. 6.3 “全部”范围趋势起点：取 `min(finishedAt, 最早 session 日期)`。

无待确认项。不在本方案范围（后续需求）：检查点级用时归属（检查点目前只有 `actualMinutes`，无轮次）。