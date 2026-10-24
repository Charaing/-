import type { PunchCode, ReadStyle, Stance, VoiceStyle } from '../types';
import { baseOf, coachWord, formalWord, isBody, handOf, numberWord } from '../data/punches';

export interface SpeechToken {
  text: string;
  /** 음성 팩(녹음 클립) 키 */
  key: string;
}

function wordKey(p: PunchCode, stance: Stance): string {
  const b = baseOf(p);
  const body = isBody(p);
  if (b === '1') return body ? 'w_bjab' : 'w_jab';
  if (b === '2') return body ? 'w_btwo' : 'w_two';
  const left = handOf(p, stance) === '왼';
  return `w_${body ? 'b' : ''}${left ? 'l' : 'r'}hook`;
}

/** 복싱 코치 스타일 토큰. 1 바로 뒤 2는 '원투'로 묶는다 (단, 앞에 잽이 연속된 경우 '잽, 잽, 투'). */
export function coachTokens(punches: PunchCode[], stance: Stance): SpeechToken[] {
  const out: SpeechToken[] = [];
  for (let i = 0; i < punches.length; i++) {
    const p = punches[i];
    if (p === '1' && punches[i + 1] === '2' && punches[i - 1] !== '1') {
      out.push({ text: '원투', key: 'w_onetwo' });
      i++;
      continue;
    }
    out.push({ text: coachWord(p, stance), key: wordKey(p, stance) });
  }
  return out;
}

export function readTokens(punches: PunchCode[], readStyle: ReadStyle, stance: Stance): string[] {
  if (readStyle === 'number') return punches.map(numberWord);
  if (readStyle === 'formal') return punches.map((p) => formalWord(p, stance));
  return coachTokens(punches, stance).map((t) => t.text);
}

export function joinWords(words: string[], voiceStyle: VoiceStyle): string {
  if (words.length === 0) return '';
  if (voiceStyle === 'live') return words.join('! ') + '!';
  if (voiceStyle === 'number') return words.join(', ') + '!';
  return words.join(', ') + '.';
}

export function effectiveReadStyle(readStyle: ReadStyle, voiceStyle: VoiceStyle): ReadStyle {
  return voiceStyle === 'number' ? 'number' : readStyle;
}

export function comboSpeech(punches: PunchCode[], readStyle: ReadStyle, voiceStyle: VoiceStyle, stance: Stance): string {
  return joinWords(readTokens(punches, effectiveReadStyle(readStyle, voiceStyle), stance), voiceStyle);
}

/** 긴 콤비는 알아듣기 쉽도록 천천히 */
export function comboRateMul(count: number, voiceStyle: VoiceStyle): number {
  let m = count >= 6 ? 0.88 : count === 5 ? 0.93 : 1;
  if (voiceStyle === 'live') m *= 1.05;
  if (voiceStyle === 'number') m *= 1.1;
  return m;
}

/** 큰 글씨 표시: 1 → 2 → 3B */
export function comboLabel(punches: PunchCode[]): string {
  return punches.join(' → ');
}

/** 보조 표시: 원투 · 왼훅 · 투 (번호 스타일이어도 실제 펀치 종류를 보여준다) */
export function comboSub(punches: PunchCode[], stance: Stance): string {
  return coachTokens(punches, stance).map((t) => t.text).join(' · ');
}

/** 발화 예상 길이(초) — onend가 오지 않을 때의 안전장치 */
export function estimateSpeechSec(text: string, rate: number): number {
  const syllables = text.replace(/[^가-힣a-zA-Z0-9]/g, '').length;
  const pauses = (text.match(/[,!.]/g) || []).length;
  return (syllables * 0.2 + pauses * 0.18 + 0.35) / Math.max(0.5, rate);
}

const ORDINAL = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한', '열두'];
export const roundOrdinal = (n: number) => `${ORDINAL[n - 1] ?? n} 번째 라운드`;
export const COUNT_WORDS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구', '십'];
