# Problem Review

本文件记录当前代码审查中发现的、可能导致功能异常或业务结果不符合预期的问题。重点只覆盖功能和业务逻辑，不记录单纯代码风格或 UI 风格问题。

状态：以下问题已在当前工作区修复，保留为回归测试和后续复查清单。

## 部署与运行问题

### 1. 生产构建默认 API 地址会指向访问者本机

- 严重程度：高
- 位置：
  - `frontend/src/api/client.ts:1`
  - `frontend/src/pages/SettingsPage.tsx:140`
  - `Usage.md:87-98`
- 现象：前端默认 `VITE_API_BASE` 是 `http://localhost:8998`。如果按文档直接 `npm run build` 并用 Nginx 同域部署，浏览器会请求访问者自己电脑的 `localhost:8998`，而不是服务器上的后端。
- 额外问题：文档示例写 `VITE_API_BASE=https://your-domain.com/api`，但代码调用路径已经包含 `/api/...`，最终会请求 `/api/api/...`。
- 影响：登录、任务列表、统计、导入导出、一键更新等 API 功能在生产环境可能全部不可用。

### 2. 后端托管前端构建产物的方案与 React 路由不匹配

- 严重程度：高
- 位置：
  - `src/createApp.js:492-520`
  - `frontend/src/App.tsx:43-60`
  - `Usage.md:241-245`
- 现象：文档建议将 `frontend/dist` 复制到 `public/`，再设置 `WORK_SCHEDULE_SERVE_STATIC=true`。但后端静态模式仍按旧静态页面跳转 `/login.html`、`/index.html`；React 应用实际路由是 `/login`、`/app`。
- 影响：如果 `public/` 中是 Vite 构建产物，未登录访问会被重定向到不存在的 `/login.html`；如果保留当前 `public/`，托管的是旧页面，不是 README 描述的 React 应用。

### 3. 一键更新检查 tag，但实际下载 main 分支

- 严重程度：中
- 位置：
  - `src/createApp.js:340-353`
  - `src/createApp.js:376-378`
- 现象：版本检查读取 GitHub tags，但更新接口下载的是 `main` 分支 zip。
- 影响：用户以为更新到最新 release/tag，实际可能更新到未发布代码，版本号和代码状态可能不一致。更新后重新构建前端时还会继承第 1 条的 API base 风险。

## 前后端数据一致性问题

### 4. 任务变更后缓存失效不完整

- 严重程度：中高
- 位置：
  - `frontend/src/hooks/useApi.ts:3-23`
  - `frontend/src/components/TaskDetail.tsx:181-184`
  - `frontend/src/pages/DashboardPage.tsx:14-16`
  - `frontend/src/pages/DashboardPage.tsx:91-95`
- 现象：前端查询缓存有 30 秒有效期。任务完成、暂停、检查点变化等操作只失效 `tasks` 或 `task:`，但不失效 `stats`、`recommendations`、`anomalies`。
- 影响：完成任务后，今日摘要、分类推荐、异常列表等可能继续显示旧数据，直到缓存过期或刷新页面。

## 业务逻辑问题

### 5. 推荐算法的优先级方向与前端含义相反

- 严重程度：高
- 位置：
  - `README.md:11`
  - `frontend/src/pages/TasksPage.tsx:107-109`
  - `frontend/src/pages/TasksPage.tsx:219-235`
  - `src/services/schedulerService.js:451-489`
- 现象：前端颜色和排序都体现 P1 更紧急、P5 更低优先级；但后端推荐算法使用 `manualPriority / 5`，并在同分时用更大的 `manualPriority` 靠前。
- 影响：同类别下，P5 任务可能比 P1 任务更容易被推荐，违背“推荐优先级最高任务”的核心需求。
- 已用临时数据验证：同估时、同分类的 P1 和 P5 任务，推荐结果选择了 P5。

### 6. 推荐列表会包含 paused/in_progress，但前端按钮仍按 start 处理

- 严重程度：中高
- 位置：
  - `src/services/schedulerService.js:61-62`
  - `src/services/schedulerService.js:425-428`
  - `src/services/schedulerService.js:210-224`
  - `frontend/src/pages/DashboardPage.tsx:61-83`
- 现象：后端推荐候选包含 `todo`、`in_progress`、`paused`。但仪表盘推荐卡片按钮固定调用 `start`；后端 `start` 只允许从 `todo` 状态转换。
- 影响：如果推荐到暂停任务，点击“开始”会返回 409；如果推荐到进行中任务，则会和“当前进行中”区域重复出现。

### 7. 带检查点的任务，完成时填写的实际用时会被忽略

- 严重程度：高
- 位置：
  - `src/services/schedulerService.js:251-258`
  - `src/services/schedulerService.js:973-976`
  - `frontend/src/components/TaskDetail.tsx:190-193`
- 现象：完成任务时，后端会把 `payload.actualMinutes` 写入 `directMinutes`；但只要任务有检查点，随后重算会把 `actualMinutes` 改成所有检查点实际用时之和。
- 影响：用户在完成任务弹窗输入的实际用时不会进入统计。若检查点没有单独填实际用时，归档和统计中实际用时会显示为 0。
- 已用临时数据验证：带 1 个检查点的任务完成时传入 45 分钟，最终 `actualMinutes` 仍为 0，`directMinutes` 为 45。

### 8. 手动完成带检查点任务后，检查点可能仍未完成且不可再编辑

- 严重程度：中高
- 位置：
  - `src/services/schedulerService.js:980-1026`
  - `frontend/src/components/TaskDetail.tsx:245-246`
  - `frontend/src/components/TaskDetail.tsx:464-537`
- 现象：任务可以被手动标记为 `done`，但未完成的检查点不会自动完成或跳过。完成后的任务在详情页进入只读状态，检查点按钮不再显示。
- 影响：归档任务里可能存在“任务已完成，但检查点仍未完成”的不一致状态，并且用户无法从界面修正检查点状态。

### 9. “跳过检查点”与任务进度/自动完成的含义不一致

- 严重程度：中
- 位置：
  - `src/services/schedulerService.js:390-391`
  - `src/services/schedulerService.js:991-1001`
  - `src/services/schedulerService.js:895-912`
- 现象：剩余时间计算会排除 skipped 检查点，但进度计算只统计 completed 检查点，自动完成也要求所有检查点 completed。
- 影响：当一个任务的剩余检查点都被跳过后，推荐逻辑可能认为剩余时间为 0，但任务进度仍不到 100%，也不会自动完成。用户需要再手动完成任务。
- 已用临时数据验证：两个检查点中一个完成、一个跳过后，任务仍为 `in_progress`，进度为 50%，但已无真正剩余检查点。

### 10. 今日完成数会漏掉实际用时为 0 的已完成任务

- 严重程度：中
- 位置：
  - `src/services/schedulerService.js:1073-1081`
  - `frontend/src/pages/DashboardPage.tsx:145-147`
- 现象：`dailyDoneCount` 只有在 `actual > 0` 时才增加；`weeklyDoneCount` 则不要求 actual 大于 0。
- 影响：用户今天完成了任务但没有填写实际用时，仪表盘“完成任务”可能仍显示 0 个；同一个任务却会计入本周完成数，统计口径不一致。
- 已用临时数据验证：完成一个实际用时为 0 的任务后，`dailyDoneCount=0`，`weeklyDoneCount=1`。

### 11. 今日/本周统计按滚动时间窗口计算，而不是自然日/自然周

- 严重程度：中
- 位置：
  - `src/services/schedulerService.js:1047-1050`
  - `src/services/schedulerService.js:1073-1081`
  - `src/services/schedulerService.js:1127-1143`
- 现象：“今日”使用最近 24 小时，“本周”使用最近 7 天；每日趋势的日期 key 使用 `toISOString()`，即 UTC 日期。
- 影响：例如今天上午查看时，昨晚完成的任务仍会算进“今日”；中国时区凌晨时段的每日趋势可能归到前一天，用户会觉得统计日期不准。

### 12. 逾期标记和手动推迟共用 `postponed` 异常，且不会因新 deadline 自动清除

- 严重程度：中
- 位置：
  - `src/services/schedulerService.js:228-238`
  - `src/services/schedulerService.js:932-956`
  - `frontend/src/pages/AnomaliesPage.tsx:8-14`
- 现象：手动推迟和逾期自动规则都添加 `postponed`。当逾期任务被改到未来日期后，当前逻辑不会自动清除这个 flag。
- 影响：异常页显示“已推迟”无法区分“用户主动推迟”和“任务逾期”；即使已重新安排未来 deadline，任务仍会留在异常列表中，除非手动忽略或完成。

### 13. 导入数据校验不足，可能产生不可见或冲突的数据

- 严重程度：中
- 位置：
  - `src/services/schedulerService.js:626-668`
  - `src/services/schedulerService.js:962-964`
- 现象：导入只校验数组和 id 是否存在，不校验重复 id、检查点的 `taskId` 是否真实存在、分类 id 是否重复、任务分类是否存在。
- 影响：导入后可能出现孤儿检查点、重复任务/检查点 id、任务指向不存在分类等数据。孤儿检查点不会显示在任何任务详情中，但仍会留在存储和导出文件里。

### 14. 检查点完成时无法保存 0 分钟实际用时

- 严重程度：低到中
- 位置：
  - `frontend/src/components/TaskDetail.tsx:63-65`
  - `frontend/src/api/index.ts:30-31`
- 现象：完成弹窗允许输入 `0`，但 `checkpointsApi.complete` 用 truthy 判断 `actualMinutes ? { actualMinutes } : undefined`，数字 0 会被当成未传值。
- 影响：用户无法通过“完成检查点”动作把检查点实际用时记录为 0，也无法用该动作把已有检查点实际用时清零。

## 已执行验证

- `cd frontend && npm run build`：通过。
- `cd frontend && npm run lint`：通过。
- 使用临时 JSON 存储跑了后端服务级场景，确认了优先级推荐方向、带检查点任务实际用时覆盖、跳过检查点后进度/状态不一致、实际用时为 0 时今日完成数漏计等问题。
