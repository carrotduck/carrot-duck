import { Router } from 'express';
import { getUser } from '../db.js';
import { pickVoiceId, resolveVoiceId } from '../services/personality.js';
import { synthesizeSpeech } from '../services/elevenlabs.js';
import { textForSpeech } from '../services/text.js';
import { generateTTS, generateTTSWithTimeline } from '../services/tts.js';

const router = Router();

function detectTtsLang(text) {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t) return 'zh';
  const ascii = (t.match(/[\x00-\x7F]/g) || []).length;
  return ascii / t.length > 0.85 ? 'en' : 'zh';
}

router.post('/', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'no text' });
    const speakText = textForSpeech(text);
    if (!speakText || speakText.length < 2) return res.status(400).json({ error: 'nothing to speak' });
    const lang = req.body?.lang || detectTtsLang(speakText);
    const voiceId = req.body?.voice_id || pickVoiceId({});
    const audio = await synthesizeSpeech(voiceId, speakText.slice(0, 2000), lang);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (e) {
    res.status(500).json({ error: 'tts failed' });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'no text' });
    const speakText = textForSpeech(text);
    if (!speakText || speakText.length < 2) return res.status(400).json({ error: 'nothing to speak' });
    const lang = req.body?.lang || detectTtsLang(speakText);
    const user = req.body?.user_id ? getUser(String(req.body.user_id)) : null;
    const voiceId = req.body?.voice_id || (user ? resolveVoiceId(user) : pickVoiceId({}));
    const result = await generateTTS(text, lang, voiceId, req.body?.expression_plan?.voice || {}, user?.id || null);
    if (!result) return res.status(400).json({ error: 'nothing to speak' });
    res.json({ url: result.url, duration: result.duration, lang: result.lang });
  } catch (e) {
    res.status(500).json({ error: 'tts failed' });
  }
});

router.post('/generate-aligned', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'no text' });
    const speakText = textForSpeech(text);
    if (!speakText || speakText.length < 2) return res.status(400).json({ error: 'nothing to speak' });
    const lang = req.body?.lang || detectTtsLang(speakText);
    const user = req.body?.user_id ? getUser(String(req.body.user_id)) : null;
    const voiceId = req.body?.voice_id || (user ? resolveVoiceId(user) : pickVoiceId({}));
    const result = await generateTTSWithTimeline(text, lang, voiceId, req.body?.expression_plan?.voice || {}, user?.id || null);
    if (!result) return res.status(400).json({ error: 'nothing to speak' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'tts alignment failed' });
  }
});

router.post('/:userId', async (req, res) => {
  try {
    const user = getUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'no text' });
    const speakText = textForSpeech(text);
    if (!speakText || speakText.length < 2) return res.status(400).json({ error: 'nothing to speak' });
    const lang = req.body?.lang || detectTtsLang(speakText);
    const audio = await synthesizeSpeech(resolveVoiceId(user), speakText.slice(0, 2000), lang);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (e) {
    res.status(500).json({ error: 'tts failed' });
  }
});

export default router;
