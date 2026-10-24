import type { PunchCode, Stance } from '../types';

/** 허용된 펀치 코드 — 어퍼컷(5, 6 등)은 체계에 존재하지 않는다. */
export const PUNCH_CODES: readonly PunchCode[] = ['1', '2', '3', '4', '1B', '2B', '3B', '4B'] as const;

export const isPunchCode = (s: string): s is PunchCode => (PUNCH_CODES as readonly string[]).includes(s);

export const isBody = (p: PunchCode) => p.endsWith('B');
export const baseOf = (p: PunchCode) => p[0] as '1' | '2' | '3' | '4';

/** 앞손/뒷손 → 실제 손 (오소독스: 앞손=왼손) */
export function handOf(p: PunchCode, stance: Stance): '왼' | '오른' {
  const front = baseOf(p) === '1' || baseOf(p) === '3';
  if (stance === 'orthodox') return front ? '왼' : '오른';
  return front ? '오른' : '왼';
}

/** 화면에 표시할 정확한 펀치 명칭 */
export function punchFullName(p: PunchCode, stance: Stance): string {
  const hand = handOf(p, stance);
  const pos = baseOf(p) === '1' || baseOf(p) === '3' ? '앞손' : '뒷손';
  const body = isBody(p) ? ' 바디' : '';
  switch (baseOf(p)) {
    case '1': return `${pos}(${hand}손)${body} 잽`;
    case '2': return `${pos}(${hand}손)${body} 스트레이트`;
    case '3': return `${pos}(${hand}손)${body} 훅`;
    case '4': return `${pos}(${hand}손)${body} 훅`;
  }
}

/** 짧은 표시명 (번호 스타일에서도 3·4의 실제 펀치 종류를 보여주기 위함) */
export function punchShortName(p: PunchCode, stance: Stance): string {
  const hand = handOf(p, stance);
  const body = isBody(p) ? '바디 ' : '';
  switch (baseOf(p)) {
    case '1': return isBody(p) ? '바디 잽' : '잽';
    case '2': return isBody(p) ? '바디 투' : '투';
    case '3':
    case '4': return `${hand} ${body}훅`.replace('왼 훅', '왼훅').replace('오른 훅', '오른훅');
  }
}

/** 음성 단어 — 복싱 코치 스타일 */
export function coachWord(p: PunchCode, stance: Stance): string {
  switch (baseOf(p)) {
    case '1': return isBody(p) ? '바디 잽' : '잽';
    case '2': return isBody(p) ? '바디 투' : '투';
    case '3':
    case '4': {
      const hand = handOf(p, stance);
      return isBody(p) ? `${hand} 바디 훅` : `${hand}훅`;
    }
  }
}

/** 음성 단어 — 번호 스타일 */
export function numberWord(p: PunchCode): string {
  const n = { '1': '원', '2': '투', '3': '쓰리', '4': '포' }[baseOf(p)];
  return isBody(p) ? `${n} 바디` : n;
}

/** 음성 단어 — 정식 명칭 스타일 */
export function formalWord(p: PunchCode, stance: Stance): string {
  const hand = handOf(p, stance);
  const body = isBody(p) ? '바디 ' : '';
  switch (baseOf(p)) {
    case '1': return `${body}잽`;
    case '2': return `${body}스트레이트`;
    case '3':
    case '4': return `${hand}손 ${body}훅`;
  }
}
