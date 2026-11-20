import { hashSessionToken } from '@buhuchet/adapters/tokens';
import {
  endSession,
  loadEmployeeAccess,
  orgSubscriptionClosed,
  sessionByToken,
  withOrgContext,
} from '@buhuchet/db';
import { loginDenial } from '@buhuchet/domain';
import { createMiddleware } from 'hono/factory';
import { denialError, subClosedError, subClosedOwnerError } from '../auth-errors';
import type { ApiDeps } from '../deps';
import type { AppEnv } from '../env';
import { apiError } from '../errors';
import { ownerOpenWhenClosed, subscriptionToday } from '../subscription-access';
import { clearSessionCookie, readSessionToken, writeSessionCookie } from './cookie';

/** Открытые методы: без входа. Все остальные пути API требуют действующий сеанс. */
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/cron/tick',
  // Словарь текстов нужен уже на странице входа.
  '/api/l10n',
  '/api/auth/login',
  // Код из Telegram при входе администратора платформы: сеанса ещё нет (docs/deviations.md п. О-13).
  '/api/auth/login/code',
  '/api/auth/logout',
  '/api/auth/password-reset',
  '/api/auth/password-reset/confirm',
  // «Оставить заявку» с лендинга: без входа, предел по адресу (задача #165).
  '/api/leads',
  // Документ формы заявки: начать загрузку (доработки 14.11.2026, блок 1; пределы по адресу и общий).
  '/api/leads/uploads',
  // Вебхук бота проверяет свой секрет (X-Telegram-Bot-Api-Secret-Token).
  '/api/telegram/webhook',
]);

/**
 * Открытые методы с параметрами в пути: страница контрагента по ссылке — что показать
 * (`/api/page/<адрес организации>/<ИНН>`), ввод кода (`…/code`, задача 2.42) и файл отчёта с неё
 * (`…/files/<номер>`, задача 2.43), без входа, только чтение одного контрагента после кода доступа;
 * ссылка «Подключить Telegram» (`…/telegram`, задача К3) — только браузеру с запомненным кодом;
 * конец обзора страницы (`…/tour`, доработки 15.11.2026) — тоже.
 * Только эти четыре пути: новый метод под `/api/page/` без сеанса не откроется. Видео лендинга
 * (прототип v79): обложка, чем играть, запуск и «досмотрел» — только видео с отметкой «На лендинге».
 * «Прочитать» документ формы заявки (доработки 14.11.2026, блок 1) — только с номером черновика,
 * который знает браузер заявителя.
 */
const PUBLIC_PATTERNS: readonly RegExp[] = [
  /^\/api\/page\/[^/]+\/[^/]+(?:\/code|\/telegram|\/files\/[^/]+|\/sent|\/sent\/complete|\/paid|\/paid\/complete|\/forgot|\/tour)?$/,
  // «Задать пароль» по ссылке из Telegram (доработки 14.11.2026, блок 1): ключ ссылки — в пути.
  /^\/api\/auth\/setup\/[A-Za-z0-9_-]{43}$/,
  /^\/api\/landing\/videos\/[a-z0-9][a-z0-9_-]{0,63}\/(?:cover|play|start|watched)$/,
  /^\/api\/leads\/uploads\/[0-9a-f-]{36}\/read$/,
];

const isPublicPath = (path: string) =>
  PUBLIC_PATHS.has(path) || PUBLIC_PATTERNS.some((pattern) => pattern.test(path));

/** Что доступно, пока пользователь не сменил временный пароль. */
const BEFORE_PASSWORD_CHANGE = new Set(['/api/auth/me', '/api/auth/password']);

/**
 * Общий слой для всех методов API (ТЗ «Проверка входа, организации и прав — общим промежуточным
 * слоем»): cookie → сеанс → организация. Без сеанса — 401; заблокированный пользователь или
 * организация — 403, сеанс закрывается; с временным паролем — только «кто я» и смена пароля. Для
 * сотрудника права и области загружаются в контексте его организации (RLS) и лежат в `access`;
 * право конкретного метода проверяет `requirePermission`. Доступ организации закрыт по подписке
 * (доработки 20.11.2026, блок 4, пункты 4–5) — сеанс сотрудника закрывается (403 `sub_closed`), а
 * владельцу открыта только «Подписка» (`ownerOpenWhenClosed`, иначе 403 `sub_closed_owner`).
 */
export function sessionGuard(deps: ApiDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set('session', null);
    c.set('access', null);
    if (isPublicPath(c.req.path)) return next();

    const token = readSessionToken(c, deps);
    const tokenHash = token ? hashSessionToken(token) : null;
    // При показе страницы сервером сеанс не продлевается: новая cookie из такого ответа до браузера не
    // дойдёт, а продление забрало бы часовой слот у запросов самой страницы — тогда срок в базе
    // сдвигался бы, а cookie в браузере нет.
    const touch = c.env?.pageRender !== true;
    const session = tokenHash ? await sessionByToken(deps.db, tokenHash, { touch }) : null;
    if (!token || !tokenHash || !session) {
      clearSessionCookie(c, deps);
      return c.json(apiError('unauthorized', 'Войдите в систему'), 401);
    }
    const denial = loginDenial(session);
    if (denial) {
      await endSession(deps.db, tokenHash, 'blocked');
      clearSessionCookie(c, deps);
      return c.json(denialError(denial, session), 403);
    }
    if (session.touched) writeSessionCookie(c, deps, token);
    c.set('session', { ...session, tokenHash });

    if (session.mustChangePassword && !BEFORE_PASSWORD_CHANGE.has(c.req.path)) {
      return c.json(
        apiError('password_change_required', 'Смените временный пароль, чтобы продолжить'),
        403,
      );
    }
    if (session.orgId && session.employeeId) {
      const today = subscriptionToday(deps);
      const { access, closed } = await withOrgContext(
        deps.db,
        { orgId: session.orgId, userId: session.userId },
        async (tx) => ({
          access: await loadEmployeeAccess(tx, session.employeeId!),
          closed: await orgSubscriptionClosed(tx, today),
        }),
      );
      // ОТКЛОНЕНИЕ: docs/deviations.md#О-89
      if (closed && !access?.subject.isOwner) {
        await endSession(deps.db, tokenHash, 'blocked');
        clearSessionCookie(c, deps);
        return c.json(subClosedError(), 403);
      }
      c.set('access', access);
      if (closed && !ownerOpenWhenClosed(c.req.path)) return c.json(subClosedOwnerError(), 403);
    }
    return next();
  });
}
