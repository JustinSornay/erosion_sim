"""Check the original compact layout, real edge clicks and local entry points.
Uses the same Playwright/Chromium setup as smoke.py. No remote resources.
"""
from pathlib import Path
import json
import os
import shutil
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tests' / 'generated' / 'design-validation' / 'layout'
OUT.mkdir(parents=True, exist_ok=True)
checks = []

def check(condition, description):
    assert condition, description
    checks.append(description)
    print('PASS:', description, flush=True)

with sync_playwright() as p:
    options = {'headless': True}
    executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
    if executable:
        options['executable_path'] = executable
    if hasattr(os, 'geteuid') and os.geteuid() == 0:
        options['args'] = ['--no-sandbox']
    browser = p.chromium.launch(**options)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, offline=True)
    page = context.new_page()
    page.set_default_timeout(5000)
    errors, requests, layouts = [], [], []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.on('request', lambda req: requests.append(req.url))
    page.set_content((ROOT / 'dist' / 'erosion-simulation.html').read_text(encoding='utf-8'), wait_until='load')
    page.click('#pause')
    before = page.evaluate('({steps, time:simTime, water:getSimulationStats().water, seed:terrainSeed})')
    for width, height in [(1440, 1000), (1365, 768), (1920, 1080), (1024, 768), (768, 1024), (390, 844), (320, 568), (844, 390)]:
        label = f'{width}x{height}'
        page.set_viewport_size({'width': width, 'height': height})
        page.evaluate('setPanelOpen(false); document.getElementById("terrain-settings").open=false; document.getElementById("simulation-budget").open=false; sidePanel.scrollTop=0;')
        page.wait_for_timeout(350)
        box = page.locator('#c').bounding_box()
        bar = page.locator('#bottom-bar').bounding_box()
        stage = page.locator('#stage').bounding_box()
        panel = page.locator('#side-panel').bounding_box()
        check(abs(box['width'] - box['height']) < .1 and box['x'] >= 0 and box['y'] >= 0 and box['x']+box['width'] <= stage['width']+.1 and box['y']+box['height'] <= height+.1, f'{label}: square terrain fits the visible stage')
        check(bar['x'] >= 0 and bar['x']+bar['width'] <= stage['width']+.1 and bar['y']+bar['height'] <= height, f'{label}: full floating transport bar fits')
        check(page.evaluate('scrollX === 0 && scrollY === 0 && document.documentElement.scrollWidth <= innerWidth'), f'{label}: no document overflow or focus-induced scrolling')
        # Edge context menu must stay inside the stage, rather than under settings.
        page.locator('#c').click(position={'x':box['width']-5, 'y':box['height']*.3}, button='right')
        menu = page.locator('#context-menu').bounding_box()
        check(menu['x'] >= stage['x'] and menu['x']+menu['width'] <= stage['x']+stage['width']+.1, f'{label}: edge context menu is not clipped by the panel')
        page.click('#ctx-add-source')
        check(page.evaluate('sources.length === 1 && sources[0].x >= 188'), f'{label}: edge menu action still reaches the real simulation')
        page.click('#clearSrc')
        if width < 768:
            check(page.evaluate('sidePanel.inert'), f'{label}: closed mobile panel is inert')
            page.click('#panel-tab'); page.wait_for_timeout(350)
            panel = page.locator('#side-panel').bounding_box()
            check(abs(panel['x']+panel['width']-width) < .1 and panel['x'] >= 0 and page.evaluate('scrollX === 0'), f'{label}: mobile drawer remains anchored to the viewport after focus')
            check(page.locator('#panel-tab').get_attribute('aria-expanded') == 'true', f'{label}: mobile drawer exposes its expanded state')
        check(page.evaluate('sidePanel.scrollWidth <= sidePanel.clientWidth'), f'{label}: panel contents do not overflow horizontally')
        page.click('#terrain-settings > summary')
        page.locator('#terrainSeed').fill('314159265')
        check(page.evaluate('document.getElementById("terrain-settings").open'), f'{label}: added settings remain reachable')
        page.click('#simulation-budget > summary')
        page.locator('#statWater').scroll_into_view_if_needed()
        check(page.locator('#statWater').is_visible() and page.locator('#budget-status').is_visible(), f'{label}: detailed budgets remain reachable')
        check(page.evaluate('sidePanel.scrollWidth <= sidePanel.clientWidth'), f'{label}: expanded settings and budgets fit the panel')
        layouts.append({'viewport':label, 'canvas':box, 'bar':bar, 'panel':panel})
        if width in [1440, 320, 768, 844]:
            page.screenshot(path=str(OUT / f'expanded-{label}.png'))
        if width < 768:
            page.locator('#terrainSeed').focus(); page.keyboard.press('Escape'); page.wait_for_timeout(350)
            check(page.evaluate('sidePanel.inert && document.activeElement === panelTab && scrollX === 0'), f'{label}: Escape from a field safely closes the drawer')
    after = page.evaluate('({steps, time:simTime, water:getSimulationStats().water, seed:terrainSeed})')
    check(before == after, 'Layout changes and empty-source editing do not advance or regenerate the paused simulation')
    check(not errors and not requests, 'All responsive layouts work offline without JavaScript errors or network requests')
    context.close()

    # The container's browser policy blocks top-level localhost navigation.
    # Load the unchanged scripts and styles separately through local fulfillment;
    # rewrite only their URLs, not their contents. No HTTP service is contacted.
    served = browser.new_page(viewport={'width':1280,'height':800})
    served_errors, served_requests, bad_responses = [], [], []
    served.on('pageerror', lambda err: served_errors.append(str(err)))
    served.on('request', lambda req: served_requests.append(req.url))
    served.on('response', lambda res: bad_responses.append(f'{res.status} {res.url}') if res.status >= 400 else None)
    base = 'https://erosion.test/'
    def local_asset(route):
        url = route.request.url
        if not url.startswith(base):
            route.abort(); return
        file = (ROOT / url[len(base):]).resolve()
        if not file.is_relative_to(ROOT) or not file.is_file():
            route.fulfill(status=404,body='Missing local asset'); return
        mime = 'text/css' if file.suffix == '.css' else 'text/javascript'
        route.fulfill(status=200,content_type=mime,body=file.read_bytes())
    served.route('**/*', local_asset)
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    html = re.sub(r'(src|href)="\./([^"\s]+)"', lambda m: f'{m[1]}="{base}{m[2]}"', html)
    served.set_content(html,wait_until='networkidle')
    served.click('#pause')
    check(served.evaluate('terrainPreset === "natural" && typeof getSimulationStats === "function"'), 'Multi-file HTML initializes with its separately loaded local assets')
    check(served.locator('.layer-item').count()==6 and served.locator('#pauseIcon').get_attribute('data-icon')=='play' and served.locator('#pauseIcon path').count()>0, 'Multi-file entry point loads layer controls and Lucide icons')
    check(len(served_requests)==21 and not served_errors and not bad_responses and all(url.startswith(base) for url in served_requests), 'All 21 separate script/style assets load through local fulfillment without errors')
    served.screenshot(path=str(OUT / 'multi-file.png'))
    served.close()
    report = {'passed':True, 'browser':browser.version, 'checks':checks, 'layouts':layouts, 'pageErrors':errors, 'networkRequests':requests, 'entryPointMode':'injected HTML + intercepted local assets (no HTTP server)', 'entryPointErrors':served_errors, 'entryPointRequests':served_requests, 'httpErrors':bad_responses, 'limitation':'Top-level localhost navigation is blocked by the container browser policy; native file opening on Windows is not tested.'}
    (OUT / 'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    browser.close()
print(f'PASS: {len(checks)} layout and entry-point checks')
