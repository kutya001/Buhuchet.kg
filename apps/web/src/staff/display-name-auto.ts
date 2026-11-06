import { shortName } from '@buhuchet/domain';

/**
 * Отображаемое имя заполняется по ФИО, пока его не ввели руками; поле, оставленное пустым, снова
 * получает имя по ФИО (прототип v74 bindShort). `manual` — имя уже задано вручную
 * (`displayNameManual`); `set` — записать имя в поле формы.
 */
export function autoDisplayName(manual: boolean, set: (value: string) => void) {
  let typed = manual;
  return {
    /** Ввели ФИО: имя, не заданное вручную, — по новому ФИО. */
    fullNameInput(fullName: string) {
      if (!typed) set(shortName(fullName));
    },
    /** Ввели имя: пустое поле — снова по ФИО. */
    input(value: string) {
      typed = value.trim() !== '';
    },
    blur(value: string, fullName: string) {
      if (value.trim()) return;
      set(shortName(fullName));
      typed = false;
    },
    /** Форма перечитана с сервера. */
    reset(next: boolean) {
      typed = next;
    },
  };
}
