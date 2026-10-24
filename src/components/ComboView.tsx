import type { Combination, PunchCode, Stance } from '../types';
import { cx } from './ui';
import { comboSub } from '../utils/speech';
import { DIFF_NAMES } from '../utils/labels';
import { GROUP_NAMES } from '../data/combinations';

/** 펀치 코드 알약: 바디는 아래 밑줄로 구분 */
export function PunchPill({ code, size = 'md' }: { code: PunchCode; size?: 'sm' | 'md' | 'lg' }) {
  const body = code.endsWith('B');
  const s = { sm: 'h-7 min-w-7 px-1.5 text-[14px]', md: 'h-9 min-w-9 px-2 text-[17px]', lg: 'h-14 min-w-14 px-3 text-[26px]' }[size];
  return (
    <span className={cx('tnum inline-flex items-center justify-center rounded-lg bg-bg2 font-extrabold', s, body && 'text-accent')}>
      {code[0]}
      {body && <span className="ml-0.5 text-[0.62em] font-bold">B</span>}
    </span>
  );
}

export function PunchRow({ punches, size }: { punches: PunchCode[]; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {punches.map((p, i) => (
        <PunchPill key={i} code={p} size={size} />
      ))}
    </span>
  );
}

export function comboTitle(c: Combination) {
  return c.custom ? c.name || c.punches.join('-') : `#${String(c.no).padStart(3, '0')}`;
}

export function comboMeta(c: Combination) {
  return `${c.count}펀치 · ${DIFF_NAMES[c.difficulty]} · ${GROUP_NAMES[c.group]}`;
}

export function ComboSub({ c, stance }: { c: Combination; stance: Stance }) {
  return <span>{comboSub(c.punches, stance)}</span>;
}
