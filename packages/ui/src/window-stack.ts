/**
 * Вид окна (ТЗ «Окна (формы и карточки) и развёртывание на весь экран», прототип ui/popups.js
 * openModal): `card` — карточка записи (просмотр), `form` — форма ввода, `message` — короткое
 * подтверждение или сообщение («Удалить?», «Пароль сброшен»): ему нечего разворачивать.
 */
export type WindowKind = 'card' | 'form' | 'message';

/** Развёрнутость на весь экран запоминается отдельно для карточек и для форм. */
export interface MaxPrefs {
  card: boolean;
  form: boolean;
}

/** Окно в стопке открытых окон. */
export interface OpenWindow {
  kind: WindowKind;
}

/** Можно ли окно развернуть на весь экран (у коротких подтверждений кнопки нет). */
export function canMaximize(kind: WindowKind): kind is keyof MaxPrefs {
  return kind !== 'message';
}

/**
 * Открытые окна по порядку открытия (прототип `MODALS`): Esc закрывает и Tab обходит только верхнее
 * окно; выход из аккаунта при открытой форме спрашивает «Выйти без сохранения?» (core/login.js
 * logoutDlg).
 */
export class WindowStack {
  private readonly items: OpenWindow[] = [];

  /** Окно открылось; возвращает функцию «окно закрылось». */
  add(window: OpenWindow): () => void {
    this.items.push(window);
    return () => {
      const i = this.items.indexOf(window);
      if (i >= 0) this.items.splice(i, 1);
    };
  }

  isTop(window: OpenWindow): boolean {
    return this.items[this.items.length - 1] === window;
  }

  /** Открыто ли окно-форма (в нём могут быть несохранённые изменения). */
  hasForm(): boolean {
    return this.items.some((w) => w.kind === 'form');
  }

  get size(): number {
    return this.items.length;
  }
}
