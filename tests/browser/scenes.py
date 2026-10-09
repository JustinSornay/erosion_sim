"""Real Chromium, local entry points and real physics; no mock engine.
Run: python tests/browser/scenes.py (includes navigation and eight viewports).
CHROMIUM_EXECUTABLE may specify a non-default browser installation.
"""
from pathlib import Path
import json
import base64
import os
import shutil
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tests/generated/scenes-validation/browser'
OUT.mkdir(parents=True, exist_ok=True)
checks, errors, remote = [], [], []
# Enterprise Chromium blocks both file:// and loopback navigation here.
# Load the real standalone document in memory; a Storage-compatible adapter
# exercises application persistence without claiming native localStorage QA.

def check(condition, description):
    assert condition, description
    checks.append(description)
    print('PASS:', description, flush=True)

def apply(page, preset, seed=12347):
    page.evaluate('''({preset,seed})=>{
      generateScene({preset,seed}); terrainHistory.remember({preset,seed});
      paused=true; refreshSceneUI(); render(DEFAULT_ISO_STEP);
    }''', {'preset':preset,'seed':seed})

with sync_playwright() as p:
    exe = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
    launch = {'headless':True}
    if exe: launch['executable_path'] = exe
    if hasattr(os, 'geteuid') and os.geteuid() == 0: launch['args'] = ['--no-sandbox']
    browser = p.chromium.launch(**launch)
    context = browser.new_context(viewport={'width':1440,'height':950}, accept_downloads=True)
    def new_page(stored=None, html=None):
        page=context.new_page();page.set_default_timeout(8000)
        page.on('pageerror',lambda err:errors.append(str(err)))
        page.on('request',lambda req:remote.append(req.url))
        page.evaluate("""(stored)=>{
          const values=new Map(Object.entries(stored));
          const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),clear:()=>values.clear()};
          Object.defineProperty(window,'localStorage',{configurable:true,get:()=>storage});
          window.readTestStorage=()=>Object.fromEntries(values);
        }""",stored or {})
        page.set_content(html or (ROOT/'dist/erosion-simulation.html').read_text(),wait_until='load')
        return page
    page=new_page()
    page.wait_for_function('typeof sceneState !== "undefined" && sceneState !== null && steps>1')
    page.click('#pause')
    check(page.evaluate('paused && sceneState.initialWetCells>0'), 'First visit opens a live, prefilled aquatic card')
    check(not errors and not remote, 'The actual standalone document initializes in memory without any network request')
    check(page.locator('h1').inner_text() == 'Sandbox Hydrographique', 'The existing title is retained')
    check(page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == '#d2a15c', 'Original warm accent color is retained')
    check(page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--water').trim()") == '#4c8fb5', 'Original water/UI color is retained')
    check(page.locator('#terrain-browser').is_visible() and page.locator('#rainToggle').is_visible(), 'Card browsing and rain are directly visible')
    check(page.locator('select,input[type=number],input[type=range]').count() == 0, 'No boundary, rainfall intensity, source discharge or speed slider remains')
    check(page.locator('.modes button').count() == 2, 'Two view choices replace three persistent analysis tabs')
    check(not page.evaluate('document.getElementById("display-settings").open || document.getElementById("simulation-budget").open'), 'Display and diagnostics start collapsed')
    check(page.locator('#bottom-bar button').count() == 3, 'Floating transport contains only playback, speed and next card')

    apply(page,'island')
    initial = page.evaluate('exportSimulation()')
    profile = initial['scene']
    check(profile['initialSourceCount']>0, 'An island card can include an upstream preconfigured source')
    check(page.locator('#rainToggle').get_attribute('aria-pressed') == str(profile['rainDefault']).lower(), 'Rain button reflects the card default')
    icon = page.locator('#rainIcon').get_attribute('data-icon')
    page.click('#rainToggle')
    check(page.evaluate('simulationOptions.rainfall') == (0 if profile['rainDefault'] else profile['rainRate']), 'Rain has only off and the prescribed on-rate')
    check(page.locator('#rainIcon').get_attribute('data-icon') == icon, 'Switching rain off preserves the intensity-specific glyph')
    page.click('#rainToggle')
    check(page.evaluate('simulationOptions.rainfall') == initial['options']['rainfall'], 'Switching back recovers the exact prescribed rainfall')
    check(page.evaluate('exportSimulation().fields.d') == initial['fields']['d'], 'Rain toggle never erases or repaints standing water')
    check(page.locator('#sources input').count()==0, 'Sources display read-only discharge levels instead of numeric editors')
    page.locator('.source-toggle').first.click()
    check(not page.evaluate('sources[0].active'), 'An automatically placed source can be turned off')
    page.locator('.source-toggle').first.click()
    check(page.evaluate('sources[0].active'), 'The same source can be reactivated')
    page.click('#clearSrc')
    check(page.evaluate('sources.length')==0 and page.evaluate('getSimulationStats().water')>100, 'Removing sources does not remove the sea')
    page.click('#restartScene')
    check(page.evaluate('exportSimulation()') == initial, 'Restart restores the entire initial scene, not just its height field')
    check(page.evaluate('paused'), 'Restart preserves pause state')

    speeds=[]
    for _ in range(4):
        page.click('#speed');speeds.append(page.locator('#speedLbl').inner_text())
    check(speeds == ['\u00d72','\u00d75','\u00d710','\u00d71'], 'A single speed button cycles through the four existing speeds')
    page.click('#speed')
    page.click('#rainToggle')
    page.click('#nextTerrain')
    check(page.evaluate('paused && SPEED_STEPS[Number(speedEl.value)]===2'), 'Browsing preserves playback and speed')
    check(page.evaluate('simulationOptions.rainfall === (sceneState.rainDefault ? sceneState.rainRate : 0)'), 'The next card uses its own rain default, not the previous toggle')
    page.click('#previousTerrain')
    check(page.evaluate('exportSimulation()') == initial, 'Previous returns the exact initial water, rain and sources of the previous card')
    page.click('#nextTerrain');next_seed=page.evaluate('terrainSeed')
    page.locator('#terrain-browser').focus();page.keyboard.press('ArrowLeft');page.keyboard.press('ArrowRight')
    check(page.evaluate('terrainSeed')==next_seed, 'Keyboard left/right shares the same card history')
    page.locator('#terrain-browser').click(position={'x':110,'y':25})
    page.locator('#terrain-browser').dispatch_event('wheel',{'deltaY':120,'cancelable':True})
    check(page.evaluate('terrainSeed')!=next_seed, 'An explicitly focused selector supports wheel browsing')
    before=page.evaluate('terrainSeed')
    page.locator('#terrain-browser').dispatch_event('pointerleave')
    page.locator('#terrain-browser').dispatch_event('wheel',{'deltaY':120,'cancelable':True})
    check(page.evaluate('terrainSeed')==before, 'Leaving the selector disarms the wheel')
    page.locator('#c').focus();page.keyboard.press('ArrowRight')
    check(page.evaluate('terrainSeed')==before, 'Arrow keys outside the card selector do not change the map')
    page.click('#regen');check(page.evaluate('terrainSeed')!=before, 'Floating next-card button shares the same navigation')

    for preset,seed in [('glacial',2),('headwaters',1),('island',12347),('badlands',2)]:
        apply(page,preset,seed)
        check(page.locator('#rainIcon path').count()>=2 and page.locator('#rainIcon').get_attribute('data-icon')==page.evaluate('rainAppearance(sceneState.rainRate).icon'), f'{preset}: correct rain glyph for actual intensity')
    apply(page,'mesas',2)
    check(page.evaluate('sources.length===0 && simulationOptions.rainfall===0'), 'An arid card can start with neither sources nor rain')
    rate=page.evaluate('sceneState.rainRate');page.click('#rainToggle')
    check(page.evaluate('simulationOptions.rainfall')==rate, 'A dry card still permits its prescribed rain to be activated')

    # Source interaction on an emergent cell, with exact click coordinate mapping.
    apply(page,'island',4);page.evaluate('sources.length=0;refreshSourceList()')
    position=page.evaluate('''()=>{for(let y=70;y<125;y++)for(let x=70;x<125;x++)if(d[y*N+x]===0)return {x,y};}''')
    box=page.locator('#c').bounding_box()
    sx=box['x']+(position['x']+.5)/192*box['width'];sy=box['y']+(position['y']+.5)/192*box['height']
    page.mouse.click(sx,sy)
    check(page.evaluate('sources.length')==1, 'Clicking emergent terrain adds a source')
    check(page.evaluate('sources[0].rate===sceneState.manualSourceRate'), 'Manual sources inherit the card-appropriate discharge')
    page.mouse.click(sx,sy,button='right')
    check(page.locator('#ctx-toggle-source').is_visible(), 'Context menu recognizes sources at the exact clicked position')
    page.click('#ctx-toggle-source');check(not page.evaluate('sources[0].active'), 'Context-menu source toggle remains functional')
    page.mouse.click(box['x']+5,box['y']+5)
    check(page.evaluate('sources.length')==1, 'Clicking deep sea does not create an accidental underwater source')

    apply(page,'estuary',12347);page.evaluate('for(let i=0;i<35;i++)step();updateMetrics()')
    with page.expect_download() as event:
        page.click('#saveSession')
    saved_file=OUT/'saved-scene.json';event.value.save_as(str(saved_file))
    saved=json.loads(saved_file.read_text())
    check(saved['version']==3 and saved['marine'] is not None and len(saved['marine']['flux'])==768, 'Actual downloaded snapshot includes card climate and marine momentum')
    page.click('#nextTerrain')
    page.locator('#sessionFile').set_input_files(str(saved_file))
    page.wait_for_function('(seed)=>terrainSeed===seed && paused',arg=saved['seed'])
    check(page.evaluate('exportSimulation()')==saved, 'Actual file import restores every saved physical buffer and option exactly')
    check(page.locator('#rainToggle').get_attribute('aria-pressed')==str(saved['options']['rainfall']>0).lower(), 'Imported rainfall state matches the button')
    saved_file.unlink()
    # Authentic v2 structure from the historical raw terrain API.
    legacy=page.evaluate('''()=>{genTerrain({preset:'natural',seed:314159265});simulationOptions.rainfall=.000017;
      const old=exportSimulation();old.version=2;delete old.scene;delete old.marine;delete old.budget.waterIn;return old;}''')
    page.locator('#sessionFile').set_input_files({'name':'old-v2.json','mimeType':'application/json','buffer':json.dumps(legacy).encode()})
    page.wait_for_function('terrainPreset === "natural" && paused')
    check(page.evaluate('seaLevel===null && simulationOptions.rainfall===.000017 && sceneState===null'), 'Old v2 sessions retain exact rain and no invented sea boundary')
    page.click('#rainToggle');page.click('#rainToggle')
    check(page.evaluate('simulationOptions.rainfall')==.000017, 'An imported legacy custom rate is fixed but still switchable')
    old_seed=page.evaluate('terrainSeed')
    page.locator('#sessionFile').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'{"version":99}'})
    page.wait_for_function('document.getElementById("toast").classList.contains("error")')
    check(page.evaluate('terrainSeed')==old_seed, 'Invalid import leaves the current map untouched')

    apply(page,'island')
    page.click('#display-settings > summary');page.click('[data-m=change]')
    check(page.evaluate('viewMode==="change"') and not page.locator('#stage-hint').is_hidden(), 'The erosion view retains its explanation')
    page.click('[data-m=composite]');page.locator('.layer-item[data-id=contours]').click()
    check(not page.evaluate('layerOn.contours'), 'Optional terrain contours still toggle')
    page.locator('.layer-item[data-id=contours]').click()
    page.click('#simulation-budget > summary');page.click('#analysisToggle')
    check(page.evaluate('viewMode==="contribution"'), 'Potential-flow analysis remains available in diagnostics')
    page.click('#analysisToggle');page.click('#simulation-budget > summary');page.click('#display-settings > summary')
    check(page.evaluate('viewMode==="composite"'), 'Leaving analysis restores the landscape view')

    # Fresh application lifecycles with a Storage-compatible backend. The
    # app and generator are real; native browser storage is not under test.
    apply(page,'island',934751)  # A new tip entry, not a revisit inside older history.
    old_seed=page.evaluate('terrainSeed');old_number=page.evaluate('terrainHistory.current().number')
    stored=page.evaluate('readTestStorage()');page.close();page=new_page(stored)
    page.wait_for_function('sceneState!==null');page.click('#pause')
    check(page.evaluate('terrainSeed')!=old_seed, 'A fresh application lifecycle advances the seed instead of replaying the initial map')
    check(page.evaluate('terrainHistory.current().number')==old_number+1, 'A fresh lifecycle preserves the stored history and sequence number')
    page.click('#previousTerrain');check(page.evaluate('terrainSeed')==old_seed, 'Previous can recover the map from before reload')

    for width,height in [(320,568),(360,640),(390,844),(768,1024),(1024,768),(1280,720),(1440,950),(1920,1080)]:
        page.set_viewport_size({'width':width,'height':height});apply(page,'lagoon',12347)
        if width<768:
            page.evaluate('setPanelOpen(false)');page.wait_for_timeout(320);page.click('#panel-tab');page.wait_for_timeout(320)
        page.locator('#terrain-browser').scroll_into_view_if_needed()
        check(page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'{width}x{height}: no horizontal viewport overflow')
        check(page.evaluate('sidePanel.scrollWidth<=sidePanel.clientWidth'), f'{width}x{height}: no clipped side-panel contents')
        check(page.locator('#rainToggle').is_visible() and page.locator('#nextTerrain').is_enabled(), f'{width}x{height}: primary controls remain reachable')
        page.click('#rainToggle');page.click('#rainToggle');before=page.evaluate('terrainSeed');page.click('#nextTerrain')
        check(page.evaluate('terrainSeed')!=before, f'{width}x{height}: next button remains usable')
        if width<768:
            page.keyboard.press('Escape')
            check(page.evaluate('sidePanel.inert && document.activeElement===panelTab'), f'{width}x{height}: closing drawer restores focus and makes it inert')
            page.screenshot(path=str(OUT/f'mobile-{width}.png'))
        if width==1440:
            apply(page,'island');page.screenshot(path=str(OUT/'desktop.png'))
    page.set_viewport_size({'width':1440,'height':950})
    for preset,seed in [('island',12347),('archipelago',17),('coast',28),('estuary',4),('fjord',2),('lagoon',12347),('atoll',8),('lake',1),('craterlake',2)]:
        apply(page,preset,seed)
        pixels=page.evaluate("canvas.toDataURL('image/png').split(',')[1]")
        (OUT/f'{preset}.png').write_bytes(base64.b64decode(pixels))
        check(page.evaluate('sceneState.initialWetCells>0'), f'{preset}: actual rendered card contains initialized water')
    page.set_viewport_size({'width':390,'height':844});apply(page,'archipelago',17)
    page.evaluate('setPanelOpen(true)');page.wait_for_timeout(320)
    page.screenshot(path=str(OUT/'mobile-panel.png'))
    check(not errors and not remote, 'All interactions and layouts stay offline and free from JavaScript errors')

    # Verify source scripts assembled in document order as a second entry.
    source_html=(ROOT/'index.html').read_text()
    code=[]
    def script_match(match):
        code.append((ROOT/match.group(1)).read_text());return ''
    source_html=re.sub(r'<script defer src="\./([^"]+)"></script>',script_match,source_html)
    source_html=re.sub(r'<link rel="stylesheet" href="\./([^"]+)"\s*/>',lambda m:'<style>'+ (ROOT/m.group(1)).read_text()+'</style>',source_html)
    source_html=source_html.replace('</body>','<script>'+ '\n;\n'.join(code).replace('</script','<\\/script')+'</script></body>')
    other=new_page(html=source_html);other.wait_for_function('sceneState!==null && steps>1')
    check(other.evaluate('getSimulationStats().finite') and not errors, 'The source scripts also initialize in document order without remote assets')
    other.close()
    (OUT/'report.json').write_text(json.dumps({'passed':True,'browser':browser.version,'checks':checks,'count':len(checks),'errors':errors,'remoteRequests':remote,'loading':'real standalone via set_content; Storage-compatible test adapter','limits':['file:// and localhost blocked by browser policy','native browser storage and Windows not tested']},indent=2))
    browser.close()
print(f'{len(checks)} browser checks passed')
