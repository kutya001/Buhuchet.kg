import { hashSessionToken, newSessionToken } from '@buhuchet/adapters/tokens';
import { endSession, startSession, type LoginRecord } from '@buhuchet/db';
import { sessionDevice } from '@buhuchet/domain';
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
  if (previous) await endSession(deps.db, hashSessionToken(previous), 'closed');
  const token = newSessionToken();
  await startSession(deps.db, {
    userId: account.userId,
    tokenHash: hashSessionToken(token),
    // Только «браузер и система»: сам заголовок и адрес IP в сеансе не хранятся.
    device: sessionDevice(c.req.header('user-agent')),
  });
  writeSessionCookie(c, deps, token);
  return loadMe(deps, account);
}
