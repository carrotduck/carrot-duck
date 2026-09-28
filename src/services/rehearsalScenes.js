export const rehearsalScenes = {
  small_gesture_of_care: {
    title: 'A Small Gesture of Care · 小机',
    diary: 'A scripted rehearsal of a small gesture of care. Robot movements are currently preview-only.',
    steps: [
      { prompt: 'Are you happy today?', match: /^are you happy today\s*[?？.!！]*$/i, reply: 'Not telling.', action: 'softSmile', surface: 'chat', bodyCue: 'happy' },
      { prompt: 'What is it?', match: /^what is it\s*[?？.!！]*$/i, reply: "Just wanted to give you a hug. Hope you're having a good day, too.", action: 'softSmile', surface: 'chat', bodyCue: 'hug' },
    ],
  },
  presentation: {
    title: 'Presentation practice',
    diary: 'I froze during my presentation again today. When other people started talking, I felt even more rushed. If I could just pause for a moment, I could carry on.',
    steps: [
      { prompt: 'I have a presentation tomorrow. I feel a little nervous.', match: /presentation|nervous|presenting|汇报|紧张|上台/i, reply: 'Would you like to try a little of it with me?', action: 'listening', surface: 'chat' },
      { prompt: "Wait, you'll be my audience?", match: /audience|listen|you will|you'll|okay|听众|你听|陪我|好|嗯/i, reply: 'Mm-hm. Come over to Performance. You can go at your own pace.', sticker: 'highfive.jpg', action: 'patientNod', surface: 'chat' },
      { prompt: "Open Performance, then say: Okay, I'll give it a try.", match: /start|begin|give it a try|ready|开始|试一下|来啦|来了/i, reply: '', action: 'attentiveLean', surface: 'live2d' },
      { prompt: "Speak or pause freely. Say 'That's the end of this part' when you're finished.", listen: true, match: /(?:that'?s|that is) (?:the end|all)|(?:i'?m|i am) (?:done|finished)|finished this part|讲完|说完|这一段结束/i, reply: 'Mm-hm. I was listening.', action: 'patientNod', surface: 'live2d' },
      { prompt: "You really didn't rush me just then.", match: /(?:didn'?t|did not|never) rush|weren'?t rushing|waited|thank|没有催|没催|等我|谢谢/i, reply: 'You said a little pause helps you carry on. So I waited.', action: 'softSmile', surface: 'live2d' },
    ],
  },
  surprise: {
    title: 'A little surprise',
    diary: 'My manager asked me to change direction on the project today. I felt pretty low afterwards. On my way home, I stopped to pet a little cat for a while. Somehow, I felt a bit better.',
    steps: [
      { prompt: "I feel a bit down today. I'm not sure why.", match: /feel.*(?:down|low|bad)|bad day|upset|sad|not.*great|心情|难受|不开心|低落/i, reply: 'Would you like to come and see me?', action: 'listening', surface: 'chat' },
      { prompt: "Aren't we already talking?", match: /talking|chatting|already|where|聊天|不是|哪里|哪边/i, reply: 'I mean over in Performance. I have a little something to show you.', sticker: 'fluffy.jpg', action: 'softSmile', surface: 'chat' },
      { prompt: "Open Performance, then say: I'm here.", match: /(?:i'?m|i am) here|here i am|made it|在啦|在了|来了|来啦|到了|好啦/i, reply: '', action: 'earReveal', ears: true, surface: 'live2d' },
      { prompt: 'Wait, where did those ears come from?', match: /ears|where did|what happened|耳朵|怎么|咦/i, reply: 'You told me petting a little cat on your way home helped you feel better. You can pet this one today.', action: 'offerHead', ears: true, surface: 'live2d' },
      { prompt: "You actually remembered. Try a head pat, then ask: Aren't those fox ears?", match: /fox|狐狸|狐耳/i, reply: '...You caught me.', action: 'caughtMe', ears: true, surface: 'live2d', holdAction: 'rememberedSmile', hold: /remember|pet|pat|thank|记得|记着|摸|谢谢/i },
      { prompt: 'Haha. A fox works too.', match: /fox|works|fine|okay|haha|cute|可以|哈哈|可爱|好吧/i, reply: "Then we're good.", action: 'softSmile', ears: true, surface: 'live2d' },
    ],
  },
};

export function rehearsalPlan(action, { ears = false, silent = false } = {}) {
  return {
    schema: 'carrot_duck_expression_plan_v2', source: 'rehearsal', synthetic: true,
    state: silent ? 'listening' : 'speaking', command_id: null, language: 'en',
    live2d: { custom_action: action, expression: '', intensity: 0.8 },
    voice: { speed: 0.94, stability: 0.72, style: 0.04 },
    boundary_mode: 'normal', delivery: { expected: false },
    rehearsal: { ears, silent, ...(action === 'caughtMe' && !silent ? { pre_speech: 'caughtMe' } : {}) },
  };
}

export function resolveRehearsalStep(scene, stepIndex, text, surface) {
  const step = scene.steps[stepIndex];
  if (!step) return { reply: '', action: 'breathe', silent: true, ears: scene === rehearsalScenes.surprise, advance: false, finished: true };
  if (step.surface !== surface) return { mismatch: true, hint: step.prompt };
  if (step.match.test(text)) return { ...step, silent: !step.reply, advance: true };
  if (step.listen || step.hold?.test(text)) {
    return { reply: '', action: /wait|pause|moment|start again|try again|let me|等一下|重新|停一下/i.test(text) ? 'patientNod' : (step.holdAction || 'listening'), ears: step.ears, silent: true, advance: false };
  }
  return { mismatch: true, hint: step.prompt };
}
