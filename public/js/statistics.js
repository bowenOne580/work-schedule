(async function statisticsPage() {
  const { api, escapeHtml } = window.WS;
  const view = document.querySelector("#statistics-view");
  if (!view) {
    return;
  }

  const [stats, categories] = await Promise.all([api("/api/statistics/overview"), api("/api/categories")]);
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
  const completionPercent = Math.round((stats.completionRate || 0) * 100);

  const categoryEntries = Object.entries(stats.categoryTimeShare || {})
    .map(([id, share]) => ({
      id,
      name: categoryMap.get(id) || id,
      share: Number(share || 0),
    }))
    .sort((a, b) => b.share - a.share);

  const priorityEntries = [1, 2, 3, 4, 5].map((priority) => ({
    priority,
    count: Number((stats.doneByPriority || {})[String(priority)] || 0),
  }));
  const maxPriorityCount = Math.max(1, ...priorityEntries.map((item) => item.count));

  const categoryBars = categoryEntries
    .map((item) => {
      const percent = Math.round(item.share * 100);
      return `
        <div class="bar-row">
          <div class="bar-label">
            <span>${escapeHtml(item.name)}</span>
            <strong>${percent}%</strong>
          </div>
          <div class="bar-track"><span style="width: ${percent}%"></span></div>
        </div>
      `;
    })
    .join("");

  const priorityBars = priorityEntries
    .map((item) => {
      const width = Math.round((item.count / maxPriorityCount) * 100);
      return `
        <div class="priority-bar">
          <span>P${item.priority}</span>
          <div class="bar-track"><span style="width: ${width}%"></span></div>
          <strong>${item.count}</strong>
        </div>
      `;
    })
    .join("");

  view.innerHTML = `
    <div class="stats-grid">
      <article class="metric-card">
        <span>今日学习</span>
        <strong>${stats.dailyMinutes || 0}</strong>
        <small>分钟</small>
      </article>
      <article class="metric-card">
        <span>本周学习</span>
        <strong>${stats.weeklyMinutes || 0}</strong>
        <small>分钟</small>
      </article>
      <article class="metric-card">
        <span>统计日期</span>
        <strong class="date-value">${escapeHtml(stats.dateKey || "-")}</strong>
        <small>最近一次重算</small>
      </article>
      <article class="metric-card ring-card">
        <div class="completion-ring" style="--value: ${completionPercent}">
          <span>${completionPercent}%</span>
        </div>
        <small>任务完成率</small>
      </article>
    </div>

    <div class="grid two-col stats-panels">
      <article class="card">
        <h3>分类时间占比</h3>
        <div class="visual-list">${categoryBars || '<div class="empty">暂无分类时长数据</div>'}</div>
      </article>
      <article class="card">
        <h3>按优先级完成分布</h3>
        <div class="visual-list">${priorityBars}</div>
      </article>
    </div>
  `;
})();
