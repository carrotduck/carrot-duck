// Keep delivery separate from generation and memory updates so playback ordering
// can be tested without calling a model or synthesizing real speech.
export function createReplyDelivery({
  db, detectVoiceTurnContext, userRequestedVoice, emitVoiceBubbleIfNeeded,
  isStickerOnlyContent, buildExpressionPlan, createDeliveryCommand,
  completeModelRun, appVersion,
}) {
  return async function deliverReply({
    res, user, storedContent, finalCleaned, recent, voiceCall, voiceTagged,
    performanceMode, assistantMessages, affectiveSignal, emotionState,
    relationalState, relationshipProfile, userMsgId, parts, modelRun, turnPlan,
  }) {
    const recentChat = recent.map((m) => `${m.role}: ${m.content}`).join('\n');
    const voiceCtx = detectVoiceTurnContext(storedContent, recentChat);
    const wantsVoice = userRequestedVoice(storedContent) || Boolean(voiceCall);
    // The performance stage synthesizes speech using the final expression plan.
    const voiceBubble = performanceMode ? null : await emitVoiceBubbleIfNeeded(
      user, finalCleaned, storedContent, recentChat,
      { voiceCtx, voiceTagged: voiceTagged || wantsVoice, userRequestedVoice: wantsVoice, user },
    );

    if (voiceBubble) {
      const voiceTarget = [...assistantMessages].reverse().find((m) => !isStickerOnlyContent(m.content))
        || assistantMessages[assistantMessages.length - 1];
      if (voiceTarget) {
        const voiceMeta = {
          assistant_voice: {
            url: voiceBubble.url, transcript: voiceBubble.text,
            duration: voiceBubble.duration, lang: voiceBubble.lang || 'en',
          },
        };
        db.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(JSON.stringify(voiceMeta), voiceTarget.id);
        voiceTarget.voice_url = voiceBubble.url;
        voiceTarget.voice_text = voiceBubble.text;
        voiceTarget.voice_duration = voiceBubble.duration;
        voiceTarget.metadata = voiceMeta;
      }
      res.write(`data: ${JSON.stringify({
        type: 'voice_bubble', url: voiceBubble.url,
        text: voiceBubble.text, duration: voiceBubble.duration,
      })}\n\n`);
    }

    const lastMessage = assistantMessages[assistantMessages.length - 1] || null;
    const expressionPlan = buildExpressionPlan({
      affectiveSignal, emotionState, relationalState, relationshipProfile,
      surface: performanceMode ? 'live2d' : 'chat', turnId: userMsgId,
      messageId: lastMessage?.id || null, deliveryExpected: Boolean(performanceMode),
    });
    if (performanceMode && lastMessage && expressionPlan.command_id) {
      createDeliveryCommand({
        userId: user.id, turnId: userMsgId, messageId: lastMessage.id,
        surface: 'live2d', plan: expressionPlan,
      });
    }
    if (lastMessage) {
      const stored = db.prepare('SELECT metadata FROM messages WHERE id = ?').get(lastMessage.id);
      let metadata = {};
      try { metadata = JSON.parse(stored?.metadata || '{}'); } catch { metadata = {}; }
      metadata = { ...metadata, expression_plan: expressionPlan, turn_id: userMsgId, app_version: appVersion };
      db.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), lastMessage.id);
      lastMessage.metadata = metadata;
    }
    res.write(`data: ${JSON.stringify({
      type: 'done', messages: assistantMessages, bubble_parts: parts,
      message: lastMessage, emotion_state: emotionState,
      relationship_profile: relationshipProfile, expression_plan: expressionPlan,
      model_run_id: modelRun.id, turn_plan: turnPlan,
    })}\n\n`);
    completeModelRun(modelRun.id, { output: finalCleaned, status: 'completed' });
    res.end();
  };
}
