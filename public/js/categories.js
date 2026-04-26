(async function categoriesPage() {
  const { api, escapeHtml, toast, statusText, formatDate } = window.WS;

  const categoryForm = document.querySelector("#category-form");
  const categoryList = document.querySelector("#category-list");
  const categoryTaskList = document.querySelector("#category-task-list");
  const categoryModal = document.querySelector("#category-modal");
  const openModalButton = document.querySelector("#open-category-modal");
  const cancelModalButton = document.querySelector("#cancel-category-modal");

  if (!categoryForm || !categoryList || !categoryTaskList || !categoryModal || !openModalButton || !cancelModalButton) {
    return;
  }

  const state = {
    categories: [],
    tasks: [],
    selectedCategoryId: null,
  };

  function renderCategoryList() {
    if (!state.categories.length) {
      categoryList.innerHTML = '<div class="empty">暂无分类</div>';
      return;
    }

    const counts = {};
    for (const task of state.tasks) {
      counts[task.categoryId] = (counts[task.categoryId] || 0) + 1;
    }

    categoryList.innerHTML = state.categories
      .map((category) => {
        const taskCount = counts[category.id] || 0;
        const canDelete = !category.isAnomalyBucket && category.id !== "cat-general";
        const selectedClass = state.selectedCategoryId === category.id ? " selected" : "";

        return `
          <article class="card category-card${selectedClass}" data-category-id="${category.id}" role="button" tabindex="0">
            <h3>${escapeHtml(category.name)}</h3>
            <p class="muted">${escapeHtml(category.description || "-")}</p>
            <p class="muted">任务数量：${taskCount}</p>
            <div class="actions">
              <button data-action="select">查看任务</button>
              ${canDelete ? '<button class="danger" data-action="delete">删除分类</button>' : '<span class="tag">系统分类</span>'}
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderCategoryTasks() {
    if (!state.selectedCategoryId) {
      categoryTaskList.innerHTML = "请选择一个分类查看任务";
      return;
    }

    const category = state.categories.find((item) => item.id === state.selectedCategoryId);
    const tasks = state.tasks
      .filter((task) => task.categoryId === state.selectedCategoryId)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    if (!tasks.length) {
      categoryTaskList.innerHTML = `<div class="empty">分类「${escapeHtml(category?.name || "-")}」下暂无任务</div>`;
      return;
    }

    categoryTaskList.innerHTML = tasks
      .map((task) => {
        return `
          <article class="card compact">
            <h3>${escapeHtml(task.title)}</h3>
            <p class="muted">状态：${statusText(task.status)} | 进度：${task.progress}%</p>
            <p class="muted">预计：${task.estimatedMinutes ?? "-"} 分钟 | 已用：${task.actualMinutes} 分钟 | 截止：${formatDate(task.deadline)}</p>
          </article>
        `;
      })
      .join("");
  }

  function bindModal() {
    openModalButton.addEventListener("click", () => {
      categoryModal.showModal();
    });

    cancelModalButton.addEventListener("click", () => {
      categoryModal.close();
    });

    categoryModal.addEventListener("click", (event) => {
      if (event.target === categoryModal) {
        categoryModal.close();
      }
    });
  }

  async function load() {
    const [categories, tasks] = await Promise.all([api("/api/categories"), api("/api/tasks")]);
    state.categories = categories;
    state.tasks = tasks;

    if (state.selectedCategoryId && !state.categories.some((item) => item.id === state.selectedCategoryId)) {
      state.selectedCategoryId = null;
    }

    renderCategoryList();
    renderCategoryTasks();
  }

  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(categoryForm);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      description: String(formData.get("description") || "").trim(),
    };

    try {
      await api("/api/categories", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      categoryForm.reset();
      categoryModal.close();
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  categoryList.addEventListener("click", async (event) => {
    const card = event.target.closest("[data-category-id]");
    if (!card) {
      return;
    }

    const categoryId = card.dataset.categoryId;
    const button = event.target.closest("button[data-action]");
    const action = button?.dataset.action || "select";

    if (action === "select") {
      state.selectedCategoryId = categoryId;
      renderCategoryList();
      renderCategoryTasks();
      return;
    }

    if (action === "delete") {
      const confirmed = window.confirm("删除后，该分类中的任务会转移到 General。确认删除？");
      if (!confirmed) {
        return;
      }

      try {
        await api(`/api/categories/${categoryId}`, { method: "DELETE" });
        if (state.selectedCategoryId === categoryId) {
          state.selectedCategoryId = null;
        }
        await load();
      } catch (error) {
        toast(error.message);
      }
    }
  });

  bindModal();
  await load();
})();
