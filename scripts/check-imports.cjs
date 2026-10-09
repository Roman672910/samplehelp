// ============================================================
// scripts/check-imports.js — самотест графа модулей.
// Ловит ошибки линковки (импорт несуществующего экспорта),
// которые в браузере роняют всё приложение целиком.
// Запуск: npm run check
// ============================================================
const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, '..', 'public', 'js');
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.mjs'));

// Собираем экспорты каждого модуля
const exportsOf = {};
for (const f of files) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  const ex = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) ex.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach((s) => ex.add(s.trim().split(/\s+as\s+/).pop()));
  }
  exportsOf[f] = ex;
}

let problems = 0;

// Проверяем каждый локальный импорт
for (const f of files) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([A-Za-z0-9_]+\.mjs)'/g)) {
    const [, names, target] = m;
    if (!exportsOf[target]) {
      console.log(`✗ ${f}: модуль ./${target} не найден`);
      problems++;
      continue;
    }
    for (const raw of names.split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0];
      if (name && !exportsOf[target].has(name)) {
        console.log(`✗ ${f}: импорт «${name}» не экспортируется из ./${target}`);
        problems++;
      }
    }
  }
}

// Проверяем дубли объявлений функций верхнего уровня
for (const f of files) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  const seen = {};
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) {
    seen[m[1]] = (seen[m[1]] || 0) + 1;
  }
  for (const [name, count] of Object.entries(seen)) {
    if (count > 1) {
      console.log(`✗ ${f}: функция «${name}» объявлена ${count} раза`);
      problems++;
    }
  }
}

// Синтаксис всех модулей
const { execFileSync } = require('child_process');
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(jsDir, f)], { stdio: 'pipe' });
  } catch (e) {
    console.log(`✗ синтаксис ${f}:\n${e.stderr.toString().split('\n').slice(0, 6).join('\n')}`);
    problems++;
  }
}

if (problems) {
  console.log(`\nИТОГО проблем: ${problems}`);
  process.exit(1);
}
console.log(`✓ ${files.length} модулей: импорты, экспорты, дубли и синтаксис в порядке`);