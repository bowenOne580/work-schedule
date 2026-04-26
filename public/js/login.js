(async function loginPage() {
  const form = document.querySelector("#login-form");
  const message = document.querySelector("#login-message");

  if (!form || !message) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const rawNext = params.get("next") || "/index.html";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/index.html";

  function setMessage(text) {
    message.textContent = text || "";
  }

  async function request(path, options) {
    const response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
      },
      ...(options || {}),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || "请求失败");
    }
    return payload.data;
  }

  try {
    const status = await request("/api/auth/status");
    if (status.authenticated) {
      window.location.replace(next);
      return;
    }
  } catch {
    // stay on login page
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");

    const data = new FormData(form);
    const submitButton = form.querySelector("button[type='submit']");
    submitButton.disabled = true;

    try {
      await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: String(data.get("username") || ""),
          password: String(data.get("password") || ""),
          remember: Boolean(data.get("remember")),
        }),
      });
      window.location.replace(next);
    } catch (error) {
      setMessage(error.message);
      submitButton.disabled = false;
    }
  });
})();
