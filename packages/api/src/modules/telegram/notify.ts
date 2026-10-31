import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  getNotifySettings,
  notifyTarget,
  saveNotifySettings,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  formatText,
  notifyKindsFor,
  NOTIFY_KINDS,
  type NotifyKind,
  type NotifyMode,
  type Translate,
} from '@buhuchet/domain';
import { ApiError, NotifySettingsRequest, NotifySettingsResponse } from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requireEmployee } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * «Уведомления в Telegram» в «Мой профиль» (ТЗ «Уведомления в Telegram»; задача 2.25; прототип
 * modules/profile.js — `notifyBox`, `bindNotify`): свой режим и переключатели. Режим и переключатели по
 * отчётам других сотрудников — только владельцу и главному бухгалтеру; остальным — «Ручные задачи» и
 * «Регулярные задачи по отчётам». Смена — в историю сотрудника («Уведомления: …»), устаревшая версия —
 * «запись изменена другим пользователем». У администратора платформы блока нет (метод — сотрудникам).
 */

const error = { 'application/json': { schema: ApiError } };

/** Сотрудник того, кто вошёл: свой ли, старший ли и его настройки. */
async function mine(c: Context<AppEnv>, tx: Tx) {
  const access = c.get('access')!;
  const target = await notifyTarget(tx, access.subject.employeeId);
  if (!target) apiFail(403, 'forbidden', 'Нет доступа');
  const stored = await getNotifySettings(tx, target.userId);
  return { target, stored };
}

export const getNotifyRoute = createRoute({
  method: 'get',
  path: '/telegram/notify',
  tags: ['telegram'],
  summary: 'Свои «Уведомления в Telegram»',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Режим (у владельца и главного бухгалтера), отключённые переключатели и версия',
      content: { 'application/json': { schema: NotifySettingsResponse } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

export function getNotifyHandler(deps: ApiDeps): RouteHandler<typeof getNotifyRoute, AppEnv> {
  return async (c) => {
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const { target, stored } = await mine(c, tx);
      return { boss: target.boss, ...stored, off: [...stored.off] };
    });
    return c.json(body, 200);
  };
}

export const saveNotifyRoute = createRoute({
  method: 'put',
  path: '/telegram/notify',
  tags: ['telegram'],
  summary: 'Сохранить свои «Уведомления в Telegram»',
  middleware: [requireEmployee] as const,
  request: {
    body: { content: { 'application/json': { schema: NotifySettingsRequest } }, required: true },
  },
  responses: {
    200: {
      description: 'Сохранено: новые настройки и версия',
      content: { 'application/json': { schema: NotifySettingsResponse } },
    },
    400: { description: 'Неверные данные', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Режим и переключатели по отчётам других — только владельцу и главному бухгалтеру',
      content: error,
    },
    409: { description: 'Запись изменена другим пользователем', content: error },
  },
});

/** Запись истории: «Уведомления: Все» → «Уведомления: Только ручные задачи» или «… «…» отключено». */
function historyText(
  t: Translate,
  from: { mode: NotifyMode; off: readonly NotifyKind[] },
  to: { mode: NotifyMode; off: readonly NotifyKind[] },
): { from: string; to: string } | null {
  const mode = (m: NotifyMode) =>
    t('profile.notify.history_mode', { mode: t(`profile.notify.mode.${m}`) });
  if (from.mode !== to.mode) return { from: mode(from.mode), to: mode(to.mode) };
  const kind = (k: NotifyKind, on: boolean) =>
    t('profile.notify.history_kind', {
      kind: t(`profile.notify.kind.${k}`),
      state: t(on ? 'profile.notify.history_on' : 'profile.notify.history_off'),
    });
  const changed = NOTIFY_KINDS.filter((k) => from.off.includes(k) !== to.off.includes(k));
  if (!changed.length) return null;
  return {
    from: changed.map((k) => kind(k, !from.off.includes(k))).join('; '),
    to: changed.map((k) => kind(k, !to.off.includes(k))).join('; '),
  };
}

/**
 * Сохранить (прототип `bindNotify`): смена режима сбрасывает переключатели — это делает экран, сервер
 * сохраняет то, что пришло. Сотрудник без режима меняет только свои переключатели задач.
 */
export function saveNotifyHandler(deps: ApiDeps): RouteHandler<typeof saveNotifyRoute, AppEnv> {
  return async (c) => {
    const input = c.req.valid('json');
    const texts = await serverTexts(deps);
    const t: Translate = (key, params) => formatText(texts(key), params);
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const { target, stored } = await mine(c, tx);
      const allowed = notifyKindsFor(target.boss);
      if (
        (!target.boss && input.mode !== stored.mode) ||
        input.off.some((k) => !allowed.includes(k))
      ) {
        apiFail(
          403,
          'notify_boss_only',
          'Режим и уведомления по отчётам других сотрудников — только владельцу и главному бухгалтеру',
        );
      }
      const off = NOTIFY_KINDS.filter((k) => input.off.includes(k));
      const next = { mode: input.mode, off };
      const change = historyText(t, stored, next);
      // Ничего не меняется (например, уже сохранено в другой вкладке) — те же настройки.
      if (!change) return { boss: target.boss, ...stored, off: [...stored.off] };
      const saved = await saveNotifySettings(tx, {
        userId: target.userId,
        employeeId: target.employeeId,
        version: input.version,
        ...next,
        ...change,
      });
      return { boss: target.boss, ...saved, off: [...saved.off] };
    });
    return c.json(body, 200);
  };
}
