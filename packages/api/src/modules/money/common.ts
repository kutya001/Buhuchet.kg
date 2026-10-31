import {
  contractorScope,
  MoneyRefusedError,
  orgMenuSettings,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  formatText,
  MONEY_MESSAGES,
  scopeOf,
  type AccessSubject,
  type MoneyMessageKey,
} from '@buhuchet/domain';
import type { SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf } from '../../middleware/access';

/** Область «Свои контрагенты» группы «Финансовые операции» над контрагентом. */
export const finScopeOf = (subject: AccessSubject): SQL | undefined =>
  contractorScope(scopeOf(subject, 'fin') === 'own' ? subject.employeeId : null);

/** Отказ денежного действия: код — ключ словаря `err.<код>`, текст — по умолчанию. */
export function moneyFail(
  status: 400 | 403 | 404 | 409,
  code: MoneyMessageKey,
  details?: unknown,
): never {
  return apiFail(status, code, MONEY_MESSAGES[code], details);
}

/**
 * Транзакция организации для денег по отчётам: «Учёт оплаты налогов» выключен в учётной политике —
 * 403 `taxpay_off` (сервер проверяет сам, а не только прячет кнопки и вкладку).
 */
export function inTaxpay<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx, settings: Awaited<ReturnType<typeof orgMenuSettings>>) => Promise<T>,
): Promise<T> {
  const ctx = orgContextOf(c);
  return withOrgContext(deps.db, ctx, async (tx) => {
    const settings = await orgMenuSettings(tx, ctx.orgId);
    if (!settings.features.taxpay) moneyFail(403, 'taxpay_off');
    return withMoneyErrors(() => fn(tx, settings));
  });
}

/**
 * Отказы слоя данных — ответом API: свой код, текст варианта (`payment_not_enough.short`) с
 * подстановками и `details` — поле, вариант и подстановки для текста словаря.
 */
export async function withMoneyErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof MoneyRefusedError) {
      const { variant, ...params } = e.params;
      const key = (variant ? `${e.code}.${variant}` : e.code) as MoneyMessageKey;
      apiFail(e.status, e.code, formatText(MONEY_MESSAGES[key] ?? MONEY_MESSAGES[e.code], params), {
        ...(e.field ? { field: e.field } : {}),
        ...(variant ? { variant } : {}),
        ...params,
      });
    }
    throw e;
  }
}
