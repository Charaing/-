import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Minus, Plus, X } from 'lucide-react';

export function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}

export function Section({ title, children, hint }: { title?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="mb-7">
      {title && <h2 className="mb-2.5 px-1 text-[15px] font-bold text-fg">{title}</h2>}
      <div className="overflow-hidden rounded-2xl bg-card">{children}</div>
      {hint && <p className="mt-2 px-1 text-[13px] leading-relaxed text-mute">{hint}</p>}
    </section>
  );
}

export function Row({ label, desc, children, onClick, stack }: { label: ReactNode; desc?: ReactNode; children?: ReactNode; onClick?: () => void; stack?: boolean }) {
  const inner = (
    <div className={cx('flex min-h-[56px] gap-3 px-4 py-3', stack ? 'flex-col' : 'items-center justify-between')}>
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-fg">{label}</div>
        {desc && <div className="mt-0.5 text-[13px] leading-snug text-mute">{desc}</div>}
      </div>
      {children != null && <div className={cx(stack ? 'w-full' : 'shrink-0')}>{children}</div>}
    </div>
  );
  return (
    <div className="border-b border-line last:border-b-0">
      {onClick ? (
        <button type="button" onClick={onClick} className="press block w-full text-left">
          {inner}
        </button>
      ) : (
        inner
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-[31px] w-[51px] rounded-full transition-colors', checked ? 'bg-accent' : 'bg-[#2a313c]', disabled && 'opacity-40')}
    >
      <span className={cx('absolute left-0 top-[2px] h-[27px] w-[27px] rounded-full transition-transform', checked ? 'translate-x-[22px] bg-bg' : 'translate-x-[2px] bg-fg')} />
    </button>
  );
}

export function Stepper({ value, onChange, min, max, step = 1, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string }) {
  const btn = 'press flex h-10 w-10 items-center justify-center rounded-xl bg-bg2 text-fg disabled:opacity-30';
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} aria-label="줄이기" disabled={value <= min} onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>
        <Minus size={18} />
      </button>
      <span className="tnum min-w-[64px] text-center text-[17px] font-bold">{format ? format(value) : value}</span>
      <button type="button" className={btn} aria-label="늘리기" disabled={value >= max} onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}>
        <Plus size={18} />
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, small }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className="flex w-full gap-1 rounded-xl bg-bg2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'press flex-1 rounded-lg px-2 font-semibold',
            small ? 'h-9 text-[13px]' : 'h-10 text-[14px]',
            o.value === value ? 'bg-fg text-bg' : 'text-mute',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step = 1, format, ariaLabel }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string; ariaLabel?: string }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex w-full items-center gap-3">
      <input
        type="range"
        className="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--p' as string]: `${p}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="tnum w-[64px] shrink-0 text-right text-[15px] font-bold">{format ? format(value) : value}</span>
    </div>
  );
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('press h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[14px] font-semibold', active ? 'bg-fg text-bg' : 'bg-card text-mute')}
    >
      {children}
    </button>
  );
}

export function Button({ children, onClick, kind = 'primary', className, disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; className?: string; disabled?: boolean; type?: 'button' | 'submit' }) {
  const k = {
    primary: 'bg-accent text-bg',
    secondary: 'bg-card text-fg',
    danger: 'bg-danger/15 text-danger',
    ghost: 'text-mute',
  }[kind];
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={cx('press flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[16px] font-bold disabled:opacity-35', k, className)}>
      {children}
    </button>
  );
}

/** 길게 눌러야 실행 — 훈련 중 실수 종료 방지 */
export function HoldButton({ children, onDone, ms = 900, className }: { children: ReactNode; onDone: () => void; ms?: number; className?: string }) {
  const [holding, setHolding] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    setHolding(true);
    t.current = setTimeout(() => {
      setHolding(false);
      onDone();
    }, ms);
  };
  const cancel = () => {
    setHolding(false);
    if (t.current) clearTimeout(t.current);
  };
  useEffect(() => cancel, []);
  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onDone()}
      className={cx('relative overflow-hidden', className)}
    >
      <span
        className="absolute inset-0 origin-left bg-danger/30"
        style={{ transform: 'scaleX(0)', animation: holding ? `hold-fill ${ms}ms linear forwards` : 'none' }}
      />
      <span className="relative flex items-center justify-center gap-2">{children}</span>
    </button>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="fade-in absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="sheet-in pb-safe relative max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-t-3xl bg-bg2 px-5 pt-3">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#2a313c]" />
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[19px] font-bold">{title}</div>
          <button type="button" aria-label="닫기" onClick={onClose} className="press -mr-2 flex h-10 w-10 items-center justify-center rounded-full text-mute">
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode; action?: ReactNode }) {
  const c = { info: 'bg-card text-fg', warn: 'bg-[#2a2614] text-[#f2e7a5]', error: 'bg-danger/15 text-[#ffb3b5]' }[tone];
  return (
    <div className={cx('mb-4 rounded-2xl px-4 py-3 text-[14px] leading-relaxed', c)}>
      {children}
      {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between px-1 pb-5 pt-2">
      <h1 className="text-[28px] font-extrabold tracking-tight">{title}</h1>
      {right}
    </header>
  );
}
