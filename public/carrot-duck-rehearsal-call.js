(function (root) {
  'use strict';
  function create({ Recognition, deliver, isCurrent, onState, onInterim, onError }) {
    let active = false, epoch = 0, recognizer = null, retry = null, processing = false;
    let queue = [], emptyEnds = 0;
    const valid = token => active && token === epoch && isCurrent();
    function detach() {
      clearTimeout(retry); retry = null;
      const old = recognizer; recognizer = null;
      if (old) {
        old.onresult = old.onend = old.onerror = old.onstart = null;
        try { old.abort(); } catch { /* Already disconnected. */ }
      }
    }
    function stop() {
      active = false; epoch++; queue = []; processing = false;
      detach(); onInterim(''); onState('off');
    }
    function fail(message) { stop(); onError(message); }
    async function pump(token) {
      if (!valid(token)) { if (active && token === epoch) stop(); return; }
      if (processing || !queue.length) return;
      processing = true;
      try {
        while (valid(token) && queue.length) {
          const text = queue.shift();
          await deliver(text, () => {
            if (!valid(token)) return;
            detach(); onInterim(''); onState('responding');
          });
          if (!valid(token)) return;
          if (!recognizer) listen(token);
        }
      } catch (error) {
        if (valid(token)) fail(error.message || 'Voice call interrupted.');
      } finally { if (token === epoch) processing = false; }
    }
    function listen(token) {
      if (!valid(token) || recognizer) return;
      const instance = new Recognition(); recognizer = instance;
      instance.lang = 'en-US'; instance.continuous = true; instance.interimResults = true;
      const seen = new Set();
      const owns = () => valid(token) && recognizer === instance;
      instance.onstart = () => { if (owns()) onState('listening'); };
      instance.onresult = event => {
        if (!owns()) return;
        const finals = []; let interim = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i], text = result[0]?.transcript?.trim();
          if (!text) continue;
          if (result.isFinal && !seen.has(i)) { seen.add(i); finals.push(text); }
          else if (!result.isFinal) interim += text + ' ';
        }
        onInterim(interim.trim());
        if (finals.length) {
          emptyEnds = 0;
          if (queue.length + finals.length > 12) { fail('Too much speech is waiting. Please reconnect and try a shorter section.'); return; }
          queue.push(...finals); pump(token);
        }
      };
      instance.onerror = event => {
        if (!owns() || event.error === 'no-speech') return;
        const message = ['not-allowed', 'service-not-allowed'].includes(event.error)
          ? 'Microphone access was denied. Allow it in your browser, then reconnect.'
          : 'Speech recognition is unavailable. Please reconnect or use text.';
        fail(message);
      };
      instance.onend = () => {
        if (!owns()) return;
        recognizer = null;
        instance.onresult = instance.onerror = instance.onend = instance.onstart = null;
        if (++emptyEnds > 12) { fail('Speech recognition keeps disconnecting. Please reconnect or use text.'); return; }
        // A service disconnect or a pause is not an end-of-turn signal.
        onState('connecting');
        retry = setTimeout(() => listen(token), 500);
      };
      try { instance.start(); } catch { fail('The microphone could not start. Please reconnect.'); }
    }
    return {
      start() {
        if (active) return;
        if (!Recognition) { onError('This browser does not support speech recognition. You can use text instead.'); return; }
        if (!isCurrent()) return;
        active = true; emptyEnds = 0; onState('connecting'); listen(++epoch);
      },
      stop,
      get active() { return active; },
    };
  }
  root.CarrotDuckRehearsalCall = { create };
})(typeof window === 'undefined' ? globalThis : window);
