(async function anomaliesPage() {
  const { api, escapeHtml, statusText, toast } = window.WS;
  const list = document.querySelector("#anomaly-list");
  if (!list) {
    return;
  }

  async function load() {
    const [tasks, categories] = await Promise.all([api("/api/tasks/anomalies"), api("/api/categories")]);
    const categoryMap = new Map(categories.map((item) => [item.id, item.name]));

    if (!tasks.length) {
      list.innerHTML = '<div class="empty">暂无异常任务</div>';
      return;
    }

    list.innerHTML = tasks
      .map((task) => {
        const flags = (task.anomalyFlags || []).map((flag) => `<span class="tag">${escapeHtml(flag)}</span>`).join("");
        const ignoreTag = task.anomalyIgnored ? '<span class="tag">ignored</span>' : "";
        const ignoreButtonText = task.anomalyIgnored ? "取消忽略" : "标记忽略";

        return `
          <article class="card" data-task-id="${task.id}" data-ignored="${task.anomalyIgnored ? "1" : "0"}">
            <h3>${escapeHtml(task.title)}</h3>
            <p class="muted">状态：${statusText(task.status)}</p>
            <p class="muted">预计：${task.estimatedMinutes ?? "-"} 分钟 | 已用：${task.actualMinutes} 分钟</p>
            <p class="muted">分类：${escapeHtml(categoryMap.get(task.categoryId) || "未分类")}</p>
            <div>${flags || "-"} ${ignoreTag}</div>
            <div class="actions">
              <button data-action="toggle-ignore">${ignoreButtonText}</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='toggle-ignore']");
    if (!button) {
      return;
    }

    const card = button.closest("[data-task-id]");
    if (!card) {
      return;
    }

    const taskId = card.dataset.taskId;
    const nextIgnored = card.dataset.ignored !== "1";

    try {
      await api(`/api/tasks/${taskId}/anomaly-ignore`, {
        method: "PATCH",
        body: JSON.stringify({ ignored: nextIgnored }),
      });
      await load();
    } catch (error) {
      toast(error.message);
    }
  });

  await load();
})();
