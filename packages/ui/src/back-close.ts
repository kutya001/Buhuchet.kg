'use client';

import { useCallback, useEffect, useEffectEvent, useRef } from 'react';

/** Что нужно от окна браузера (в тестах — подделка). */
export interface HistoryHost {
  history: Pick<History, 'state' | 'pushState' | 'back'>;
  addEventListener(type: 'popstate', listener: (e: { state: unknown }) => void): void;
}

/** Метка записи-заглушки в истории браузера. */
const STUB = '__bhOverlay';

export interface OverlayHandle {
  /**
   * Окно закрыто кнопкой, жестом или касанием вне его — заглушка снимается (`history.back()`).
   * `navigating`: окно закрывается переходом, который сам заменит заглушку (`replace`), — снимать
   * её не нужно.
   */
  release(options?: { navigating?: boolean }): void;
}

interface Entry {
  /** false — окно не закрылось (форма спросила «Закрыть без сохранения?») и остаётся открытым. */
  close: () => void | boolean;
  done: boolean;
}

/**
 * Кнопка «Назад» (телефон и браузер) закрывает верхнее открытое окно, а не уходит со страницы
 * (ТЗ «Мобильная навигация», прототип ui/popups.js ovOpen/ovClosed). Пока открыто хоть одно окно,
 * поверх текущей записи истории лежит одна запись-заглушка с тем же адресом; «Назад» снимает её,
 * и верхнее окно закрывается. Закрыли последнее окно иначе — заглушка снимается сама.
 */
export class OverlayHistory {
  private readonly stack: Entry[] = [];
  /** Ждём popstate от своего `history.back()`. */
  private skip = false;
  /** Пока снималась заглушка, открылось новое окно: заглушку нужно положить снова. */
  private reopen = false;
  private listening = false;

  constructor(private readonly host: HistoryHost) {}

  open(close: () => void | boolean): OverlayHandle {
    this.listen();
    const entry: Entry = { close, done: false };
    this.stack.push(entry);
    this.pushStub();
    return {
      release: ({ navigating = false } = {}) => {
        if (entry.done) return;
        entry.done = true;
        this.stack.splice(this.stack.indexOf(entry), 1);
        if (this.stack.length > 0 || navigating) return;
        // Своё «Назад» уже в пути (окно сменили другим, и оно сразу закрылось): второе увело бы со
        // страницы — достаточно не класть заглушку снова.
        if (this.skip) {
          this.reopen = false;
          return;
        }
        if (!this.onStub()) return;
        this.skip = true;
        this.host.history.back();
      },
    };
  }

  /** Сколько окон открыто (для проверок). */
  get size(): number {
    return this.stack.length;
  }

  private onStub(): boolean {
    const state = this.host.history.state as Record<string, unknown> | null;
    return state?.[STUB] === true;
  }

  private pushStub() {
    if (this.skip) {
      this.reopen = true;
      return;
    }
    // Без адреса: Next.js переносит в запись своё состояние и не начинает переход.
    if (!this.onStub()) this.host.history.pushState({ [STUB]: true }, '');
  }

  private listen() {
    if (this.listening) return;
    this.listening = true;
    this.host.addEventListener('popstate', (e) => this.popState(e.state));
  }

  private popState(state: unknown) {
    if (this.skip) {
      this.skip = false;
      if (this.reopen) {
        this.reopen = false;
        if (this.stack.length > 0) this.pushStub();
      }
      return;
    }
    // Вернулись на заглушку (например, «Вперёд»), а окон уже нет — она лишняя, проходим её.
    if ((state as Record<string, unknown> | null)?.[STUB] === true) {
      if (this.stack.length === 0) {
        this.skip = true;
        this.host.history.back();
      }
      return;
    }
    const top = this.stack.pop();
    if (!top) return;
    top.done = true;
    // Окно не закрылось: оно остаётся в стопке со своей заглушкой, следующее «Назад» снова к нему.
    if (top.close() === false) {
      top.done = false;
      this.stack.push(top);
    }
    if (this.stack.length > 0) this.pushStub();
  }
}

let shared: OverlayHistory | null = null;

/**
 * Закрывать окно кнопкой «Назад», пока оно открыто; `close` может вернуть false — окно осталось
 * открытым (форма с несохранёнными изменениями спрашивает «Закрыть без сохранения?»). Возвращает
 * функцию для закрытия переходом: вызвать перед переходом с `replace` (выбор модуля в панели «Меню»),
 * чтобы заглушку заменил сам переход.
 */
export function useBackClose(
  open: boolean,
  close: () => void | boolean,
): (navigating?: boolean) => void {
  const onBack = useEffectEvent(() => close());
  const handle = useRef<OverlayHandle | null>(null);

  useEffect(() => {
    if (!open) return;
    shared ??= new OverlayHistory(window);
    const h = shared.open(() => onBack());
    handle.current = h;
    return () => {
      h.release();
      if (handle.current === h) handle.current = null;
    };
  }, [open]);

  return useCallback((navigating = false) => handle.current?.release({ navigating }), []);
}
