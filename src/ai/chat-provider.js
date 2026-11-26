// Phase 3 interface: LLM-driven conversation, wired to expressions and lip sync.
// Not active in this build. Contract is fixed here so the renderer, the
// animator and the future backend can be developed against it now.
//
//   const provider = new ChatProvider();
//   const { reply, emotion } = await provider.send(userText);
//   animator.mixer.set(mapEmotionToExpression(emotion), 1);   // face
//   speakBubble(reply)                                          // bubble UI
//
// API keys must come from environment variables / .env (never hard-coded).

export const EMOTION_EXPRESSIONS = Object.freeze({
  neutral: 'neutral',
  happy: 'happy',
  angry: 'angry',
  sad: 'sad',
  surprised: 'surprised',
  relaxed: 'relaxed',
});

/** Map an emotion tag from the LLM to a VRM expression name. */
export function mapEmotionToExpression(emotion) {
  return EMOTION_EXPRESSIONS[String(emotion || '').toLowerCase()] || 'neutral';
}

/**
 * Text-to-lip-sync helper (usable once chat is live):
 * walks the text, alternates vowel mouth shapes so the mouth moves while the
 * bubble is "speaking". speak(text, mixer, onDone) is intentionally simple;
 * refine per-phoneme timing in Phase 3.
 */
export function speak(text, mixer, onDone) {
  const vowels = ['a', 'i', 'u', 'e', 'o'];
  const chars = Array.from(String(text || ''));
  const step = 90; // ms per mouth shape
  let i = 0;
  mixer.closeMouth();
  const timer = setInterval(() => {
    if (i >= chars.length) {
      clearInterval(timer);
      mixer.closeMouth();
      onDone?.();
      return;
    }
    const ch = chars[i];
    const vowel = vowels[i % vowels.length];
    const open = /[一-龥a-zA-Z0-9]/.test(ch) ? 0.7 : 0.15;
    mixer.setMouth(vowel, open);
    i++;
  }, step);
  return () => clearInterval(timer);
}

export class ChatProvider {
  /**
   * Contract: send(userText) -> Promise<{ reply: string, emotion: keyof EMOTION_EXPRESSIONS }>
   * Phase 3 will implement this against an LLM API (key via env var).
   */
  async send(_userText) {
    throw new Error('ChatProvider 未接入 LLM（第三期实现）');
  }
}
