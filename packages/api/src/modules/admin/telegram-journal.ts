import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminTelegramMessage,
  adminTelegramSummary,
  exportAdminTelegramLog,
  listAdminTelegramLogPage,
  listAdminTelegramLogValues,
  withUserContext,
  type AdminTelegramLogRecord,
  type JournalScope,
} from '@buhuchet/db';
import {
  addDays,
  bishkekDate,
  formatText,
  JOURNAL_DAYS,
  JOURNAL_PERIOD_DEFAULT,
  journalLine,
  type BotMessage,
  type IsoDate,
  type JournalDir,
} from '@buhuchet/domain';
import {
  AdminTelegramLogExportQuery,
  AdminTelegramLogList,
  AdminTelegramLogQuery,
  type AdminTelegramLogRow,
  AdminTelegramLogValuesQuery,
  AdminTelegramMessage,
  type AdminTelegramMessageBody,
  AdminTelegramSummary,
  type AdminTelegramView,
  ApiError,
  ListValues,
  Uuid,
} from '@buhuchet/shared';
import { z } from 'zod';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Админка → «Телеграм» → «Журнал»: переписка бота всех организаций в обе стороны и текст сообщений
 * (решение заказчика 17.11.2026; ТЗ «Доработки 17.11.2026», блок «Админка: запуски по расписанию и
 * переписка бота», пункт 3; прототип v132 admin/tg-log.js; docs/decisions.md п. Т-16). Только
 * администратору платформы и только чтение. В ответах нет номера чата, адресов и данных кнопок, а у
 * кода и одноразовой ссылки нет и текста: их в журнале нет вовсе.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

type Texts = (key: string) => string;

/** Начало дня по Бишкеку (UTC+6) как момент. */
const dayStart = (day: IsoDate): Date => new Date(`${day}T00:00:00+06:00`);

/** С какого момента журнал хранит и показывает сообщения: 90 дней. */
export function journalSince(now: Date): Date {
  return dayStart(addDays(bishkekDate(now), -(JOURNAL_DAYS - 1)));
}

/**
 * Что показать: направление и период («Сегодня» — с начала дня по Бишкеку, «7 дней» — сегодня и шесть
 * дней до него, как в прототипе). «Вся переписка» (`chat`) — весь срок хранения и оба направления.
 */
function scopeOf(
  now: Date,
  p: { dir?: JournalDir | undefined; days?: string | undefined; chat?: string | undefined },
): JournalScope {
  if (p.chat) return { dir: null, from: journalSince(now), chatOf: p.chat };
  const days = Math.min(Number(p.days ?? JOURNAL_PERIOD_DEFAULT), JOURNAL_DAYS);
  return { dir: p.dir ?? null, from: dayStart(addDays(bishkekDate(now), -(days - 1))) };
}

/** Текст одной строкой, как в столбце «Текст» (прототип `tgTxt`); у скрытого — null. */
function lineOf(r: AdminTelegramLogRecord, t: Texts): string | null {
  if (r.hide) return null;
  const note = r.text?.replace(/\s+/g, ' ').trim() || null;
  if (r.fileName) {
    return [formatText(t('tgadm.txt.file'), { name: r.fileName }), note]
      .filter(Boolean)
      .join(' · ');
  }
  if (r.kind === 'in_file') return [t('tgadm.txt.photo'), note].filter(Boolean).join(' · ');
  if (r.kind === 'in_press') {
    return r.button
      ? formatText(t('tgadm.txt.press'), { name: r.button })
      : t('tgadm.txt.press_any');
  }
  return journalLine({ hide: null, text: r.text, payload: r.message });
}

/** Строка журнала для ответа API: без номера чата, моменты — строкой ISO. */
function rowBody(r: AdminTelegramLogRecord, t: Texts): AdminTelegramLogRow {
  return {
    id: r.id,
    src: r.src,
    dir: r.dir,
    at: r.createdAt.toISOString(),
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    recipient: r.recipient,
    orgId: r.orgId,
    orgName: r.orgName,
    chatKind: r.chatKind,
    kind: r.kind,
    status: r.status,
    tries: r.tries,
    error: r.lastError,
    text: lineOf(r, t),
    hide: r.hide,
  };
}

/**
 * Сообщение бота для окна «Сообщение»: только то, что человек видит в чате. Адрес ссылки, текст
 * копирования и данные нажатия кнопки в ответ не идут — от кнопки остаются подпись и вид.
 */
export function viewOf(m: BotMessage, pressed: ReadonlySet<string>): AdminTelegramView {
  return {
    ...(m.heading ? { heading: m.heading } : {}),
    ...(m.sub ? { sub: m.sub } : {}),
    ...(m.text ? { text: m.text } : {}),
    ...(m.tables?.length
      ? {
          tables: m.tables.map((x) => ({
            ...(x.title ? { title: x.title } : {}),
            ...(x.open ? { open: true } : {}),
            ...(x.head ? { head: [...x.head] } : {}),
            rows: x.rows.map((row) => [...row]),
            ...(x.foot ? { foot: [...x.foot] } : {}),
            ...(x.numeric ? { numeric: [...x.numeric] } : {}),
            ...(x.n === undefined ? {} : { n: x.n }),
          })),
        }
      : {}),
    ...(m.buttons?.length
      ? {
          buttons: m.buttons.map((row) =>
            row.map((b) => ({
              text: b.text,
              kind: b.copy ? ('copy' as const) : b.url ? ('url' as const) : ('action' as const),
              off: b.off === true,
              pressed: pressed.has(b.text),
            })),
          ),
        }
      : {}),
    image: Boolean(m.image),
  };
}

function messageBody(
  r: AdminTelegramLogRecord,
  t: Texts,
  pressed: ReadonlySet<string>,
): AdminTelegramMessageBody {
  const out = r.dir === 'out';
  return {
    ...rowBody(r, t),
    userId: r.userId,
    view: out && r.message ? viewOf(r.message, pressed) : null,
    fullText: r.hide || (out && r.message) ? null : r.text,
    button: r.button,
    file:
      r.fileName !== null || r.fileSize !== null || r.kind === 'in_file'
        ? { name: r.fileName, size: r.fileSize }
        : null,
  };
}

export const telegramLogRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/log',
  tags: ['admin'],
  summary: 'Журнал переписки бота Telegram всех организаций: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminTelegramLogQuery },
  responses: {
    200: {
      description: 'Страница журнала: сортировка, страница, фильтры, поиск и группы — на сервере',
      content: json(AdminTelegramLogList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

/** «Журнал» (прототип grid 'tg-log'): отправленное и полученное всех организаций, сначала новые. */
export function telegramLogHandler(deps: ApiDeps): RouteHandler<typeof telegramLogRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const scope = scopeOf(deps.clock.now(), params);
    const t = await serverTexts(deps);
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminTelegramLogPage(tx, query, t, scope, deps.config.APP_ENV === 'staging'),
    );
    return c.json(
      {
        items: page.rows.map((r) => rowBody(r, t)),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const telegramLogValuesRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/log/values',
  tags: ['admin'],
  summary: 'Значения столбца журнала Telegram для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminTelegramLogValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей за выбранный период',
      content: json(ListValues),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function telegramLogValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramLogValuesRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const scope = scopeOf(deps.clock.now(), params);
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminTelegramLogValues(
        tx,
        params.col,
        t,
        scope,
        params.q,
        deps.config.APP_ENV === 'staging',
      ),
    );
    return c.json(values, 200);
  };
}

export const telegramLogExportRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/log/export',
  tags: ['admin'],
  summary: 'Журнал переписки бота Telegram в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminTelegramLogExportQuery },
  responses: {
    200: {
      description: 'Файл Excel со всеми записями под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function telegramLogExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramLogExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const scope = scopeOf(deps.clock.now(), params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) =>
          exportAdminTelegramLog(tx, query, keys, t, scope, deps.config.APP_ENV === 'staging'),
        'export',
      );
      return xlsxResponse(c, {
        title: t('nav.telegram'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

export const telegramSummaryRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/log/summary',
  tags: ['admin'],
  summary: 'Плашки над журналом Telegram',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description:
        'В очереди и ошибок отправки — за срок хранения; отправлено и получено сегодня (по Бишкеку)',
      content: json(AdminTelegramSummary),
    },
    ...denied,
  },
});

export function telegramSummaryHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramSummaryRoute, AppEnv> {
  return async (c) => {
    const now = deps.clock.now();
    const summary = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      adminTelegramSummary(tx, bishkekDate(now), journalSince(now)),
    );
    return c.json(summary, 200);
  };
}

export const telegramMessageRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/log/{id}',
  tags: ['admin'],
  summary: 'Окно «Сообщение»: сообщение журнала, связанные с ним и соседние в том же чате',
  middleware: [requirePlatformAdmin] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Сообщение, как в чате, и ссылки на связанные и соседние сообщения',
      content: json(AdminTelegramMessage),
    },
    400: { description: 'Неверный номер сообщения', content: error },
    404: { description: 'Сообщения нет или оно старше срока хранения', content: error },
    ...denied,
  },
});

/**
 * «Сообщение» (прототип `tgMsgDlg`): отправленное — как его видит человек (заголовок, таблицы, кнопки),
 * полученное — под сообщением бота, к которому оно относится. Нажатая кнопка отмечена по подписи.
 */
export function telegramMessageHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramMessageRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const t = await serverTexts(deps);
    const found = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      adminTelegramMessage(
        tx,
        id,
        journalSince(deps.clock.now()),
        deps.config.APP_ENV === 'staging',
        t('tgadm.org.stand'),
      ),
    );
    if (!found) return apiFail(404, 'not_found', 'Сообщение не найдено');
    const labels = (rows: readonly AdminTelegramLogRecord[]) =>
      new Set(rows.flatMap((r) => (r.button ? [r.button] : [])));
    const none = new Set<string>();
    return c.json(
      {
        message: messageBody(found.message, t, labels(found.replies)),
        bot: found.bot ? messageBody(found.bot, t, labels([found.message])) : null,
        replies: found.replies.map((r) => messageBody(r, t, none)),
        prevId: found.prevId,
        nextId: found.nextId,
      },
      200,
    );
  };
}
