(function initCommon() {
  function toast(message) {
    window.alert(message);
  }

  function escapeHtml(input) {
    return String(input)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDate(dateValue) {
    if (!dateValue) {
      return "无";
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return dateValue;
    }
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return "无效日期";
    }
    return date.toLocaleDateString("zh-CN");
  }

  function statusText(status) {
    const map = {
      todo: "待办",
      in_progress: "进行中",
      paused: "暂停",
      done: "已完成",
    };
    return map[status] || status;
  }

  async function api(path, options) {
    const response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
      },
      ...(options || {}),
    });

    const contentType = response.headers.get("content-type") || "";
    let payload = null;

    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      const text = await response.text();
      payload = { error: { message: text } };
    }

    if (!response.ok) {
      const message = payload?.error?.message || `请求失败: ${response.status}`;
      if (response.status === 401) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login.html?next=${next}`;
        return null;
      }
      throw new Error(message);
    }

    return payload.data;
  }

  function setNavActive() {
    const page = document.body.dataset.page;
    const links = document.querySelectorAll("[data-nav]");
    for (const link of links) {
      if (link.dataset.nav === page) {
        link.classList.add("active");
      }
    }
  }

  function bindStopButton() {
    const stopButton = document.querySelector("#stop-server-btn");
    if (!stopButton) {
      return;
    }

    stopButton.addEventListener("click", async () => {
      const confirmed = window.confirm("确认停止软件服务？停止后所有页面将无法继续访问 API。");
      if (!confirmed) {
        return;
      }

      try {
        const result = await api("/api/system/stop", { method: "POST" });
        stopButton.disabled = true;
        toast(result?.message || "服务正在停止");
      } catch (error) {
        toast(error.message);
      }
    });
  }

  function bindLogoutButton() {
    const logoutButton = document.querySelector("#logout-btn");
    if (!logoutButton) {
      return;
    }

    logoutButton.addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch {
        // redirect anyway; the goal is to leave the local session.
      }
      window.location.href = "/login.html";
    });
  }

  window.WS = {
    api,
    toast,
    escapeHtml,
    formatDate,
    statusText,
  };

  setNavActive();
  bindStopButton();
  bindLogoutButton();
})();
