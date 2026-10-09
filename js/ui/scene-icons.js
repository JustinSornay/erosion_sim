// Small local weather glyphs in the existing 24px / 2px-stroke visual language.
// Kept separate from the committed Lucide bundle: fully reproducible offline.
(() => {
  const original = UIIcons.createIcon;
  const cloud = 'M5 14a4 4 0 0 1-.3-8 6 6 0 0 1 11.1-1A4.5 4.5 0 0 1 20 14';
  const paths = {
    'chevron-right': ['m9 18 6-6-6-6'],
    'cloud-drizzle': [cloud, 'M8 17v.5M12 19v.5M16 17v.5'],
    'cloud-rain': [cloud, 'M8 17v3M16 17v3'],
    'cloud-rain-wind': [cloud, 'm8 17-2 4m8-4-2 4m8-4-2 4'],
    'cloud-rain-heavy': [cloud, 'm6 17-1 4m5-4-1 4m5-4-1 4m5-4-1 4'],
  };
  function createIcon(name) {
    if (!paths[name]) return original(name);
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    for (const [key, value] of Object.entries({viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icon',
      'data-icon': name, 'aria-hidden': 'true', focusable: 'false'})) svg.setAttribute(key, value);
    for (const d of paths[name]) { const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); svg.appendChild(path); }
    return svg;
  }
  function setIcon(element, name) {
    const icon = createIcon(name);
    for (const attribute of icon.attributes) element.setAttribute(attribute.name, attribute.value);
    element.replaceChildren(...icon.childNodes);
  }
  UIIcons = {...UIIcons, createIcon, setIcon, initializeIcons() {
    document.querySelectorAll('svg[data-icon]').forEach(svg => setIcon(svg, svg.dataset.icon));
  }};
})();
