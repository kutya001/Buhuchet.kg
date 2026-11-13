/*
 * Ссылка на запись из сообщения бота Telegram (поток Т, задача Т2): `/app/reports/all?report=<id>`,
 * `/app/tasks/mine?task=<id>`. Экран списка открывает карточку записи и сразу убирает параметр из
 * адреса — обновление страницы и «Назад» карточку заново не открывают.
 */

const RECORD_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Номер записи из параметра адреса: только uuid, иначе null. */
export const linkedRecordId = (value: string | null): string | null =>
  value !== null && RECORD_ID.test(value) ? value : null;

/** Что нужно от окна браузера (в тестах — подделка). */
export interface AddressHost {
  location: Pick<Location, 'href'>;
  history: Pick<History, 'state' | 'replaceState'>;
}

/**
 * Убрать параметр из адреса сразу, без перехода: до открытия окна карточки, чтобы запись-заглушка окна
 * в истории браузера («Назад» закрывает окно) легла уже с чистым адресом. Остальные параметры остаются.
 */
export function dropAddressParam(name: string, host: AddressHost = window): void {
  const url = new URL(host.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  host.history.replaceState(host.history.state, '', url.pathname + url.search + url.hash);
}
