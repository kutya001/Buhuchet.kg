'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useBackClose } from './back-close';
import { buttonClass, iconButtonClass } from './button';
import { CardTabs, type CardTab } from './card-tabs';
import { reducedMotion } from './gestures';
import { Icon } from './icon';
import { useCardPager } from './use-card-pager';
import { PHONE_QUERY, useMediaQuery, useMounted } from './use-media';
import { useSwipeDown } from './use-swipe-down';
import {
  canMaximize,
  closesAtOnce,
  WindowStack,
  type MaxPrefs,
  type OpenWindow,
  type WindowKind,
} from './window-stack';

/** Тексты окон из словаря (модуль «Локализация»). */
export interface WindowLabels {
  /** «На весь экран» и «Свернуть окно». */
  maximize: string;
  restore: string;
  /** «(двойной клик по заголовку)» — в подсказке кнопки на ПК. */
  maximizeHint: string;
  close: string;
  cancel: string;
  /** Кнопка подтверждения по умолчанию — «Подтвердить». */
  confirm: string;
  /** «Закрыть без сохранения?» у формы с несохранёнными изменениями. */
  discardTitle: string;
  discardText: string;
  discardOk: string;
  /** «N из M» текущей вкладки карточки на телефоне. */
  tabPosition: (n: number, total: number) => string;
}

interface WindowsValue {
  labels: WindowLabels;
  stack: WindowStack;
  max: MaxPrefs;
  saveMax: (kind: keyof MaxPrefs, on: boolean) => void;
}

const WindowsContext = createContext<WindowsValue | null>(null);

function useWindowsValue(): WindowsValue {
  const value = useContext(WindowsContext);
  if (!value) throw new Error('Modal: WindowProvider is required');
  return value;
}

/**
 * Общее для всех окон страницы: тексты, стопка открытых окон и выбор «На весь экран», который
 * запоминается на этом устройстве отдельно для карточек и для форм (ТЗ «Окна … и развёртывание на весь
 * экран»). `initialMax` — сохранённый выбор, `onMaxChange` — сохранить новый (сайт пишет cookie).
 */
export function WindowProvider({
  labels,
  initialMax,
  onMaxChange,
  children,
}: {
  labels: WindowLabels;
  initialMax: MaxPrefs;
  onMaxChange?: (prefs: MaxPrefs) => void;
  children: ReactNode;
}) {
  const [stack] = useState(() => new WindowStack());
  const [max, setMax] = useState(initialMax);
  const saveMax = useCallback(
    (kind: keyof MaxPrefs, on: boolean) => {
      const next = { ...max, [kind]: on };
      setMax(next);
      onMaxChange?.(next);
    },
    [max, onMaxChange],
  );
  const value = useMemo(() => ({ labels, stack, max, saveMax }), [labels, stack, max, saveMax]);
  return <WindowsContext.Provider value={value}>{children}</WindowsContext.Provider>;
}

/**
 * Открытые окна страницы: есть ли форма с несохранёнными изменениями (выход спрашивает «Выйти без
 * сохранения?»).
 */
export function useWindows(): { hasUnsavedForm: () => boolean } {
  const { stack } = useWindowsValue();
  return useMemo(() => ({ hasUnsavedForm: () => stack.hasUnsaved() }), [stack]);
}

interface CurrentWindow {
  /** Закрыть окно. */
  close: () => void;
  /** Закрыть окно перед переходом с заменой записи истории (`replace`): «Назад» не вернёт к окну. */
  leave: () => void;
}

const CurrentWindowContext = createContext<CurrentWindow>({ close: () => {}, leave: () => {} });

/** Окно, внутри которого нарисован компонент: закрыть его или закрыть перед переходом. */
export function useWindow(): CurrentWindow {
  return useContext(CurrentWindowContext);
}

export type ModalSize = 'narrow' | 'mid' | 'wide';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Строка под названием (например, «База знаний», «Профиль организации · только просмотр»). */
  sub?: ReactNode;
  /** Название для экранного диктора, если `title` — не строка. */
  label?: string;
  /** Свои кнопки шапки — слева от «На весь экран» и «Закрыть». */
  head?: ReactNode;
  children: ReactNode;
  /** Нижняя строка с кнопками действий (кнопки справа; `<div className="flex-1" />` — распорка). */
  footer?: ReactNode;
  kind?: WindowKind;
  /** Ширина на ПК: 580, 780 или 1100 px (у широкого окна и высота — до 860 px). */
  size?: ModalSize;
  /** В форме есть несохранённые изменения: протяжка вниз и «Назад» сначала спрашивают. */
  dirty?: boolean;
  /** Касание фона не закрывает окно. */
  sticky?: boolean;
  /** На телефоне тянуть вниз только за ручку и шапку (в окне свои жесты по содержимому). */
  swipeHead?: boolean;
  /** Вкладки карточки записи: ряд закреплён вверху содержимого, свайп вбок листает их. */
  tabs?: {
    items: readonly CardTab[];
    active: string;
    onSelect: (id: string) => void;
    label: string;
  };
}

/** Первое поле формы: на ПК фокус сразу в нём. */
const FIRST_FIELD =
  'input:not([type=checkbox]):not([type=radio]):not([readonly]):not([disabled]),textarea:not([readonly]),select:not([disabled])';
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const FLIP_MS = 220;
const FLIP_EASE = 'cubic-bezier(.2,.8,.2,1)';

/** Tab и Shift+Tab не уходят из окна под фон (окно модальное). */
function trapTab(e: KeyboardEvent, dialog: HTMLElement) {
  const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (n) => n.getClientRects().length > 0,
  );
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!first || !last) {
    e.preventDefault();
    dialog.focus();
    return;
  }
  if (e.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Окно поверх рабочей области: карточка записи, форма ввода или подтверждение (ТЗ «Принципы
 * оформления» → «Окна (формы и карточки) и развёртывание на весь экран», прототип ui/popups.js
 * openModal, css/popups.css и kb.css). На ПК — по центру, на телефоне — шторка снизу с ручкой.
 *
 * - Шапка: название, строка под ним, «На весь экран» / «Свернуть окно» (у подтверждений её нет; на ПК
 *   также двойной клик по шапке) и «Закрыть». Прокручивается только содержимое; нижняя строка с
 *   кнопками остаётся внизу.
 * - Развёрнутое окно на ПК занимает всё окно браузера с отступом 12 px, содержимое — до 1600 px по
 *   центру (форма — колонкой до 980 px); на телефоне — весь экран без скругления. Выбор запоминается
 *   для следующих карточек (или форм); окно поверх другого разворачивается само по себе.
 * - Закрывается крестиком, клавишей Esc, касанием фона, кнопкой «Назад» и на телефоне протяжкой вниз;
 *   форма с несохранёнными изменениями на протяжку и «Назад» спрашивает «Закрыть без сохранения?».
 * - Фокус — в первое поле формы (на ПК) или в окно, Tab не уходит под фон, после закрытия фокус
 *   возвращается на кнопку, которая открыла окно.
 */
export function Modal({
  open,
  onClose,
  title,
  sub,
  label,
  head,
  children,
  footer,
  kind = 'card',
  size = 'narrow',
  dirty = false,
  sticky = false,
  swipeHead = false,
  tabs,
}: ModalProps) {
  const windows = useWindowsValue();
  const mounted = useMounted();
  const phone = useMediaQuery(PHONE_QUERY);
  const titleId = useId();
  const canMax = canMaximize(kind);
  const [shown, setShown] = useState(false);
  const [max, setMax] = useState(false);
  const [openedMax, setOpenedMax] = useState(false);
  const [asking, setAsking] = useState(false);
  // Окно открылось — развёрнуто, если так выбрали в прошлый раз (для карточек и форм отдельно).
  if (shown !== open) {
    const startMax = open && canMaximize(kind) && windows.max[kind];
    setShown(open);
    setMax(startMax);
    setOpenedMax(startMax);
    setAsking(false);
  }

  const cover = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const flip = useRef<DOMRect | null>(null);
  const live = open && mounted;

  /** Окно в стопке открытых окон: вид и несохранённые изменения (для «Выйти без сохранения?»). */
  const self = useRef<OpenWindow>({ kind, dirty });
  useEffect(() => {
    self.current.kind = kind;
    self.current.dirty = dirty;
  }, [kind, dirty]);
  /** Можно ли закрыть сразу; форма с несохранёнными изменениями сначала спрашивает. */
  const mayClose = () => {
    if (closesAtOnce({ kind, dirty })) return true;
    setAsking(true);
    return false;
  };
  const release = useBackClose(live, () => {
    if (!mayClose()) return false;
    onClose();
  });
  useSwipeDown(dialog, {
    enabled: live,
    onClose,
    canClose: mayClose,
    cover,
    scroller: body,
    handleOnly: swipeHead,
  });
  useCardPager(body, page, {
    enabled: live && !!tabs,
    tabs: tabs?.items.map((t) => t.id) ?? [],
    active: tabs?.active ?? '',
    onSelect: (id) => tabs?.onSelect(id),
  });

  const keydown = useEffectEvent((e: KeyboardEvent, entry: OpenWindow) => {
    const el = dialog.current;
    if (!el || e.defaultPrevented || !windows.stack.isTop(entry)) return;
    if (e.key === 'Escape') {
      // Сначала закрывается всплывающее окошко внутри окна (оно само слушает Esc).
      if (document.querySelector('[data-popover]')) return;
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      trapTab(e, el);
    }
  });
  useEffect(() => {
    if (!live) return;
    const entry = self.current;
    const remove = windows.stack.add(entry);
    const opener = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    // На телефоне клавиатура сама не выезжает: фокус — в окно, а не в поле.
    const field = window.matchMedia(PHONE_QUERY).matches
      ? null
      : el?.querySelector<HTMLElement>(`[data-window-body] ${FIRST_FIELD}`);
    (field ?? el)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => keydown(e, entry);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      remove();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [live, windows.stack]);

  // Развернули или свернули на ПК — окно плавно меняет размер от прежнего (около 220 мс).
  useLayoutEffect(() => {
    const from = flip.current;
    const el = dialog.current;
    flip.current = null;
    if (!from || !el) return;
    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const x = from.left + from.width / 2 - (to.left + to.width / 2);
    const y = from.top + from.height / 2 - (to.top + to.height / 2);
    el.animate(
      [
        {
          transform: `translate(${x}px, ${y}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        { transform: 'none' },
      ],
      { duration: FLIP_MS, easing: FLIP_EASE },
    );
  }, [max]);

  // Другая вкладка карточки открывается с начала.
  const tab = tabs?.active;
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [tab]);

  const toggleMax = () => {
    if (!canMaximize(kind)) return;
    const el = dialog.current;
    if (el && !phone && !reducedMotion()) flip.current = el.getBoundingClientRect();
    setMax(!max);
    windows.saveMax(kind, !max);
  };

  const current = useMemo<CurrentWindow>(
    () => ({
      close: onClose,
      leave: () => {
        release(true);
        onClose();
      },
    }),
    [onClose, release],
  );

  if (!live) return null;
  return createPortal(
    <CurrentWindowContext.Provider value={current}>
      <WindowFrame
        coverRef={cover}
        dialogRef={dialog}
        bodyRef={body}
        pageRef={page}
        titleId={titleId}
        title={title}
        sub={sub}
        label={label}
        head={head}
        footer={footer}
        size={size}
        narrow={kind === 'form' && size !== 'wide'}
        canMax={canMax}
        max={max}
        slide={!openedMax}
        phone={phone}
        labels={windows.labels}
        tabs={tabs}
        onToggleMax={toggleMax}
        onClose={onClose}
        onCoverDown={(e) => {
          if (e.target === e.currentTarget && !sticky) onClose();
        }}
      >
        {children}
      </WindowFrame>
      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        title={windows.labels.discardTitle}
        text={windows.labels.discardText}
        ok={windows.labels.discardOk}
        danger
        onConfirm={onClose}
      />
    </CurrentWindowContext.Provider>,
    document.body,
  );
}

const DIALOG_SIZE: Record<ModalSize, string> = {
  narrow: 'w-[min(580px,100%)]',
  mid: 'w-[min(780px,100%)]',
  wide: 'w-[min(1100px,100%)] h-[min(860px,calc(100dvh-48px))]',
};

/**
 * Классы окна: размер на ПК, шторка на телефоне, развёрнутое — во всё окно (прототип `.modal`).
 * `slide` — окно выезжает снизу при открытии; открытое сразу развёрнутым появляется без выезда
 * (прототип `.modal.max{animation:none}`).
 */
export function dialogClass(size: ModalSize, max: boolean, slide = true): string {
  const desktop = max
    ? 'w-full h-[calc(100dvh-24px)] max-h-none'
    : `${DIALOG_SIZE[size]} max-h-[calc(100dvh-48px)]`;
  const phone = max
    ? 'max-md:h-dvh max-md:max-h-dvh max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top,0px)] max-md:pb-[env(safe-area-inset-bottom,0px)]'
    : `max-md:w-full max-md:max-h-[92dvh] ${size === 'wide' ? 'max-md:h-[92dvh]' : 'max-md:h-auto'} max-md:rounded-b-none max-md:border-b-0 max-md:pb-[env(safe-area-inset-bottom,0px)]`;
  return `relative flex min-w-0 touch-pan-y flex-col rounded-2xl border border-line-strong bg-pane text-ink shadow-pop outline-none ${slide ? 'animate-slide-up' : ''} ${desktop} ${phone}`;
}

const EDGE_MAX = {
  wide: 'pl-[max(22px,calc((100%_-_1600px)/2))] pr-[max(22px,calc((100%_-_1600px)/2))] max-md:px-4',
  narrow: 'pl-[max(22px,calc((100%_-_980px)/2))] pr-[max(22px,calc((100%_-_980px)/2))] max-md:px-4',
};

/** Поля шапки и нижней строки; у развёрнутого — по колонке содержимого (1600 или 980 px). */
function edgeClass(max: boolean, narrow: boolean, normal: string): string {
  return max ? EDGE_MAX[narrow ? 'narrow' : 'wide'] : normal;
}

export interface WindowFrameProps {
  coverRef?: RefObject<HTMLDivElement | null>;
  dialogRef?: RefObject<HTMLDivElement | null>;
  bodyRef?: RefObject<HTMLDivElement | null>;
  pageRef?: RefObject<HTMLDivElement | null>;
  titleId: string;
  title: ReactNode;
  sub?: ReactNode;
  label?: string;
  head?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size: ModalSize;
  /** Форма: развёрнутое содержимое — колонкой до 980 px. */
  narrow: boolean;
  canMax: boolean;
  max: boolean;
  /** Выезд снизу при открытии (нет у окна, открытого сразу развёрнутым). */
  slide?: boolean;
  phone: boolean;
  labels: WindowLabels;
  tabs?: ModalProps['tabs'];
  onToggleMax: () => void;
  onClose: () => void;
  onCoverDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

/** Разметка окна (без поведения): фон, окно, ручка, шапка, содержимое, нижняя строка. */
export function WindowFrame({
  coverRef,
  dialogRef,
  bodyRef,
  pageRef,
  titleId,
  title,
  sub,
  label,
  head,
  children,
  footer,
  size,
  narrow,
  canMax,
  max,
  slide = true,
  phone,
  labels,
  tabs,
  onToggleMax,
  onClose,
  onCoverDown,
}: WindowFrameProps) {
  const maxLabel = max ? labels.restore : labels.maximize;
  const column = max
    ? narrow
      ? '*:mx-auto *:w-full *:max-w-[980px]'
      : '*:mx-auto *:w-full *:max-w-[1600px]'
    : '';
  const doubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canMax || phone || (e.target as HTMLElement).closest('button,a,input,select')) return;
    onToggleMax();
  };
  return (
    <div
      data-max={max}
      className={`fixed inset-0 z-50 grid place-items-center max-md:items-end max-md:justify-items-stretch max-md:p-0 ${max ? 'p-3' : 'px-4 py-6'}`}
    >
      {/* Фон отдельно от окна: пока окно тянут вниз, светлеет только фон, окно остаётся непрозрачным. */}
      <div
        ref={coverRef}
        onPointerDown={onCoverDown}
        aria-hidden="true"
        className="absolute inset-0 animate-fade bg-cover backdrop-blur-[3px]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        tabIndex={-1}
        data-window
        data-overlay
        data-max={max}
        className={dialogClass(size, max, slide)}
      >
        <div
          data-swipe-handle
          aria-hidden="true"
          className="mx-auto mt-2 hidden h-1 w-10 flex-none rounded bg-line-strong max-md:block"
        />
        <div
          data-swipe-handle
          onDoubleClick={doubleClick}
          className={`flex flex-none items-start gap-3 pt-[18px] pb-2.5 max-md:pt-3 max-md:pb-2 ${edgeClass(max, narrow, 'pr-[18px] pl-[22px] max-md:pr-3.5 max-md:pl-4')}`}
        >
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="m-0 text-[19px] leading-tight font-bold tracking-[-0.015em] text-balance"
            >
              {title}
            </h2>
            {sub && <div className="mt-[3px] text-[13px] text-muted">{sub}</div>}
          </div>
          {head}
          <div className="flex flex-none gap-0.5">
            {canMax && (
              <button
                type="button"
                aria-pressed={max}
                aria-label={maxLabel}
                title={phone ? maxLabel : `${maxLabel} ${labels.maximizeHint}`}
                onClick={onToggleMax}
                className={iconButtonClass()}
              >
                <Icon name={max ? 'minimize' : 'maximize'} />
              </button>
            )}
            <button
              type="button"
              aria-label={labels.close}
              onClick={onClose}
              className={iconButtonClass()}
            >
              <Icon name="x" />
            </button>
          </div>
        </div>
        <div
          ref={bodyRef}
          data-window-body
          className={`flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto overflow-x-hidden px-[22px] pt-1.5 pb-[18px] *:shrink-0 max-md:px-4 max-md:pt-1 max-md:pb-4 ${column}`}
        >
          {tabs && (
            <CardTabs
              tabs={tabs.items}
              active={tabs.active}
              onSelect={tabs.onSelect}
              label={tabs.label}
              position={labels.tabPosition}
              inWindow
            />
          )}
          {tabs ? (
            <div ref={pageRef} className="flex min-w-0 flex-col gap-3.5 *:shrink-0">
              {children}
            </div>
          ) : (
            children
          )}
        </div>
        {footer && (
          <div
            className={`flex flex-none flex-wrap items-center justify-end gap-2 border-t border-line pt-3 pb-3.5 max-md:pt-2.5 max-md:pb-3 ${edgeClass(max, narrow, 'pr-[18px] pl-[22px] max-md:px-4')}`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Нижняя строка подтверждения: «Отмена» и кнопка действия (красная у опасного действия). */
export function confirmFooter({
  cancel,
  ok,
  danger,
  onCancel,
  onOk,
}: {
  cancel: string;
  ok: string;
  danger: boolean;
  onCancel: () => void;
  onOk: () => void;
}): ReactNode {
  return (
    <>
      <button type="button" onClick={onCancel} className={buttonClass('ghost')}>
        {cancel}
      </button>
      <button type="button" onClick={onOk} className={buttonClass(danger ? 'danger' : 'cta')}>
        {ok}
      </button>
    </>
  );
}

/**
 * Окно подтверждения (прототип ui/popups.js confirmDlg): название, пояснение и «Отмена» с кнопкой
 * действия; опасное действие — красная кнопка. Развернуть его нельзя — нечего разворачивать.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  text,
  ok,
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  text: ReactNode;
  /** Надпись кнопки действия; по умолчанию «Подтвердить». */
  ok?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const { labels } = useWindowsValue();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="message"
      title={title}
      footer={confirmFooter({
        cancel: labels.cancel,
        ok: ok ?? labels.confirm,
        danger,
        onCancel: onClose,
        onOk: () => {
          onClose();
          onConfirm();
        },
      })}
    >
      <p className="m-0 leading-[1.55] text-muted">{text}</p>
    </Modal>
  );
}
