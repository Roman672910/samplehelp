#!/usr/bin/env node
// ============================================================
// scripts/restore-filelist.cjs — восстановление проекта из дампа
// filelist_with_content.txt (созданного make-filelist.cjs или
// исходным инструментом). Формат дампа: маркеры [📄 ФАЙЛ] <путь>,
// --- НАЧАЛО/КОНЕЦ СОДЕРЖИМОГО ---; бинарные файлы помечены
// «Тип: Изображение/Бинарный файл» — они пропускаются (список
// выводится в конце).
//
// Запуск:
//   node scripts/restore-filelist.cjs <дамп.txt> <папка_назначения>
// Пример:
//   node scripts/restore-filelist.cjs ../filelist_with_content.txt ../samplehelp_restored
//
// Пути в дампе могут быть Windows-стиля (C:\...\samplehelp\...) —
// префикс корня отсекается, разделители нормализуются, дерево
// воссоздаётся внутри <папка_назначения>. Переносы строк в
// восстановленных файлах — LF, завершающий перенос добавляется.
// ============================================================
const fs = require('fs');
const path = require('path');

const [, , DUMP, DEST] = process.argv;
if (!DUMP || !DEST) {
  console.error('Использование: node scripts/restore-filelist.cjs <дамп.txt> <папка_назначения>');
  process.exit(1);
}

let data = fs.readFileSync(path.resolve(DUMP), 'utf8');
if (data.charCodeAt(0) === 0xfeff) data = data.slice(1); // BOM
data = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const lines = data.split('\n');

// Корень из шапки «СОДЕРЖИМОЕ ПАПКИ: <path>» — чтобы отсекать префикс
const rootMatch = data.match(/^СОДЕРЖИМОЕ ПАПКИ:\s*(.+)$/m);
const ROOT = rootMatch ? rootMatch[1].trim() : null;

const dest = path.resolve(DEST);
const restored = [];
const skipped = [];

const fileRe = /^\[📄 ФАЙЛ\]\s+(.+)$/;
const startRe = /^--- НАЧАЛО СОДЕРЖИМОГО ---$/;
const endRe = /^--- КОНЕЦ СОДЕРЖИМОГО ---$/;
const binaryRe = /^\s*Тип:\s*Изображение\/Бинарный файл/;

function relPath(winPath) {
  let p = winPath.trim();
  if (ROOT && p.startsWith(ROOT)) p = p.slice(ROOT.length);
  p = p.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  return p;
}

let i = 0;
while (i < lines.length) {
  const m = lines[i].match(fileRe);
  if (!m) { i++; continue; }
  const rel = relPath(m[1]);
  i++;

  // Метаданные: ищем начало содержимого; «Тип: …Бинарный…» — пропускаем файл
  let foundStart = false;
  while (i < lines.length) {
    if (startRe.test(lines[i])) { foundStart = true; i++; break; }
    if (binaryRe.test(lines[i])) break;
    if (/^\[📄 ФАЙЛ\]/.test(lines[i]) || /^\[📁 ПАПКА\]/.test(lines[i])) break;
    i++;
  }
  if (!foundStart) { skipped.push(rel); continue; }

  const body = [];
  while (i < lines.length && !endRe.test(lines[i])) { body.push(lines[i]); i++; }
  i++; // закрывающий маркер

  const target = path.join(dest, ...rel.split('/'));
  // Защита от выхода за пределы назначения
  if (!target.startsWith(dest + path.sep) && target !== dest) { skipped.push(rel + ' (небезопасный путь)'); continue; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body.length ? body.join('\n') + '\n' : '', 'utf8');
  restored.push(rel);
}

console.log(`✓ Восстановлено файлов: ${restored.length} → ${dest}`);
if (skipped.length) {
  console.log(`⚠ Пропущено (бинарные/без содержимого): ${skipped.length}`);
  skipped.forEach((s) => console.log('   -', s));
}
