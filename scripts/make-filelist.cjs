#!/usr/bin/env node
// ============================================================
// scripts/make-filelist.cjs — генератор снимка проекта:
// filelist_with_content.txt (дерево папок + ПОЛНОЕ содержимое
// текстовых файлов). Формат идентичен исходному дампу:
// UTF-8 BOM, CRLF, маркеры [📁 ПАПКА] / [📄 ФАЙЛ],
// --- НАЧАЛО/КОНЕЦ СОДЕРЖИМОГО ---, разделители из «=».
//
// Запуск:
//   node scripts/make-filelist.cjs [файл_назначения]
//   npm run filelist
// По умолчанию пишет ВНУТРЬ проекта: samplehelp/filelist_with_content.txt
// (решение заказчика 2026-10-14: всё нужное — в одной папке). Сам дамп и
// откатные снимки из списка исключены, поэтому рекурсии/роста нет.
//
// Не включаются: node_modules, .git, filelist_with_content.txt,
// filelist_baseline_*.txt (откатные снимки в rollbacks/).
// Бинарные файлы (медиа/архивы/шрифты и всё, что не валидный
// UTF-8) — только заголовок «Тип: Изображение/Бинарный файл…».
// Текстовые .svg сохраняются целиком (это валидный UTF-8).
//
// Восстановить проект из дампа: scripts/restore-filelist.cjs
// ============================================================
const fs = require('fs');
const path = require('path');

// Корень проекта: cwd, если запуск из корня (npm run filelist), иначе —
// от расположения скрипта. Важно: __dirname в некоторых окружениях
// раскрывает симлинки в физические пути, cwd сохраняет логический.
const ROOT = (fs.existsSync(path.join(process.cwd(), 'package.json'))
  && fs.existsSync(path.join(process.cwd(), 'scripts', 'make-filelist.cjs')))
  ? process.cwd()
  : path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'filelist_with_content.txt'));

const SKIP_DIRS = new Set(['node_modules', '.git']);
const BINARY_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico',
  '.mp3', '.wav', '.ogg', '.opus', '.flac', '.m4a', '.aac',
  '.webm', '.mp4', '.mov', '.zip', '.gz', '.7z', '.rar',
  '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.fxb', '.fxp',
]);

const CRLF = '\r\n';
const SEP = '='.repeat(80);
const DASH = '-'.repeat(60);

const pad = (n) => String(n).padStart(2, '0');
function fmtDate(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtSize(bytes) {
  return bytes === 0 ? '0 KB' : `${(bytes / 1024).toFixed(2)} KB`;
}
const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

/** Содержимое как текст, если файл — валидный UTF-8 без NUL; иначе null */
function readText(buf) {
  if (buf.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return null; }
}

let out = `\uFEFFСОДЕРЖИМОЕ ПАПКИ: ${ROOT}${CRLF}Дата создания: ${fmtDate(new Date())}${CRLF}${SEP}${CRLF}${CRLF}`;
let filesCount = 0, dirsCount = 0, binCount = 0;

function walk(dir) {
  const ents = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) return false;
    // Рантайм-артефакты backend (загрузки dev/тестов) в дамп кода не входят
    if (e.isDirectory() && /^storage(-tmp.*)?$/.test(e.name) && dir.includes('backend')) return false;
    if (e.isFile() && path.resolve(dir, e.name) === OUT) return false; // сам дамп
    // Дамп внутри проекта и откатные снимки не включаются: дамп не должен
    // носить сам себя (квадратичный рост при перегенерации), а baseline —
    // это полный снимок прошлого состояния (удвоение размера).
    if (e.isFile() && (e.name === 'filelist_with_content.txt' || /^filelist_baseline_.*\.txt$/.test(e.name))) return false;
    return true;
  });
  const dirs = ents.filter((e) => e.isDirectory()).sort(byName);
  const files = ents.filter((e) => e.isFile()).sort(byName);

  // Заголовки подпапок (между ними пустая строка, перед файлами — нет)
  dirs.forEach((d, i) => {
    out += `[📁 ПАПКА] ${path.join(dir, d.name)}${CRLF}${DASH}${CRLF}`;
    if (i < dirs.length - 1) out += CRLF;
    dirsCount++;
  });

  // Файлы с содержимым
  for (const f of files) {
    const full = path.join(dir, f.name);
    const st = fs.statSync(full);
    const buf = fs.readFileSync(full);
    const ext = path.extname(f.name).toLowerCase();
    const text = BINARY_EXT.has(ext) ? null : readText(buf);
    filesCount++;

    if (text === null) {
      binCount++;
      out += `[📄 ФАЙЛ] ${full}${CRLF}`
        + `  Тип: Изображение/Бинарный файл (содержимое не отображается)${CRLF}`
        + `  Размер: ${fmtSize(st.size)} KB${CRLF}${CRLF}`;
      continue;
    }

    // Содержимое: все переносы → CRLF, каждая строка завершается CRLF.
    // Файлы без завершающего переноса в дампе его получают (формат
    // строчный; restore-filelist.cjs восстановит с переносом).
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop(); // завершающий перенос
    const body = lines.map((l) => l + CRLF).join('');

    out += `[📄 ФАЙЛ] ${full}${CRLF}`
      + `  Размер: ${fmtSize(st.size)} KB${CRLF}`
      + `  Дата изменения: ${fmtDate(st.mtime)}${CRLF}${CRLF}`
      + `--- НАЧАЛО СОДЕРЖИМОГО ---${CRLF}${body}--- КОНЕЦ СОДЕРЖИМОГО ---${CRLF}${CRLF}`
      + `${SEP}${CRLF}${CRLF}`;
  }

  // Рекурсия в подпапки (после файлов текущей)
  for (const d of dirs) walk(path.join(dir, d.name));
}

walk(ROOT);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');
console.log(`✓ Дамп записан: ${OUT}`);
console.log(`  папок: ${dirsCount}, файлов: ${filesCount} (бинарных без содержимого: ${binCount})`);
console.log(`  размер: ${(Buffer.byteLength(out, 'utf8') / 1024 / 1024).toFixed(2)} MB`);
