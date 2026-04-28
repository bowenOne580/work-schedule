# 前端 Code Review 报告

报告日期: 2026-04-28
审查范围: `frontend/` 目录全部源代码 (17 个 TypeScript/TSX 文件)

---

## 严重 (Critical)

### C1. DELETE 请求遇到 204 No Content 会崩溃

**文件**: [frontend/src/api/client.ts:13](frontend/src/api/client.ts#L13)

```typescript
const json = await res.json()  // 204 No Content 时抛 JSON 解析异常
```

后端 DELETE 接口（`DELETE /api/tasks/:id`, `DELETE /api/categories/:id`, `DELETE /api/checkpoints/:id`）返回 204 时没有响应体，`res.json()` 会抛出 `SyntaxError: Unexpected end of JSON input`。该错误未被捕获，会导致整个请求挂掉。

**建议**: 在 `request()` 中先判断 `Content-Length` 或尝试 `text()` 再解析 JSON，或检查 `res.status === 204` 时直接返回。

---

### C2. `useMutation` 的 `opts` 闭包陷阱

**文件**: [frontend/src/hooks/useApi.ts:75-98](frontend/src/hooks/useApi.ts#L75-L98)

`useMutation` 使用 `useCallback(fn, [])`（空依赖数组）缓存 `mutate` 函数，但 `opts` 参数没有被 ref 保存。当组件重新渲染时，`opts.onSuccess`/`opts.onError` 始终指向**首次渲染时的闭包**。

```typescript
export function useMutation<TArg, TResult = unknown>(
  fn: (arg: TArg) => Promise<TResult>,
  opts?: { onSuccess?: ...; onError?: ... }
) {
  const fnRef = useRef(fn)
  fnRef.current = fn          // fn 有 ref，没问题
  const mutate = useCallback(async (arg: TArg) => {
    // ...
    opts?.onSuccess?.(result, arg)  // opts 永远是最初的值！
```

在实际使用中这可能导致 bug，例如 `LoginPage.tsx:17` 中 `setCache` 使用的 `username` 来自初始闭包而非最新状态。如果用户名在表单中变化，缓存中写入的始终是初始值。此外在 React StrictMode 下，闭包不一致问题更容易被触发。

**建议**: `opts` 也需要像 `fn` 一样用 ref 保存。

---

### C3. 无全局 ErrorBoundary，前端加载异常时白屏

整个应用没有任何 ErrorBoundary 组件包裹。如果任意组件在渲染阶段抛出异常（例如 API 字段不匹配导致 `undefined.name`），页面将完全白屏。React 18 中 Uncaught error 不显示任何提示。

**建议**: 在 [App.tsx](frontend/src/App.tsx) 外层添加 ErrorBoundary，显示友好的错误回退 UI。

---

## 高 (High)

### H1. API 错误被静默吞没

- **`useQuery` 错误不展示**: 所有页面组件（[DashboardPage](frontend/src/pages/DashboardPage.tsx)、[TasksPage](frontend/src/pages/TasksPage.tsx)、[StatsPage](frontend/src/pages/StatsPage.tsx) 等）都解构了 `useQuery` 返回的 `data` 和 `loading`，但没有任何组件读取或展示 `error`。API 请求失败后用户看到的只是空白或永久的 spinner，没有任何提示。
- **Mutation 缺少 onError**: 除 `LoginPage` 外，`TaskDetail`、`DashboardPage`、`SettingsPage`、`AnomaliesPage` 中的 `useMutation` 均未设置 `onError`。操作失败没有任何反馈。

**建议**: 在页面层添加错误状态展示，或实现全局 Toast 机制。

---

### H3. `invalidatePrefix` 函数定义了但从未使用

**文件**: [frontend/src/hooks/useApi.ts:17-24](frontend/src/hooks/useApi.ts#L17-L24)

`invalidatePrefix` 函数（用于按前缀批量清除缓存）已定义导出，但在整个代码库中未调用。例如 `TaskDetail.tsx:51-53` 中手动调用两次 `invalidate`：

```typescript
const refresh = () => {
  invalidate(`task:${taskId}`)
  invalidate('tasks')
}
```

若通过 `invalidatePrefix('task:')` 则可以一次清除所有任务相关缓存，且更不易遗漏。

**建议**: 删除未使用的导出，或在需要的地方替换为 `invalidatePrefix`。

---

## 中 (Medium)

### M1. API 模块中类型泛型遗漏

**文件**: [frontend/src/api/index.ts](frontend/src/api/index.ts)

`tasksApi.delete`、`tasksApi.anomalyIgnore`、`checkpointsApi.update`、`checkpointsApi.delete`、`categoriesApi.delete` 等调用 `api.delete` / `api.patch` 时**未传类型参数**，TypeScript 无法推断返回类型，返回值为 `Promise<unknown>`。这削弱了类型安全性。

```typescript
delete: (id: string) => api.delete(`/api/tasks/${id}`),
//                            ^ 应改为 api.delete<void> 或 api.delete<unknown>
```

**建议**: 统一为有返回类型的 API 调用加上泛型标记。

---

### M2. 退出登录后缓存未清理

**文件**: [frontend/src/components/AppShell.tsx:22-26](frontend/src/components/AppShell.tsx#L22-L26)

退出登录时只更新了 `auth-status` 缓存：

```typescript
onSuccess: () => {
  setCache('auth-status', { authenticated: false })
  navigate('/login')
},
```

但其他缓存（`tasks`、`categories`、`recommendations`、`stats` 等）仍保留。以新身份重新登录后会短暂显示旧数据，直到缓存过期（30 秒）。

**建议**: 登出时调用 `invalidate` 清除所有业务数据缓存，或使用 `invalidatePrefix` 批量清除。

---

### M3. `.env.local` 被提交到版本库

**文件**: [frontend/.env.local](frontend/.env.local)

```
VITE_API_BASE=http://localhost:8998
```

`.env.local` 按惯例应添加到 `.gitignore`（[frontend/.gitignore](frontend/.gitignore) 中未包含）。被提交后，如果不同开发者的环境配置不同，会导致冲突。`.env*` 规则通常排除本地专用文件。

**建议**: 将 `.env.local` 加入 `.gitignore`，使用 `.env` 或 `.env.example` 作为默认配置模板。

---

### M4. `client.ts` 中 `headers` 展开顺序可能导致 Content-Type 被覆盖

**文件**: [frontend/src/api/client.ts:6-7](frontend/src/api/client.ts#L6-L7)

```typescript
headers: { 'Content-Type': 'application/json', ...init?.headers },
...init,
```

当 `init` 包含 `headers` 属性时，`...init` 会在顶层展开，覆盖整个 `headers` 对象（包括 `Content-Type`）。虽然目前没有调用者传自定义 headers，但这是一个隐藏的陷阱。

**建议**: 可以将 headers 合并从 `...init` 中拆出，或者在 `...init` 后面重新设置 `Content-Type`。

---

## 低 (Low)

### L1. 两个重复的 `fmtMinutes` 函数

三个文件实现了同名同功能的工具函数，但行为略有差异：

- [pages/TaskDetail.tsx:8](frontend/src/components/TaskDetail.tsx#L8): `if (!m) return '—'`
- [pages/StatsPage.tsx:11](frontend/src/pages/StatsPage.tsx#L11): `if (!m) return '0m'`
- [pages/DashboardPage.tsx:8](frontend/src/pages/DashboardPage.tsx#L8): 第三个版本，没有 `!m` 守卫

**建议**: 提取到共享的 `utils/` 模块。

---

### L2. TasksPage 的 CategorySidebar 和 NewTaskModal 各自独立请求分类列表

[CategorySidebar](frontend/src/pages/TasksPage.tsx#L119) 和 [NewTaskModal](frontend/src/pages/TasksPage.tsx#L11) 都各自调用 `useQuery('categories', categoriesApi.list)`。虽然有 30 秒缓存，但首次加载和缓存失效后都会发起重复的 HTTP 请求。

**建议**: 将分类查询提升到父组件 `TasksPage`，通过 props 下传。

---

### L3. KanbanCard 不显示分类信息

看板视图的卡片（[KanbanCard](frontend/src/pages/TasksPage.tsx#L172)）只显示标题、进度和截止日期。在看板视图中，不同分类的任务混排，用户无法区分任务属于哪个分类。

**建议**: 在 KanbanCard 上添加分类名称的角标或标识。

---

### L4. `index.css` 中的 utility classes 未被使用

[frontend/src/index.css:23-33](frontend/src/index.css#L23-L33) 中定义了 `.status-todo`、`.status-in_progress` 等多个 CSS utility classes，但这些类名从未在组件中使用——组件使用 `StatusBadge` 组件中的内联 Tailwind classes。

**建议**: 删除未使用的 CSS 或改为组件使用它们。

---

### L5. `PageLoader` 与 AuthGuard loading 状态视觉混淆

[AuthGuard](frontend/src/App.tsx#L26) 的 loading spinner 和 [PageLoader](frontend/src/App.tsx#L14-L18) 视觉上几乎一样（都是居中旋转圆弧）。当首次加载时用户无法分辨是"正在检查登录"还是"路由页面正在加载"，如果某个环节卡住，用户无法判断是哪个阶段的问题。

**建议**: 区分两者的视觉样式，或添加辅助文字说明。

---

### L6. react-router-dom 版本问题

`package.json` 中 `react-router-dom` 的版本为 `^7.14.2`（React Router v7），但代码中使用的 API（`Routes`、`Route`、`useNavigate`、`Outlet` 等）是 React Router v6 的 API 模式，而非 v7 的数据路由 API。这本身不会出错（v7 兼容 v6 用法），但建议确认依赖版本与实际用法一致。

---

## 总结

| 级别 | 数量 | 主要关注点 |
|------|------|-----------|
| 严重 | 3 | DELETE 时 JSON 解析崩溃、`useMutation` 闭包陷阱、无 ErrorBoundary |
| 高 | 3 | 错误静默吞没、无意义趋势图、未使用的函数 |
| 中 | 4 | 类型泛型遗漏、登出缓存清理、env 文件提交、headers 覆盖风险 |
| 低 | 6 | 代码重复、冗余请求、CSS 死代码等 |
