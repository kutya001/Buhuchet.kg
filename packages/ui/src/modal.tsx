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
import { useFadeAway } from './fade-away';
import { reducedMotion } from './gestures';
import { Icon } from './icon';
import { useCardPager } from './use-card-pager';
import { PHONE_QUERY, useMediaQuery, useMounted } from './use-media';
import { useSwipeDown } from './use-swipe-down';
import {
  canMaximize,
  closesAtOnce,
  isCancelButton,
  unsavedNow,
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
  /** «Остаться» — вторая кнопка вопроса «Закрыть без сохранения?» (прототип v131). */
  discardStay: string;
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
  /** Компонент нарисован внутри окна; вне окна `close` и `leave` ничего не делают. */
  inside: boolean;
}

const CurrentWindowContext = createContext<CurrentWindow>({
  close: () => {},
  leave: () => {},
  inside: false,
});

/** Тексты окон из `WindowProvider` («Отмена», «Подтвердить», …) — для своих окон пакета. */
export function useWindowLabels(): WindowLabels {
  return useWindowsValue().labels;
}

/** Окно, внутри которого нарисован компонент: закрыть его или закрыть перед переходом. */
export function useWindow(): CurrentWindow {
  return useContext(CurrentWindowContext);
}

export type ModalSize = 'narrow' | 'mid' | 'wide' | 'large' | 'side';

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
  /**
   * Ширина на ПК: 580, 780 или 1100 px (у широкого окна и высота — до 860 px); `large` — приветствие:
   * 860 px, высота до 760 px, на телефоне — на весь экран (прототип `.wl-card`); `side` — панель справа
   * во всю высоту, 460 px, на телефоне — на весь экран («Помощь» страницы контрагента, прототип v120
   * `.modal.pgside`).
   */
  size?: ModalSize;
  /**
   * В форме есть несохранённые изменения: крестик, Esc, касание фона, «Отмена», протяжка вниз, «Назад»
   * и выход из аккаунта сначала спрашивают. У карточки — если в ней своя форма с изменениями («Смена
   * пароля» в «Мой профиль»). Вопрос задаётся, только если человек что-то делал в теле окна (ввод,
   * выбор, нажатие): форма, открытая уже заполненной, закрывается без вопроса.
   */
  dirty?: boolean;
  /** Касание фона не закрывает окно. */
  sticky?: boolean;
  /** Без «На весь экран» (окно видео: у плеера своя кнопка, прототип `noMax`). */
  noMax?: boolean;
  /** На телефоне тянуть вниз только за ручку и шапку (в окне свои жесты по содержимому). */
  swipeHead?: boolean;
  /** На телефоне — на весь экран, а не шторкой (окна подбора: прототип `.modal.pickm`). */
  phoneFull?: boolean;
  /**
   * На телефоне крестик и «На весь экран» не меньше 44 px (окна страницы контрагента для клиентов:
   * «Помощь», «Добро пожаловать», окна итога; прототип v120 cp-help.css).
   */
  touch?: boolean;
  /**
   * Короткое подтверждение появляется сразу, без выезда (прототип v131 `.modal.cfm`: за 100 мс) — и на
   * телефоне.
   */
  quick?: boolean;
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
  'input:not([type=checkbox]):not([type=radio]):not([readonly]):not([disabled]),textarea:not([readonly]),select:not([disabled]),button[data-search-select]:not([disabled])';
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const FLIP_MS = 220;
const FLIP_EASE = 'cubic-bezier(.2,.8,.2,1)';

/** Tab и Shift+Tab не уходят из окна под фон (окно модальное). */
/**
 * Окно закрывается по нажатию на фон (`pointerdown`, как `openModal` прототипа), и фон исчезает сразу.
 * «Клик» того же нажатия браузер отдаёт уже тому, что было под фоном (на телефоне — кнопке верхней
 * панели): касание фона только закрывает окно, поэтому клик этого нажатия гасится. Ждём его до
 * следующего нажатия или `GHOST_CLICK_MS` — так чужой клик позже не пропадёт.
 */
const GHOST_CLICK_MS = 700;

export function swallowGhostClick(doc: Document | undefined = globalThis.document): void {
  if (!doc) return;
  const capture = { capture: true };
  const stop = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    done();
  };
  const done = () => {
    doc.removeEventListener('click', stop, capture);
    doc.removeEventListener('pointerdown', done, capture);
    clearTimeout(timer);
  };
  doc.addEventListener('click', stop, capture);
  // Слушатель добавлен во время текущего `pointerdown`: на него он уже не сработает, только на следующее нажатие.
  doc.addEventListener('pointerdown', done, capture);
  const timer = setTimeout(done, GHOST_CLICK_MS);
}

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
 *   форма с несохранёнными изменениями на любой из этих способов и на «Отмена» спрашивает «Закрыть без
 *   сохранения?» с кнопками «Остаться» и «Закрыть» (прототип v131 `tryClose`). Сохранение закрывает без
 *   вопроса: экран сам убирает окно.
 * - Появляется за 240 мс без отскока, уходит за 140 мс (`useFadeAway`); на телефоне выезжает снизу и
 *   уезжает вниз.
 * - Фокус — в первое поле формы (на ПК) или в окно, Tab не уходит под фон, после закрытия фокус
 *   возвращается на кнопку, которая открыла окно.
 */
/** Действия человека в теле окна, после которых изменения формы считаются его изменениями. */
const TOUCH_EVENTS = ['input', 'change', 'click', 'drop'] as const;

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
  noMax = false,
  swipeHead = false,
  phoneFull = false,
  touch = false,
  quick = false,
  tabs,
}: ModalProps) {
  const windows = useWindowsValue();
  const mounted = useMounted();
  const phone = useMediaQuery(PHONE_QUERY);
  const titleId = useId();
  const canMax = canMaximize(kind) && !noMax;
  const [shown, setShown] = useState(false);
  const [max, setMax] = useState(false);
  const [openedMax, setOpenedMax] = useState(false);
  const [asking, setAsking] = useState(false);
  const [touched, setTouched] = useState(false);
  // Окно открылось — развёрнуто, если так выбрали в прошлый раз (для карточек и форм отдельно).
  if (shown !== open) {
    const startMax = open && canMax && windows.max[kind as keyof typeof windows.max];
    setShown(open);
    setMax(startMax);
    setOpenedMax(startMax);
    setAsking(false);
    setTouched(false);
  }

  const frame = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const flip = useRef<DOMRect | null>(null);
  const live = open && mounted;

  /** Окно в стопке открытых окон: вид и несохранённые изменения (для «Выйти без сохранения?»). */
  /**
   * Несохранённое есть, когда экран сказал `dirty` и человек что-то делал в теле окна (прототип
   * `m.dirty` ставится по событиям ввода): форма, которая открылась уже заполненной, закрывается без
   * вопроса, пока её не тронули.
   */
  const unsaved = unsavedNow(dirty, touched);
  const self = useRef<OpenWindow>({ kind, dirty: unsaved });
  useEffect(() => {
    self.current.kind = kind;
    self.current.dirty = unsaved;
  }, [kind, unsaved]);
  useEffect(() => {
    const el = body.current;
    if (!live || !el) return;
    const mark = () => setTouched(true);
    for (const type of TOUCH_EVENTS) el.addEventListener(type, mark, true);
    return () => {
      for (const type of TOUCH_EVENTS) el.removeEventListener(type, mark, true);
    };
  }, [live]);
  /** Можно ли закрыть сразу; форма с несохранёнными изменениями сначала спрашивает. */
  const mayClose = () => {
    if (closesAtOnce({ kind, dirty: unsaved })) return true;
    setAsking(true);
    return false;
  };
  /** Закрыть крестиком, Esc, касанием фона или «Отмена»: форма с изменениями сначала спрашивает. */
  const tryClose = () => {
    if (mayClose()) onClose();
  };
  const release = useBackClose(live, () => {
    if (!mayClose()) return false;
    onClose();
  });
  useFadeAway(frame, live);
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
      tryClose();
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
    if (!canMax || !canMaximize(kind)) return;
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
      inside: true,
    }),
    [onClose, release],
  );

  if (!live) return null;
  return createPortal(
    <CurrentWindowContext.Provider value={current}>
      <WindowFrame
        frameRef={frame}
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
        kind={kind}
        canMax={canMax}
        max={max}
        slide={!openedMax}
        phoneFull={phoneFull}
        touch={touch}
        quick={quick}
        phone={phone}
        labels={windows.labels}
        tabs={tabs}
        onToggleMax={toggleMax}
        onClose={tryClose}
        onCoverDown={(e) => {
          if (e.target !== e.currentTarget || sticky) return;
          swallowGhostClick();
          tryClose();
        }}
        onFootClick={(e) => {
          // «Отмена» формы с изменениями (прототип v131, `[data-close]`): кнопку рисует сам экран, поэтому
          // её нажатие перехватывается здесь — по `data-window-cancel` или по надписи «Отмена».
          if (closesAtOnce({ kind, dirty: unsaved })) return;
          const button = (e.target as HTMLElement).closest('button');
          if (!button || button.disabled) return;
          const cancel = isCancelButton(
            { marked: button.hasAttribute('data-window-cancel'), text: button.textContent },
            windows.labels.cancel,
          );
          if (!cancel) return;
          e.preventDefault();
          e.stopPropagation();
          setAsking(true);
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
        cancel={windows.labels.discardStay}
        danger
        onConfirm={onClose}
      />
    </CurrentWindowContext.Provider>,
    document.body,
  );
}

const DIALOG_SIZE: Record<ModalSize, string> = {
  narrow: 'w-[min(580px,100%)] max-h-[calc(100dvh-48px)]',
  mid: 'w-[min(780px,100%)] max-h-[calc(100dvh-48px)]',
  wide: 'w-[min(1100px,100%)] h-[min(860px,calc(100dvh-48px))] max-h-[calc(100dvh-48px)]',
  large: 'w-[min(860px,100%)] max-h-[min(760px,calc(100dvh-48px))]',
  side: 'w-[min(460px,100%)] h-dvh max-h-dvh md:rounded-r-none md:border-r-0',
};

/** Во весь экран телефона: развёрнутое окно и приветствие. */
const PHONE_FULL =
  'max-md:h-dvh max-md:max-h-dvh max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top,0px)] max-md:pb-[env(safe-area-inset-bottom,0px)]';

/**
 * Классы окна: размер на ПК, шторка на телефоне, развёрнутое — во всё окно (прототип `.modal`).
 * `slide` — окно выезжает снизу при открытии; открытое сразу развёрнутым появляется без выезда
 * (прототип `.modal.max{animation:none}`). `phoneFull` и размер `large` — на телефоне на весь экран
 * и не развёрнутое. На телефоне окно выезжает листом снизу (прототип v131 `sheet-in`); `quick` — короткое
 * подтверждение: появляется на месте за 100 мс.
 */
export function dialogClass(
  size: ModalSize,
  max: boolean,
  slide = true,
  phoneFull = false,
  quick = false,
): string {
  const desktop = max ? 'w-full h-[calc(100dvh-24px)] max-h-none' : DIALOG_SIZE[size];
  const phone =
    max || phoneFull || size === 'large' || size === 'side'
      ? PHONE_FULL
      : `max-md:w-full max-md:max-h-[92dvh] ${size === 'wide' ? 'max-md:h-[92dvh]' : 'max-md:h-auto'} max-md:rounded-b-none max-md:border-b-0 max-md:pb-[env(safe-area-inset-bottom,0px)]`;
  return `relative flex min-w-0 touch-pan-y flex-col rounded-2xl border border-line-strong bg-pane text-ink shadow-pop outline-none ${slide ? (quick ? 'animate-fade-fast' : 'animate-slide-up max-md:animate-sheet-in') : ''} ${desktop} ${phone}`;
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
  /** Всё окно вместе с фоном: его копия плавно уходит при закрытии. */
  frameRef?: RefObject<HTMLDivElement | null>;
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
  /** Вид окна (`data-window-kind`): «Показать как» разбирает карточку и форму по-разному. */
  kind?: WindowKind;
  canMax: boolean;
  max: boolean;
  /** Выезд снизу при открытии (нет у окна, открытого сразу развёрнутым). */
  slide?: boolean;
  /** На телефоне — на весь экран. */
  phoneFull?: boolean;
  /** На телефоне кнопки шапки не меньше 44 px. */
  touch?: boolean;
  /** Короткое подтверждение: без выезда. */
  quick?: boolean;
  phone: boolean;
  labels: WindowLabels;
  tabs?: ModalProps['tabs'];
  onToggleMax: () => void;
  onClose: () => void;
  onCoverDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Нажатие в нижней строке — до кнопок экрана (перехват «Отмена» у формы с изменениями). */
  onFootClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
}

/** Разметка окна (без поведения): фон, окно, ручка, шапка, содержимое, нижняя строка. */
export function WindowFrame({
  frameRef,
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
  kind,
  canMax,
  max,
  slide = true,
  phoneFull = false,
  touch = false,
  quick = false,
  phone,
  labels,
  tabs,
  onToggleMax,
  onClose,
  onCoverDown,
  onFootClick,
}: WindowFrameProps) {
  const maxLabel = max ? labels.restore : labels.maximize;
  const headButton = `${iconButtonClass()}${touch ? ' max-md:min-h-11 max-md:min-w-11' : ''}`;
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
      ref={frameRef}
      data-max={max}
      className={`fixed inset-0 z-50 grid max-md:items-end max-md:justify-items-stretch max-md:p-0 ${size === 'side' && !max ? 'items-stretch justify-items-end p-0' : `place-items-center ${max ? 'p-3' : 'px-4 py-6'}`}`}
    >
      {/* Фон отдельно от окна: пока окно тянут вниз, светлеет только фон, окно остаётся непрозрачным. */}
      <div
        ref={coverRef}
        onPointerDown={onCoverDown}
        aria-hidden="true"
        data-leave="animate-fade-out"
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
        data-window-kind={kind}
        data-overlay
        data-max={max}
        data-leave="animate-sink max-md:animate-sheet-out"
        className={dialogClass(size, max, slide, phoneFull, quick)}
      >
        <div
          data-swipe-handle
          aria-hidden="true"
          className="mx-auto mt-2 hidden h-1 w-10 flex-none rounded bg-line-strong max-md:block"
        />
        <div
          data-swipe-handle
          data-window-head
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
                className={headButton}
                data-window-max
              >
                <Icon name={max ? 'minimize' : 'maximize'} />
              </button>
            )}
            <button
              type="button"
              data-window-close
              aria-label={labels.close}
              onClick={onClose}
              className={headButton}
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
            data-window-foot
            onClickCapture={onFootClick}
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
  cancel,
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  text: ReactNode;
  /** Надпись кнопки действия; по умолчанию «Подтвердить». */
  ok?: string;
  /**
   * Надпись кнопки отказа; по умолчанию «Отмена». «Остаться» — у «Закрыть без сохранения?», «Не
   * отменять» — когда «Отмена» читается двояко.
   */
  cancel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const { labels } = useWindowsValue();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="message"
      quick
      title={title}
      footer={confirmFooter({
        cancel: cancel ?? labels.cancel,
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
