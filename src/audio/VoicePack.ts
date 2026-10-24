import { FOOTWORK_STEPS } from '../data/footwork';
import { createStore } from '../stores/store';

/**
 * 연속 오디오 트랙용 음성 클립.
 * Web Speech API는 오디오 파일로 내보낼 수 없으므로, 트랙은 다음 두 소스 중 하나로 만든다.
 *  1) 녹음 음성 팩 — 사용자가 직접 녹음한 단어 클립 (기기 안에 저장, 완전 오프라인)
 *  2) 외부 TTS 서버 — 사용자가 지정한 URL에서 문장 음성을 받아 캐시 (CORS 허용 필요)
 */

export interface ClipDef {
  key: string;
  text: string;
  group: 'punch' | 'step' | 'announce';
  required: boolean;
}

export const CLIP_DEFS: ClipDef[] = [
  { key: 'w_onetwo', text: '원투', group: 'punch', required: true },
  { key: 'w_jab', text: '잽', group: 'punch', required: true },
  { key: 'w_two', text: '투', group: 'punch', required: true },
  { key: 'w_lhook', text: '왼훅', group: 'punch', required: true },
  { key: 'w_rhook', text: '오른훅', group: 'punch', required: true },
  { key: 'w_bjab', text: '바디 잽', group: 'punch', required: true },
  { key: 'w_btwo', text: '바디 투', group: 'punch', required: true },
  { key: 'w_blhook', text: '왼 바디 훅', group: 'punch', required: true },
  { key: 'w_brhook', text: '오른 바디 훅', group: 'punch', required: true },
  ...FOOTWORK_STEPS.map((f) => ({ key: f.id, text: f.speech, group: 'step' as const, required: true })),
  { key: 'a_ready', text: '라운드 준비', group: 'announce', required: false },
  { key: 'a_start', text: '시작!', group: 'announce', required: false },
  { key: 'a_end', text: '라운드 종료, 휴식', group: 'announce', required: false },
  { key: 'a_10s', text: '십 초 남았습니다!', group: 'announce', required: false },
  { key: 'a_next', text: '다음 라운드 준비', group: 'announce', required: false },
  { key: 'a_done', text: '훈련 종료, 수고하셨습니다', group: 'announce', required: false },
];

export interface TrackSourceSettings {
  provider: 'recorded' | 'remote';
  remoteUrl: string; // 예: https://my-tts.example.com/tts?lang=ko&text={text}
}

export const trackSourceStore = createStore<TrackSourceSettings>({ provider: 'recorded', remoteUrl: '' }, 'bvc.trackSource.v1');

/* ---------------- IndexedDB ---------------- */

const DB_NAME = 'bvc-audio';
const DB_VER = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB를 사용할 수 없습니다.'));
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips');
      if (!db.objectStoreNames.contains('remote')) db.createObjectStore('remote');
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const idb = {
  get: <T>(store: string, key: string) => tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  put: (store: string, key: string, val: unknown) => tx(store, 'readwrite', (s) => s.put(val, key)),
  del: (store: string, key: string) => tx(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: string) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
  clear: (store: string) => tx(store, 'readwrite', (s) => s.clear()),
};

/** 녹음된 클립 키 목록 (UI 갱신용) */
export const recordedKeysStore = createStore<string[]>([]);

export async function refreshRecordedKeys() {
  try {
    const keys = (await idb.keys('clips')).map(String);
    recordedKeysStore.set(keys);
  } catch {
    recordedKeysStore.set([]);
  }
}

export async function saveClip(key: string, blob: Blob) {
  await idb.put('clips', key, blob);
  await refreshRecordedKeys();
}

export async function deleteClip(key: string) {
  await idb.del('clips', key);
  await refreshRecordedKeys();
}

export async function clearClips() {
  await idb.clear('clips');
  await refreshRecordedKeys();
}

export async function clearRemoteCache() {
  await idb.clear('remote');
}

/* ---------------- 녹음 ---------------- */

export const recordingSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined';

export class ClipRecorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported?.(m));
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.rec) return reject(new Error('녹음 중이 아닙니다.'));
      const rec = this.rec;
      rec.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/mp4' }));
        this.rec = null;
      };
      rec.stop();
    });
  }

  cancel() {
    try {
      this.rec?.stop();
    } catch {
      /* noop */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rec = null;
  }
}

/* ---------------- 디코딩 / 다듬기 ---------------- */

export const TRACK_SR = 16000;

let decodeCtx: AudioContext | null = null;
function getDecodeCtx(): BaseAudioContext {
  if (!decodeCtx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    decodeCtx = new AC();
  }
  return decodeCtx;
}

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const buf = await blob.arrayBuffer();
  const ctx = getDecodeCtx();
  return await new Promise<AudioBuffer>((resolve, reject) => {
    // 구형 Safari는 콜백 형식만 지원
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}

/** 앞뒤 무음 제거 + 피크 정규화, 모노 Float32 */
export function trimNormalize(b: AudioBuffer): { data: Float32Array; sampleRate: number } {
  const ch = b.numberOfChannels;
  const n = b.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
  const thr = Math.max(0.01, peak * 0.06);
  let s = 0;
  while (s < n && Math.abs(mono[s]) < thr) s++;
  let e = n - 1;
  while (e > s && Math.abs(mono[e]) < thr) e--;
  const pad = Math.round(b.sampleRate * 0.04);
  s = Math.max(0, s - pad);
  e = Math.min(n - 1, e + pad);
  const out = mono.slice(s, e + 1);
  const gain = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return { data: out, sampleRate: b.sampleRate };
}
