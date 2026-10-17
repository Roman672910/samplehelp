// Round-trip снимка проекта: make-filelist.cjs → restore-filelist.cjs →
// побайтовое сравнение всех файлов. Гарантирует, что формат дампа
// filelist_with_content.txt не сломается при правках скриптов: снимок
// всегда восстанавливает проект 1-в-1 (кроме node_modules/.git и
// бинарных файлов — они в дамп не попадают).
// Запуск из корня проекта (как и остальные тесты): node tmp_tests/test_filelist_roundtrip.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-roundtrip-'));
const dump = path.join(tmp, 'dump.txt');
const dest = path.join(tmp, 'restored');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };

console.log('1) Генерация дампа:');
execFileSync('node', ['scripts/make-filelist.cjs', dump], { cwd: ROOT, stdio: 'pipe' });
ok(fs.existsSync(dump), 'дамп создан');
const raw = fs.readFileSync(dump, 'utf8');
ok(raw.charCodeAt(0) === 0xfeff, 'UTF-8 BOM (как в исходном дампе)');
ok(raw.includes('[📁 ПАПКА]') && raw.includes('[📄 ФАЙЛ]'), 'маркеры папок/файлов на месте');
ok(raw.includes('--- НАЧАЛО СОДЕРЖИМОГО ---') && raw.includes('--- КОНЕЦ СОДЕРЖИМОГО ---'), 'маркеры содержимого на месте');
ok(!/\[📄 ФАЙЛ\][^\n]*node_modules/.test(raw), 'node_modules в дамп не попал');
ok(raw.startsWith('\uFEFFСОДЕРЖИМОЕ ПАПКИ:'), 'шапка «СОДЕРЖИМОЕ ПАПКИ» на месте');

console.log('\n2) Восстановление из дампа:');
execFileSync('node', ['scripts/restore-filelist.cjs', dump, dest], { cwd: ROOT, stdio: 'pipe' });
ok(fs.existsSync(dest), 'папка назначения создана');

console.log('\n3) Побайтовое сравнение:');
const collect = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) {
      return ['node_modules', '.git'].includes(e.name) ? [] : collect(path.join(dir, e.name), base);
    }
    return [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')];
  }).sort();

// Бинарники в дамп не попадают (make-filelist пишет только заголовок) — исключаем
// их из сравнения. Список берём ИЗ САМОГО ДАМПА (самоподдерживаемо): парсим
// пометки «Тип: Изображение/Бинарный файл» у файлов.
const dumpText = fs.readFileSync(dump, 'utf8');
const binRels = new Set();
for (const m of dumpText.matchAll(/\[📄 ФАЙЛ\] ([^\r\n]+)\r?\n\s+Тип: Изображение\/Бинарный файл/g)) {
  binRels.add(path.relative(ROOT, m[1].trim()).split(path.sep).join('/'));
}
console.log(`   бинарных в дампе (исключены из сравнения): ${binRels.size}${binRels.size ? ' — ' + [...binRels].join(', ') : ''}`);
ok([...binRels].includes('public/assets/og-cover.png'), 'og-cover.png помечен в дампе как бинарный (в дамп идёт только заголовок)');

// Дамп внутри проекта и откатные снимки не входят в дамп (make-filelist) —
// исключаем их и из сравнения живого дерева, иначе списки не сойдутся.
const notInDump = (r) => path.basename(r) === 'filelist_with_content.txt' || /^filelist_baseline_.*\.txt$/.test(path.basename(r));
const srcFiles = collect(ROOT).filter((r) => !binRels.has(r) && !notInDump(r));
const dstFiles = collect(dest).filter((r) => !binRels.has(r) && !notInDump(r));
ok(srcFiles.length === dstFiles.length, `число файлов совпадает: ${srcFiles.length}`);
ok(JSON.stringify(srcFiles) === JSON.stringify(dstFiles), 'списки файлов идентичны');
const diffs = srcFiles.filter((rel) => {
  const a = fs.readFileSync(path.join(ROOT, rel));
  const bPath = path.join(dest, ...rel.split('/'));
  return !fs.existsSync(bPath) || !a.equals(fs.readFileSync(bPath));
});
diffs.forEach((d) => console.log('   различается:', d));
ok(diffs.length === 0, `содержимое совпадает побайтово (${srcFiles.length - diffs.length}/${srcFiles.length})`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
