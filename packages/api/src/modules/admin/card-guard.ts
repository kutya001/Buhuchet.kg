import { takeRateLimit, type RateLimit } from '@buhuchet/db';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';

// Чтение карточки пользователя и организации в Админке пишет запись «Открыта карточка…» в историю,
// поэтому у него защита как у изменяющего метода: только запрос своего сайта и предел частоты.

/** Новых открытий карточек одним администратором — не больше стольких за час. */
export const ADMIN_CARD_VIEW_RATE_LIMIT: RateLimit = {
  kind: 'admin_card_view',
  max: 300,
  windowSeconds: 3600,
};

/**
 * Сторож чтения карточки. Проверка Origin идёт только у изменяющих методов, поэтому запрос, который
 * браузер сделал не со своего сайта (ссылка на адрес API, картинка, соседний поддомен), отклоняется по
 * `Sec-Fetch-Site`: принимается только `same-origin` и `none` (адрес набран руками); без заголовка
 * (не браузер) — как раньше. Новое открытие (`refresh` нет) считается в пределе частоты: историю
 * организации и учётной записи нельзя засорить записями об открытии.
 */
export async function guardCardRead(
  deps: ApiDeps,
  c: Context<AppEnv>,
  refresh: boolean,
): Promise<void> {
  const site = c.req.header('sec-fetch-site');
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    apiFail(403, 'origin_mismatch', 'Запрос с другого сайта отклонён');
  }
  if (refresh) return;
  const slot = await takeRateLimit(deps.db, ADMIN_CARD_VIEW_RATE_LIMIT, c.get('session')!.userId);
  if (!slot.ok) {
    apiFail(429, 'card_view_limit', 'Слишком много открытий карточек. Попробуйте через час');
  }
}
