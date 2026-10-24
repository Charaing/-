import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Settings } from '../types';

/** 네이티브(iOS)로 넘기는 타임라인 이벤트 */
export interface NativeEvent {
  t: number;
  kind: 'speak' | 'bell' | 'beep';
  text?: string;
  priority?: number;
  rate?: number;
  strikes?: number;
  freq?: number;
}

export interface NativeState {
  position: number;
  running: boolean;
  active: boolean;
  finished: boolean;
  speaking: boolean;
  durationMs: number;
  segment: { phase?: string; round?: number };
}

export interface VoiceOptions {
  rate?: number;
  volume?: number;
  pitch?: number;
  voiceId?: string;
  audioMix?: 'mix' | 'duck' | 'solo';
  keepAwake?: boolean;
}

interface CoachEnginePlugin {
  configure(o: VoiceOptions): Promise<void>;
  start(o: VoiceOptions & {
    events: NativeEvent[];
    segments: { phase: string; round: number; start: number; end: number }[];
    durationMs: number;
    startMs?: number;
    totalRounds: number;
    title?: string;
  }): Promise<{ ok: boolean }>;
  pause(): Promise<NativeState>;
  resume(o: { cue?: string }): Promise<NativeState>;
  stop(): Promise<void>;
  getState(): Promise<NativeState>;
  speak(o: VoiceOptions & { text: string; rateMul?: number; interrupt?: boolean }): Promise<{ result: 'end' | 'cancelled' }>;
  stopSpeaking(): Promise<void>;
  getVoices(): Promise<{ voices: { id: string; name: string; lang: string; quality: number }[] }>;
  playSound(o: { name: 'bell1' | 'bell2' | 'bell3' | 'beep660' | 'beep880' | 'beep990' | 'tick' }): Promise<void>;
  setKeepAwake(o: { on: boolean }): Promise<void>;
  haptic(o: { style: 'light' | 'medium' | 'heavy' | 'success' | 'warning' }): Promise<void>;
  addListener(event: 'state', fn: (d: { status: 'running' | 'paused'; reason: string; position: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'finished', fn: (d: { position: number }) => void): Promise<PluginListenerHandle>;
}

export const CoachEngine = registerPlugin<CoachEnginePlugin>('CoachEngine');

/** iOS 앱(Capacitor)으로 실행 중인지 */
export const isNativeApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
};

export function voiceOptions(s: Settings): VoiceOptions {
  return {
    rate: s.rate,
    volume: s.volume,
    pitch: s.voiceStyle === 'live' ? 1.05 : 1,
    voiceId: s.voiceURI ?? '',
    audioMix: s.audioMix,
    keepAwake: s.keepAwake,
  };
}
