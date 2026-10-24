import { settingsStore } from '../services/SettingsManager';
import { createStore } from '../stores/store';
import { estimateSpeechSec } from '../utils/speech';
import { CoachEngine, isNativeApp, voiceOptions } from '../native/CoachEngine';

const NATIVE = isNativeApp();

export type SpeakResult = 'end' | 'error' | 'cancelled' | 'timeout' | 'unsupported';

export interface VoiceInfo {
  uri: string;
  name: string;
  lang: string;
  local: boolean;
}

export interface VoiceStatus {
  supported: boolean;
  ready: boolean;
  voices: VoiceInfo[];
  korean: boolean;
  lastError: string | null;
  speaking: boolean;
}

const webSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const supported = NATIVE || webSupported;

export const voiceStatus = createStore<VoiceStatus>({
  supported,
  ready: false,
  voices: [],
  korean: false,
  lastError: supported ? null : '이 브라우저는 음성 합성(Web Speech API)을 지원하지 않습니다.',
  speaking: false,
});

let rawVoices: SpeechSynthesisVoice[] = [];

function loadVoices() {
  if (!supported) return;
  rawVoices = window.speechSynthesis.getVoices();
  const voices = rawVoices.map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
  const korean = voices.some((v) => v.lang.toLowerCase().startsWith('ko'));
  voiceStatus.set((s) => ({ ...s, voices, korean, ready: voices.length > 0 || s.ready }));
}

/** iOS 앱: 기기 음성 목록을 네이티브에서 가져오고, 설정 변경을 네이티브 엔진에 반영 */
async function loadNativeVoices() {
  try {
    const { voices } = await CoachEngine.getVoices();
    const list = voices.map((v) => ({ uri: v.id, name: `${v.name}${v.quality >= 2 ? ' (고음질)' : ''}`, lang: v.lang, local: true }));
    voiceStatus.set((s) => ({ ...s, voices: list, korean: list.some((v) => v.lang.toLowerCase().startsWith('ko')), ready: true }));
  } catch (e) {
    voiceStatus.set((s) => ({ ...s, ready: true, lastError: `음성 목록을 불러오지 못했습니다: ${(e as Error).message}` }));
  }
}

if (NATIVE) {
  loadNativeVoices();
  let t: ReturnType<typeof setTimeout> | null = null;
  settingsStore.subscribe(() => {
    if (t) clearTimeout(t);
    t = setTimeout(() => CoachEngine.configure(voiceOptions(settingsStore.get())).catch(() => {}), 150);
  });
  CoachEngine.configure(voiceOptions(settingsStore.get())).catch(() => {});
} else if (supported) {
  loadVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
  // 일부 iOS 버전은 voiceschanged를 보내지 않으므로 몇 차례 재시도
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    loadVoices();
    if (rawVoices.length || tries > 10) {
      clearInterval(t);
      voiceStatus.set((s) => ({ ...s, ready: true }));
    }
  }, 300);
}

export function koreanVoices(): VoiceInfo[] {
  return voiceStatus.get().voices.filter((v) => v.lang.toLowerCase().startsWith('ko'));
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!rawVoices.length) return null;
  const uri = settingsStore.get().voiceURI;
  if (uri) {
    const v = rawVoices.find((x) => x.voiceURI === uri);
    if (v) return v;
  }
  const ko = rawVoices.filter((v) => v.lang.toLowerCase().startsWith('ko'));
  // 기기 내장(로컬) 한국어 음성을 우선 — 오프라인에서도 동작할 가능성이 높다
  return ko.find((v) => v.localService && /yuna|유나/i.test(v.name)) ?? ko.find((v) => v.localService) ?? ko[0] ?? null;
}

let generation = 0;
let current: SpeechSynthesisUtterance | null = null; // GC로 onend가 사라지는 크롬 버그 방지용 참조
let lastCancelAt = 0;

function setSpeaking(v: boolean) {
  if (voiceStatus.get().speaking !== v) voiceStatus.set((s) => ({ ...s, speaking: v }));
}

export interface SpeakOptions {
  rateMul?: number;
  interrupt?: boolean;
  pitch?: number;
}

/** 한 번에 하나의 발화만 유지한다. interrupt=true면 현재 발화를 끊고 말한다. */
export function speak(text: string, opts: SpeakOptions = {}): Promise<SpeakResult> {
  if (NATIVE) return speakNative(text, opts);
  if (!supported) return Promise.resolve('unsupported');
  const synth = window.speechSynthesis;
  const myGen = ++generation;
  const s = settingsStore.get();
  if (opts.interrupt || synth.speaking || synth.pending) {
    synth.cancel();
    lastCancelAt = performance.now();
  }
  const rate = Math.min(2, Math.max(0.5, s.rate * (opts.rateMul ?? 1)));

  return new Promise<SpeakResult>((resolve) => {
    let done = false;
    const finish = (r: SpeakResult) => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      if (myGen === generation) {
        setSpeaking(false);
        current = null;
      }
      resolve(r);
    };
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = rate;
    u.pitch = opts.pitch ?? (s.voiceStyle === 'live' ? 1.05 : 1);
    u.volume = s.volume;
    u.onend = () => finish(myGen === generation ? 'end' : 'cancelled');
    u.onerror = (e) => {
      const err = (e as SpeechSynthesisErrorEvent).error;
      if (err === 'interrupted' || err === 'canceled') return finish('cancelled');
      voiceStatus.set((st) => ({ ...st, lastError: `음성 출력 오류: ${err ?? '알 수 없음'}` }));
      finish('error');
    };
    // onend가 오지 않는 브라우저 대비 안전 타이머 — 타이머 전체가 멈추지 않게 한다
    const safety = setTimeout(() => finish('timeout'), (estimateSpeechSec(text, rate) * 1.8 + 1.5) * 1000);
    current = u;
    setSpeaking(true);
    // iOS는 cancel 직후 곧바로 speak하면 발화가 버려지는 경우가 있어 짧게 지연
    const wait = performance.now() - lastCancelAt < 80 ? 70 : 0;
    const go = () => {
      if (myGen !== generation) return finish('cancelled');
      try {
        synth.speak(u);
        if (synth.paused) synth.resume();
      } catch (err) {
        voiceStatus.set((st) => ({ ...st, lastError: `음성 출력 실패: ${String(err)}` }));
        finish('error');
      }
    };
    if (wait) setTimeout(go, wait);
    else go();
  });
}

function speakNative(text: string, opts: SpeakOptions): Promise<SpeakResult> {
  const myGen = ++generation;
  setSpeaking(true);
  return CoachEngine.speak({ ...voiceOptions(settingsStore.get()), text, rateMul: opts.rateMul ?? 1, interrupt: opts.interrupt ?? false })
    .then((r) => {
      if (myGen === generation) setSpeaking(false);
      return (r.result === 'end' ? 'end' : 'cancelled') as SpeakResult;
    })
    .catch((e) => {
      if (myGen === generation) setSpeaking(false);
      voiceStatus.set((st) => ({ ...st, lastError: `음성 출력 실패: ${(e as Error).message}` }));
      return 'error' as SpeakResult;
    });
}

/** 대기 중인 음성까지 모두 취소 */
export function cancelSpeech() {
  if (NATIVE) {
    generation++;
    setSpeaking(false);
    CoachEngine.stopSpeaking().catch(() => {});
    return;
  }
  generation++;
  current = null;
  setSpeaking(false);
  if (supported) {
    window.speechSynthesis.cancel();
    lastCancelAt = performance.now();
  }
}

/** iOS: 사용자 터치 이벤트 안에서 한 번 호출해야 이후 음성이 나온다 */
export function unlockSpeech() {
  if (NATIVE || !supported) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.lang = 'ko-KR';
    window.speechSynthesis.speak(u);
  } catch {
    /* noop */
  }
}

export function clearVoiceError() {
  voiceStatus.set((s) => ({ ...s, lastError: supported ? null : s.lastError }));
}

export function isNativeVoice() {
  return NATIVE;
}

export function isSpeaking() {
  return current != null;
}

// 참조 유지 (트리 셰이킹 방지 목적 아님 — 디버깅용)
export const _debug = { get current() { return current; } };
