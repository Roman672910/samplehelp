// Все ключи t('…')/tp('…') из кода должны существовать в словаре ru
// (ru-only заморозка; при возврате языков добавить их в LOCALES ниже)
const fs = require('fs');
const path = require('path');

function flat(o, p = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, p + k + '.').forEach((x) => out.add(x));
    else out.add(p + k);
  }
  return out;
}

const LOCALES = ['ru'];
const dicts = {};
for (const l of LOCALES) dicts[l] = flat(JSON.parse(fs.readFileSync(`public/locales/${l}.json`, 'utf8')));

const dir = 'public/js';
const used = new Map(); // key -> files
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of src.matchAll(/\bt[p]?\(\s*'([a-z0-9_]+\.[a-z0-9_.]+)'/gi)) {
    const key = m[1];
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(f);
  }
  // динамические ключи вида t(`ask.category_${...}`) — проверяем префиксом
  for (const m of src.matchAll(/\bt\(\s*`([a-z0-9_.]+)\$\{/gi)) {
    const prefix = m[1];
    const exists = [...dicts.ru].some((k) => k.startsWith(prefix));
    if (!exists) console.log(`ДИНАМИЧЕСКИЙ ПРЕФИКС БЕЗ КЛЮЧЕЙ: ${prefix} (${f})`);
  }
}

let missing = 0;
for (const [key, files] of used) {
  for (const l of LOCALES) {
    if (!dicts[l].has(key)) { console.log(`НЕТ В ${l}: ${key} (используется в ${[...files].join(', ')})`); missing++; }
  }
}
console.log(missing ? `✗ ${missing} недостающих ключей` : `✓ Все ${used.size} используемых ключей есть в ${LOCALES.join('/')}`);
process.exit(missing ? 1 : 0);
