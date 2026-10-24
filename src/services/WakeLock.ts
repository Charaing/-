import { createStore } from '../stores/store';
import { CoachEngine, isNativeApp } from '../native/CoachEngine';

const NATIVE = isNativeApp();

type Sentinel = { release(): Promise<void>; released?: boolean; addEventListener?: (t: string, f: () => void) => void };

export const wakeLockSupported = () => NATIVE || (typeof navigator !== 'undefined' && 'wakeLock' in navigator);
export const wakeLockState = createStore<{ active: boolean; error: string | null }>({ active: false, error: null });

let sentinel: Sentinel | null = null;
let wanted = false;

export async function acquireWakeLock() {
  wanted = true;
  if (NATIVE) {
    await CoachEngine.setKeepAwake({ on: true }).catch(() => {});
    wakeLockState.set({ active: true, error: null });
    return;
  }
  if (!wakeLockSupported()) {
    wakeLockState.set({ active: false, error: '이 기기는 화면 켜짐 유지를 지원하지 않습니다. 자동 잠금 시간을 늘려 주세요.' });
    return;
  }
  if (sentinel && !sentinel.released) return;
  try {
    sentinel = (await (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<Sentinel> } }).wakeLock.request('screen')) as Sentinel;
    wakeLockState.set({ active: true, error: null });
    sentinel.addEventListener?.('release', () => wakeLockState.set((s) => ({ ...s, active: false })));
  } catch (e) {
    void e;
    wakeLockState.set({ active: false, error: '화면 켜짐 유지를 켜지 못했습니다' });
  }
}

export async function releaseWakeLock() {
  wanted = false;
  if (NATIVE) {
    await CoachEngine.setKeepAwake({ on: false }).catch(() => {});
    wakeLockState.set({ active: false, error: null });
    return;
  }
  try {
    await sentinel?.release();
  } catch {
    /* noop */
  }
  sentinel = null;
  wakeLockState.set({ active: false, error: null });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) acquireWakeLock();
  });
}
