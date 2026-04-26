(async function tasksPage() {
  const { api, toast, escapeHtml, formatDate, statusText } = window.WS;
  const ARCHIVED_CATEGORY_ID = "cat-archived";
  const initialParams = new URLSearchParams(window.location.search);

  const categoryTree = document.querySelector("#category-tree");
  const explorerView = document.querySelector("#explorer-view");
  const taskModal = document.querySelector("#task-modal");
  const categoryModal = document.querySelector("#category-modal");
  const openTaskModalButton = document.querySelector("#open-task-modal");
  const openCategoryModalButton = document.querySelector("#open-category-modal");
  const cancelTaskModalButton = document.querySelector("#cancel-task-modal");
  const cancelCategoryModalButton = document.querySelector("#cancel-category-modal");
  const taskForm = document.querySelector("#task-form");
  const categoryForm = document.querySelector("#category-form");
  const taskCategory = document.querySelector("#task-category");

  if (!categoryTree || !explorerView || !taskModal || !categoryModal || !taskForm || !categoryForm || !taskCategory) {
    return;
  }

  const state = {
    categories: [],
    tasks: [],
    selectedCategoryId: initialParams.get("category"),
    selectedTaskId: initialParams.get("task"),
  };

  function categoryName(categoryId) {
    return state.categories.find((item) => item.id === categoryId)?.name || "未分类";
  }

  function selectedCategory() {
    return state.categories.find((item) => item.id === state.selectedCategoryId) || null;
  }

  function selectedTask() {
    return state.tasks.find((item) => item.id === state.selectedTaskId) || null;
  }

  function writeRoute() {
    const params = new URLSearchParams();
    if (state.selectedTaskId) {
      params.set("task", state.selectedTaskId);
    } else if (state.selectedCategoryId) {
      params.set("category", state.selectedCategoryId);
    }

    const query = params.toString();
    const nextUrl = query ? `/tasks.html?${query}` : "/tasks.html";
    window.history.replaceState(null, "", nextUrl);
  }

  function isArchivedCategory(category) {
    return category?.id === ARCHIVED_CATEGORY_ID || category?.isArchiveBucket;
  }

  function tasksInCategory(categoryId) {
    return state.tasks
      .filter((task) => task.categoryId === categoryId)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function renderCategoryOptions() {
    taskCategory.innerHTML = state.categories
      .filter((category) => !isArchivedCategory(category))
      .map((category) => {
        const selected = category.id === state.selectedCategoryId ? " selected" : "";
        return `<option value="${category.id}"${selected}>${escapeHtml(category.name)}</option>`;
      })
      .join("");
  }

  function renderCategoryTree() {
    if (!state.categories.length) {
      categoryTree.innerHTML = '<div class="empty">暂无分类</div>';
      return;
    }

    categoryTree.innerHTML = state.categories
      .map((category) => {
        const tasks = tasksInCategory(category.id);
        const isSelected = category.id === state.selectedCategoryId;
        const taskNodes = isSelected
          ? `<div class="tree-children">${
              tasks.length
                ? tasks
                    .map((task) => {
                      const taskSelected = task.id === state.selectedTaskId ? " selected" : "";
                      return `
                        <button class="tree-node task-node${taskSelected}" data-tree-task-id="${task.id}" type="button">
                          <span>${escapeHtml(task.title)}</span>
                          <small>${statusText(task.status)} · ${task.progress}%</small>
                        </button>
                      `;
                    })
                    .join("")
                : '<div class="tree-empty">暂无任务</div>'
            }</div>`
          : "";

        return `
          <div class="tree-group">
            <button class="tree-node category-node${isSelected ? " selected" : ""}" data-tree-category-id="${category.id}" type="button">
              <span>${escapeHtml(category.name)}</span>
              <small>${tasks.length} 个任务</small>
            </button>
            ${taskNodes}
          </div>
        `;
      })
      .join("");
  }

  function taskActions(task, options = {}) {
    const detailButton = options.inDetail
      ? ""
      : `<button data-action="select-task" data-task-id="${task.id}" type="button">详情</button>`;

    if (task.status === "done") {
      return `
        <div class="actions">
          ${detailButton}
          <button class="danger" data-action="delete-task" data-task-id="${task.id}" type="button">删除</button>
        </div>
      `;
    }

    return `
      <div class="actions">
        ${detailButton}
        <button data-action="start" data-task-id="${task.id}" type="button">开始</button>
        <button data-action="pause" data-task-id="${task.id}" type="button">暂停</button>
        <button data-action="resume" data-task-id="${task.id}" type="button">恢复</button>
        <button data-action="complete" data-task-id="${task.id}" type="button">完成</button>
        <button data-action="postpone" data-task-id="${task.id}" type="button">延期</button>
        <button class="danger" data-action="delete-task" data-task-id="${task.id}" type="button">删除</button>
      </div>
    `;
  }

  function taskSummary(task) {
    return `
      <article class="card task-card">
        <h3>${escapeHtml(task.title)}</h3>
        <p class="muted">状态：${statusText(task.status)} | 优先级：${task.manualPriority} | 进度：${task.progress}%</p>
        <p class="muted">预计：${task.estimatedMinutes ?? "-"} 分钟 | 已用：${task.actualMinutes} 分钟 | 截止：${formatDate(task.deadline)}</p>
        ${taskActions(task)}
      </article>
    `;
  }

  function renderOverview() {
    const categoryCards = state.categories
      .map((category) => {
        const tasks = tasksInCategory(category.id);
        return `
          <article class="card category-overview" data-category-id="${category.id}">
            <h3>${escapeHtml(category.name)}</h3>
            <p class="muted">${escapeHtml(category.description || "-")}</p>
            <p class="muted">任务数量：${tasks.length}</p>
            <div class="actions">
              <button data-action="select-category" data-category-id="${category.id}" type="button">打开分类</button>
            </div>
          </article>
        `;
      })
      .join("");

    explorerView.innerHTML = `
      <div class="view-header">
        <div>
          <h2>全部分类</h2>
          <p class="muted">选择一个分类后，只显示该分类下的任务。</p>
        </div>
      </div>
      <div class="list">${categoryCards || '<div class="empty">暂无分类</div>'}</div>
    `;
  }

  function renderCategoryView() {
    const category = selectedCategory();
    if (!category) {
      renderOverview();
      return;
    }

    const tasks = tasksInCategory(category.id);
    const canDelete = !category.isAnomalyBucket && category.id !== "cat-general";
    const isArchive = isArchivedCategory(category);

    explorerView.innerHTML = `
      <div class="view-header">
        <div>
          <h2>${escapeHtml(category.name)}</h2>
          <p class="muted">${escapeHtml(isArchive ? "已完成任务留档，不参与推荐和规划排序。" : category.description || "当前分类下的任务")}</p>
        </div>
        <div class="actions no-margin">
          <button data-action="back-overview" type="button">返回</button>
          ${isArchive ? "" : '<button data-action="new-task-in-category" type="button">新建任务</button>'}
          ${canDelete && !isArchive ? '<button class="danger" data-action="delete-category" type="button">删除分类</button>' : ""}
        </div>
      </div>
      <div class="list">
        ${tasks.length ? tasks.map(taskSummary).join("") : '<div class="empty">这个分类下暂无任务</div>'}
      </div>
    `;
  }

  async function renderTaskView() {
    const task = selectedTask();
    if (!task) {
      renderCategoryView();
      return;
    }

    const detail = await api(`/api/tasks/${task.id}`);
    const checkpoints = (detail.checkpoints || []).sort((a, b) => a.order - b.order);

    explorerView.innerHTML = `
      <div class="view-header">
        <div>
          <h2>${escapeHtml(detail.title)}</h2>
          <p class="muted">分类：${escapeHtml(categoryName(detail.categoryId))} | 状态：${statusText(detail.status)}</p>
        </div>
        <div class="actions no-margin">
          <button data-action="back-category" type="button">返回</button>
        </div>
      </div>

      <article class="card">
        <h3>任务信息</h3>
        <p class="muted">优先级：${detail.manualPriority} | 进度：${detail.progress}% | 截止：${formatDate(detail.deadline)}</p>
        <p class="muted">预计：${detail.estimatedMinutes ?? "-"} 分钟 | 已用：${detail.actualMinutes} 分钟</p>
        ${taskActions(detail, { inDetail: true })}
        ${
          detail.status === "done"
            ? '<p class="muted">该任务已归档，仅保留查看和删除操作。</p>'
            : `<form id="task-quick-update" class="inline-form">
          <label>
            任务级预计分钟（无检查点时生效）
            <input name="estimatedMinutes" type="number" min="0" value="${detail.directEstimatedMinutes ?? detail.estimatedMinutes ?? ""}" />
          </label>
          <label>
            进度（无检查点时生效）
            <input name="progress" type="number" min="0" max="100" value="${detail.progress}" />
          </label>
          <label>
            任务级已用分钟（无检查点时生效）
            <input name="actualMinutes" type="number" min="0" value="${detail.directMinutes || 0}" />
          </label>
          <button type="submit">更新任务</button>
        </form>`
        }
      </article>

      ${
        detail.status === "done"
          ? ""
          : `<article class="card">
        <h3>新增检查点</h3>
        <form id="checkpoint-create-form" class="inline-form">
          <label>
            检查点标题
            <input name="title" required placeholder="例如：完成章节1例题" />
          </label>
          <label>
            预计分钟
            <input name="estimatedMinutes" type="number" min="0" />
          </label>
          <label>
            已用分钟
            <input name="actualMinutes" type="number" min="0" value="0" />
          </label>
          <button type="submit">添加检查点</button>
        </form>
      </article>`
      }

      <article class="card">
        <h3>检查点列表</h3>
        <div id="checkpoint-list">
          ${
            checkpoints.length
              ? checkpoints
                  .map((cp) => {
                    return `
                      <div class="checkpoint-item" data-checkpoint-id="${cp.id}">
                        <p><strong>${escapeHtml(cp.title)}</strong></p>
                        <p class="muted">顺序：${cp.order} | 预计：${cp.estimatedMinutes ?? "-"} | 已用：<span class="checkpoint-minutes" data-actual-minutes="${cp.actualMinutes}">${cp.actualMinutes}</span></p>
                        <p class="muted">完成：${cp.completed ? "是" : "否"} | 跳过：${cp.skipped ? "是" : "否"}</p>
                        <div class="actions">
                          <button data-cp-action="complete" type="button">标记完成</button>
                          <button data-cp-action="skip" type="button">标记跳过</button>
                          <button data-cp-action="uncomplete" type="button">标记未完成</button>
                          <button class="danger" data-cp-action="delete" type="button">删除</button>
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : '<div class="empty">暂无检查点</div>'
          }
        </div>
      </article>
    `;

    bindTaskDetailForms(detail);
  }

  async function renderExplorer() {
    renderCategoryTree();
    if (state.selectedTaskId) {
      await renderTaskView();
    } else if (state.selectedCategoryId) {
      renderCategoryView();
    } else {
      renderOverview();
    }
  }

  async function refresh() {
    const [categories, tasks] = await Promise.all([api("/api/categories"), api("/api/tasks")]);
    state.categories = categories;
    state.tasks = tasks;

    if (state.selectedCategoryId && !categories.some((item) => item.id === state.selectedCategoryId)) {
      state.selectedCategoryId = null;
      state.selectedTaskId = null;
    }
    if (state.selectedTaskId) {
      const task = tasks.find((item) => item.id === state.selectedTaskId);
      if (!task) {
        state.selectedTaskId = null;
      } else {
        state.selectedCategoryId = task.categoryId;
      }
    }

    renderCategoryOptions();
    writeRoute();
    await renderExplorer();
  }

  function bindModals() {
    openTaskModalButton.addEventListener("click", () => {
      renderCategoryOptions();
      taskModal.showModal();
    });
    openCategoryModalButton.addEventListener("click", () => categoryModal.showModal());
    cancelTaskModalButton.addEventListener("click", () => taskModal.close());
    cancelCategoryModalButton.addEventListener("click", () => categoryModal.close());

    for (const modal of [taskModal, categoryModal]) {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          modal.close();
        }
      });
    }
  }

  function bindTaskDetailForms(detail) {
    const taskId = detail.id;
    const quickUpdateForm = document.querySelector("#task-quick-update");
    const checkpointCreateForm = document.querySelector("#checkpoint-create-form");
    const checkpointList = document.querySelector("#checkpoint-list");

    if (quickUpdateForm) {
      quickUpdateForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(quickUpdateForm);
        try {
          await api(`/api/tasks/${taskId}`, {
            method: "PATCH",
            body: JSON.stringify({
              estimatedMinutes: data.get("estimatedMinutes") ? Number(data.get("estimatedMinutes")) : null,
              progress: Number(data.get("progress")),
              actualMinutes: Number(data.get("actualMinutes")),
            }),
          });
          await refresh();
        } catch (error) {
          toast(error.message);
        }
      });
    }

    if (checkpointCreateForm) {
      checkpointCreateForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(checkpointCreateForm);
        try {
          await api(`/api/tasks/${taskId}/checkpoints`, {
            method: "POST",
            body: JSON.stringify({
              title: String(data.get("title") || "").trim(),
              estimatedMinutes: data.get("estimatedMinutes") ? Number(data.get("estimatedMinutes")) : null,
              actualMinutes: Number(data.get("actualMinutes") || 0),
            }),
          });
          await refresh();
        } catch (error) {
          toast(error.message);
        }
      });
    }

    checkpointList.addEventListener("click", async (event) => {
      if (detail.status === "done") {
        toast("已归档任务仅供查看");
        return;
      }

      const button = event.target.closest("button[data-cp-action]");
      if (!button) {
        return;
      }

      const container = button.closest("[data-checkpoint-id]");
      const checkpointId = container?.dataset.checkpointId;
      const action = button.dataset.cpAction;
      if (!checkpointId) {
        return;
      }

      try {
        if (action === "delete") {
          const confirmed = window.confirm("确定删除这个检查点吗？");
          if (!confirmed) {
            return;
          }
          await api(`/api/checkpoints/${checkpointId}`, { method: "DELETE" });
        } else if (action === "complete") {
          const currentMinutes = container.querySelector(".checkpoint-minutes")?.dataset.actualMinutes || "0";
          const input = window.prompt("请输入该检查点实际花费的时间（分钟）", currentMinutes);
          if (input === null) {
            return;
          }
          const actualMinutes = Number(input);
          if (!Number.isFinite(actualMinutes) || actualMinutes < 0) {
            toast("请输入大于等于 0 的有效分钟数");
            return;
          }
          await api(`/api/checkpoints/${checkpointId}/complete`, {
            method: "POST",
            body: JSON.stringify({ actualMinutes }),
          });
        } else {
          await api(`/api/checkpoints/${checkpointId}/${action}`, { method: "POST" });
        }
        await refresh();
      } catch (error) {
        toast(error.message);
      }
    });
  }

  async function handleTaskAction(action, taskId) {
    if (action === "select-task") {
      const task = state.tasks.find((item) => item.id === taskId);
      state.selectedTaskId = taskId;
      state.selectedCategoryId = task?.categoryId || state.selectedCategoryId;
      writeRoute();
      await renderExplorer();
      return;
    }

    if (action === "delete-task") {
      const confirmed = window.confirm("确定删除这个任务吗？任务及其检查点会一起删除。");
      if (!confirmed) {
        return;
      }
      await api(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (state.selectedTaskId === taskId) {
        state.selectedTaskId = null;
      }
      await refresh();
      return;
    }

    await api(`/api/tasks/${taskId}/${action}`, { method: "POST" });
    await refresh();
  }

  categoryTree.addEventListener("click", async (event) => {
    const taskButton = event.target.closest("[data-tree-task-id]");
    if (taskButton) {
      state.selectedTaskId = taskButton.dataset.treeTaskId;
      const task = state.tasks.find((item) => item.id === state.selectedTaskId);
      state.selectedCategoryId = task?.categoryId || state.selectedCategoryId;
      writeRoute();
      await renderExplorer();
      return;
    }

    const categoryButton = event.target.closest("[data-tree-category-id]");
    if (categoryButton) {
      state.selectedCategoryId = categoryButton.dataset.treeCategoryId;
      state.selectedTaskId = null;
      writeRoute();
      await renderExplorer();
    }
  });

  explorerView.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;

    try {
      if (action === "select-category") {
        state.selectedCategoryId = button.dataset.categoryId;
        state.selectedTaskId = null;
        writeRoute();
        await renderExplorer();
        return;
      }

      if (action === "back-overview") {
        state.selectedCategoryId = null;
        state.selectedTaskId = null;
        writeRoute();
        await renderExplorer();
        return;
      }

      if (action === "back-category") {
        state.selectedTaskId = null;
        writeRoute();
        await renderExplorer();
        return;
      }

      if (action === "new-task-in-category") {
        renderCategoryOptions();
        taskCategory.value = state.selectedCategoryId || "";
        taskModal.showModal();
        return;
      }

      if (action === "delete-category") {
        const category = selectedCategory();
        const confirmed = window.confirm(`删除分类「${category?.name || ""}」？该分类中的任务会转移到 General。`);
        if (!confirmed) {
          return;
        }
        await api(`/api/categories/${state.selectedCategoryId}`, { method: "DELETE" });
        state.selectedCategoryId = null;
        state.selectedTaskId = null;
        await refresh();
        return;
      }

      const taskId = button.dataset.taskId;
      if (taskId) {
        await handleTaskAction(action, taskId);
      }
    } catch (error) {
      toast(error.message);
    }
  });

  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(taskForm);
    const payload = {
      title: String(data.get("title") || "").trim(),
      categoryId: String(data.get("categoryId") || "").trim(),
      tags: String(data.get("tags") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      manualPriority: Number(data.get("manualPriority") || 3),
      estimatedMinutes: data.get("estimatedMinutes") ? Number(data.get("estimatedMinutes")) : null,
      actualMinutes: Number(data.get("actualMinutes") || 0),
      deadline: data.get("deadline") ? String(data.get("deadline")) : null,
    };

    try {
      const task = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      taskForm.reset();
      taskModal.close();
      state.selectedCategoryId = task.categoryId;
      state.selectedTaskId = task.id;
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  });

  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(categoryForm);
    try {
      const category = await api("/api/categories", {
        method: "POST",
        body: JSON.stringify({
          name: String(data.get("name") || "").trim(),
          description: String(data.get("description") || "").trim(),
        }),
      });
      categoryForm.reset();
      categoryModal.close();
      state.selectedCategoryId = category.id;
      state.selectedTaskId = null;
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  });

  bindModals();
  await refresh();
})();
