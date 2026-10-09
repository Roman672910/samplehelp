// SampleHelp — локальный сервер на Express (раздача статики + SPA fallback)
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Статика из public/
app.use(express.static(join(__dirname, 'public')));

// SPA fallback: любой неизвестный маршрут отдаёт index.html
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🎛️ SampleHelp запущен на http://localhost:${PORT}`);
});