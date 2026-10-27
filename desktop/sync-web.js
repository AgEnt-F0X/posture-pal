// Copies the web app (index.html, css, js, models, vendor) into desktop/web
// so the packaged exe is self-contained. Run before packaging.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..');
const dest = path.join(__dirname, 'web');
const ITEMS = ['index.html', 'css', 'js', 'models', 'vendor', 'assets', 'fonts'];

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const item of ITEMS) {
  const from = path.join(src, item);
  const to = path.join(dest, item);
  if (fs.statSync(from).isDirectory()) {
    fs.cpSync(from, to, { recursive: true });
  } else {
    fs.copyFileSync(from, to);
  }
  console.log('copied', item);
}
console.log('web assets synced to', dest);
