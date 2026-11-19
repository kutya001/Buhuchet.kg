'use client';

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { buttonClass, iconButtonClass, linkButtonClass } from '../button';
import { useFadeAway } from '../fade-away';
import { Icon } from '../icon';
import type { IconName } from '../icons';
import { PHONE_QUERY, useMediaQuery, useMounted } from '../use-media';
import { useSwipeDown } from '../use-swipe-down';

/** Строка панели, готовая к показу: тексты и время приложение уже собрало. */
export interface BellRowView {
  id: string;
  icon: IconName;
  /** Название контрагента — над фразой; нет контрагента — null. */
  contractor: string | null;
  /** Что случилось — одной фразой, простым текстом. */
  text: string;
  /** Когда: «только что», «5 мин назад», «14:20», «вчера 14:20», «12.11 14:20». */
  at: string;
  /** Подпись группы: «Сегодня», «Вчера», «Раньше». */
  group: string;
  read: boolean;
}

export interface BellLabels {
  /** «Уведомления» — заголовок панели и подпись значка. */
  title: string;
  /** Подпись значка с непросмотренными: «Уведомления: непросмотренных 3». */
  unseen: string;
  /** Подпись значка с серой точкой: «Уведомления: есть новости». */
  newsDot: string;
  /** «Новости» — ссылка пустой панели «Все», когда под кнопкой «Новости» строки есть. */
  showNews: string;
  readAll: string;
  close: string;
  /** Название ряда кнопок-фильтров для экранного диктора. */
  tabs: string;
  empty: string;
  showAll: string;
  more: string;
  /** Точка у неоткрытой строки — для экранного диктора. */
  unread: string;
  error: string;
  retry: string;
}

export interface BellProps {
  /**
   * Сколько рабочих уведомлений ещё не видели: 1–99, больше — «99+»; 0 — значок серый, без числа.
   * Новости версий в число не входят (прототип v138).
   */
  unseen: number;
  /** Есть непросмотренные новости версий: серая точка на значке, когда рабочих уведомлений нет. */
  news?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: BellLabels;
  tabs: readonly { value: string; label: string }[];
  tab: string;
  onTab: (tab: string) => void;
  /** Строки выбранной кнопки-фильтра; null — загружаются. */
  rows: readonly BellRowView[] | null;
  error: boolean;
  onRetry: () => void;
  more: boolean;
  loadingMore: boolean;
  onMore: () => void;
  /** Есть неоткрытые строки — «Прочитать все» доступна. */
  canReadAll: boolean;
  onReadAll: () => void;
  /** Пусто под фильтром, а во «Все» строки есть — «Показать все». */
  canShowAll: boolean;
  /** Пусто во «Все», а под кнопкой «Новости» строки есть — ссылка «Новости» (прототип v138). */
  canShowNews?: boolean;
  onRow: (id: string) => void;
}

/** Число на значке (прототип `bellCount`): больше 99 — «99+». */
export function bellCountText(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** Строки по группам «Сегодня / Вчера / Раньше» в порядке списка (прототип `bellListHtml`). */
export function bellGroups(rows: readonly BellRowView[]): { group: string; rows: BellRowView[] }[] {
  const out: { group: string; rows: BellRowView[] }[] = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (last && last.group === r.group) last.rows.push(r);
    else out.push({ group: r.group, rows: [r] });
  }
  return out;
}

/** Отступ панели от края экрана на ПК (openPop прототипа). */
const EDGE = 8;

/**
 * Колокольчик в верхней панели и панель «Уведомления» (доработки 16.11.2026, блок 3; прототип v123
 * `ui/bell-panel.js`, css/shell.css `.tb-bell`, `.bell-*`): значок жёлтый с красным числом, пока есть
 * непросмотренные рабочие уведомления; только новости версий — серая точка без числа (прототип v138
 * `.bell-nd`); панель под значком (на ПК 400 px, до 600 px в высоту) с кнопками-фильтрами, строками
 * по группам, «Показать ещё» и «Прочитать все»; на телефоне — во весь экран, выезжает снизу,
 * закрывается крестиком или протяжкой вниз. Как всплывающее окошко: Esc, нажатие вне панели и «Назад»
 * закрывают её. Данные, отметки и переходы — у приложения.
 */
export function Bell(p: BellProps) {
  const button = useRef<HTMLButtonElement>(null);
  const newsDot = !p.unseen && p.news === true;
  const label = p.unseen ? p.labels.unseen : newsDot ? p.labels.newsDot : p.labels.title;
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => p.onOpenChange(!p.open)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        data-bell=""
        data-unseen={p.unseen}
        className={`${iconButtonClass()} relative max-md:-mx-0.5 max-md:-my-1.5 max-md:h-11 max-md:w-11 ${p.unseen ? 'text-warn hover:text-warn' : ''}`}
      >
        <Icon name="bell" />
        {p.unseen ? (
          <span
            data-bell-count=""
            className="pointer-events-none absolute -top-[3px] -right-[5px] min-w-[17px] rounded-full bg-danger-btn px-1 text-center text-[10px] leading-4 font-[650] text-on-accent tabular-nums shadow-[0_0_0_2px_var(--color-pane)]"
          >
            {bellCountText(p.unseen)}
          </span>
        ) : newsDot ? (
          <span
            data-bell-news=""
            className="pointer-events-none absolute top-[5px] right-[5px] h-2 w-2 rounded-full bg-faint shadow-[0_0_0_2px_var(--color-pane)] max-md:top-2.5 max-md:right-2.5"
          />
        ) : null}
      </button>
      {p.open ? <BellPanel {...p} anchor={button} /> : null}
    </>
  );
}

function BellPanel(p: BellProps & { anchor: RefObject<HTMLButtonElement | null> }): ReactNode {
  const mounted = useMounted();
  const phone = useMediaQuery(PHONE_QUERY);
  const panel = useRef<HTMLDivElement>(null);
  const close = (focus: boolean) => {
    p.onOpenChange(false);
    if (focus) p.anchor.current?.focus();
  };
  const closeEvent = useEffectEvent(close);

  useSwipeDown(panel, { enabled: phone, onClose: () => close(false) });
  // Панель гаснет плавно (прототип v131 `.pop.out`).
  useFadeAway(panel, mounted);

  // На ПК — под значком, правым краем к нему и не дальше 8 px от края экрана.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    if (phone) {
      el.style.top = '';
      el.style.right = '';
      return;
    }
    const at = () => {
      const r = p.anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = document.documentElement.clientWidth;
      el.style.top = `${r.bottom + 6}px`;
      el.style.right = `${Math.max(EDGE, w - r.right)}px`;
    };
    at();
    window.addEventListener('resize', at);
    return () => window.removeEventListener('resize', at);
  }, [phone, p.anchor]);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || p.anchor.current?.contains(t)) return;
      closeEvent(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEvent(true);
    };
    // «Назад» закрывает панель, переход идёт своим чередом (closePop прототипа).
    const back = () => closeEvent(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('popstate', back);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('popstate', back);
    };
  }, [p.anchor]);

  if (!mounted) return null;
  const l = p.labels;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={l.title}
      tabIndex={-1}
      data-overlay
      data-popover
      data-bell-panel=""
      data-leave="animate-fade-out"
      className="fixed z-[70] flex w-[min(400px,calc(100vw-16px))] touch-pan-y flex-col overflow-auto rounded-xl border border-line-strong bg-raised text-ink shadow-pop outline-none md:max-h-[min(600px,calc(100dvh-72px))] md:animate-rise max-md:inset-0 max-md:h-dvh max-md:w-full max-md:animate-bell-up max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top,0px)] max-md:pb-[env(safe-area-inset-bottom,0px)] motion-reduce:animate-none"
    >
      <div
        data-swipe-handle
        aria-hidden="true"
        className="mx-auto mt-2 hidden h-1 w-10 flex-none rounded bg-line-strong max-md:block"
      />
      <div className="sticky top-0 z-[1] flex flex-col gap-2 border-b border-line bg-raised px-3 pt-2.5 pb-2 max-md:py-2">
        <div data-swipe-handle className="flex items-center gap-2.5">
          <b className="text-[15px] tracking-[-0.01em]">{l.title}</b>
          <div className="flex-1" />
          <button
            type="button"
            onClick={p.onReadAll}
            disabled={!p.canReadAll}
            data-bell-read-all=""
            className={`${linkButtonClass()} text-[12.5px] disabled:cursor-default disabled:text-faint disabled:no-underline max-md:min-h-11`}
          >
            {l.readAll}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            aria-label={l.close}
            title={l.close}
            className={`${iconButtonClass('sm')} max-md:-my-1.5 max-md:-mr-2 max-md:h-11 max-md:w-11`}
          >
            <Icon name="x" />
          </button>
        </div>
        <div
          role="group"
          aria-label={l.tabs}
          data-no-swipe
          className="flex flex-nowrap gap-1 overflow-x-auto [scrollbar-width:none] max-md:-mx-3 max-md:px-3 max-md:pb-0.5 [&::-webkit-scrollbar]:hidden"
        >
          {p.tabs.map((x) => {
            const on = x.value === p.tab;
            return (
              <button
                key={x.value}
                type="button"
                aria-pressed={on}
                data-bell-tab={x.value}
                onClick={() => {
                  if (panel.current) panel.current.scrollTop = 0;
                  p.onTab(x.value);
                }}
                className={`inline-flex flex-none cursor-pointer items-center rounded-full border px-[7px] py-[3px] text-[12px] font-[550] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-md:min-h-9 max-md:px-2 max-md:py-1 max-md:text-[12.5px] ${on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-muted'}`}
              >
                {x.label}
              </button>
            );
          })}
        </div>
      </div>
      <div data-bell-list="" className="px-1.5 pt-1 pb-2">
        <BellList {...p} />
      </div>
    </div>,
    document.body,
  );
}

function BellList(p: BellProps): ReactNode {
  const l = p.labels;
  if (p.error && !p.rows?.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted">
        <span>{l.error}</span>
        <button type="button" onClick={p.onRetry} className={linkButtonClass()}>
          {l.retry}
        </button>
      </div>
    );
  }
  if (p.rows === null) return <div className="h-24" aria-busy="true" />;
  if (!p.rows.length) {
    return (
      <div
        data-bell-empty=""
        className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted"
      >
        <Icon name="bell" size="lg" className="text-faint" />
        <b>{l.empty}</b>
        {p.canShowAll ? (
          <button type="button" onClick={() => p.onTab('all')} className={linkButtonClass()}>
            {l.showAll}
          </button>
        ) : p.canShowNews ? (
          <button
            type="button"
            onClick={() => p.onTab('news')}
            data-bell-show-news=""
            className={linkButtonClass()}
          >
            {l.showNews}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <>
      {bellGroups(p.rows).map((g) => (
        <div key={g.group}>
          <div className="px-2 pt-2.5 pb-1 text-[12.5px] font-[650] text-muted">{g.group}</div>
          {g.rows.map((r) => (
            <BellRow key={r.id} row={r} unread={l.unread} onRow={p.onRow} />
          ))}
        </div>
      ))}
      {/* ОТКЛОНЕНИЕ: docs/deviations.md#И-11 — «Показать ещё» без «N из M». */}
      {p.more ? (
        <div className="flex items-center gap-2.5 px-2 pt-2 pb-0.5">
          <button
            type="button"
            onClick={p.onMore}
            disabled={p.loadingMore}
            data-bell-more=""
            className={buttonClass('default', 'sm')}
          >
            {l.more}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Строка (прототип `bellRow`): значок, контрагент, фраза, время; неоткрытая — жирная с синей точкой. */
function BellRow({
  row: r,
  unread,
  onRow,
}: {
  row: BellRowView;
  unread: string;
  onRow: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRow(r.id)}
      data-bell-row={r.id}
      data-read={r.read}
      className={`relative grid w-full cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5 rounded-[10px] border-0 bg-transparent p-2 text-left text-[13px] leading-[1.35] hover:bg-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue max-md:min-h-[52px] max-md:px-2 max-md:py-2.5 max-md:text-[14px] ${r.read ? 'text-muted' : 'text-ink'}`}
    >
      <span
        className={`grid h-7 w-7 place-items-center rounded-full bg-pane-alt ${r.read ? 'text-muted' : 'text-ink'}`}
      >
        <Icon name={r.icon} size="sm" />
      </span>
      <span className="flex min-w-0 flex-col">
        {r.contractor !== null ? (
          <span data-bell-cp="" className="truncate text-[12px] font-normal text-faint">
            {r.contractor}
          </span>
        ) : null}
        <span
          data-bell-text=""
          className={`[overflow-wrap:anywhere] ${r.read ? '' : 'font-[650]'}`}
        >
          {r.text}
        </span>
      </span>
      <span className="pt-px text-[11.5px] whitespace-nowrap text-faint">{r.at}</span>
      {r.read ? null : (
        <span
          role="img"
          aria-label={unread}
          className="absolute right-[9px] bottom-[11px] h-[7px] w-[7px] rounded-full bg-brand-blue"
        />
      )}
    </button>
  );
}
