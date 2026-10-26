import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, rowEvents, type PressState } from './row-events';

// Нажатия по строке списка (прототип ui/grid.js, bind; ТЗ «Действия над записью») — обработчики
// вызываются напрямую с поддельными событиями: открыть запись, меню правым кликом, долгим нажатием
// и клавишами.

const ROW = { id: 'r1' };
const row = {} as HTMLElement;

const press = (): PressState => ({ timer: undefined, start: null, pressed: false });

/** Элемент, внутри которого было нажатие: `closest` находит его, если он подходит под селектор. */
const target = (tag: 'td' | 'button' | 'input' | 'a') => ({
  closest: (selector: string) => (selector.split(',').includes(tag) ? {} : null),
});

const mouse = (
  over: Partial<{ tag: 'td' | 'button' | 'input' | 'a'; x: number; y: number }> = {},
) =>
  ({
    target: target(over.tag ?? 'td'),
    currentTarget: row,
    clientX: over.x ?? 10,
    clientY: over.y ?? 20,
    preventDefault: vi.fn(),
  }) as unknown as ReactMouseEvent<HTMLElement>;

const key = (k: string, over: { shiftKey?: boolean; inner?: boolean } = {}) =>
  ({
    key: k,
    shiftKey: over.shiftKey ?? false,
    target: over.inner ? {} : row,
    currentTarget: row,
    preventDefault: vi.fn(),
  }) as unknown as ReactKeyboardEvent<HTMLElement>;

const pointer = (x: number, y: number, pointerType = 'touch') =>
  ({ pointerType, clientX: x, clientY: y }) as unknown as ReactPointerEvent<HTMLElement>;

describe('нажатия по строке списка', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (withMenu = true) => {
    const onOpen = vi.fn();
    const onMenu = vi.fn();
    const events = rowEvents<typeof ROW>(press(), {
      onOpen,
      onMenu: withMenu ? onMenu : undefined,
    });
    return { onOpen, onMenu, h: events.handlers(ROW), events };
  };

  it('нажатие на строку открывает запись; на кнопку, галочку или ссылку внутри — нет', () => {
    const { onOpen, h } = setup();
    h.onClick(mouse());
    expect(onOpen).toHaveBeenCalledWith(ROW);
    for (const tag of ['button', 'input', 'a'] as const) h.onClick(mouse({ tag }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('правый клик — меню в точке нажатия вместо меню браузера', () => {
    const { onMenu, h } = setup();
    const e = mouse({ x: 120, y: 340 });
    h.onContextMenu(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onMenu).toHaveBeenCalledWith(ROW, { x: 120, y: 340 });
  });

  it('правый клик по ссылке и список без меню — меню браузера', () => {
    const { onMenu, h } = setup();
    const onLink = mouse({ tag: 'a' });
    h.onContextMenu(onLink);
    expect(onLink.preventDefault).not.toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
    const plain = setup(false);
    const e = mouse();
    plain.h.onContextMenu(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('Enter открывает запись, ContextMenu и Shift+F10 — меню у строки', () => {
    const { onOpen, onMenu, h } = setup();
    h.onKeyDown(key('Enter'));
    expect(onOpen).toHaveBeenCalledWith(ROW);
    h.onKeyDown(key('ContextMenu'));
    h.onKeyDown(key('F10', { shiftKey: true }));
    expect(onMenu.mock.calls).toEqual([
      [ROW, { anchor: row }],
      [ROW, { anchor: row }],
    ]);
    h.onKeyDown(key('F10'));
    expect(onMenu).toHaveBeenCalledTimes(2);
  });

  it('клавиши на кнопке или галочке внутри строки строку не трогают', () => {
    const { onOpen, onMenu, h } = setup();
    h.onKeyDown(key('Enter', { inner: true }));
    h.onKeyDown(key('ContextMenu', { inner: true }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('долгое нажатие пальцем 550 мс — меню; отпускание после него запись не открывает', () => {
    const { onOpen, onMenu, h } = setup();
    h.onPointerDown(pointer(50, 60));
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onMenu).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onMenu).toHaveBeenCalledWith(ROW, { x: 50, y: 60 });
    h.onPointerUp();
    h.onClick(mouse());
    expect(onOpen).not.toHaveBeenCalled();
    // Следующее обычное нажатие снова открывает запись.
    h.onPointerDown(pointer(50, 60));
    h.onPointerUp();
    h.onClick(mouse());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('короткое касание открывает запись, а не меню', () => {
    const { onOpen, onMenu, h } = setup();
    h.onPointerDown(pointer(50, 60));
    vi.advanceTimersByTime(200);
    h.onPointerUp();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    h.onClick(mouse());
    expect(onMenu).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('палец сдвинулся больше чем на 8 px (прокрутка) — меню не открывается', () => {
    const { onMenu, h } = setup();
    h.onPointerDown(pointer(50, 60));
    h.onPointerMove(pointer(54, 64));
    vi.advanceTimersByTime(100);
    h.onPointerMove(pointer(50, 75));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('сдвиг до 8 px меню не отменяет; отмена касания браузером — отменяет', () => {
    const { onMenu, h } = setup();
    h.onPointerDown(pointer(50, 60));
    h.onPointerMove(pointer(55, 65));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onMenu).toHaveBeenCalledOnce();
    h.onPointerDown(pointer(50, 60));
    h.onPointerCancel();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onMenu).toHaveBeenCalledOnce();
  });

  it('мышь долгим нажатием меню не открывает; список без меню — тоже', () => {
    const { onMenu, h } = setup();
    h.onPointerDown(pointer(50, 60, 'mouse'));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onMenu).not.toHaveBeenCalled();
    const plain = setup(false);
    plain.h.onPointerDown(pointer(50, 60));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(plain.onMenu).not.toHaveBeenCalled();
  });

  it('кнопка «⋯» открывает меню у себя', () => {
    const { onMenu, events } = setup();
    events.menuAt(ROW, { anchor: row });
    expect(onMenu).toHaveBeenCalledWith(ROW, { anchor: row });
  });
});
