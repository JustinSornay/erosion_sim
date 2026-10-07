"""Offline UI and real-engine tests. Requires Python, Playwright and Chromium.
The standalone DOM is loaded in memory; this also works where file:// navigation
is forbidden by an enterprise browser policy. No mocked physics or network.
"""
from pathlib import Path
import json
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tests' / 'generated' / 'v2-validation' / 'browser'
OUT.mkdir(parents=True, exist_ok=True)
checks = []
def check(condition, description):
    assert condition, description
    checks.append(description)
    print('PASS:', description, flush=True)

with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
    options = {'headless': True}
    if executable:
        options['executable_path'] = executable
    if hasattr(os, 'geteuid') and os.geteuid() == 0:
        options['args'] = ['--no-sandbox']
    browser = p.chromium.launch(**options)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(6000)
    errors, requests = [], []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.on('request', lambda req: requests.append(req.url))
    page.set_content((ROOT / 'dist' / 'erosion-simulation.html').read_text(encoding='utf-8'), wait_until='load')
    page.wait_for_function('typeof getSimulationStats === "function" && !!b')
    check(not errors, 'Application initializes without a JavaScript error')
    check(not requests, 'No remote assets or network requests')
    page.click('#pause')
    check(page.evaluate('paused'), 'Pause button pauses the simulation')
    canvas = page.locator('#c')
    box = canvas.bounding_box()
    panel = page.locator('#side-panel').bounding_box()
    check(box['x'] + box['width'] <= panel['x'], 'Desktop terrain is not hidden under settings')
    pos = {'x': (107.5 / 192) * box['width'], 'y': (22.5 / 192) * box['height']}
    canvas.click(position=pos)
    page.wait_for_timeout(140)
    check(page.evaluate('sources.length === 1 && sources[0].x === 107 && sources[0].y === 22'), 'Real click creates a source at the clicked cell')
    page.click('#pause')
    page.wait_for_function('getSimulationStats().water > 0.03')
    check(page.evaluate('getSimulationStats().injected > 0'), 'Source actually injects water when running')
    page.click('#pause')
    step_count = page.evaluate('steps')
    page.wait_for_timeout(220)
    check(page.evaluate('steps') == step_count, 'No hidden stepping while paused')
    rate = page.locator('.src-row input')
    rate.fill('4.5'); rate.dispatch_event('change')
    check(page.evaluate('sources[0].rate === 4.5'), 'Source discharge is editable')
    rate.fill('-1'); rate.dispatch_event('change')
    check(page.evaluate('sources[0].rate === 4.5'), 'Invalid discharge cannot corrupt the engine')
    page.click('.source-toggle')
    injected = page.evaluate('budget.injected')
    page.click('#pause'); page.wait_for_timeout(180); page.click('#pause')
    check(page.evaluate('budget.injected') == injected, 'Turning a source off stops injection')
    canvas.click(position=pos, button='right')
    page.click('#ctx-toggle-source')
    check(page.evaluate('sources[0].active'), 'Context menu toggles a source')
    canvas.click(position=pos, button='right'); page.click('#ctx-delete-source')
    check(page.evaluate('sources.length === 0'), 'Context menu deletes a source')

    page.evaluate('simulationOptions.evaporation=9; simulationOptions.capacity=9; simulationOptions.erosionRate=90;')
    page.click('#demo'); page.click('#pause')
    check(page.evaluate('simulationOptions.evaporation === .002 && simulationOptions.capacity === .22 && simulationOptions.erosionRate === 2.7'), 'Demo resets custom imported physical options')
    page.evaluate('for(let i=0;i<1500;i++)step();computeActiveNetwork();render(DEFAULT_ISO_STEP);updateMetrics();')
    page.wait_for_timeout(150)
    stats = page.evaluate('getSimulationStats()')
    check(stats['waterOut'] > 10 and stats['eroded'] > 1 and stats['deposited'] > .1, 'River demo flows out, erodes and deposits in the browser')
    check(abs(stats['waterResidual']) < 1e-8 and abs(stats['solidResidual']) < 1e-8, 'Browser engine preserves both budgets')
    blue = page.evaluate('''(() => {let count=0; for(let i=0;i<NN;i++) {
      if(Math.hypot(i%N-107,Math.floor(i/N)-22)<8)continue;
      if(img.data[i*4+2]>img.data[i*4]*1.15 && d[i]>0.0001)count++;
    }return count;})()''')
    check(blue > 500, 'Flowing water is visibly blue beyond the source marker')
    page.evaluate('document.getElementById("toast").classList.remove("visible")')
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / 'river.png'))
    page.click('[data-m="change"]'); page.wait_for_timeout(120)
    check(page.evaluate('viewMode === "change"'), 'Erosion/deposition view is reachable')
    page.screenshot(path=str(OUT / 'erosion-deposition.png'))
    page.click('[data-m="contribution"]'); page.wait_for_timeout(120)
    check(page.evaluate('viewMode === "contribution" && drainReady'), 'D8 analysis remains distinct from actual water')
    page.click('[data-m="composite"]')
    with page.expect_download() as download_info:
        page.click('#saveSession')
    saved_path = OUT / 'roundtrip.json'
    download_info.value.save_as(str(saved_path))
    saved = json.loads(saved_path.read_text())
    page.click('#clearSrc')
    page.locator('#sessionFile').set_input_files(str(saved_path))
    page.wait_for_function('sources.length === 1 && paused')
    check(page.evaluate('steps') == saved['steps'], 'A saved session restores its exact step count')
    check(abs(page.evaluate('getSimulationStats().water') - sum(saved['fields']['d'])) < 1e-10, 'A saved session restores physical water, not just UI state')
    before_bad = page.evaluate('steps')
    page.locator('#sessionFile').set_input_files({'name': 'invalid.json', 'mimeType': 'application/json', 'buffer': b'{"version":1}'})
    page.wait_for_timeout(120)
    check(page.evaluate('steps') == before_bad and page.evaluate('sources.length') == 1, 'Invalid save leaves the live session intact')
    page.click('#replay')
    check(page.evaluate('steps === 0 && sources.length === 1 && terrainSeed === 314159265'), 'Replay resets the same terrain and preserves sources')
    page.select_option('#rain', '0.00001'); page.select_option('#boundary', 'closed'); page.uncheck('#erode')
    check(page.evaluate('simulationOptions.rainfall === .00001 && simulationOptions.boundary === "closed" && !simulationOptions.erosion'), 'Rain, boundaries and erosion controls reach the engine')
    canvas.focus(); page.keyboard.press('Space')
    check(page.evaluate('!paused'), 'Space toggles playback outside form controls')
    page.click('#pause')
    page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(150)
    check(canvas.bounding_box()['width'] <= 390, 'Canvas fits a mobile viewport')
    page.click('#panel-tab'); page.wait_for_timeout(350)
    mobile_panel = page.locator('#side-panel').bounding_box()
    check(mobile_panel['x'] >= 0 and mobile_panel['x'] + mobile_panel['width'] <= 391, 'Mobile settings open within the viewport')
    page.screenshot(path=str(OUT / 'mobile-settings.png'))
    page.click('#close-panel'); page.wait_for_timeout(350)
    check(not page.evaluate('sidePanel.classList.contains("open")'), 'Mobile settings close normally')
    check(not errors, 'No JavaScript errors throughout the interaction sequence')
    saved_path.unlink()
    report = {'passed': True, 'browser': browser.version, 'mode': 'offline-inline-bundle', 'checks': checks, 'statsAt1500': stats, 'blueCellsBeyondSource': blue, 'pageErrors': errors, 'networkRequests': requests}
    (OUT / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    context.close(); browser.close()
print(f'PASS: {len(checks)} browser checks')
