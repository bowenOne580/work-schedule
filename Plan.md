## 设计对接文档（design.md 内容稿）

### 1. 文档目标
本文件用于与实现人员对接，明确系统边界、业务规则、数据结构、接口契约、异常处理和验收标准，保证开发过程无需反复确认口径。

### 2. 项目范围与边界
- 目标用户：单用户（首版）
- 运行形态：可部署到服务器，通过网页访问
- 数据存储：服务器端 JSON 文件
- 不包含范围：多用户账号体系、大型数据库、复杂云同步

### 3. 业务目标
- 解决学习时间分配不合理
- 解决不知道先做什么任务
- 解决任务过程难跟踪、难复盘

### 4. 核心术语定义
- 任务：可执行学习事项，包含优先级、预计工时、截止日期、状态等
- 检查点：任务内可选步骤节点，用于记录阶段耗时和完成情况
- 分类：任务所属学习领域或主题
- 异常任务：发生超时、暂停中断、检查点跳过、延期等事件的任务

### 5. 功能模块划分
- 任务管理模块：任务增删改查、标签、状态流转、预计工时维护
- 进度追踪模块：检查点创建与完成、耗时记录、任务进度计算
- 推荐模块：首页按分类推荐当前最优先任务
- 统计模块：学习时长、完成率、领域时间占比、按优先级完成分布
- 异常管理模块：异常标记、异常分类归档、异常任务检索
- 存储模块：JSON 文件读写、序列化、并发写入保护、备份

### 6. 系统架构
- 前端层：Web 页面（主页、任务详情、统计页、异常页）
- API 层：提供 REST 风格接口，参数校验、错误码输出
- 服务层：封装任务、推荐、统计、异常业务规则
- 存储层：JSON Repository（统一读写入口，避免业务层直接读文件）

### 7. 数据模型（逻辑字段）
- Task
  - id: string
  - title: string
  - categoryId: string
  - tags: string[]
  - manualPriority: number（建议 1-5，5 最高）
  - estimatedMinutes: number | null
  - deadline: string(ISO) | null
  - status: todo | in_progress | paused | done
  - progress: number（0-100）
  - checkpointIds: string[]
  - actualMinutes: number
  - anomalyFlags: string[]
  - createdAt: string(ISO)
  - updatedAt: string(ISO)
- Checkpoint
  - id: string
  - taskId: string
  - title: string
  - order: number
  - estimatedMinutes: number | null
  - actualMinutes: number
  - completed: boolean
  - skipped: boolean
- Category
  - id: string
  - name: string
  - description: string
  - isAnomalyBucket: boolean
- StatisticsSnapshot
  - dateKey: string
  - dailyMinutes: number
  - weeklyMinutes: number
  - completionRate: number
  - categoryTimeShare: Record<string, number>
  - doneByPriority: Record<string, number>

### 8. 状态机与行为约束
- 状态流转：todo -> in_progress -> paused -> done
- 允许动作
  - todo: start
  - in_progress: pause / complete / postpone
  - paused: resume / complete / postpone
  - done: 仅允许查看与归档，不可回退
- 违规转换处理
  - 返回业务错误码，不修改任何状态
- 到期未完成
  - 自动标记 postponed 异常
  - 自动归入异常分类
  - 截止日期不自动修改

### 9. 推荐算法实现规则
- 评分目标：每个分类选出 1 个推荐任务
- 总分公式
  - score = 0.5 * manualScore + 0.3 * deadlineScore + 0.2 * effortScore
- 维度规则
  - manualScore：按 1-5 归一化
  - deadlineScore：越接近截止日期分数越高；无截止日期按最低优先
  - effortScore：预计工时越短分数越高；无工时用该分类中位值估算
- 同分排序
  - 先比较更早截止日期
  - 再比较更高 manualPriority
  - 再比较更早创建时间
- 异常任务
  - 与普通任务同权参与推荐，不额外降权

### 10. 检查点与进度计算
- 检查点规则：可选，数量不限
- 进度计算建议
  - 有检查点：已完成检查点数 / 检查点总数
  - 无检查点：由手动进度输入或任务耗时映射
- 耗时累积
  - 任务 actualMinutes = 所有检查点 actualMinutes 汇总 + 任务级直接记录耗时
- 跳过检查点
  - checkpoint.skipped = true
  - 任务 anomalyFlags 增加 checkpoint_skipped

### 11. 统计口径定义
- 每日/每周学习总时长：done 与 in_progress、paused 的已记录实际时长按时间窗口聚合
- 任务完成率：done 数 / (todo + in_progress + paused + done)
- 各学习领域时间占比：分类总时长 / 全部分类总时长
- 按优先级完成分布：按 manualPriority 统计 done 任务数量
- 更新策略：每次任务或检查点变更后实时重算（首版）

### 12. API 契约（建议）
- 任务
  - GET /api/tasks
  - POST /api/tasks
  - PATCH /api/tasks/{id}
  - POST /api/tasks/{id}/start
  - POST /api/tasks/{id}/pause
  - POST /api/tasks/{id}/resume
  - POST /api/tasks/{id}/complete
- 检查点
  - POST /api/tasks/{id}/checkpoints
  - PATCH /api/checkpoints/{id}
  - POST /api/checkpoints/{id}/complete
  - POST /api/checkpoints/{id}/skip
- 推荐
  - GET /api/recommendations/by-category
- 统计
  - GET /api/statistics/overview
- 异常
  - GET /api/tasks/anomalies

### 13. JSON 存储与并发策略
- 文件拆分建议
  - data/tasks.json
  - data/checkpoints.json
  - data/categories.json
  - data/statistics_cache.json
- 写入策略
  - 采用写操作串行队列
  - 单次写入流程：读最新 -> 内存修改 -> 写临时文件 -> 原子替换
- 恢复策略
  - 保留最近 N 份备份
  - 启动时校验 JSON 完整性，损坏则回滚最近可用备份

### 14. 前端页面与交互要点
- 主页
  - 展示分类列表
  - 每个分类显示 1 个推荐任务
  - 可一键进入任务详情
- 任务详情页
  - 展示任务基础信息、状态、优先级、截止日期
  - 支持检查点增删改与完成/跳过
  - 实时显示进度与已用时
- 统计页
  - 展示四项核心统计图表
- 异常页
  - 集中展示异常任务及异常类型

### 15. 非功能要求
- 可维护：业务规则集中在服务层，页面不直接写规则
- 可扩展：存储层适配器化，后续可替换 SQLite
- 可测试：推荐算法、状态机、统计函数可独立单测
- 可观测：关键状态转换和异常写入日志

### 16. 验收标准
- 功能验收
  - 可完成任务全生命周期操作
  - 可在首页获得每类推荐任务
  - 可记录检查点并看到进度更新
  - 可查看四项统计结果
  - 异常任务被正确归类且可检索
- 正确性验收
  - 推荐排序符合 50/30/20 规则与缺失值规则
  - 到期未完成自动延期标记并进入异常分类
  - 统计结果与样例手工对账一致
- 稳定性验收
  - 并发写入不出现 JSON 损坏
  - 服务重启后数据可恢复

### 17. 开发顺序建议
- 第 1 阶段：数据模型 + 存储层 + 状态机
- 第 2 阶段：任务与检查点 API + 推荐服务
- 第 3 阶段：统计服务 + 异常管理
- 第 4 阶段：前端页面联调 + 验收测试

---
以下为会话计划原文：

## Plan: 学习任务规划 Web 软件设计

基于 README 与你的确认，本方案聚焦单用户、服务器端 JSON 存储的轻量 Web 应用，先完成信息架构、业务规则、数据模型与交互流程设计，再进入可实现的技术方案与验证清单。优先确保任务规划、分类推荐、检查点计时与统计模块可闭环，避免过早扩展到账号体系或复杂数据库。

**Steps**
1. 锁定需求边界与术语定义：整理目标问题（时间分配、任务选择迷茫、跟踪困难）与关键术语（任务、检查点、分类、暂停、异常分类），形成统一业务语言。*阻塞后续全部步骤*
2. 设计任务生命周期与状态机：确定状态流转为“待办 -> 进行中 -> 暂停 -> 已完成”，补充每个状态允许的动作（开始、暂停、恢复、完成、延期），并定义非法状态转换处理。*depends on 1*
3. 设计优先级评分规则：将“手动优先级 + 预计工时 + 截止日期”转为可计算公式，采用 50/30/20 权重，明确同分排序与缺失字段兜底（无截止日期按最低优先处理；无工时按中位值估算）。*depends on 1；parallel with 2*
4. 设计数据模型与 JSON 持久化结构：定义任务、检查点、分类、统计快照的字段；明确服务器 JSON 文件组织、读写并发策略、备份与恢复机制。*depends on 2,3*
5. 设计核心功能流程与页面信息架构：规划主页（分类卡片 + 每类推荐任务）、任务详情（检查点记录与计时）、统计页（首版四项指标）与异常任务分类视图。*depends on 2,3,4*
6. 设计异常场景处理策略：把“超时、暂停中断、检查点跳过、延期”等事件统一沉淀为异常标记并自动归入独立分类；到期未完成任务自动标记延期且不改截止日期；异常分类任务仍参与推荐且与普通任务同权，同时明确统计口径。*depends on 2,4,5*
7. 制定模块化实现蓝图：拆分前端层、API 层、服务层、存储层，给出接口契约与解耦边界（参数传递、最小共享状态、可替换存储适配器）。*depends on 4,5,6*
8. 输出验证计划：定义设计评审检查项、最小可用流程验收路径、统计准确性核对方法、异常场景回归清单。*depends on 7*

**Relevant files**
- c:/Users/27972/Desktop/Toy App/work-estimater/README.md — 需求来源与设计约束（轻量、可维护、解耦、网页部署、JSON 存储倾向）

**Verification**
1. 需求一致性检查：逐条对照 README 与已确认决策，确保无冲突和遗漏。
2. 状态机可执行性检查：对“暂停/恢复/完成/延期”进行场景推演，确保不存在死锁或无法回退状态。
3. 推荐算法合理性检查：用 5-10 个样例任务手工验算排序，验证权重与兜底规则符合预期。
4. 统计口径验证：对四项统计（时长、完成率、领域占比、按优先级完成分布）做手工对账。
5. 异常策略验证：模拟超时、跳过检查点、延期，确认都进入异常分类且不破坏主流程。

**Decisions**
- 已确认：首版为单用户。
- 已确认：部署形态为服务器可访问 Web，数据采用服务器端 JSON 存储。
- 已确认：任务状态采用“待办 -> 进行中 -> 暂停 -> 已完成”。
- 已确认：推荐优先级采用固定权重“手动优先级 50% + 截止日期 30% + 预计工时 20%”。
- 已确认：首版统计包含“每日/每周学习总时长、任务完成率、各领域时间占比、按优先级完成分布”。
- 已确认：异常任务（超时/暂停中断/检查点跳过/延期）放入独立分类管理。
- 已确认：检查点为可选且数量不限。
- 已确认：任务到期未完成时，自动标记延期并进入异常分类，截止日期不自动变更。
- 本轮明确不包含：多用户账号体系、大型数据库、复杂云同步。

**Further Considerations**
1. JSON 并发写入策略可选：Option A（写操作串行队列）/ Option B（文件锁 + 重试）。推荐 Option A，首版实现更稳定简单。
2. 统计更新策略可选：Option A（每次任务变更实时重算）/ Option B（定时批量重算）。推荐 Option A，首版数据量小且反馈及时。