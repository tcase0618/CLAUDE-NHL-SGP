// Loads the browser scripts into Node (they attach to globalThis.NQ).
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const order = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/src="(js\/[^"]+)"/g)
  .map((s) => s.slice(5, -1)).filter((f) => !f.startsWith('js/views') && f !== 'js/app.js' && f.startsWith('js/'));
for (const f of order) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
module.exports = globalThis.NQ;
