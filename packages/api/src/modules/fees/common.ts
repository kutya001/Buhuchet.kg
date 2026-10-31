import { FeeRefusedError, orgMenuSettings, withOrgContext, type Tx } from '@buhuchet/db';
import { FEE_MESSAGES, formatText, type FeeMessageKey } from '@buhuchet/domain';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf } from '../../middleware/access';

/** Отказ платы за обслуживание: код — ключ словаря `err.<код>`, текст — по умолчанию. */
export function feeFail(
  status: 400 | 403 | 404 | 409,
  code: FeeMessageKey,
  details?: Record<string, unknown>,
): never {
  return apiFail(status, code, formatText(FEE_MESSAGES[code], details as never), details);
}

/**
 * Транзакция организации для платы за обслуживание: «Плата за обслуживание» выключена в учётной
 * политике — 403 `fee_off` (сервер проверяет сам, а не только прячет вкладку и кнопки). Отказы слоя
 * данных (`FeeRefusedError`) — ответом API со своим кодом, полем и подстановками.
 */
export function inFee<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx, settings: Awaited<ReturnType<typeof orgMenuSettings>>) => Promise<T>,
): Promise<T> {
  const ctx = orgContextOf(c);
  return withOrgContext(deps.db, ctx, async (tx) => {
    const settings = await orgMenuSettings(tx, ctx.orgId);
    if (!settings.features.fee) feeFail(403, 'fee_off');
    try {
      return await fn(tx, settings);
    } catch (e) {
      if (e instanceof FeeRefusedError) {
        feeFail(e.status, e.code, {
          ...(e.field ? { field: e.field } : {}),
          ...(e.params ?? {}),
        });
      }
      throw e;
    }
  });
}
