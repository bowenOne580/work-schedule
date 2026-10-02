"""Independent weekly timetable regression, using temporary data and auth.

Build with `cd frontend && VITE_API_BASE= npm run build` first.
Requires Python Playwright and Chromium. Real service/data are never used.
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
    sessionSecret: 'isolated-browser-schedule-test-secret',
  }));
  const storage = new JsonStorage(path.join(process.env.SCHEDULE_TEST_DIR, 'data'));
  await storage.initialize();
  const server = createApp(new SchedulerService(storage), { serveStatic: true }).listen(0, '127.0.0.1', () => {
    console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` }));
  });
})().catch(err => { console.error(err); process.exit(1); });
"""


def read_slots(page):
    return page.evaluate("async () => (await (await fetch('/api/schedule/slots')).json()).data")


def editor(page):
    return page.get_by_role("dialog", name="新增时间段").or_(
        page.get_by_role("dialog", name="编辑时间段")
    )


def submit(page, name="添加时间段"):
    with page.expect_response(lambda res: "/api/schedule/slots" in res.url and res.request.method in ["POST", "PATCH"]):
        editor(page).get_by_role("button", name=name, exact=True).click()


def add(page, title, start, end, slot_type="固定占用", weekdays=()):
    page.get_by_role("button", name="新增时间段", exact=True).click()
    form = editor(page)
    form.get_by_label("名称", exact=True).fill(title)
    form.get_by_label(slot_type, exact=True).check()
    for day in weekdays:
        form.get_by_label(day, exact=True).check()
    form.get_by_label("开始时间", exact=True).select_option(start)
    form.get_by_label("结束时间", exact=True).select_option(end)
    submit(page)
    expect(editor(page)).to_have_count(0)


def verify(page, base):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    # A dev API base must not send test requests to another running service.
    page.route("**/api/**", lambda route: route.continue_() if route.request.url.startswith(base + "/api/") else route.abort())
    page.goto(base + "/login")
    page.get_by_placeholder("请输入用户名").fill("demo_user")
    page.get_by_placeholder("请输入密码").fill("123456")
    page.get_by_role("button", name="登录", exact=True).click()
    page.get_by_role("link", name="日程", exact=True).click()
    expect(page.get_by_role("heading", name="日程表", exact=True)).to_be_visible()
    expect(page.get_by_role("region", name="可视化日程表，时间轴可滚动")).to_be_visible()

    board = page.locator(".schedule-board-scroll")
    original_bounds = board.bounding_box()
    page.get_by_role("button", name="新增时间段", exact=True).click()
    form = editor(page)
    expect(form).to_be_visible()
    assert board.bounding_box() == original_bounds, "弹窗不得改变日程表的位置和大小"
    expect(form.get_by_label("名称", exact=True)).to_be_focused()
    page.keyboard.press("Escape")
    expect(editor(page)).to_have_count(0)
    expect(page.get_by_role("button", name="新增时间段", exact=True)).to_be_focused()
    page.get_by_role("button", name="新增时间段", exact=True).click()
    page.mouse.click(5, 5)
    expect(editor(page)).to_have_count(0)
    page.get_by_role("button", name="新增时间段", exact=True).click()
    form = editor(page)
    expect(form.get_by_label("开始时间").locator("option")).to_have_count(288)
    expect(form.get_by_label("结束时间").locator("option")).to_have_count(288)
    form.get_by_label("名称", exact=True).fill("test_高等数学")
    form.get_by_label("周三", exact=True).check()
    form.get_by_label("开始时间").select_option("08:05")
    form.get_by_label("结束时间").select_option("09:40")
    submit(page)
    expect(editor(page)).to_have_count(0)
    busy = read_slots(page)[0]
    blocks = page.locator(f'[data-slot-id="{busy["id"]}"]')
    expect(blocks).to_have_count(2)
    assert abs(blocks.first.evaluate("el => parseFloat(el.style.top)") - 78) < 0.1
    assert abs(blocks.first.evaluate("el => parseFloat(el.style.height)") - 114) < 0.1

    add(page, "test_自习", "09:40", "10:30", "固定空闲")
    slots = read_slots(page)
    free = next(slot for slot in slots if slot["type"] == "free")
    busy_color = blocks.first.evaluate("el => getComputedStyle(el).backgroundColor")
    free_color = page.locator(f'[data-slot-id="{free["id"]}"]').evaluate("el => getComputedStyle(el).backgroundColor")
    assert busy_color != free_color

    # Reject conflicting occupied/free blocks, retaining the draft for correction.
    page.get_by_role("button", name="新增时间段", exact=True).click()
    form = editor(page)
    form.get_by_label("名称", exact=True).fill("test_冲突")
    form.get_by_label("固定空闲", exact=True).check()
    form.get_by_label("开始时间").select_option("09:35")
    form.get_by_label("结束时间").select_option("10:00")
    submit(page)
    expect(form.get_by_role("alert")).to_contain_text("重叠")
    assert len(read_slots(page)) == 2
    form.get_by_role("button", name="取消", exact=True).click()

    page.get_by_role("button", name="编辑时间段 test_自习", exact=True).click()
    form = editor(page)
    expect(form.get_by_label("开始时间")).to_have_value("09:40")
    form.get_by_label("名称", exact=True).fill("test_自由安排")
    form.get_by_label("周五", exact=True).check()
    form.get_by_label("开始时间").select_option("09:45")
    submit(page, "保存修改")
    expect(editor(page)).to_have_count(0)
    page.reload()
    expect(page.get_by_role("button", name="编辑时间段 test_自由安排", exact=True)).to_be_visible()
    revised = next(slot for slot in read_slots(page) if slot["id"] == free["id"])
    assert revised["weekdays"] == [1, 5]
    assert revised["startTime"] == "09:45"

    # Reversed ranges and no weekdays give inline errors before saving.
    page.get_by_role("button", name="新增时间段", exact=True).click()
    form = editor(page)
    form.get_by_label("名称", exact=True).fill("test_无效")
    form.get_by_label("周一", exact=True).uncheck()
    form.get_by_role("button", name="添加时间段", exact=True).click()
    expect(form.get_by_role("alert")).to_contain_text("至少选择")
    form.get_by_label("周一", exact=True).check()
    form.get_by_label("开始时间").select_option("12:00")
    form.get_by_label("结束时间").select_option("11:00")
    form.get_by_role("button", name="添加时间段", exact=True).click()
    expect(form.get_by_role("alert")).to_contain_text("晚于")
    form.get_by_role("button", name="取消", exact=True).click()

    add(page, "test_午夜五分钟", "23:55", "24:00", "固定空闲", ["周日"])
    last = next(slot for slot in read_slots(page) if slot["title"] == "test_午夜五分钟")
    last_block = page.locator(f'[data-slot-id="{last["id"]}"]')
    expect(last_block).to_have_count(2)
    assert abs(last_block.first.evaluate("el => parseFloat(el.style.height)") - 6) < 0.1
    # Very short blocks remain accessible through the full information list.
    expect(page.get_by_role("button", name="编辑时间段 test_午夜五分钟", exact=True)).to_contain_text("23:55–24:00")
    page.screenshot(path="/tmp/work-schedule-timetable-desktop.png", full_page=True)

    page.get_by_role("button", name="编辑时间段 test_自由安排", exact=True).click()
    form = editor(page)
    form.get_by_role("button", name="删除时间段", exact=True).click()
    form.get_by_role("button", name="确认删除", exact=True).click()
    expect(editor(page)).to_have_count(0)
    expect(page.get_by_role("button", name="编辑时间段 test_自由安排", exact=True)).to_have_count(0)
    assert len(read_slots(page)) == 2

    page.set_viewport_size({"width": 390, "height": 844})
    page.reload()
    expect(page.get_by_role("button", name="单日", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(page.locator(".schedule-day-column")).to_have_count(1)
    expect(page.get_by_role("link", name="日程", exact=True)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    page.screenshot(path="/tmp/work-schedule-timetable-mobile.png", full_page=True)
    page.get_by_role("button", name="周三", exact=True).click()
    expect(blocks).to_have_count(1)
    page.get_by_role("button", name="整周", exact=True).click()
    expect(page.locator(".schedule-day-column")).to_have_count(7)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    page.get_by_role("button", name="新增时间段", exact=True).click()
    expect(editor(page)).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    bounds = editor(page).bounding_box()
    assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= 390
    assert bounds["y"] >= 0 and bounds["y"] + bounds["height"] <= 844
    page.screenshot(path="/tmp/work-schedule-timetable-mobile-editor.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 500})
    bounds = editor(page).bounding_box()
    assert bounds["y"] >= 0 and bounds["y"] + bounds["height"] <= 500
    editor(page).get_by_role("button", name="取消", exact=True).click()
    expect(editor(page)).to_have_count(0)
    assert not errors, errors
    print("[PASS] timetable creation, 5-minute scale, type colors, overlap, editing, deletion, refresh, midnight, short slots and mobile layouts")


def main():
    with tempfile.TemporaryDirectory(prefix="work-schedule-timetable-browser-") as temp:
        env = {**os.environ, "SCHEDULE_TEST_DIR": temp, "WORK_SCHEDULE_AUTH_CONFIG": str(Path(temp) / "auth.json")}
        server = subprocess.Popen(["node", "-e", SERVER_CODE], cwd=ROOT, env=env,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            ready = server.stdout.readline()
            if not ready:
                raise RuntimeError(server.stderr.read())
            base = json.loads(ready)["url"]
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    verify(browser.new_page(viewport={"width": 1440, "height": 1000}), base)
                finally:
                    browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)


if __name__ == "__main__":
    main()
