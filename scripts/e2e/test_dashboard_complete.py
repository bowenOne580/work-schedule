"""Verify dashboard complete button opens the actual-minutes modal.

Uses the shared test account documented in Testing.md (demo_user / 123456).
Requires: backend on :8998, frontend on :5173, playwright installed.
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
API = "http://localhost:5173"  # vite proxies /api to the backend


def login(page):
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    if page.locator('input[type="password"]').count() > 0:
        page.locator('input[placeholder="请输入用户名"]').fill("demo_user")
        page.locator('input[placeholder="请输入密码"]').fill("123456")
        page.locator("button", has_text="登录").first.click()
        page.wait_for_url("**/app", timeout=10000)
    print("[ok] logged in, url =", page.url)


def api_get_tasks(page):
    res = page.evaluate(
        "fetch('%s/api/tasks', { credentials: 'include' }).then(r => r.json())" % API
    )
    return res.get("data", [])


def main():
    failures = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        login(page)

        # --- Prepare: ensure a task named test_no_time is in_progress ---
        tasks = api_get_tasks(page)
        task = next((t for t in tasks if t["title"] == "test_no_time"), None)
        if task is None:
            failures.append("task test_no_time not found; create it first")
            print(json.dumps(failures))
            browser.close()
            sys.exit(1)

        if task["status"] != "in_progress":
            page.evaluate(
                "fetch('%s/api/tasks/%s/start', { method: 'POST', credentials: 'include' })"
                % (API, task["id"])
            )

        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)

        # --- Step 1: click green complete button on dashboard card ---
        card = page.locator("div", has_text="test_no_time").filter(
            has=page.locator("button", has_text="完成")
        ).first
        complete_btn = card.locator("button", has_text="完成").first
        complete_btn.click()
        page.wait_for_timeout(300)

        # --- Step 2: modal should appear asking for actual minutes ---
        modal = page.locator("text=实际花费时间（分钟）")
        if modal.count() == 0:
            page.screenshot(path="/tmp/step2_fail.png", full_page=True)
            failures.append("complete modal did NOT appear")
            browser.close()
            print(json.dumps(failures))
            sys.exit(1)
        page.screenshot(path="/tmp/step2_modal.png", full_page=True)
        print("[ok] modal appeared")

        # --- Step 3: fill 37 minutes and confirm ---
        page.locator('input[type="number"]').first.fill("37")
        page.locator("button", has_text="确认完成").first.click()
        page.wait_for_timeout(1000)

        # --- Step 4: verify task is done with actualMinutes == 37 ---
        tasks = api_get_tasks(page)
        task = next(t for t in tasks if t["title"] == "test_no_time")
        if task["status"] != "done":
            failures.append("task not done, status=%s" % task["status"])
        if task.get("actualMinutes") != 37:
            failures.append("actualMinutes=%r, expected 37" % task.get("actualMinutes"))

        page.screenshot(path="/tmp/step4_after.png", full_page=True)
        print("[result] status=%s actualMinutes=%s" % (task["status"], task.get("actualMinutes")))
        browser.close()

    if failures:
        print(json.dumps(failures, ensure_ascii=False))
        sys.exit(1)
    print("[PASS] dashboard complete flow works with actual-minutes prompt")


if __name__ == "__main__":
    main()
