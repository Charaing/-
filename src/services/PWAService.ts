import { createStore } from '../stores/store';
import { isNativeApp } from '../native/CoachEngine';

export interface PWAState {
  standalone: boolean;
  isIOS: boolean;
  isSafari: boolean;
  online: boolean;
  swReady: boolean;
  updateAvailable: boolean;
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && typeof document !== 'undefined' && 'ontouchend' in document);
const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/.test(ua);
const standalone =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

export const pwaStore = createStore<PWAState>({
  standalone: !!standalone,
  isIOS,
  isSafari,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  swReady: false,
  updateAvailable: false,
});

export function initPWA() {
  window.addEventListener('online', () => pwaStore.set((s) => ({ ...s, online: true })));
  window.addEventListener('offline', () => pwaStore.set((s) => ({ ...s, online: false })));
  if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.SINGLE_FILE && location.protocol.startsWith('http')) {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        pwaStore.set((s) => ({ ...s, swReady: true }));
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) pwaStore.set((s) => ({ ...s, updateAvailable: true }));
          });
        });
      })
      .catch(() => pwaStore.set((s) => ({ ...s, swReady: false })));
  }
}

/** iPhone Safari(브라우저 탭)에서 아직 설치하지 않은 경우에만 설치 안내 */
export const shouldShowInstallHint = (s: PWAState) => s.isIOS && !s.standalone && !isNativeApp();
