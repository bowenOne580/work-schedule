"""Browser regression for automatic timing with isolated storage and auth.

Requires a same-origin frontend build (VITE_API_BASE= npm run build),
Python Playwright and its Chromium browser.
No development server or real task data is used.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
SERVER_CODE = r"""
const fs = require('node:fs/promises');
const path = require('node:path');
const { JsonStorage } = require('./src/repository/jsonStorage');
const { SchedulerService } = require('./src/services/schedulerService');
const { hashPassword } = require('./src/auth');
const { createApp } = require('./src/createApp');
(async () => {
  await fs.writeFile(process.env.WORK_SCHEDULE_AUTH_CONFIG, JSON.stringify({
    username: 'demo_user', passwordHash: hashPassword('123456'),
    sessionSecret: 'isolated-browser-timing-test-secret',
  }));
  const storage = new JsonStorage(path.join(process.env.TIMING_TEST_DIR, 'data'));
  await storage.initialize();
  const service = new SchedulerService(storage);
  const app = createApp(service, { serveStatic: true });
  const server = app.listen(0, '127.0.0.1', () => {
    console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` }));
  });
})().catch(err => { console.error(err); process.exit(1); });
"""


def api(page, path, method="GET", body=None):
    result = page.evaluate(
        """async ({path, method, body}) => {
          const res = await fetch(path, {
            method, credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: body == null ? undefined : JSON.stringify(body),
          });
          return {status: res.status, ...(await res.json())};
        }""",
        {"path": path, "method": method, "body": body},
    )
    assert result["status"] == 200, result
    return result["data"]


def click_action(page, name, task_id, action):
    with page.expect_response(
        lambda res: res.url.endswith(f"/api/tasks/{task_id}/{action}")
        and res.request.method == "POST"
    ) as response:
        page.get_by_role("button", name=name, exact=True).click()
    assert response.value.status == 200


def verify(page, base):
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    # Prevent a locally configured VITE_API_BASE from touching another service.
    def restrict_api(route):
        if route.request.url.startswith(base + "/api/"):
            route.continue_()
        else:
            errors.append("测试需要同源构建：cd frontend && VITE_API_BASE= npm run build")
            route.abort()
    page.route("**/api/**", restrict_api)
    page.goto(base)
    page.get_by_placeholder("请输入用户名").fill("demo_user")
    page.get_by_placeholder("请输入密码").fill("123456")
    page.get_by_role("button", name="登录", exact=True).click()
    page.wait_for_url("**/app", timeout=10000)

    # Real creation form: estimate is optional.
    page.goto(base + "/app/tasks")
    page.get_by_role("button", name="新建任务", exact=True).click()
    page.get_by_placeholder("任务标题").fill("test_automatic_time")
    expect(page.get_by_label("预计时间（分钟，选填）")).to_have_value("")
    page.get_by_role("button", name="创建", exact=True).click()
    page.get_by_text("test_automatic_time", exact=True).click()
    task_id = page.url.rsplit("/", 1)[1]
    task = api(page, f"/api/tasks/{task_id}")
    assert task["estimatedMinutes"] is None
    expect(page.get_by_role("timer")).to_have_text("0s")

    click_action(page, "开始", task_id, "start")
    expect(page.get_by_text("计时中", exact=True)).to_be_visible()
    page.wait_for_function("document.querySelector('[role=timer]')?.textContent !== '0s'")
    timer_start = api(page, f"/api/tasks/{task_id}")["timerStartedAt"]
    page.reload()
    expect(page.get_by_text("计时中", exact=True)).to_be_visible()
    assert api(page, f"/api/tasks/{task_id}")["timerStartedAt"] == timer_start
    click_action(page, "暂停", task_id, "pause")
    paused = api(page, f"/api/tasks/{task_id}")
    assert paused["accumulatedMs"] > 0
    assert paused["timerStartedAt"] is None
    expect(page.get_by_role("button", name="继续", exact=True)).to_be_visible()
    paused_display = page.get_by_role("timer").inner_text()
    page.wait_for_timeout(1100)
    expect(page.get_by_role("timer")).to_have_text(paused_display)
    assert api(page, f"/api/tasks/{task_id}")["accumulatedMs"] == paused["accumulatedMs"]

    click_action(page, "继续", task_id, "resume")
    expect(page.get_by_text("计时中", exact=True)).to_be_visible()
    page.goto(base + "/app")
    expect(page.get_by_role("timer")).to_contain_text("计时中")
    page.wait_for_timeout(1100)
    click_action(page, "完成", task_id, "complete")
    done = api(page, f"/api/tasks/{task_id}")
    assert done["status"] == "done"
    assert done["timerStartedAt"] is None
    assert done["accumulatedMs"] > paused["accumulatedMs"]
    assert abs(done["actualMinutes"] * 60_000 - done["accumulatedMs"]) < 1e-6
    assert page.get_by_text("实际花费时间（分钟）").count() == 0

    # A checkpoint without an estimate auto-completes the task and settles time.
    parent = api(page, "/api/tasks", "POST", {"title": "test_checkpoint_time"})
    parent_id = parent["id"]
    page.goto(base + f"/app/tasks/{parent_id}")
    page.get_by_role("button", name="添加", exact=True).click()
    page.get_by_placeholder("检查点名称").fill("test_checkpoint")
    expect(page.get_by_label("检查点预计时间（分钟，选填）")).to_have_value("")
    page.get_by_role("button", name="确认", exact=True).click()
    expect(page.get_by_text("test_checkpoint", exact=True)).to_be_visible()
    click_action(page, "开始", parent_id, "start")
    page.wait_for_function("document.querySelector('[role=timer]')?.textContent !== '0s'")
    page.locator('button[title="完成"]').click()
    expect(page.get_by_role("button", name="暂停", exact=True)).to_have_count(0)
    parent_done = api(page, f"/api/tasks/{parent_id}")
    assert parent_done["status"] == "done"
    assert parent_done["accumulatedMs"] > 0
    assert parent_done["timerStartedAt"] is None
    assert parent_done["checkpoints"][0]["estimatedMinutes"] is None

    # Time stays consistent in archive and statistics.
    page.goto(base + "/app/archive")
    expect(page.get_by_text("test_automatic_time", exact=True)).to_be_visible()
    page.get_by_text("test_automatic_time", exact=True).click()
    expect(page.get_by_text("实际用时（自动累计）", exact=True)).to_be_visible()
    expect(page.get_by_text("未估算", exact=True)).to_be_visible()
    page.goto(base + "/app/stats")
    expect(page.get_by_role("heading", name="统计分析", exact=True)).to_be_visible()
    stats = api(page, "/api/statistics/overview?range=all")
    assert abs(stats["rangeMinutes"] - done["actualMinutes"] - parent_done["actualMinutes"]) < 1e-6
    assert not errors, errors
    print("[PASS] optional estimates, timing, pause/resume, refresh, dashboard completion, checkpoints, archive and stats")


def main():
    with tempfile.TemporaryDirectory(prefix="work-schedule-browser-") as temp:
        env = os.environ.copy()
        env["TIMING_TEST_DIR"] = temp
        env["WORK_SCHEDULE_AUTH_CONFIG"] = str(Path(temp) / "auth.json")
        server = subprocess.Popen(
            ["node", "-e", SERVER_CODE], cwd=ROOT, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        try:
            ready = server.stdout.readline()
            if not ready:
                raise RuntimeError(server.stderr.read())
            base = json.loads(ready)["url"]
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                try:
                    verify(browser.new_page(viewport={"width": 1280, "height": 900}), base)
                finally:
                    browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)


if __name__ == "__main__":
    main()
