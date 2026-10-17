// SampleHelp — локальный сервер на Express (раздача статики + SPA fallback)
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Статика из public/
// DEV-режим: css/js/html отдаём без кэша, иначе браузер показывает
// устаревшие стили и «изменений не видно» после правок.
// В проде кэшированием занимается nginx (см. deploy/nginx-sample.conf).
app.use(
  express.static(join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (/\.(css|js|mjs|html)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      }
    },
  }),
);

// SPA fallback: любой неизвестный маршрут отдаёт index.html
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`🎛️ SampleHelp запущен на http://localhost:${PORT}`);
});

// Дружественная диагностика вместо стектрейса: самый частый вопрос в демо —
// «npm start упал с EADDRINUSE». Порт занят ПРЕЖНИМ процессом сервера; он
// продолжает раздавать сайт (файлы читаются с диска на каждый запрос), так
// что сайт работает, просто второй экземпляр не поднялся.
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ Порт ${PORT} уже занят — вероятно, запущен другой экземпляр SampleHelp.`);
    console.error('   Освободить порт:');
    console.error('     • в терминале, где сервер запускали раньше, нажмите Ctrl+C;');
    console.error('     • или Диспетчер задач → завершить процесс node.exe;');
    console.error(`     • или PowerShell: Get-NetTCPConnection -LocalPort ${PORT} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
    console.error(`   Уже запущенный сервер продолжит отдавать сайт на http://localhost:${PORT}`);
    console.error('   (файлы читаются с диска на каждый запрос — правки видны и без перезапуска).');
    process.exit(1);
  }
  throw e;
});
