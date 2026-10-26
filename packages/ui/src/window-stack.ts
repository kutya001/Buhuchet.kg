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
  /** В форме есть несохранённые изменения. */
  dirty?: boolean;
}

/** Можно ли окно развернуть на весь экран (у коротких подтверждений кнопки нет). */
export function canMaximize(kind: WindowKind): kind is keyof MaxPrefs {
  return kind !== 'message';
}

/**
 * Закрывается ли окно сразу: форма с несохранёнными изменениями на протяжку вниз и «Назад» сначала
 * спрашивает «Закрыть без сохранения?» (ТЗ «Управление свайпами»).
 */
export function closesAtOnce(window: OpenWindow): boolean {
  return !(window.kind === 'form' && window.dirty);
}

/**
 * Открытые окна по порядку открытия (прототип `MODALS`): Esc закрывает и Tab обходит только верхнее
 * окно; выход из аккаунта при несохранённых изменениях в открытой форме спрашивает «Выйти без
 * сохранения?» (ТЗ «Панель модулей»; прототип core/login.js logoutDlg спрашивает при любой открытой
 * форме — docs/deviations.md, п. 27).
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

  /** Есть ли открытая форма с несохранёнными изменениями. */
  hasUnsaved(): boolean {
    // ОТКЛОНЕНИЕ: docs/deviations.md#27
    return this.items.some((w) => !closesAtOnce(w));
  }

  get size(): number {
    return this.items.length;
  }
}
