(async function dashboardPage() {
  const { api, escapeHtml, statusText } = window.WS;

  const recommendList = document.querySelector("#recommend-list");
  const overviewStats = document.querySelector("#overview-stats");
  const inProgressTasks = document.querySelector("#in-progress-tasks");
  const toggleInProgress = document.querySelector("#toggle-in-progress");
  const recentTasks = document.querySelector("#recent-tasks");

  if (!recommendList || !overviewStats || !inProgressTasks || !toggleInProgress || !recentTasks) {
    return;
  }

  let showAllInProgress = false;

  const [categories, tasks, recommendations, stats] = await Promise.all([
    api("/api/categories"),
    api("/api/tasks"),
    api("/api/recommendations/by-category"),
    api("/api/statistics/overview"),
  ]);

  const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
  const topTasks = tasks.slice(0, 6);
  const checkpointMap = new Map();
  const activeTaskCount = tasks.filter((task) => task.status === "in_progress").length;
  const completionPercent = Math.round((stats.completionRate || 0) * 100);

  function taskHref(taskId) {
    return `/tasks.html?task=${encodeURIComponent(taskId)}`;
  }

  await Promise.all(
    topTasks.map(async (task) => {
      if (!Array.isArray(task.checkpointIds) || task.checkpointIds.length === 0) {
        checkpointMap.set(task.id, []);
        return;
      }

      try {
        const detail = await api(`/api/tasks/${task.id}`);
        const checkpoints = (detail.checkpoints || []).sort((a, b) => a.order - b.order);
        checkpointMap.set(task.id, checkpoints);
      } catch {
        checkpointMap.set(task.id, []);
      }
    }),
  );

  if (!recommendations.length) {
    recommendList.innerHTML = '<div class="empty">暂无推荐任务</div>';
  } else {
    recommendList.innerHTML = recommendations
      .map((item) => {
        return `
          <a class="card card-link" href="${taskHref(item.task.id)}">
            <h3>${escapeHtml(item.category.name)}</h3>
            <p>${escapeHtml(item.task.title)}</p>
            <p class="muted">优先级 ${item.task.manualPriority} | 状态 ${statusText(item.task.status)} | 分数 ${item.score}</p>
            <p class="muted">剩余预计 ${item.scoreDetails?.remainingEstimatedMinutes ?? "-"} 分钟</p>
          </a>
        `;
      })
      .join("");
  }

  overviewStats.innerHTML = `
    <div class="overview-metrics">
      <article class="mini-metric">
        <span>今日</span>
        <strong>${stats.dailyMinutes || 0}</strong>
        <small>分钟</small>
      </article>
      <article class="mini-metric">
        <span>本周</span>
        <strong>${stats.weeklyMinutes || 0}</strong>
        <small>分钟</small>
      </article>
      <article class="mini-metric">
        <span>进行中</span>
        <strong>${activeTaskCount}</strong>
        <small>任务</small>
      </article>
      <article class="mini-metric mini-ring-card">
        <div class="mini-ring" style="--value: ${completionPercent}"><span>${completionPercent}%</span></div>
        <small>完成率</small>
      </article>
    </div>
  `;

  function renderInProgress() {
    const activeTasks = tasks.filter((task) => task.status === "in_progress").sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const visible = showAllInProgress ? activeTasks : activeTasks.slice(0, 3);

    toggleInProgress.hidden = activeTasks.length <= 3;
    toggleInProgress.textContent = showAllInProgress ? "收起" : `展开全部（${activeTasks.length}）`;

    if (!activeTasks.length) {
      inProgressTasks.innerHTML = '<div class="empty">当前没有正在进行的任务</div>';
      return;
    }

    inProgressTasks.innerHTML = visible
      .map((task) => {
        return `
          <a class="card compact card-link" href="${taskHref(task.id)}">
            <h3>${escapeHtml(task.title)}</h3>
            <p class="muted">分类：${escapeHtml(categoryMap.get(task.categoryId) || "未分类")} | 进度：${task.progress}%</p>
            <p class="muted">预计：${task.estimatedMinutes ?? "-"} 分钟 | 已用：${task.actualMinutes} 分钟</p>
          </a>
        `;
      })
      .join("");
  }

  toggleInProgress.addEventListener("click", () => {
    showAllInProgress = !showAllInProgress;
    renderInProgress();
  });

  renderInProgress();

  if (!topTasks.length) {
    recentTasks.innerHTML = '<div class="empty">暂无任务</div>';
    return;
  }

  recentTasks.innerHTML = topTasks
    .map((task) => {
      const checkpoints = checkpointMap.get(task.id) || [];
      const checkpointTrack = checkpoints.length
        ? `<div class="checkpoint-track">${checkpoints
            .map((cp, index) => {
              const point = `<span class="checkpoint-dot ${cp.completed ? "is-complete" : ""}" data-title="${escapeHtml(cp.title)}">${cp.completed ? "✓" : ""}</span>`;
              if (index === 0) {
                return `<span class="checkpoint-node">${point}</span>`;
              }
              return `<span class="checkpoint-node"><span class="checkpoint-line"></span>${point}</span>`;
            })
            .join("")}</div>`
        : '<p class="muted">无检查点</p>';

      return `
        <article class="card compact">
          <h3>${escapeHtml(task.title)}</h3>
          <p class="muted">分类：${escapeHtml(categoryMap.get(task.categoryId) || "未分类")}</p>
          <p class="muted">状态：${statusText(task.status)} | 进度：${task.progress}%</p>
          <p class="muted">预计：${task.estimatedMinutes ?? "-"} 分钟 | 已用：${task.actualMinutes} 分钟</p>
          ${checkpointTrack}
        </article>
      `;
    })
    .join("");
})();
