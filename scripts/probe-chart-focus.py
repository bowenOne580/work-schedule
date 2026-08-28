"""探测统计页图表内部小元素(柱子/扇区/折线点)点击后的聚焦元素。"""
from playwright.sync_api import sync_playwright

CHECK_JS = """() => {
  const el = document.activeElement;
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    tag: el.tagName,
    cls: el.getAttribute('class'),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto("http://localhost:5173/login")
    page.wait_for_load_state("networkidle")
    page.fill('input[type="text"]', "demo_user")
    page.fill('input[type="password"]', "123456")
    page.click('button[type="submit"]')
    page.wait_for_load_state("networkidle")
    print("after login url:", page.url)
    page.screenshot(path="/tmp/probe-after-login.png")
    page.goto("http://localhost:5173/app/stats")
    page.wait_for_selector(".recharts-wrapper", timeout=15000)
    page.wait_for_timeout(1500)

    # 1. 点击柱状图中的一根柱子（recharts-bar-rectangle 内的 path）
    bar = page.locator(".recharts-bar-rectangle path").first
    if bar.count() > 0:
        box = bar.bounding_box()
        if box:
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.wait_for_timeout(300)
            print("BAR click  ->", page.evaluate(CHECK_JS))
    else:
        print("BAR click  -> no bar rectangle found")

    # 2. 点击饼图扇区（recharts-pie-sector 内的 path）
    sector = page.locator(".recharts-pie-sector path")
    print("pie sector path count:", sector.count())
    if sector.count() > 0:
        box = sector.first.bounding_box()
        if box:
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.wait_for_timeout(300)
            print("PIE click  ->", page.evaluate(CHECK_JS))
        else:
            print("PIE click  -> sector bounding box is None")
    else:
        print("PIE click  -> no sector path found")

    # 3. 点击折线图的数据点
    dot = page.locator(".recharts-line circle, .recharts-line-dot")
    if dot.count() > 0:
        box = dot.first.bounding_box()
        if box:
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.wait_for_timeout(300)
            print("LINE click ->", page.evaluate(CHECK_JS))

    # 4. 点击坐标轴 / 图例等
    legend = page.locator(".recharts-legend-wrapper")
    if legend.count() > 0:
        box = legend.first.bounding_box()
        if box:
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.wait_for_timeout(300)
            print("LEGEND click ->", page.evaluate(CHECK_JS))

    # 5. 最终全文档扫描：仍带 outline 的元素
    outlined = page.evaluate("""() => {
      const res = [];
      document.querySelectorAll('*').forEach((n) => {
        const s = getComputedStyle(n);
        if (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') {
          res.push(n.tagName + '.' + (n.getAttribute('class') || ''));
        }
      });
      return res;
    }""")
    print("FINAL outlined elements:", len(outlined), outlined[:10])

    page.screenshot(path="/tmp/stats-inner-click.png", full_page=True)
    browser.close()
