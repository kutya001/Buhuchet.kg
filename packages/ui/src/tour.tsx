'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { buttonClass, iconButtonClass, linkButtonClass } from './button';
import { Icon } from './icon';
import type { IconName } from './icons';
import { PHONE_QUERY, useMediaQuery, useMounted } from './use-media';

/*
 * «Показать как» и «Обзор экрана» поверх экрана (прототип ui/tour.js — tourOverlay, tourShow,
 * tourPlace; css/kb.css `.tour-*`): подсвеченный элемент в «окошке», остальной экран затемнён,
 * облачко с «N из M», полосой прогресса, названием, пояснением и кнопками «Назад», «Далее»,
 * «Закончить показ». Нажатия по экрану во время показа не доходят до него, открытые показом меню от
 * нажатия по облачку не закрываются. На ПК — стрелки ← → и Esc, на телефоне облачко внизу экрана
 * поверх нижней панели, только кнопками.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Отступ рамки подсветки от элемента, px. */
const HOLE_PAD = 6;
/** Отступ облачка от краёв экрана и от элемента, px. */
const GAP = 12;
/** Ширина облачка, px (на узком экране — по ширине экрана). */
const BUBBLE_W = 380;

/** «Окошко» подсветки: элемент с отступом, не за краями экрана. */
export function tourHole(r: Rect, view: { w: number; h: number }): Rect {
  const left = Math.max(4, r.left - HOLE_PAD);
  const top = Math.max(4, r.top - HOLE_PAD);
  return {
    left,
    top,
    width: Math.min(view.w - 8, r.width + HOLE_PAD * 2),
    height: Math.min(view.h - 8, r.height + HOLE_PAD * 2),
  };
}

/**
 * Где облачко (прототип tourPlace): на телефоне — внизу, а если элемент внизу — над ним или сверху;
 * без элемента — посередине; у пункта меню — сбоку от меню, чтобы не закрывать следующие пункты; иначе
 * под элементом, не помещается — над ним, и над ним нет места — сбоку.
 */
export function tourBubblePlace(
  hole: Rect | null,
  bubble: { w: number; h: number },
  view: { w: number; h: number },
  options: { phone: boolean; menu?: Rect | null },
): { x: number; y: number } {
  const { w: W, h: H } = view;
  const { w: bw, h: bh } = bubble;
  if (options.phone) {
    const x = (W - bw) / 2;
    let y = H - bh - GAP;
    if (hole && hole.top + hole.height > y - 8) {
      y = Math.max(GAP, Math.min(hole.top - bh - GAP, H - bh - GAP));
    }
    if (hole && y < hole.top + hole.height && y + bh > hole.top) y = GAP;
    return { x, y };
  }
  if (!hole) return { x: (W - bw) / 2, y: (H - bh) / 2 };
  const menu = options.menu;
  if (menu) {
    const lx = menu.left - bw - GAP;
    const rx = menu.left + menu.width + GAP;
    const x = lx >= GAP ? lx : rx + bw <= W - GAP ? rx : null;
    if (x !== null) return { x, y: Math.max(GAP, Math.min(H - bh - GAP, hole.top - 10)) };
  }
  let x = Math.min(W - bw - GAP, Math.max(GAP, hole.left));
  let y = hole.top + hole.height + GAP;
  if (y + bh > H - GAP) {
    y = hole.top - bh - GAP;
    if (y < GAP) {
      x = hole.left + hole.width + GAP;
      y = Math.max(GAP, Math.min(H - bh - GAP, hole.top));
      if (x + bw > W - GAP) x = Math.max(GAP, hole.left - bw - GAP);
    }
  }
  return { x, y };
}

export interface TourLabels {
  /** «Закончить показ». */
  end: string;
  /** Подсказка крестика: «Закончить показ (Esc)». */
  endHint: string;
  back: string;
  /** «← → — листать, Esc — закончить» (только на ПК). */
  keys: string;
}

export interface TourOverlayProps {
  /** Показ идёт: затемнение и облачко на экране. */
  open: boolean;
  /** Подсвеченный элемент; null — облачко посередине, без подсветки. */
  target: HTMLElement | null;
  /** «5 из 14» и доля для полосы; null — показ ещё готовится (без счётчика и кнопок). */
  step: { label: string; part: number } | null;
  title: string;
  text: string;
  /** «Пропущено знакомых элементов: N» и «Показать всё» (ссылкой; `solo` — кнопкой рядом с «Готово»). */
  skipped?: { text: string; showAll: string; solo: boolean } | null;
  /** Кнопка вперёд: «Далее», «Готово», «Сделать сейчас», «Понятно, заполню». */
  next: { label: string; icon?: IconName };
  canBack: boolean;
  /** Пока готовится следующее облачко — кнопки не нажимаются. */
  busy?: boolean;
  labels: TourLabels;
  onNext: () => void;
  onBack: () => void;
  onEnd: () => void;
  onShowAll: () => void;
}

const visible = (el: HTMLElement | null): el is HTMLElement =>
  !!el && el.isConnected && el.getClientRects().length > 0;

export function TourOverlay(props: TourOverlayProps) {
  const { open, target, step, title, text, skipped, next, canBack, busy, labels } = props;
  const root = useRef<HTMLDivElement>(null);
  const holeRef = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  const mounted = useMounted();
  // Обработчики клавиш и нажатий читают свежие пропсы.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // «Окошко» и облачко ставятся прямо в разметку (как в прототипе): они следуют за прокруткой и
  // размером окна без новых отрисовок.
  const place = useCallback(() => {
    const el = visible(target) ? target : null;
    const view = { w: window.innerWidth, h: window.innerHeight };
    const mob = window.matchMedia(PHONE_QUERY).matches;
    const h = el ? tourHole(el.getBoundingClientRect(), view) : null;
    const hole = holeRef.current;
    if (hole) {
      Object.assign(
        hole.style,
        h
          ? {
              left: `${h.left}px`,
              top: `${h.top}px`,
              width: `${h.width}px`,
              height: `${h.height}px`,
            }
          : { left: '50%', top: '50%', width: '0px', height: '0px' },
      );
    }
    const b = bubble.current;
    if (!b) return;
    const bw = Math.min(BUBBLE_W, view.w - 24);
    b.style.width = `${bw}px`;
    const pop = el?.closest<HTMLElement>('[data-popover]');
    const pos = tourBubblePlace(h, { w: bw, h: b.offsetHeight }, view, {
      phone: mob,
      menu: pop ? pop.getBoundingClientRect() : null,
    });
    Object.assign(b.style, { left: `${pos.x}px`, top: `${pos.y}px`, visibility: 'visible' });
  }, [target]);

  // Облачко ставится по элементу после каждой смены облачка и ещё раз, когда экран успокоился.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const raf = requestAnimationFrame(place);
    const timer = setTimeout(place, 260);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [open, place, step, title, text, skipped]);

  useEffect(() => {
    if (!open) return;
    const again = () => place();
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => {
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
    };
  }, [open, place]);

  // Нажатия по затемнению и облачку не доходят до экрана: меню, открытое показом, не закрывается.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) e.stopPropagation();
    };
    const key = (e: KeyboardEvent) => {
      const p = latest.current;
      const go =
        e.key === 'ArrowRight'
          ? 'next'
          : e.key === 'ArrowLeft'
            ? 'back'
            : e.key === 'Escape'
              ? 'end'
              : null;
      if (!go) return;
      e.preventDefault();
      e.stopPropagation();
      if (go === 'end') p.onEnd();
      else if (!p.busy && p.step && go === 'next') p.onNext();
      else if (!p.busy && p.step && p.canBack) p.onBack();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  if (!open || !mounted) return null;
  return createPortal(
    <div ref={root} data-tour="" className="fixed inset-0 z-[200]">
      <div
        aria-hidden="true"
        ref={holeRef}
        data-tour-hole=""
        style={{ left: '50%', top: '50%', width: 0, height: 0 }}
        className="pointer-events-none fixed rounded-[14px] shadow-[0_0_0_9999px_var(--color-tour-dim)] outline-2 outline-tour-ring transition-[left,top,width,height] duration-250 motion-reduce:transition-none"
      />
      <div
        ref={bubble}
        role="dialog"
        aria-live="polite"
        aria-label={title}
        data-tour-bubble=""
        style={{ left: 0, top: 0, visibility: 'hidden' }}
        className="fixed flex flex-col gap-1.5 rounded-2xl border border-line-strong bg-raised px-4 pt-3.5 pb-3 text-ink shadow-pop transition-[left,top] duration-250 motion-reduce:transition-none max-md:px-3.5 max-md:pt-3 max-md:pb-2.5"
      >
        {step ? (
          <>
            <div className="flex min-h-6 items-center gap-1.5">
              <span
                data-tour-count=""
                className="text-[11.5px] font-[650] tracking-[.04em] text-faint"
              >
                {step.label}
              </span>
              <span className="grow" />
              <button
                type="button"
                className={iconButtonClass('sm')}
                aria-label={labels.end}
                title={labels.endHint}
                onClick={props.onEnd}
              >
                <Icon name="x" size="sm" />
              </button>
            </div>
            <div aria-hidden="true" className="mb-1 h-1 overflow-hidden rounded-full bg-pane-alt">
              <i
                className="block h-full rounded-full bg-accent"
                style={{ width: `${Math.round(step.part * 100)}%` }}
              />
            </div>
          </>
        ) : null}
        <b className="text-[15.5px] tracking-[-.01em] max-md:text-[15px]">{title}</b>
        <p className="m-0 mb-1.5 text-[13.5px] leading-[1.55] text-muted max-md:max-h-[30vh] max-md:overflow-auto">
          {text}
        </p>
        {skipped ? (
          <div
            data-tour-skipped=""
            className="mb-2 flex items-center gap-1.5 rounded-lg bg-pane-alt px-2 py-1.5 text-[12.5px] text-muted"
          >
            <Icon name="check" size="sm" className="flex-none text-ok" />
            <span className="grow">{skipped.text}</span>
            {skipped.solo ? null : (
              <button type="button" className={linkButtonClass()} onClick={props.onShowAll}>
                {skipped.showAll}
              </button>
            )}
          </div>
        ) : null}
        {step ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <button type="button" className={linkButtonClass()} onClick={props.onEnd}>
              {labels.end}
            </button>
            <span className="grow" />
            {canBack ? (
              <button
                type="button"
                className={`${buttonClass('ghost', 'sm')} max-md:min-h-10`}
                disabled={busy}
                onClick={props.onBack}
              >
                {labels.back}
              </button>
            ) : null}
            {skipped?.solo ? (
              <button
                type="button"
                className={`${buttonClass('ghost', 'sm')} max-md:min-h-10`}
                disabled={busy}
                onClick={props.onShowAll}
              >
                {skipped.showAll}
              </button>
            ) : null}
            <button
              type="button"
              data-tour-next=""
              className={`${buttonClass('cta', 'sm')} max-md:min-h-10`}
              disabled={busy}
              onClick={props.onNext}
            >
              {next.icon ? <Icon name={next.icon} size="sm" /> : null}
              {next.label}
            </button>
          </div>
        ) : null}
        {step && !phone ? (
          <div className="text-right text-[11.5px] text-faint">{labels.keys}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
