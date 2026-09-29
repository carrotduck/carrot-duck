import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { PORT } from './config.js';
import { startScheduler } from './services/keepalive.js';
import { runTodoReminderCheck } from './services/todoReminders.js';
import { runPprCorrectionJob } from './services/pprCorrection.js';
import { backfillMemoryEmbeddings } from './services/memory.js';
import { sqliteVectorReady } from './db.js';
import { cleanupExpiredMedia } from './services/mediaAssets.js';
import usersRouter from './routes/users.js';
import chatRouter from './routes/chat.js';
import dataRouter from './routes/data.js';
import adminRouter from './routes/admin.js';
import voiceRouter from './routes/voice.js';
import asrRouter from './routes/asr.js';
import ttsRouter from './routes/tts.js';
import stickersRouter from './routes/stickers.js';
import favoritesRouter from './routes/favorites.js';
import todosRouter from './routes/todos.js';
import pushRouter from './routes/push.js';
import deliveryRouter from './routes/delivery.js';
import {
  corsOrigin,
  rateLimit,
  requireUserSession,
  secureHeaders,
} from './middleware/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: corsOrigin, credentials: false }));
app.use(secureHeaders);
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit);
app.get('/api/demo-config', (_req, res) => {
  const candidate = process.env.LIVE2D_MODEL_PATH || '';
  const model = /^\/live2d\/[a-zA-Z0-9_/-]+\.model3\.json$/.test(candidate) && !candidate.includes('..') ? candidate : null;
  res.json({ model, voice: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) });
});
app.use(requireUserSession);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'carrot-duck', model: 'deepseek-chat', vector_memory: sqliteVectorReady });
});

app.use('/api/users', usersRouter);
app.use('/api/chat', chatRouter);
app.use('/api/data', dataRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/asr', asrRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/stickers', stickersRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/todos', todosRouter);
app.use('/api/push', pushRouter);
app.use('/api/delivery', deliveryRouter);

app.use('/stickers', express.static(path.join(publicDir, 'stickers')));
app.use('/uploads', express.static(path.join(publicDir, 'uploads')));

app.use(express.static(publicDir));
app.get(/^(?!\/api).*/, (req, res, next) => {
  if (req.path.startsWith('/stickers/') || req.path.startsWith('/uploads/')) {
    return res.status(404).send('Not found');
  }
  return res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  if ((req.path.startsWith('/stickers/') || req.path.startsWith('/uploads/')) &&
      (err.code === 'ENOENT' || err.status === 404)) {
    return res.status(404).send('Not found');
  }
  return next(err);
});

if (process.env.ENABLE_BACKGROUND_JOBS === 'true') {
startScheduler();
setInterval(() => { runTodoReminderCheck().catch((e) => console.error('[todo-reminder]', e.message)); }, 60_000);
setInterval(() => { runPprCorrectionJob().catch((e) => console.error('[ppr-correction]', e.message)); }, 60 * 60 * 1000);
setInterval(() => {
  try { cleanupExpiredMedia(); } catch (e) { console.warn('[media-cleanup]', e.message); }
}, 6 * 60 * 60 * 1000);

}

app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`CARROT DUCK server listening on :${PORT}`);
  if (process.env.ENABLE_BACKGROUND_JOBS === 'true') setTimeout(() => {
    backfillMemoryEmbeddings().then((result) => {
      if (result.embedded) console.log('[memory-embedding] backfilled', result.embedded);
    }).catch((error) => console.warn('[memory-embedding] backfill failed:', error.message));
  }, 5000);
});
