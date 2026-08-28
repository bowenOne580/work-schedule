"""验证统计页图表点击后是否仍出现黑色聚焦框。"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto("http://localhost:5173/login")
    page.wait_for_load_state("networkidle")

    # 使用统一测试账号登录
    page.fill('input[type="text"], input[name="username"], #username', "demo_user")
    page.fill('input[type="password"]', "123456")
    page.click('button[type="submit"]')
    page.wait_for_load_state("networkidle")
    print("after login url:", page.url)
    page.screenshot(path="/tmp/after-login.png")
    page.goto("http://localhost:5173/app/stats")
    page.wait_for_selector(".recharts-wrapper", timeout=15000)
    page.wait_for_timeout(1500)

    # 点击柱状图中央
    chart = page.locator(".recharts-wrapper").first
    box = chart.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(500)

    info = page.evaluate(
        """() => {
      const el = document.activeElement;
      const cs = el ? getComputedStyle(el) : null;
      // 扫描所有元素，找出 outline 不为 none 的
      const outlined = [];
      document.querySelectorAll('*').forEach((n) => {
        const s = getComputedStyle(n);
        if (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') {
          outlined.push(`${n.tagName}.${n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className}`);
        }
      });
      return {
        active: el ? `${el.tagName} class=${el.getAttribute('class')}` : null,
        outlineStyle: cs ? cs.outlineStyle : null,
        outlineWidth: cs ? cs.outlineWidth : null,
        outlinedCount: outlined.length,
        outlined: outlined.slice(0, 10),
      };
    }"""
    )
    print("activeElement:", info["active"])
    print("outline:", info["outlineStyle"], info["outlineWidth"])
    print("outlined elements:", info["outlinedCount"], info["outlined"])

    page.screenshot(path="/tmp/stats-after-click.png", full_page=True)
    browser.close()
