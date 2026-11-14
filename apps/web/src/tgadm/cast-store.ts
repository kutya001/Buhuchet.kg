/*
 * «Отправить в Telegram» из меню новости (поток Т, задача Т6; прототип v103 admin/news.js `newsActs`,
 * `tgCastFromNews`): новость, из которой «Рассылка» заполнит поля при открытии. Просьба живёт до первого
 * чтения — как `requestOrgCard` Админки.
 */
let pending: string | null = null;

/** Попросить «Рассылку» заполнить поля из новости. */
export function requestCastFromNews(newsId: string): void {
  pending = newsId;
}

/** Забрать просьбу (один раз). */
export function takeCastRequest(): string | null {
  const id = pending;
  pending = null;
  return id;
}

/** Посмотреть просьбу, не забирая (начальное значение экрана: в StrictMode оно считается дважды). */
export function peekCastRequest(): string | null {
  return pending;
}
