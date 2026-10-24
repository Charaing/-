import type { Combination, Command, Segment, Settings, Weight } from '../types';
import { buildSegments } from '../services/timeline';
import { comboPool, gapAfter, newSchedulerState, nextCommand, stepPool } from '../services/CommandScheduler';
import { coachTokens, roundOrdinal } from '../utils/speech';
import { BELL_SEC, scheduleBeep, scheduleBell } from './Beeper';
import { CLIP_DEFS, TRACK_SR, decodeBlob, idb, trimNormalize, trackSourceStore } from './VoicePack';

/* ============================================================
 * 연속 오디오 훈련 모드 (방식 B)
 * 훈련 시작 전에 전체 명령 순서를 정하고, 음성 클립 + 무음 + 벨을 하나의 WAV 트랙으로 렌더링한 뒤
 * HTMLAudioElement로 재생한다. 잠금 화면에서 미디어처럼 재생될 가능성이 높아지지만, iOS 정책상 보장되지는 않는다.
 * ============================================================ */

interface Pcm {
  data: Float32Array;
  sampleRate: number;
}

export interface TrackEvent {
  t: number; // ms
  dur: number; // ms
  type: 'voice' | 'bell' | 'beep';
  pcm?: Pcm;
  strikes?: number;
  freq?: number;
  command?: Command;
  label?: string;
}

export interface TrackPlan {
  segs: Segment[];
  events: TrackEvent[];
  durationMs: number;
  settings: Settings;
}

export interface PhraseProvider {
  kind: 'recorded' | 'remote';
  phrase(text: string, keys: string[] | null): Promise<Pcm | null>;
  missing(keys: string[]): string[];
}

const pcmDur = (p: Pcm) => (p.data.length / p.sampleRate) * 1000;

function concatPcm(parts: Pcm[], gapMs = 90): Pcm {
  const sr = parts[0].sampleRate;
  const gap = Math.round((sr * gapMs) / 1000);
  // 서로 다른 샘플레이트는 단순 선형 보간으로 맞춘다
  const res = parts.map((p) => (p.sampleRate === sr ? p.data : resample(p.data, p.sampleRate, sr)));
  const len = res.reduce((a, d) => a + d.length, 0) + gap * (res.length - 1);
  const out = new Float32Array(len);
  let o = 0;
  res.forEach((d, i) => {
    out.set(d, o);
    o += d.length + (i < res.length - 1 ? gap : 0);
  });
  return { data: out, sampleRate: sr };
}

function resample(d: Float32Array, from: number, to: number): Float32Array {
  const n = Math.round((d.length * to) / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * from) / to;
    const i0 = Math.floor(x);
    const f = x - i0;
    out[i] = (d[i0] ?? 0) * (1 - f) + (d[i0 + 1] ?? d[i0] ?? 0) * f;
  }
  return out;
}

/** 녹음 음성 팩 기반 제공자 */
export async function recordedProvider(): Promise<PhraseProvider> {
  const keys = (await idb.keys('clips')).map(String);
  const cache = new Map<string, Pcm>();
  for (const k of keys) {
    const blob = await idb.get<Blob>('clips', k);
    if (!blob) continue;
    try {
      cache.set(k, trimNormalize(await decodeBlob(blob)));
    } catch {
      /* 손상된 클립은 누락으로 처리 */
    }
  }
  return {
    kind: 'recorded',
    missing: (need) => need.filter((k) => !cache.has(k)),
    async phrase(_text, k) {
      if (!k || !k.length) return null;
      const parts = k.map((x) => cache.get(x));
      if (parts.some((p) => !p)) return null;
      return parts.length === 1 ? parts[0]! : concatPcm(parts as Pcm[]);
    },
  };
}

/** 외부 TTS 서버 기반 제공자 (응답은 IndexedDB에 캐시 → 이후 오프라인 재사용) */
export function remoteProvider(urlTemplate: string): PhraseProvider {
  if (!/^https?:\/\//.test(urlTemplate) || !urlTemplate.includes('{text}')) {
    throw new Error('TTS 서버 주소는 http(s)://로 시작하고 {text} 자리표시자를 포함해야 합니다.');
  }
  const mem = new Map<string, Pcm>();
  return {
    kind: 'remote',
    missing: () => [],
    async phrase(text) {
      if (mem.has(text)) return mem.get(text)!;
      const cacheKey = `${urlTemplate}|${text}`;
      let blob = await idb.get<Blob>('remote', cacheKey).catch(() => undefined);
      if (!blob) {
        const res = await fetch(urlTemplate.replace('{text}', encodeURIComponent(text)));
        if (!res.ok) throw new Error(`TTS 서버 응답 오류 (${res.status})`);
        blob = await res.blob();
        await idb.put('remote', cacheKey, blob).catch(() => {});
      }
      const pcm = trimNormalize(await decodeBlob(blob));
      mem.set(text, pcm);
      return pcm;
    },
  };
}

export async function getProvider(): Promise<PhraseProvider> {
  const src = trackSourceStore.get();
  return src.provider === 'remote' ? remoteProvider(src.remoteUrl.trim()) : recordedProvider();
}

function commandKeys(cmd: Command, s: Settings): string[] | null {
  if (cmd.kind === 'cue') return null;
  const keys: string[] = [];
  if (cmd.stepId) keys.push(cmd.stepId);
  if (cmd.punches) keys.push(...coachTokens(cmd.punches, s.stance).map((t) => t.key));
  return keys;
}

/** 녹음 팩 사용 시 현재 설정에 필요한 클립 키 */
export function requiredKeys(s: Settings, combos: Combination[], weights: Record<string, Weight>): string[] {
  const need = new Set<string>();
  for (const c of comboPool({ settings: s, combos, weights })) coachTokens(c.punches, s.stance).forEach((t) => need.add(t.key));
  const usesSteps = s.mode === 'footwork' || s.mode === 'mix' || s.mode === 'technique';
  if (usesSteps) stepPool(s).forEach((f) => need.add(f.id));
  return [...need];
}

export function clipText(key: string) {
  return CLIP_DEFS.find((d) => d.key === key)?.text ?? key;
}

export type Progress = (ratio: number, label: string) => void;

export async function planTrack(
  settingsIn: Settings,
  combos: Combination[],
  weights: Record<string, Weight>,
  provider: PhraseProvider,
  onProgress?: Progress,
): Promise<TrackPlan> {
  const s: Settings = { ...settingsIn, coachCues: provider.kind === 'remote' ? settingsIn.coachCues : false };
  if (provider.kind === 'recorded') {
    const miss = provider.missing(requiredKeys(s, combos, weights));
    if (miss.length) {
      throw new Error(`녹음되지 않은 음성이 ${miss.length}개 있습니다: ${miss.slice(0, 6).map(clipText).join(', ')}${miss.length > 6 ? ' …' : ''}`);
    }
  }
  const segs = buildSegments(s);
  const events: TrackEvent[] = [];
  const ann = async (key: string, text: string) => (provider.kind === 'recorded' ? provider.phrase(text, [key]).catch(() => null) : provider.phrase(text, null));

  const a = {
    ready: provider.kind === 'remote' ? null : await ann('a_ready', '라운드 준비'),
    start: await ann('a_start', '시작!'),
    end: await ann('a_end', '라운드 종료, 휴식'),
    ten: s.timeAnnounce ? await ann('a_10s', '십 초 남았습니다!') : null,
    next: await ann('a_next', '다음 라운드 준비'),
    done: await ann('a_done', '훈련 종료, 수고하셨습니다'),
  };
  const voice = (t: number, pcm: Pcm | null, label: string, command?: Command) => {
    if (!pcm) return 0;
    const dur = pcmDur(pcm);
    events.push({ t, dur, type: 'voice', pcm, label, command });
    return dur;
  };
  const rng = Math.random;
  const st = newSchedulerState();

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    onProgress?.(0.05 + (0.45 * i) / segs.length, '명령 순서 구성 중');
    const durMs = seg.end - seg.start;
    if (seg.phase === 'prep') {
      const readyPcm = provider.kind === 'remote' ? await provider.phrase(`${roundOrdinal(1)} 준비.`, null) : a.ready;
      voice(seg.start + 150, readyPcm, '준비');
    }
    if (seg.phase === 'rest') {
      if (s.bell) events.push({ t: seg.start, dur: BELL_SEC * 1000, type: 'bell', strikes: 2 });
      voice(seg.start + (s.bell ? 900 : 100), a.end, '라운드 종료');
      if (durMs >= 20000) {
        const nextPcm = provider.kind === 'remote' ? await provider.phrase(`다음 라운드 준비.`, null) : a.next;
        voice(seg.end - 10000, nextPcm, '다음 라운드 준비');
      }
    }
    if ((seg.phase === 'prep' || seg.phase === 'rest') && s.countdown) {
      for (const k of [3, 2, 1]) if (durMs >= k * 1000 + 1500) events.push({ t: seg.end - k * 1000, dur: 150, type: 'beep', freq: 660 });
    }
    if (seg.phase === 'work') {
      st.indexInRound = 0;
      let t = seg.start;
      if (s.bell) events.push({ t, dur: BELL_SEC * 1000, type: 'bell', strikes: 1 });
      const startPcm = provider.kind === 'remote' && seg.round > 1 ? await provider.phrase(`${roundOrdinal(seg.round)}, 시작!`, null) : a.start;
      t += voice(t + (s.bell ? 250 : 50), startPcm, '시작') + 1500;
      const tenAt = seg.end - 10000;
      if (a.ten && durMs >= 25000) voice(tenAt, a.ten, '10초');
      const tenEnd = a.ten ? tenAt + pcmDur(a.ten) + 1200 : tenAt;
      if (s.countdown) for (const k of [3, 2, 1]) events.push({ t: seg.end - k * 1000, dur: 120, type: 'beep', freq: 880 });

      let guard = 0;
      while (seg.end - t > 3500 && guard++ < 500) {
        const cmd = nextCommand({ settings: s, combos, weights, rng }, st);
        if (!cmd) break;
        const pcm = await provider.phrase(cmd.text, commandKeys(cmd, s));
        if (!pcm) continue;
        const dur = pcmDur(pcm) + (s.preBeep ? 220 : 0);
        // 10초 안내와 겹치면 안내 뒤로 미룬다
        if (a.ten && durMs >= 25000 && t < tenEnd && t + dur + 300 > tenAt) t = tenEnd;
        if (t + dur + 600 > seg.end - (s.countdown ? 3000 : 0)) break; // 라운드 경계를 넘는 명령은 만들지 않는다
        if (s.preBeep) events.push({ t, dur: 60, type: 'beep', freq: 1320 });
        voice(t + (s.preBeep ? 220 : 0), pcm, cmd.label, cmd);
        t += dur + gapAfter(cmd, s, rng) * 1000;
      }
    }
  }
  const last = segs[segs.length - 1];
  let durationMs = last.end;
  if (s.bell) events.push({ t: last.end, dur: BELL_SEC * 1000, type: 'bell', strikes: 3 });
  const doneDur = voice(last.end + (s.bell ? 1100 : 100), a.done, '훈련 종료');
  durationMs = last.end + (s.bell ? 1100 : 100) + doneDur + 1500;
  events.sort((x, y) => x.t - y.t);
  return { segs, events, durationMs, settings: s };
}

/* ---------------- 렌더링 (구간별로 나눠 메모리 사용량 제한) ---------------- */

function OfflineCtor(): typeof OfflineAudioContext {
  return window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
}

function renderCtx(ctx: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    ctx.oncomplete = (e) => resolve(e.renderedBuffer);
    const p = ctx.startRendering() as Promise<AudioBuffer> | undefined;
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

function floatToInt16(d: Float32Array): Int16Array {
  const out = new Int16Array(d.length);
  for (let i = 0; i < d.length; i++) {
    const v = Math.max(-1, Math.min(1, d[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

function wavHeader(samples: number, sr: number): ArrayBuffer {
  const b = new ArrayBuffer(44);
  const v = new DataView(b);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples * 2, true);
  return b;
}

export const estimateTrackBytes = (durationMs: number) => Math.round((durationMs / 1000) * TRACK_SR * 2) + 44;

export async function renderTrack(plan: TrackPlan, onProgress?: Progress): Promise<Blob> {
  const OAC = OfflineCtor();
  if (!OAC) throw new Error('이 브라우저는 오디오 렌더링(OfflineAudioContext)을 지원하지 않습니다.');
  const chunkMs = 30_000;
  const total = plan.durationMs;
  const parts: BlobPart[] = [];
  let samples = 0;
  const vol = Math.max(0.1, plan.settings.volume);
  for (let start = 0; start < total; start += chunkMs) {
    const end = Math.min(total, start + chunkMs);
    const len = Math.max(1, Math.round(((end - start) / 1000) * TRACK_SR));
    const ctx = new OAC(1, len, TRACK_SR);
    const master = ctx.createGain();
    master.gain.value = vol;
    master.connect(ctx.destination);
    // 이 구간과 겹치는 이벤트(앞 구간에서 이어지는 소리 포함)를 배치
    for (const e of plan.events) {
      if (e.t >= end || e.t + e.dur + 2000 <= start) continue;
      const tl = (e.t - start) / 1000;
      if (e.type === 'voice' && e.pcm) {
        const buf = ctx.createBuffer(1, e.pcm.data.length, e.pcm.sampleRate);
        buf.getChannelData(0).set(e.pcm.data);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(master);
        if (tl >= 0) src.start(tl);
        else src.start(0, -tl);
      } else if (e.type === 'bell' && tl >= 0) {
        scheduleBell(ctx, master, tl, 0.6, e.strikes ?? 1);
      } else if (e.type === 'beep' && tl >= 0) {
        scheduleBeep(ctx, master, tl, e.freq ?? 880, e.dur / 1000, 0.45);
      }
    }
    const rendered = await renderCtx(ctx);
    const pcm = floatToInt16(rendered.getChannelData(0));
    parts.push(pcm.buffer as ArrayBuffer);
    samples += pcm.length;
    onProgress?.(0.5 + 0.5 * (end / total), '오디오 트랙 렌더링 중');
  }
  return new Blob([wavHeader(samples, TRACK_SR), ...parts], { type: 'audio/wav' });
}

/* ---------------- 캐시 (마지막 트랙 보관 → 오프라인 재생) ---------------- */

interface StoredTrack {
  blob: Blob;
  plan: Omit<TrackPlan, 'events'> & { events: Omit<TrackEvent, 'pcm'>[] };
  createdAt: number;
}

export async function saveLastTrack(blob: Blob, plan: TrackPlan) {
  const slim: StoredTrack = {
    blob,
    plan: { ...plan, events: plan.events.map(({ pcm: _p, ...rest }) => rest) },
    createdAt: Date.now(),
  };
  await idb.put('tracks', 'last', slim).catch(() => {});
}

export async function loadLastTrack(): Promise<{ blob: Blob; plan: TrackPlan; createdAt: number } | null> {
  const t = await idb.get<StoredTrack>('tracks', 'last').catch(() => undefined);
  if (!t || !t.blob) return null;
  return { blob: t.blob, plan: t.plan as TrackPlan, createdAt: t.createdAt };
}

/* ---------------- 재생기 + Media Session ---------------- */

export class TrackPlayer {
  audio: HTMLAudioElement;
  private url: string | null = null;
  onEnded: (() => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onPlayState: ((playing: boolean) => void) | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    (this.audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    this.audio.setAttribute('playsinline', '');
    this.audio.addEventListener('ended', () => this.onEnded?.());
    this.audio.addEventListener('error', () => this.onError?.('오디오 트랙을 재생할 수 없습니다.'));
    this.audio.addEventListener('play', () => this.onPlayState?.(true));
    this.audio.addEventListener('pause', () => this.onPlayState?.(false));
  }

  load(blob: Blob) {
    this.dispose(false);
    this.url = URL.createObjectURL(blob);
    this.audio.src = this.url;
    this.audio.load();
  }

  async play(): Promise<boolean> {
    try {
      await this.audio.play();
      return true;
    } catch (e) {
      this.onError?.(`재생이 차단되었습니다. 화면의 재생 버튼을 눌러 주세요. (${(e as Error).name})`);
      return false;
    }
  }

  pause() {
    this.audio.pause();
  }

  get ms() {
    return this.audio.currentTime * 1000;
  }

  seek(ms: number) {
    try {
      this.audio.currentTime = ms / 1000;
    } catch {
      /* noop */
    }
  }

  setupMediaSession(title: string, artist: string, handlers: { play: () => void; pause: () => void; stop: () => void }) {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      ms.metadata = new MediaMetadata({
        title,
        artist,
        album: 'BOXING VOICE COACH',
        artwork: [
          { src: new URL('icons/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' },
          { src: new URL('icons/icon-192.png', document.baseURI).href, sizes: '192x192', type: 'image/png' },
        ],
      });
      ms.setActionHandler('play', handlers.play);
      ms.setActionHandler('pause', handlers.pause);
      try {
        ms.setActionHandler('stop', handlers.stop);
      } catch {
        /* 일부 브라우저 미지원 */
      }
      for (const a of ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) {
        try {
          ms.setActionHandler(a, null);
        } catch {
          /* noop */
        }
      }
    } catch {
      /* Media Session 미지원 */
    }
  }

  updatePosition() {
    const ms = navigator.mediaSession;
    if (!ms?.setPositionState || !Number.isFinite(this.audio.duration)) return;
    try {
      ms.setPositionState({ duration: this.audio.duration, position: Math.min(this.audio.currentTime, this.audio.duration), playbackRate: 1 });
    } catch {
      /* noop */
    }
  }

  dispose(clearSession = true) {
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.audio.removeAttribute('src');
    if (clearSession && navigator.mediaSession) {
      try {
        navigator.mediaSession.metadata = null;
        (['play', 'pause', 'stop'] as MediaSessionAction[]).forEach((a) => navigator.mediaSession.setActionHandler(a, null));
      } catch {
        /* noop */
      }
    }
  }
}
