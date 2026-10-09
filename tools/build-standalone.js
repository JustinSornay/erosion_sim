const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Bundle only the selected Lucide icons; both entry points must work without a network.
// --skip-icons reuses the committed bundle for offline HTML/CSS/engine edits.
// Do not use this flag after changing UiIcons.js or the Lucide dependency.
if (process.argv.includes('--skip-icons')) {
  if (!fs.existsSync(path.join(root, 'js/ui/icons.js'))) throw new Error('The local icon bundle is missing. Run npm ci and npm run build.');
} else {
require('esbuild').buildSync({
  entryPoints: [path.join(root, 'js/ui/00-Helpers/UiIcons.js')],
  outfile: path.join(root, 'js/ui/icons.js'),
  bundle: true,
  format: 'iife',
  globalName: 'UIIcons',
  minify: true,
  legalComments: 'inline',
  banner: {
    js: '// Generated from UiIcons.js and Lucide by npm run build.\n/*\n' +
      fs.readFileSync(path.join(path.dirname(require.resolve('lucide/package.json')), 'LICENSE'), 'utf8') +
      '\n*/',
  },
});
}
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [];
html = html.replace(/^[ \t]*<script defer src="\.\/([^"]+)"><\/script>/gm, (_, file) => {
  scripts.push(fs.readFileSync(path.join(root, file), 'utf8'));
  return '';
});
html = html.replace(/<link rel="stylesheet" href="\.\/([^"]+)"\s*\/>/g, (_, file) =>
  '<style>\n' + fs.readFileSync(path.join(root, file), 'utf8') + '\n</style>');
if (/<(?:script|link)[^>]+(?:src|href)="https?:/i.test(html)) throw new Error('A remote dependency remains.');
const code = scripts.join('\n;\n').replace(/<\/script/gi, '<\\/script');
html = html.replace('</body>', '<script>\n' + code + '\n</script>\n</body>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'erosion-simulation.html');
fs.writeFileSync(out, html);
console.log(`Standalone: ${out} (${Buffer.byteLength(html)} bytes)`);
