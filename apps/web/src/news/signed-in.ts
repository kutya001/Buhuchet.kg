/**
 * «Что нового» открывается при входе в систему, а не при перезагрузке страницы (ТЗ; прототип
 * whatsNew). Страница входа ставит отметку на вкладку браузера, рабочая страница снимает её один раз.
 * Хранилище недоступно (запрет браузера) — окно просто не откроется.
 */
const KEY = 'bh_signed_in';

/** Вход удался: следующая рабочая страница покажет «Что нового». */
export function markSignedIn(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // Без хранилища окна не будет.
  }
}

/** Сразу после входа? Отметка снимается: при перезагрузке окна уже не будет. */
export function takeSignedIn(): boolean {
  try {
    const was = sessionStorage.getItem(KEY) === '1';
    sessionStorage.removeItem(KEY);
    return was;
  } catch {
    return false;
  }
}
