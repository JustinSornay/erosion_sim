const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [];
html = html.replace(/<script defer src="\.\/([^"]+)"><\/script>/g, (_, file) => {
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
