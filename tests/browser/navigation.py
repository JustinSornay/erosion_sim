"""Terrain discovery UX using real DOM events and the unchanged physical engine.
The managed browser forbids navigable origins. Startup persistence is therefore
checked with the real app and a small injected Storage backend, in fresh pages;
it is not reported as a native file:// or HTTP reload test.
"""
from pathlib import Path
import json
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tests' / 'generated' / 'terrain-validation' / 'browser'
OUT.mkdir(parents=True, exist_ok=True)
HTML = (ROOT / 'dist' / 'erosion-simulation.html').read_text(encoding='utf-8')
checks, errors, requests = [], [], []

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
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})

    def new_page(stored=None):
        page = context.new_page()
        page.set_default_timeout(5000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url))
        if stored is not None:
            page.evaluate('''(stored) => {
                const values = { ...stored };
                Object.defineProperty(window, 'localStorage', { configurable: true, value: {
                    getItem: key => values[key] ?? null,
                    setItem: (key, value) => { values[key] = String(value); },
                }});
                window.readTestStorage = () => ({ ...values });
            }''', stored)
        page.set_content(HTML, wait_until='load')
        page.wait_for_function('typeof terrainHistory !== "undefined" && !!b')
        page.click('#pause')
        return page

    page = new_page()
    check(page.locator('#demo, #erode, #preset, #terrainSeed, #applyTerrain, #replay').count() == 0,
          'River demo, erosion checkbox, preset menu, seed, Generate and Replay controls are removed')
    check(page.evaluate('Object.hasOwn(TERRAIN_CATALOG, terrainPreset) && simulationOptions.erosion && sources.length === 0'),
          'The app opens on a new erodible landscape without a hidden demo source')
    page.click('#terrain-settings > summary')
    check(page.locator('#previousTerrain').is_disabled(), 'Previous is disabled at the beginning of history')
    check(page.locator('#terrainName').inner_text() == page.evaluate('terrainInfo(terrainPreset).name'),
          'The current relief name is shown without an editable seed')
    check(page.locator('#terrainPosition').inner_text().endswith(page.evaluate('terrainViewLabel(terrainSeed, terrainPreset)')),
          'The same compact subtitle explains the camera framing without any new setting')
    check(page.locator('#nextTerrain svg path').count() > 0, 'Both navigation arrows reuse the bundled Lucide icon geometry')
    page.evaluate('window.firstTerrain = {seed:terrainSeed, preset:terrainPreset, bed:b.slice()};')
    page.click('#nextTerrain')
    check(page.evaluate('terrainSeed !== firstTerrain.seed && terrainPreset !== firstTerrain.preset && steps === 0 && sources.length === 0'),
          'Next produces a genuinely different family and a clean simulation')
    page.evaluate('window.secondTerrain = {seed:terrainSeed, preset:terrainPreset, bed:b.slice()};')
    page.click('#previousTerrain')
    check(page.evaluate('terrainSeed === firstTerrain.seed && terrainPreset === firstTerrain.preset && b.every((h,i)=>h===firstTerrain.bed[i])'),
          'Previous restores the exact initial relief, not another random terrain')
    check(page.evaluate('document.activeElement === terrainBrowser'), 'Reaching the first relief preserves keyboard focus when Previous becomes disabled')
    page.keyboard.press('ArrowLeft')
    check(page.evaluate('terrainSeed === firstTerrain.seed'), 'Previous never wraps around or invents a terrain')
    page.keyboard.press('ArrowRight')
    check(page.evaluate('terrainSeed === secondTerrain.seed && b.every((h,i)=>h===secondTerrain.bed[i])'),
          'Keyboard navigation reuses the existing forward history')
    page.evaluate('window.beforeRepeat = terrainSeed; terrainBrowser.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight", repeat:true, bubbles:true, cancelable:true}));')
    check(page.evaluate('terrainSeed === beforeRepeat'), 'Held arrow keys do not rapidly destroy several generations')

    page.select_option('#boundary', 'closed')
    page.select_option('#rain', '0.00001')
    page.evaluate('speedEl.value="3"; speedEl.oninput(); setMode("change"); addSourceAt(64,64); for(let i=0;i<25;i++) step(); window.previousWater=getSimulationStats().water;')
    check(page.evaluate('previousWater > 0 && sources.length === 1'), 'The scene contains real simulated water before navigation')
    page.click('#nextTerrain')
    check(page.evaluate('getSimulationStats().water === 0 && sources.length === 0 && steps === 0 && budget.injected === 0 && budget.eroded === 0'),
          'Changing terrain resets water, sources, time and budgets together')
    check(page.evaluate('paused && simulationOptions.boundary === "closed" && simulationOptions.rainfall === .00001 && speedEl.value === "3" && viewMode === "change"'),
          'Navigation preserves pause, speed, rain, boundaries and the chosen visual mode')
    page.select_option('#rain', '0'); page.select_option('#boundary', 'open')
    page.evaluate('setMode("composite");')

    # Never steal panel scrolling or browser zoom. Wheel gestures are local,
    # explicitly armed, debounced, and support pixel and line-mode mice.
    page.locator('#boundary').focus()
    before = page.evaluate('terrainSeed')
    cancelled = page.evaluate('''() => {
        const event = new WheelEvent('wheel', {deltaY:120, bubbles:true, cancelable:true});
        terrainBrowser.dispatchEvent(event); return event.defaultPrevented;
    }''')
    check(not cancelled and page.evaluate('terrainSeed') == before, 'An unfocused selector does not steal wheel scrolling or change the relief')
    page.locator('.terrain-current').click()
    page.evaluate('''() => {
        window.beforeWheel = terrainHistory.current().number;
        for(let i=0;i<20;i++) terrainBrowser.dispatchEvent(new WheelEvent('wheel', {deltaY:120, bubbles:true, cancelable:true}));
    }''')
    check(page.evaluate('terrainHistory.current().number === beforeWheel + 1'), 'A fast wheel burst advances one relief rather than twenty')
    page.wait_for_timeout(400)
    page.evaluate('terrainBrowser.dispatchEvent(new WheelEvent("wheel", {deltaY:-3, deltaMode:1, bubbles:true, cancelable:true}));')
    check(page.evaluate('terrainHistory.current().number === beforeWheel'), 'Line-mode mouse wheels can return to the previous relief')
    before = page.evaluate('terrainSeed')
    cancelled = page.evaluate('''() => {
        const event = new WheelEvent('wheel', {deltaY:120, ctrlKey:true, bubbles:true, cancelable:true});
        terrainBrowser.dispatchEvent(event); return event.defaultPrevented;
    }''')
    check(not cancelled and page.evaluate('terrainSeed') == before, 'Ctrl+wheel remains available for browser zoom')
    page.locator('#terrain-browser').dispatch_event('pointerleave')
    page.wait_for_timeout(400)
    page.evaluate('terrainBrowser.dispatchEvent(new WheelEvent("wheel", {deltaY:120, bubbles:true, cancelable:true}));')
    check(page.evaluate('terrainSeed') == before and page.evaluate('terrainBrowser.contains(document.activeElement)'),
          'Leaving the selector disarms the wheel without stealing keyboard focus')
    page.locator('#c').focus(); page.keyboard.press('ArrowRight')
    check(page.evaluate('terrainSeed') == before, 'Arrow keys outside the relief selector never regenerate the scene')
    page.click('#regen')
    check(page.evaluate('terrainSeed') != before and page.evaluate('paused'), 'The existing floating regeneration button uses the same history without resuming playback')

    # Real JSON import of a new relief and an older frozen session.
    page.evaluate('addSourceAt(85,65); for(let i=0;i<40;i++)step();')
    saved = page.evaluate('exportSimulation()')
    page.click('#nextTerrain')
    page.locator('#sessionFile').set_input_files({'name':'new-relief.json', 'mimeType':'application/json', 'buffer':json.dumps(saved).encode()})
    page.wait_for_function('(seed)=>terrainSeed===seed && sources.length===1 && paused', arg=saved['seed'])
    check(page.evaluate('steps') == saved['steps'] and page.evaluate('terrainHistory.current().seed') == saved['seed'],
          'A new-relief save restores exact time and synchronizes navigation history')
    check(page.locator('#terrainName').inner_text() == page.evaluate('terrainInfo(terrainPreset).name'),
          'Imported relief names remain synchronized with the physical state')
    page.evaluate('genTerrain({seed:314159265,preset:"ridge"}); simulationOptions.erosion=false;')
    old = page.evaluate('exportSimulation()')
    page.locator('#sessionFile').set_input_files({'name':'old-relief.json', 'mimeType':'application/json', 'buffer':json.dumps(old).encode()})
    page.wait_for_function('terrainHistory.current().preset === "ridge"')
    check(page.evaluate('paused && !simulationOptions.erosion && terrainPreset === "ridge"'),
          'Old frozen saves restore faithfully even though the checkbox is gone')
    page.click('#nextTerrain')
    check(page.evaluate('simulationOptions.erosion && Object.hasOwn(TERRAIN_CATALOG, terrainPreset)'),
          'A new relief restores active erosion instead of inheriting an invisible old freeze')
    # The historic original terrain must be reachable with the unchanged
    # selector, even after the catalogue expansion.
    for _ in range(36):
        if page.evaluate('terrainPreset === "natural"'):
            break
        page.click('#nextTerrain')
    check(page.evaluate('terrainPreset === "natural" && sources.length === 0 && steps === 0'),
          'Original natural topography is once again offered in the discovery flow')
    check(page.locator('#terrainName').inner_text() == 'Terrain naturel' and
          page.locator('#terrainPosition').inner_text().endswith('Génération classique'),
          'Classic generations are named accurately without pretending to be zoomed views')
    page.evaluate('window.classicTerrain = { seed: terrainSeed, bed: b.slice() };')
    page.click('#previousTerrain'); page.click('#nextTerrain')
    check(page.evaluate('terrainSeed === classicTerrain.seed && b.every((h,i) => h === classicTerrain.bed[i])'),
          'The original natural topography remains exactly revisitable')
    page.screenshot(path=str(OUT / 'terrain-browser-desktop.png'))
    page.set_viewport_size({'width': 320, 'height': 568})
    page.click('#panel-tab'); page.wait_for_timeout(350)
    page.locator('#terrain-browser').scroll_into_view_if_needed()
    check(page.evaluate('sidePanel.scrollWidth <= sidePanel.clientWidth && document.documentElement.scrollWidth <= innerWidth'),
          'The new compact relief selector fits the 320px mobile layout')
    before = page.evaluate('terrainSeed')
    page.click('#nextTerrain')
    check(page.evaluate('terrainSeed') != before, 'Touch-sized navigation buttons remain usable on mobile')
    page.screenshot(path=str(OUT / 'terrain-browser-mobile.png'))
    page.close()

    stored, seeds, names = {}, [], []
    for opening in range(7):
        page = new_page(stored)
        seeds.append(page.evaluate('terrainSeed')); names.append(page.evaluate('terrainPreset'))
        check(page.evaluate('terrainHistory.current().number') == opening + 1,
              f'Storage-backed startup {opening + 1} advances instead of replaying the initial seed')
        if opening:
            page.click('#terrain-settings > summary'); page.click('#previousTerrain')
            check(page.evaluate('terrainSeed') == seeds[-2], f'Startup {opening + 1} retains access to the previous opening')
        stored = page.evaluate('readTestStorage()')
        page.close()
    check(len(set(seeds)) == len(seeds), 'Seven fresh application lifecycles produce seven distinct relief seeds')
    check(len(set(names[:7])) == 7, 'Repeated openings explore seven distinct families before repeating one')
    check(not errors and not requests, 'Navigation and startup checks run offline without JavaScript errors or network requests')
    (OUT / 'report.json').write_text(json.dumps({
        'passed': True, 'browser': browser.version, 'checks': checks,
        'pageErrors': errors, 'networkRequests': requests, 'openingSeeds': seeds,
        'persistenceMode': 'fresh real application pages + injected Storage backend',
        'limitation': 'Managed browser blocks file/HTTP navigation; native reloads and Windows are not tested.',
    }, indent=2), encoding='utf-8')
    context.close(); browser.close()
print(f'PASS: {len(checks)} terrain navigation checks')
