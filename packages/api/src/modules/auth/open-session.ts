import { hashSessionToken, newSessionToken } from '@buhuchet/adapters/tokens';
import { endSession, startSession, type LoginRecord } from '@buhuchet/db';
import type { MeResponse } from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { readSessionToken, writeSessionCookie } from '../../middleware/cookie';
import { loadMe } from './me';

/**
 * Начать сеанс после входа (паролем, у администратора платформы — ещё и кодом из Telegram): прежний
 * сеанс этого браузера закрывается — один вход, один сеанс; cookie нового сеанса выставляется.
 */
export async function openSession(
  c: Context<AppEnv>,
  deps: ApiDeps,
  account: LoginRecord,
): Promise<MeResponse> {
  const previous = readSessionToken(c, deps);
  if (previous) await endSession(deps.db, hashSessionToken(previous));
  const token = newSessionToken();
  await startSession(deps.db, { userId: account.userId, tokenHash: hashSessionToken(token) });
  writeSessionCookie(c, deps, token);
  return loadMe(deps, account);
}
