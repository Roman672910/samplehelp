// Целостность каталога контекстной справки:
//  1) каждый data-help="ключ" (шаблоны) и dataset.help = 'ключ' (JS) из
//     index.html и public/js/*.mjs обязан иметь help.items.<ключ>.title/desc
//     в словаре ru (ru-only заморозка; список LOCALES ниже);
//  2) обратно: каждый пункт каталога должен быть где-то навешан (без сирот).
const fs = require('fs');
const path = require('path');

// --- Ключи, использованные в разметке ---
const used = new Map(); // key -> files
function scan(file, src) {
  for (const m of src.matchAll(/data-help="([a-z0-9_]+)"/gi)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(file);
  }
  for (const m of src.matchAll(/dataset\.help = '([a-z0-9_]+)'/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(file);
  }
}
scan('index.html', fs.readFileSync('public/index.html', 'utf8'));
const dir = 'public/js';
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
  scan(f, fs.readFileSync(path.join(dir, f), 'utf8'));
}
// Ключи тура (findStepTarget навешивает их программно)
const helpSrc = fs.readFileSync(path.join(dir, 'help.mjs'), 'utf8');
for (const m of helpSrc.matchAll(/key: '([a-z0-9_]+)'/g)) {
  if (!used.has(m[1])) used.set(m[1], new Set());
  used.get(m[1]).add('help.mjs(tour)');
}

// --- Каталог в локалях ---
const LOCALES = ['ru'];
const catalogs = {};
for (const l of LOCALES) {
  const d = JSON.parse(fs.readFileSync(`public/locales/${l}.json`, 'utf8'));
  catalogs[l] = d.help?.items || {};
}

let problems = 0;
for (const [key, files] of [...used].sort()) {
  for (const l of LOCALES) {
    const item = catalogs[l][key];
    if (!item || !item.title || !item.desc) {
      console.log(`НЕТ В ${l}: help.items.${key} (используется в ${[...files].join(', ')})`);
      problems++;
    }
  }
}
for (const l of LOCALES) {
  for (const key of Object.keys(catalogs[l])) {
    if (!used.has(key)) {
      console.log(`СИРОТА В ${l}: help.items.${key} — нет ни одного data-help/dataset.help/tour-ключа`);
      problems++;
    }
  }
}
// Каталог должен быть одинаковым во всех локалях
const sizes = LOCALES.map((l) => Object.keys(catalogs[l]).length);
if (new Set(sizes).size !== 1) {
  console.log(`РАЗНЫЙ ОБЪЁМ КАТАЛОГА: ${LOCALES.map((l, i) => `${l}=${sizes[i]}`).join(' ')}`);
  problems++;
}
console.log(problems
  ? `✗ ${problems} проблем каталога справки`
  : `✓ Каталог справки: ${used.size} ключей, ${LOCALES.join('/')} (${sizes[0]} пунктов, сирот нет)`);
process.exit(problems ? 1 : 0);
