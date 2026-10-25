import { useEffect, useMemo, useRef } from 'react';
import { gsap, ScrollTrigger } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import './DotWordmark.css';

/** 5-row dot font. 'X' is a lit dot, '.' a faint noise dot. */
const FONT: Record<string, string[]> = {
  A: ['.XX.', 'X..X', 'XXXX', 'X..X', 'X..X'],
  B: ['XXX.', 'X..X', 'XXX.', 'X..X', 'XXX.'],
  C: ['.XXX', 'X...', 'X...', 'X...', '.XXX'],
  D: ['XXX.', 'X..X', 'X..X', 'X..X', 'XXX.'],
  E: ['XXXX', 'X...', 'XXX.', 'X...', 'XXXX'],
  F: ['XXXX', 'X...', 'XXX.', 'X...', 'X...'],
  G: ['.XXX', 'X...', 'X.XX', 'X..X', '.XXX'],
  H: ['X..X', 'X..X', 'XXXX', 'X..X', 'X..X'],
  I: ['XXX', '.X.', '.X.', '.X.', 'XXX'],
  J: ['..XX', '...X', '...X', 'X..X', '.XX.'],
  K: ['X..X', 'X.X.', 'XX..', 'X.X.', 'X..X'],
  L: ['X...', 'X...', 'X...', 'X...', 'XXXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'],
  N: ['X..X', 'XX.X', 'X.XX', 'X..X', 'X..X'],
  O: ['.XX.', 'X..X', 'X..X', 'X..X', '.XX.'],
  P: ['XXX.', 'X..X', 'XXX.', 'X...', 'X...'],
  Q: ['.XX.', 'X..X', 'X..X', 'X.X.', '.X.X'],
  R: ['XXX.', 'X..X', 'XXX.', 'X.X.', 'X..X'],
  S: ['.XXX', 'X...', '.XX.', '...X', 'XXX.'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..'],
  U: ['X..X', 'X..X', 'X..X', 'X..X', '.XX.'],
  V: ['X...X', 'X...X', '.X.X.', '.X.X.', '..X..'],
  W: ['X...X', 'X...X', 'X.X.X', 'XX.XX', 'X...X'],
  X: ['X...X', '.X.X.', '..X..', '.X.X.', 'X...X'],
  Y: ['X...X', '.X.X.', '..X..', '..X..', '..X..'],
  Z: ['XXXX', '...X', '.XX.', 'X...', 'XXXX'],
  '0': ['.XX.', 'X.XX', 'XX.X', 'X..X', '.XX.'],
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '2': ['XXX.', '...X', '.XX.', 'X...', 'XXXX'],
  '3': ['XXX.', '...X', '.XX.', '...X', 'XXX.'],
  '4': ['X..X', 'X..X', 'XXXX', '...X', '...X'],
  '5': ['XXXX', 'X...', 'XXX.', '...X', 'XXX.'],
  '6': ['.XX.', 'X...', 'XXX.', 'X..X', '.XX.'],
  '7': ['XXXX', '...X', '..X.', '.X..', '.X..'],
  '8': ['.XX.', 'X..X', '.XX.', 'X..X', '.XX.'],
  '9': ['.XX.', 'X..X', '.XXX', '...X', '.XX.'],
  ' ': ['..', '..', '..', '..', '..'],
  '&': ['.X..', 'X.X.', '.X..', 'X.XX', '.XXX'],
  '-': ['...', '...', 'XXX', '...', '...'],
  '.': ['.', '.', '.', '.', 'X'],
  "'": ['X', 'X', '.', '.', '.'],
};

const STEP = 8;
const R_LIT = 3.1;
const R_NOISE = 1.3;

/** Upper-cases and strips accents; characters the font lacks are dropped. */
export function dotText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'SS')
    .toUpperCase()
    .split('')
    .filter(ch => ch in FONT)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function layout(text: string) {
  const letters: { rows: string[]; x0: number }[] = [];
  let col = 0;
  for (const ch of dotText(text)) {
    const rows = FONT[ch]!;
    letters.push({ rows, x0: col });
    col += rows[0]!.length + 1;
  }
  return { letters, cols: Math.max(col, 1) };
}

interface DotWordProps {
  text: string;
  className?: string;
  /** Pop the dots in on mount. */
  intro?: boolean;
}

/** Compact dotted wordmark for headers. The accessible name is the plain text. */
export function DotWord({ text, className, intro = true }: DotWordProps) {
  const ref = useRef<SVGSVGElement>(null);
  const { letters, cols } = useMemo(() => layout(text), [text]);

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !intro || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-dot]', {
        x: () => gsap.utils.random(-14, 14),
        y: () => gsap.utils.random(-10, 10),
        scale: 0,
        opacity: 0,
        transformOrigin: '50% 50%',
        duration: 0.7,
        ease: 'back.out(2.2)',
        stagger: { each: 0.006, from: 'random' },
      });
    }, svg);
    return () => ctx.revert();
  }, [text, intro]);

  const gather = () => {
    const dots = ref.current?.querySelectorAll('[data-dot]');
    if (!dots?.length || prefersReducedMotion() || gsap.isTweening(dots[0]!)) return;
    gsap
      .timeline()
      .to(dots, { x: () => gsap.utils.random(-4, 4), y: () => gsap.utils.random(-3, 3), duration: 0.16, stagger: { each: 0.0015, from: 'random' } })
      .to(dots, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, .5)', stagger: { each: 0.0025, from: 'random' } });
  };

  return (
    <svg
      ref={ref}
      className={['dotword', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${(cols - 1) * STEP} ${5 * STEP}`}
      role="img"
      aria-label={text}
      onPointerEnter={gather}
    >
      {letters.map(({ rows, x0 }, li) => (
        <g key={li}>
          {rows.flatMap((row, y) =>
            [...row].map((v, x) => {
              const on = v === 'X';
              return <circle key={`${x}-${y}`} data-dot cx={(x0 + x) * STEP + STEP / 2} cy={y * STEP + STEP / 2} r={on ? R_LIT : R_NOISE} opacity={on ? 1 : 0.18} fill="currentColor" />;
            }),
          )}
        </g>
      ))}
    </svg>
  );
}

interface PlayProps {
  text: string;
  /** Accessible label for the button ("Decode the wordmark"). */
  label: string;
  className?: string;
}

/**
 * Large footer wordmark: decodes letter by letter when it scrolls in or is
 * clicked, and its dots lean away from the pointer. Static under reduced motion.
 */
export function DotWordPlay({ text, label, className }: PlayProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { letters, cols } = useMemo(() => layout(text), [text]);
  const width = cols * STEP;

  useEffect(() => {
    const host = ref.current;
    const svg = host?.querySelector('svg');
    if (!host || !svg) return;
    const stop = svg.querySelector<SVGCircleElement>('[data-stop]')!;
    const cells = [...svg.querySelectorAll<SVGCircleElement>('[data-cell]')].map(el => ({
      el,
      x: Number(el.getAttribute('cx')),
      y: Number(el.getAttribute('cy')),
      on: el.dataset.on === '1',
      li: Number(el.dataset.li),
      dx: 0,
      dy: 0,
      s: 0,
    }));
    const reduced = prefersReducedMotion();

    let decoding: gsap.core.Timeline | null = null;
    const setCell = (c: (typeof cells)[number], on: boolean, duration: number) =>
      gsap.to(c.el, { attr: { r: on ? R_LIT : R_NOISE }, opacity: on ? 1 : 0.2, duration, ease: 'power2.out', overwrite: 'auto' });
    const decode = () => {
      if (reduced || decoding?.isActive()) return;
      const tl = gsap.timeline();
      letters.forEach((_, li) => {
        const own = cells.filter(c => c.li === li);
        const frames = 5 + Math.min(li, 10);
        const start = li * 0.05;
        for (let f = 0; f < frames; f++) tl.call(() => own.forEach(c => setCell(c, Math.random() < 0.45, 0.06)), undefined, start + f * 0.07);
        tl.call(() => own.forEach(c => setCell(c, c.on, 0.3)), undefined, start + frames * 0.07);
      });
      tl.fromTo(stop, { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.4)' }, '>-0.05');
      decoding = tl;
    };

    const RADIUS = 30;
    const PUSH = 11;
    let px = -1e4;
    let py = -1e4;
    let active = false;
    let raf = 0;
    const tick = () => {
      let moving = false;
      for (const c of cells) {
        let tx = 0;
        let ty = 0;
        let ts = 0;
        if (active) {
          const ddx = c.x - px;
          const ddy = c.y - py;
          const d = Math.hypot(ddx, ddy);
          if (d < RADIUS) {
            const k = 1 - d / RADIUS;
            const inv = d > 0.001 ? 1 / d : 0;
            tx = ddx * inv * PUSH * k * k;
            ty = ddy * inv * PUSH * k * k;
            ts = k;
          }
        }
        c.dx += (tx - c.dx) * 0.18;
        c.dy += (ty - c.dy) * 0.18;
        c.s += (ts - c.s) * 0.18;
        if (Math.abs(c.dx) + Math.abs(c.dy) + Math.abs(c.s) > 0.02) moving = true;
        const sc = 1 + c.s * 0.9;
        c.el.setAttribute('transform', `translate(${(c.x + c.dx).toFixed(2)} ${(c.y + c.dy).toFixed(2)}) scale(${sc.toFixed(3)}) translate(${-c.x} ${-c.y})`);
      }
      raf = moving || active ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      px = p.x;
      py = p.y;
      active = true;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onLeave = () => {
      active = false;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    let st: ScrollTrigger | null = null;
    if (!reduced) {
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerleave', onLeave);
      st = ScrollTrigger.create({
        trigger: host,
        start: 'top bottom-=40',
        once: true,
        onEnter: () => {
          cells.forEach(c => gsap.set(c.el, { attr: { r: R_NOISE }, opacity: 0.2 }));
          gsap.set(stop, { scale: 0, transformOrigin: '50% 50%' });
          decode();
        },
      });
    }
    host.addEventListener('click', decode);

    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('click', decode);
      st?.kill();
      decoding?.kill();
    };
  }, [letters]);

  return (
    <button ref={ref} type="button" aria-label={label} className={['dotplay', className].filter(Boolean).join(' ')}>
      <svg viewBox={`-4 -4 ${width + 8} ${5 * STEP + 8}`} aria-hidden="true">
        {letters.map(({ rows, x0 }, li) => (
          <g key={li}>
            {rows.flatMap((row, y) =>
              [...row].map((v, x) => {
                const on = v === 'X';
                return (
                  <circle
                    key={`${x}-${y}`}
                    data-cell
                    data-on={on ? '1' : '0'}
                    data-li={li}
                    cx={(x0 + x) * STEP + STEP / 2}
                    cy={y * STEP + STEP / 2}
                    r={on ? R_LIT : R_NOISE}
                    opacity={on ? 1 : 0.2}
                    fill="currentColor"
                  />
                );
              }),
            )}
          </g>
        ))}
        <circle data-stop className="dotplay__stop" cx={(cols - 1) * STEP + STEP / 2} cy={4 * STEP + STEP / 2} r={R_LIT + 0.9} fill="currentColor" />
      </svg>
    </button>
  );
}
