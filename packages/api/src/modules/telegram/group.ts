import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { hashSessionToken, isSessionTokenShape, newLinkToken } from '@buhuchet/adapters/tokens';
import {
  botChatUsers,
  contextOrgName,
  createTelegramGroupToken,
  getOrgPolicy,
  linkTelegramGroup,
  loadEmployeeAccess,
  loadReminderData,
  markTelegramGroupGone,
  markViaTelegram,
  moveTelegramGroup,
  readTelegramGroup,
  setTelegramGroupSummary,
  takeRateLimit,
  telegramBotRich,
  telegramFeatureOn,
  telegramGroupOrg,
  telegramGroupOwner,
  telegramGroupToken,
  telegramPlainText,
  uniqueViolation,
  unlinkTelegramGroup,
  withOrgContext,
  type RateLimit,
  type TelegramGroupRecord,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  botMessageProblem,
  botPlainText,
  GROUP_LINK_MINUTES,
  GROUP_MINE,
  groupMineMessage,
  groupMineOf,
  groupStartToken,
  groupTitleClean,
  hasPermission,
  loginDenial,
  parseBotPress,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import {
  ApiError,
  TelegramGroupLinkResponse,
  TelegramGroupResponse,
  TelegramGroupSummaryRequest,
  TelegramGroupUnlinkRequest,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { botText, sendNow } from './bot';
import { botSendOptions } from './outbox';
import { botPressTexts } from './press';
import { reminderReports } from './reminders';
import { botReportRow, reportTableTexts } from './staff-view';

/*
 * Общий рабочий чат фирмы (поток Т, задача Т8; пакет заказчика 13.11.2026, идея 11; прототип v105
 * modules/tg-group.js; docs/decisions.md п. Т-8). Владелец создаёт одноразовую ссылку на 15 минут
 * `t.me/<бот>?startgroup=g_<ключ>`, добавляет бота в рабочую группу — группа становится общим чатом
 * организации (одна на организацию, прежняя заменяется). По рабочим дням вместе с напоминаниями за день
 * в группу уходит сводка — только числа и имена сотрудников, без контрагентов и сумм. «Мои» под сводкой:
 * нажавший получает свой список скрытым сообщением — его видит только он.
 *
 * Группа ничего не разрешает: «Мои» отвечает только тому, чей личный Telegram привязан к учётной записи
 * организации группы, с правом «Просматривать отчёты», и только его собственные отчёты.
 */

const error = { 'application/json': { schema: ApiError } };

/** Сводка ответа экрана: группа, может ли менять вошедший, подключён ли бот. */
async function groupView(
  deps: ApiDeps,
  tx: Tx,
  orgId: string,
  owner: boolean,
): Promise<z.infer<typeof TelegramGroupResponse>> {
  const g: TelegramGroupRecord | null = await readTelegramGroup(tx);
  return {
    // Сводка уходит вместе с напоминаниями за день — во «Время сводки» учётной политики.
    time: (await getOrgPolicy(tx, orgId))?.digestTime ?? '09:00',
    group: g && {
      title: g.title,
      linkedByName: g.linkedByName,
      linkedAt: g.linkedAt.toISOString(),
      summary: g.summary,
      gone: g.goneAt !== null,
      version: g.version,
    },
    canEdit: owner,
    bot: Boolean(deps.telegram && deps.config.TELEGRAM_BOT_USERNAME),
  };
}

/**
 * Владелец организации — подключает, отключает и меняет сводку (прототип: `me().role === 'owner'`):
 * право «Настройки и учётная политика» (`org`) есть только у владельца, его проверяет `requirePermission`.
 */
const isOwner = (c: Context<AppEnv>) => c.get('access')?.subject.isOwner === true;

export const getGroupRoute = createRoute({
  method: 'get',
  path: '/telegram/group',
  tags: ['telegram'],
  summary: '«Общий чат фирмы в Telegram» организации',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Подключённая группа (или null), может ли вошедший её менять, подключён ли бот',
      content: { 'application/json': { schema: TelegramGroupResponse } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

export function getGroupHandler(deps: ApiDeps): RouteHandler<typeof getGroupRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const body = await withOrgContext(deps.db, ctx, (tx) =>
      groupView(deps, tx, ctx.orgId, isOwner(c)),
    );
    return c.json(body, 200);
  };
}

export const createGroupLinkRoute = createRoute({
  method: 'post',
  path: '/telegram/group/link',
  tags: ['telegram'],
  summary: 'Ссылка подключения общего чата фирмы: t.me/бот?startgroup=g_…, одноразовая, 15 минут',
  middleware: [requirePermission('org')] as const,
  responses: {
    200: {
      description: 'Ссылка; группа, в которую по ней добавят бота, станет общим чатом организации',
      content: { 'application/json': { schema: TelegramGroupLinkResponse } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Не владелец организации или «Напоминания в Telegram» выключены',
      content: error,
    },
    503: { description: 'Telegram-бот не подключён', content: error },
  },
});

/** «Подключить группу» (прототип `tgGrpLinkDlg`): в базе — только хеш ключа. */
export function createGroupLinkHandler(
  deps: ApiDeps,
): RouteHandler<typeof createGroupLinkRoute, AppEnv> {
  return async (c) => {
    const bot = deps.config.TELEGRAM_BOT_USERNAME;
    if (!deps.telegram || !bot) {
      return c.json(
        apiError('telegram_unavailable', 'Telegram-бот пока не подключён к платформе'),
        503,
      );
    }
    const token = newLinkToken();
    const ctx = orgContextOf(c);
    const expiresAt = await withOrgContext(deps.db, ctx, async (tx) => {
      if (!(await telegramFeatureOn(tx))) {
        apiFail(403, 'telegram_off', 'Напоминания в Telegram выключены в учётной политике');
      }
      return createTelegramGroupToken(tx, {
        tokenHash: hashSessionToken(token),
        userId: ctx.userId!,
        minutes: GROUP_LINK_MINUTES,
      });
    });
    return c.json(
      { url: `https://t.me/${bot}?startgroup=g_${token}`, expiresAt: expiresAt.toISOString() },
      200,
    );
  };
}

export const saveGroupRoute = createRoute({
  method: 'put',
  path: '/telegram/group',
  tags: ['telegram'],
  summary: '«Сводка дня в группу» — включить или выключить',
  middleware: [requirePermission('org')] as const,
  request: {
    body: {
      content: { 'application/json': { schema: TelegramGroupSummaryRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Общий чат после изменения',
      content: { 'application/json': { schema: TelegramGroupResponse } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не владелец организации', content: error },
    ...versionedSaveResponses,
  },
});

export function saveGroupHandler(deps: ApiDeps): RouteHandler<typeof saveGroupRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const view = await withOrgContext(deps.db, ctx, async (tx) => {
      await setTelegramGroupSummary(tx, { ...body, userId: ctx.userId! });
      return groupView(deps, tx, ctx.orgId, true);
    });
    return c.json(view, 200);
  };
}

export const unlinkGroupRoute = createRoute({
  method: 'post',
  path: '/telegram/group/unlink',
  tags: ['telegram'],
  summary: '«Отключить группу»: бот пишет в группе, что отключён, и выходит из неё',
  middleware: [requirePermission('org')] as const,
  request: {
    body: {
      content: { 'application/json': { schema: TelegramGroupUnlinkRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Общий чат после отключения (group: null)',
      content: { 'application/json': { schema: TelegramGroupResponse } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не владелец организации', content: error },
    ...versionedSaveResponses,
  },
});

export function unlinkGroupHandler(deps: ApiDeps): RouteHandler<typeof unlinkGroupRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const { removed, view } = await withOrgContext(deps.db, ctx, async (tx) => ({
      removed: await unlinkTelegramGroup(tx, body),
      view: await groupView(deps, tx, ctx.orgId, true),
    }));
    // Бот ещё в группе — пишет, что отключён, и выходит (прототип: «Бот напишет в группе …»).
    if (!removed.gone) await leaveGroup(deps, removed.chatId);
    return c.json(view, 200);
  };
}

/** «Отключён» в группу и выход из неё; ошибка Telegram метод не роняет. */
async function leaveGroup(deps: ApiDeps, chatId: number): Promise<void> {
  if (!deps.telegram) return;
  await sendNow(deps, chatId, await botText(deps, 'tgGrpOff'), 'group_off');
  try {
    await deps.telegram.leaveChat(chatId);
  } catch (err) {
    deps.logger.warn({ err, purpose: 'group_off' }, 'Telegram: бот не вышел из группы');
  }
}

/* ---------------------------------- Вебхук: группа ---------------------------------- */

/** Сообщение в группе: «/start@бот g_<ключ>» после подключения или смена номера группы. */
const GroupMessage = z.object({
  text: z.string().max(4096).optional(),
  migrate_to_chat_id: z.number().int().optional(),
  chat: z.object({
    id: z.number().int().negative(),
    type: z.enum(['group', 'supergroup']),
    title: z.string().max(1024).optional(),
  }),
  from: z.object({ id: z.number().int(), is_bot: z.boolean().optional() }).optional(),
});

/** Бота добавили в группу или удалили из неё (`my_chat_member`). */
const GroupMember = z.object({
  chat: z.object({
    id: z.number().int().negative(),
    type: z.enum(['group', 'supergroup']),
  }),
  new_chat_member: z.object({ status: z.string().max(32) }),
});

/** Сообщений о подключении в одну группу — не больше стольких за 10 минут (ссылка неверна — ответ). */
export const GROUP_LINK_RATE_LIMIT: RateLimit = {
  kind: 'bot_group_link',
  max: 10,
  windowSeconds: 600,
};
/** Нажатий «Мои» одним человеком — не больше стольких в минуту: каждое читает отчёты организации. */
export const GROUP_MINE_RATE_LIMIT: RateLimit = {
  kind: 'bot_group_mine',
  max: 20,
  windowSeconds: 60,
};

/** «/start g_<ключ>» в группе: ключ; null — это не ссылка подключения группы или не нашему боту. */
function groupStartKey(deps: ApiDeps, text: string): string | null {
  const m = /^\/start(?:@(\w+))?\s+(\S+)$/.exec(text.trim());
  if (!m) return null;
  const bot = deps.config.TELEGRAM_BOT_USERNAME;
  if (m[1] && (!bot || m[1].toLowerCase() !== bot.toLowerCase())) return null;
  return groupStartToken(m[2]!);
}

/**
 * Обновление из группы. true — обработано (вебхук дальше его не разбирает). Сбой не роняет вебхук:
 * Telegram повторял бы доставку.
 */
export async function handleGroupUpdate(
  deps: ApiDeps,
  update: { message?: unknown; my_chat_member?: unknown },
): Promise<boolean> {
  const member = GroupMember.safeParse(update.my_chat_member);
  if (member.success) {
    const { chat, new_chat_member: m } = member.data;
    if (m.status === 'left' || m.status === 'kicked') await groupGone(deps, chat.id);
    return true;
  }
  const message = GroupMessage.safeParse(update.message);
  if (!message.success) return false;
  const { chat, text, migrate_to_chat_id: to } = message.data;
  if (to !== undefined) {
    await groupMoved(deps, chat.id, to);
    return true;
  }
  if (message.data.from?.is_bot || text === undefined) return true;
  const key = groupStartKey(deps, text);
  if (key !== null) await linkGroup(deps, chat.id, groupTitleClean(chat.title), key);
  return true;
}

/** Бота удалили из группы: сводки прекращаются, владелец увидит это в «Настройках». */
async function groupGone(deps: ApiDeps, chatId: number): Promise<void> {
  const org = await telegramGroupOrg(deps.db, chatId);
  if (!org || org.gone) return;
  await withOrgContext(deps.db, { orgId: org.orgId, userId: null }, async (tx) => {
    await markViaTelegram(tx);
    await markTelegramGroupGone(tx, { chatId, now: deps.clock.now() });
  });
}

/** Группа стала супергруппой — у неё новый номер. */
async function groupMoved(deps: ApiDeps, from: number, to: number): Promise<void> {
  if (to >= 0) return;
  const org = await telegramGroupOrg(deps.db, from);
  if (!org) return;
  await withOrgContext(deps.db, { orgId: org.orgId, userId: null }, (tx) =>
    moveTelegramGroup(tx, { from, to }),
  );
}

/**
 * Подключение группы по ключу ссылки. Ссылка неверна, устарела или использована — бот отвечает и
 * выходит из группы (если группа ничья). Группа — уже общий чат другой организации: отказ, бот остаётся
 * (он нужен той организации). Создавший ссылку больше не владелец или «Напоминания в Telegram»
 * выключены — как неверная ссылка.
 */
async function linkGroup(deps: ApiDeps, chatId: number, title: string, key: string): Promise<void> {
  const slot = await takeRateLimit(deps.db, GROUP_LINK_RATE_LIMIT, String(chatId));
  if (!slot.ok) return;
  const tokenHash = isSessionTokenShape(key) ? hashSessionToken(key) : null;
  const [info, existing] = await Promise.all([
    tokenHash ? telegramGroupToken(deps.db, tokenHash) : Promise.resolve(null),
    telegramGroupOrg(deps.db, chatId),
  ]);
  // Telegram повторил то же сообщение после подключения — второй раз не отвечаем.
  if (info?.used && existing && existing.orgId === info.orgId && !existing.gone) return;
  const bad = async () => {
    await sendNow(deps, chatId, await botText(deps, 'tgGrpLinkBad'), 'group_link');
    if (!existing) {
      try {
        await deps.telegram?.leaveChat(chatId);
      } catch (err) {
        deps.logger.warn({ err, purpose: 'group_link' }, 'Telegram: бот не вышел из группы');
      }
    }
  };
  if (!tokenHash || !info || info.used || info.expired || !info.orgActive) return bad();
  if (existing && existing.orgId !== info.orgId) return bad();
  let result: { previousChatId: number | null; orgName: string | null } | null;
  try {
    result = await withOrgContext(
      deps.db,
      { orgId: info.orgId, userId: info.createdBy },
      async (tx) => {
        if (!(await telegramFeatureOn(tx)) || !(await telegramGroupOwner(tx, info.createdBy))) {
          return null;
        }
        await markViaTelegram(tx);
        const done = await linkTelegramGroup(tx, {
          tokenHash,
          chatId,
          title: title || 'Telegram',
          now: deps.clock.now(),
        });
        if (done.status !== 'ok') return null;
        return { previousChatId: done.previousChatId, orgName: await contextOrgName(tx) };
      },
    );
  } catch (err) {
    // Группу в это же время подключила другая организация.
    if (!uniqueViolation(err)) throw err;
    result = null;
  }
  if (!result) return bad();
  await sendNow(
    deps,
    chatId,
    await botText(deps, 'tgGrpLinked', {
      группа: title || 'Telegram',
      организация: result.orgName ?? '',
    }),
    'group_link',
  );
  if (result.previousChatId !== null) await leaveGroup(deps, result.previousChatId);
}

/* ------------------------------------ «Мои» ------------------------------------ */

/** Нажатие кнопки в группе. */
export interface GroupPress {
  callbackId: string;
  fromId: number;
  chatId: number;
  data: string;
}

/**
 * «Мои» под сводкой (прототип v105 `tgAct('grpMine')`, отказ `tgGrpNoLink`): организация — та, чей
 * общий чат эта группа; нажавший — по своему личному Telegram (номер пользователя Telegram и есть номер
 * его личного чата с ботом), привязанному к учётной записи этой организации; дальше — как у любого
 * действия бота: вход не закрыт, пароль не временный, право «Просматривать отчёты». Ответ — скрытым
 * сообщением в группу, его видит только нажавший; данных не меняет.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-12
export async function handleGroupPress(deps: ApiDeps, press: GroupPress): Promise<void> {
  const answer = async (text?: string, alert = false) => {
    try {
      await deps.telegram?.answerCallback(press.callbackId, text, { alert });
    } catch (err) {
      deps.logger.warn({ err, purpose: 'group_press' }, 'Telegram: ответ на нажатие не отправлен');
    }
  };
  const refuse = async (key: TelegramTemplateKey) => answer(await botText(deps, key), true);
  if (parseBotPress(press.data)?.action !== GROUP_MINE) return refuse('tgActStale');
  const org = await telegramGroupOrg(deps.db, press.chatId);
  if (!org || org.gone) return refuse('tgActStale');
  const slot = await takeRateLimit(deps.db, GROUP_MINE_RATE_LIMIT, String(press.fromId));
  if (!slot.ok) return refuse('tgActFailed');
  const user = (await botChatUsers(deps.db, press.fromId)).find((u) => u.orgId === org.orgId);
  if (!user || !user.employeeId) return refuse('tgGrpNoLink');
  if (loginDenial(user) || user.mustChangePassword || user.relinkFree) {
    return refuse('tgActNoRight');
  }
  const employeeId = user.employeeId;
  const texts = await botPressTexts(deps);
  const today = bishkekDate(deps.clock.now());
  const outcome = await withOrgContext(
    deps.db,
    { orgId: org.orgId, userId: user.userId },
    async (tx) => {
      const access = await loadEmployeeAccess(tx, employeeId);
      if (!access || !hasPermission(access.subject, 'repView')) return 'tgActNoRight' as const;
      if (!(await telegramFeatureOn(tx))) return 'tgActStale' as const;
      const data = await loadReminderData(tx, today);
      const mine = groupMineOf(employeeId, reminderReports(data.reports, texts.tr), {
        today,
        taxpay: data.features.taxpay === true,
      });
      if (!mine.length) return { text: await texts.text('tgGrpMineNone') };
      const rows = new Map(data.reports.map((r) => [r.id, r]));
      const todayN = mine.filter((x) => x.due === today).length;
      const table = reportTableTexts(texts.tr);
      const message = groupMineMessage(
        await texts.text('tgGrpMineHead', { сегодня: todayN, просрочено: mine.length - todayN }),
        mine.map((o) => ({
          ...botReportRow(rows.get(o.report.id)!, null, o.pay, today, texts.tr, true),
          due: o.due,
        })),
        {
          columns: table.columns,
          more: table.more,
          today: texts.tr('telegram.table.today_word'),
          todayDay: today,
        },
      );
      return { message };
    },
  );
  if (typeof outcome === 'string') return refuse(outcome);
  const ephemeral = { receiverUserId: press.fromId, callbackQueryId: press.callbackId };
  try {
    if (outcome.text !== undefined) {
      await deps.telegram?.sendMessage(press.chatId, outcome.text, { ephemeral });
    } else {
      const problem = botMessageProblem(outcome.message);
      if (problem) throw new Error(`Telegram: «Мои» — ${problem}`);
      const plain =
        !(await telegramBotRich(deps.db)) || (await telegramPlainText(deps.db, user.userId));
      await deps.telegram?.sendMessage(press.chatId, botPlainText(outcome.message), {
        ...botSendOptions(outcome.message, { plain }),
        ephemeral,
      });
    }
  } catch (err) {
    deps.logger.warn({ err, purpose: 'group_mine' }, 'Telegram: скрытый ответ «Мои» не отправлен');
  }
  await answer(await botText(deps, 'tgGrpMineToast'));
}
