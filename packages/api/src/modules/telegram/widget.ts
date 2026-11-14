import { redactBotToken } from '@buhuchet/adapters';
import {
  botChatUsers,
  getOrgPolicy,
  loadEmployeeAccess,
  lockTelegramWidget,
  logTelegram,
  messageTemplates,
  openBotAsks,
  orgMenuSettings,
  saveTelegramWidget,
  takeRateLimit,
  telegramWidgetsSince,
  updateTelegramWidget,
  widgetEmployee,
  widgetReports,
  widgetReportStatus,
  withOrgContext,
  type BotChatUser,
  type BotPressTarget,
  type Tx,
} from '@buhuchet/db';
import {
  addDays,
  askBotMessage,
  bishkekDate,
  bishkekTime,
  BOT_WIDGET_DATA_MAX,
  BOT_WIDGET_QUERY_MAX,
  BOT_WIDGET_REFRESH_DAYS,
  botClip,
  botTemplate,
  fillTemplate,
  formatText,
  hasPermission,
  loginDenial,
  OPEN_REPORT_STATUSES,
  parseWidgetQuery,
  RecordChangedError,
  RecordNotFoundError,
  reportWeek,
  STAFF_BOT_ACTIONS,
  widgetData,
  widgetHtml,
  widgetMarkDone,
  widgetPick,
  widgetWeekDates,
  withOrganization,
  type BotMessage,
  type IsoDate,
  type TelegramTemplateKey,
  type Translate,
  type UiTextKey,
  type WidgetData,
  type WidgetReport,
} from '@buhuchet/domain';
import type { ApiDeps, JobContext } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { sendBotMessage } from './bot';
import { reportCell } from './command-view';
import { queueTelegramEvents } from './events';
import { flushEvents } from './outbox';
import {
  BOT_PRESS_RATE_LIMIT,
  botActionOf,
  botPressTexts,
  botTargetRefusal,
  botUserContext,
  botUserOf,
  type BotPressContext,
} from './press';
import { botSiteUrl } from './staff-view';

/*
 * Виджет «Мои отчёты на неделю» (поток Т, задача Т9; пакет заказчика 13.11.2026, идея 5; прототип v106
 * modules/tg-widget.js — `tgWidgetCmd`, `tgWgPress`). Бот присылает виджет по команде меню «Мои на неделю»
 * (права и отказы — как у остальных команд, `commands.ts`); в виджете — свои отчёты сотрудника.
 *
 * Галочка в виджете приходит боту запросом `widget_query` «d:<номер строки>»: бот находит свой виджет по
 * учётным записям, к которым привязан чат, и номеру сообщения, а отчёт — по номеру строки в сохранённом
 * списке (номер отчёта виджет не присылает). Дальше — то же действие «Сдан», что у кнопки под
 * напоминанием (задача Т2): те же отказы ядра (привязка, вход, «Действия из Telegram»), право и область,
 * одна транзакция от имени сотрудника с отметкой «через Telegram»; нужен файл — бот просит его в чате.
 * Итог виджет показывает строкой, которую видит только сотрудник (`answerWidgetQuery`).
 *
 * Виджет обновляется без нового сообщения (`editMessageWidgetData`): после галочки, по «Обновить» и утром
 * во «Время сводки» (задача расписания напоминаний). Новый виджет делает прежний «устаревшим».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-13

/** Подпись под виджетом — не длиннее (знаков; предел Telegram). */
const CAPTION_MAX = 1024;

/** Тексты виджета: шаблоны бота и словарь. */
interface WidgetTextSource {
  tpl(key: TelegramTemplateKey, values?: Readonly<Record<string, string | number>>): string;
  tr: Translate;
}

/** Свои несданные отчёты сотрудника, данные виджета и номера отчётов его строк. */
async function widgetContent(
  tx: Tx,
  o: { employeeId: string; today: IsoDate; now: Date; texts: WidgetTextSource; version: number },
): Promise<{ data: WidgetData; ids: string[]; week: number; over: number }> {
  const { tpl, tr } = o.texts;
  const rows = await widgetReports(tx, {
    employeeId: o.employeeId,
    horizon: reportWeek(o.today).to,
  });
  const list: WidgetReport[] = rows
    .filter((r) => OPEN_REPORT_STATUSES.has(r.status) && r.act !== 'pay')
    .map((r) => ({
      id: r.id,
      contractor: r.contractorName,
      report: reportCell(r, o.today, tr),
      status: tr(`status.report.${r.status}` as UiTextKey),
      due: r.dueDate,
    }));
  const pick = widgetPick(list, o.today);
  const { data, ids } = widgetData(
    pick,
    o.today,
    {
      head: tpl('tgWgHead', { даты: widgetWeekDates(o.today) }),
      updated: tpl('tgWgUpd', { время: bishkekTime(o.now) }),
      over: tpl('tgWgOver'),
      none: tpl('tgWgNone'),
      more: (n) => tpl('tgWgMore', { n }),
      weekdayShort: (i) => tr(`report.cal.dow.${i + 1}` as UiTextKey),
      due: (date) => tr('telegram.widget.due', { date }),
    },
    o.version,
  );
  return { data, ids, week: pick.week, over: pick.over };
}

/** Тексты для сервера и задачи расписания: шаблоны бота читаются один раз. */
async function widgetTexts(deps: Pick<ApiDeps, 'db'> & Parameters<typeof serverTexts>[0]) {
  const [templates, dict] = await Promise.all([messageTemplates(deps.db), serverTexts(deps)]);
  const tr: Translate = (key, params) => formatText(dict(key), params);
  const tpl = (key: TelegramTemplateKey, values: Readonly<Record<string, string | number>> = {}) =>
    fillTemplate(botTemplate(key, templates[key]), values);
  return { tpl, tr };
}

/** Номер следующего списка виджета: прежний + 1 (галочка со старого списка — «Кнопка устарела»). */
const nextVersion = (raw: string) => (parseData(raw)?.v ?? 0) + 1;

/** Данные виджета «устарел»: прежний виджет показывает только этот текст и больше не обновляется. */
const oldWidget = (texts: WidgetTextSource) => JSON.stringify({ o: texts.tpl('tgWgOld') });

/**
 * Команда «Мои на неделю»: отправить виджет сотруднику (права команды уже проверены вызывающим, `tx` —
 * от имени сотрудника). false — Telegram виджет не принял (например, старый сервер Bot API): тогда
 * вызывающий отвечает, как на «Неделя».
 */
export async function sendWeekWidget(
  deps: ApiDeps,
  o: {
    user: BotChatUser & { orgId: string; employeeId: string };
    chatId: number;
    today: IsoDate;
    shared: boolean;
  },
): Promise<boolean> {
  if (!deps.telegram) return false;
  const texts = await widgetTexts(deps);
  const now = deps.clock.now();
  const { user, chatId, today } = o;
  const content = await withOrgContext(deps.db, { orgId: user.orgId, userId: user.userId }, (tx) =>
    widgetContent(tx, { employeeId: user.employeeId, today, now, texts, version: 1 }),
  );
  // Подпись виджета Telegram принимает до 1024 знаков (шаблон правится в Админке).
  const caption = botClip(
    withOrganization(
      texts.tpl('tgWgCaption', {
        даты: widgetWeekDates(today),
        сдать: content.week,
        просрочено: content.over,
      }),
      user.orgName,
      o.shared,
    ),
    CAPTION_MAX,
  );
  const html = widgetHtml({
    refresh: texts.tpl('tgBtnWgRefresh'),
    site: texts.tpl('tgBtnOpenReports'),
    siteUrl: botSiteUrl(deps, '/app/reports/week') ?? '',
  });
  const chatData = JSON.stringify(content.data);
  const tg = deps.telegram;
  let error = '';
  let messageId: number | null = null;
  try {
    const res = await tg.sendWidget(chatId, { html, chatData, caption });
    if (res.ok) messageId = res.messageId;
    else error = `${res.errorCode}: ${res.description}`;
  } catch (err) {
    error = redactBotToken(err instanceof Error ? err.message : String(err));
  }
  try {
    await logTelegram(deps.db, {
      userId: user.userId,
      chatId,
      kind: 'bot_cmd',
      text: caption,
      ok: messageId !== null,
      error,
    });
  } catch (err) {
    deps.logger.warn(
      { err, purpose: 'bot_widget' },
      'Telegram: виджет не записан в журнал отправок',
    );
  }
  if (messageId === null) {
    deps.logger.warn({ purpose: 'bot_widget', error }, 'Telegram: виджет не отправлен');
    return false;
  }
  const sentId = messageId;
  const prev = await withOrgContext(deps.db, { orgId: user.orgId, userId: user.userId }, (tx) =>
    saveTelegramWidget(tx, {
      userId: user.userId,
      chatId,
      messageId: sentId,
      items: content.ids,
      data: chatData,
      sentOn: today,
    }),
  );
  if (prev) {
    try {
      await tg.editWidgetData(prev.chatId, prev.messageId, oldWidget(texts));
    } catch (err) {
      deps.logger.warn({ err, purpose: 'bot_widget' }, 'Telegram: прежний виджет не помечен');
    }
  }
  return true;
}

/** Запрос виджета к боту (`widget_query`). */
export interface WidgetQueryUpdate {
  id: string;
  fromId: number;
  chatId: number;
  chatType: string;
  messageId: number;
  data: string;
}

/** Строка виджета словами — для итога «Готово: …» и просьбы прислать файл. */
const rowLabel = (data: WidgetData, row: number) => {
  const r = data.r[row];
  return r ? `${r[2].split(' · ')[0]}, ${r[1]}` : '';
};

/** Текст не длиннее `max` байт UTF-8 (обрезается по знакам, с «…»). */
const clipBytes = (text: string, max: number) => {
  const size = (s: string) => new TextEncoder().encode(s).length;
  if (size(text) <= max) return text;
  const chars = [...text];
  while (chars.length && size(`${chars.join('')}…`) > max) chars.pop();
  return `${chars.join('')}…`;
};

const parseData = (raw: string): WidgetData | null => {
  try {
    return JSON.parse(raw) as WidgetData;
  } catch {
    return null;
  }
};

/**
 * Принять запрос виджета. Виджет всегда получает ответ (иначе ждёт); ошибка Telegram и ошибка действия
 * вебхук не роняют.
 */
export async function handleWidgetQuery(deps: ApiDeps, q: WidgetQueryUpdate): Promise<void> {
  const tg = deps.telegram;
  if (!tg) return;
  const answer = async (text?: string) => {
    try {
      // Ответ виджету — до 1 КБ: шаблоны правятся в Админке, название отчёта длинное.
      await tg.answerWidgetQuery(q.id, text && clipBytes(text, BOT_WIDGET_DATA_MAX));
    } catch (err) {
      deps.logger.warn({ err, purpose: 'bot_widget' }, 'Telegram: ответ виджету не отправлен');
    }
  };
  const texts = await widgetTexts(deps);
  const refuse = (key: TelegramTemplateKey) => answer(texts.tpl(key));
  // Виджет живёт только в личном чате, спросить может только его хозяин.
  const query =
    new TextEncoder().encode(q.data).length <= BOT_WIDGET_QUERY_MAX
      ? parseWidgetQuery(q.data)
      : null;
  if (q.chatType !== 'private' || q.fromId !== q.chatId || !query) return answer();
  const slot = await takeRateLimit(deps.db, BOT_PRESS_RATE_LIMIT, String(q.chatId));
  if (!slot.ok) return refuse('tgActFailed');

  // Чей виджет: учётные записи, к которым привязан чат, — в своей организации (RLS).
  let found: {
    user: BotChatUser & { orgId: string; employeeId: string };
    actions: boolean;
  } | null = null;
  for (const u of await botChatUsers(deps.db, q.chatId)) {
    if (!u.orgId || !u.employeeId) continue;
    const user = { ...u, orgId: u.orgId, employeeId: u.employeeId };
    const hit = await withOrgContext(
      deps.db,
      { orgId: user.orgId, userId: user.userId },
      async (tx) => {
        const w = await lockTelegramWidget(tx, {
          userId: user.userId,
          chatId: q.chatId,
          messageId: q.messageId,
        });
        return w ? ((await getOrgPolicy(tx, user.orgId))?.telegramActions ?? false) : null;
      },
    );
    if (hit !== null) {
      found = { user, actions: hit };
      break;
    }
  }
  if (!found) return refuse('tgActStale');
  const { user } = found;
  if (loginDenial(user) || user.mustChangePassword || user.relinkFree)
    return refuse('tgActNoRight');
  const today = bishkekDate(deps.clock.now());
  const ctxOf = { orgId: user.orgId, userId: user.userId };
  const key = { userId: user.userId, chatId: q.chatId, messageId: q.messageId };

  if (query.kind === 'refresh') {
    const fresh = await withOrgContext(deps.db, ctxOf, async (tx) => {
      const [access, { features }, w] = [
        await loadEmployeeAccess(tx, user.employeeId),
        await orgMenuSettings(tx, user.orgId),
        await lockTelegramWidget(tx, key),
      ];
      if (!w) return 'tgActStale' as const;
      if (!access || !features.telegram || !hasPermission(access.subject, 'repView')) {
        return 'tgActNoRight' as const;
      }
      const c = await widgetContent(tx, {
        employeeId: user.employeeId,
        today,
        now: deps.clock.now(),
        texts,
        version: nextVersion(w.data),
      });
      const data = JSON.stringify(c.data);
      await updateTelegramWidget(tx, user.userId, { items: c.ids, data });
      return data;
    });
    if (fresh === 'tgActStale' || fresh === 'tgActNoRight') return refuse(fresh);
    try {
      await tg.editWidgetData(q.chatId, q.messageId, fresh);
    } catch (err) {
      deps.logger.warn({ err, purpose: 'bot_widget' }, 'Telegram: данные виджета не обновлены');
    }
    return answer();
  }

  // Галочка «Сдан» — действие кнопки «Сдан» (задача Т2) со всеми его проверками.
  const action = botActionOf(deps, STAFF_BOT_ACTIONS.reportDone);
  const run = action?.run?.bind(action);
  if (!action || !run) return refuse('tgActStale');
  const target: BotPressTarget = {
    outboxId: '',
    userId: user.userId,
    orgId: user.orgId,
    employeeId: user.employeeId,
    login: '',
    orgName: user.orgName,
    message: { text: '' },
    linked: true,
    mustChangePassword: user.mustChangePassword,
    relinkFree: user.relinkFree,
    isPlatformAdmin: user.isPlatformAdmin,
    userBlocked: user.userBlocked,
    employeeActive: user.employeeActive,
    orgStatus: user.orgStatus,
    telegramActions: found.actions,
  };
  const denied = botTargetRefusal(target, action);
  if (denied) return refuse(denied);
  const pressTexts = await botPressTexts(deps);
  type Done = {
    note: string;
    data: string | null;
    ask: BotMessage | null;
    queued: string[];
  };
  let outcome: Done | { refusal: TelegramTemplateKey };
  try {
    outcome = await botUserContext(deps, target, async (tx) => {
      const w = await lockTelegramWidget(tx, key);
      const data = w && parseData(w.data);
      const id = w?.items[query.row];
      // Строка — из того списка, что сейчас в виджете: после «Обновить», утреннего обновления (даже если
      // Telegram правку не принял) номер списка другой, и строка могла указать на другой отчёт.
      if (!w || !data || !id || data.v !== query.version || data.r[query.row]?.[3] === 1)
        return { refusal: 'tgActStale' as const };
      const [access, { features }] = [
        await loadEmployeeAccess(tx, user.employeeId),
        await orgMenuSettings(tx, user.orgId),
      ];
      if (
        !features.telegram ||
        (action.permission && !(access && hasPermission(access.subject, action.permission)))
      ) {
        return { refusal: 'tgActNoRight' as const };
      }
      // Отчёт уже сдан (ответом файлом в чате, на сайте) — строка отмечается, действия нет.
      const status = await widgetReportStatus(tx, id);
      if (status !== null && !OPEN_REPORT_STATUSES.has(status as never)) {
        const next = JSON.stringify(widgetMarkDone(data, query.row));
        await updateTelegramWidget(tx, user.userId, { items: w.items, data: next });
        return { note: '', data: next, ask: null, queued: [] as string[] };
      }
      const label = rowLabel(data, query.row);
      const ctx: BotPressContext = {
        deps,
        user: botUserOf(target),
        chatId: q.chatId,
        arg: id,
        message: { text: label },
        button: { text: label, action: STAFF_BOT_ACTIONS.reportDone, arg: id },
        asUser: (fn) => fn(tx, access),
        ...pressTexts,
      };
      const result = await run(ctx);
      let ask: BotMessage | null = null;
      let note = result.reply ?? '';
      if (result.ask) {
        const wanted = result.ask;
        const open = await openBotAsks(tx, q.chatId, today);
        // Просьба о том же уже открыта — вторую не шлём; в виджете — та же строка «нужен файл».
        if (!open.some((x) => x.action === wanted.action && x.arg === id)) {
          ask = askBotMessage(
            wanted.text,
            { action: wanted.action, arg: id, kind: wanted.kind, day: today },
            await pressTexts.text('tgBtnCancel'),
          );
        }
        note = await pressTexts.text('tgWgFile', { отчёт: label });
      }
      let next: string | null = null;
      if (result.done) {
        next = JSON.stringify(widgetMarkDone(data, query.row));
        await updateTelegramWidget(tx, user.userId, { items: w.items, data: next });
        note = await pressTexts.text('tgWgDone', { отчёт: label });
      }
      const queued = [
        ...(result.queued ?? []),
        ...(result.events?.length ? await queueTelegramEvents(deps, tx, result.events) : []),
      ];
      return { note, data: next, ask, queued };
    });
  } catch (err) {
    if (err instanceof RecordChangedError || err instanceof RecordNotFoundError) {
      return refuse('tgActStale');
    }
    deps.logger.error({ err, purpose: 'bot_widget' }, 'Telegram: галочка виджета не выполнена');
    deps.errors?.capture(err);
    return refuse('tgActFailed');
  }
  if ('refusal' in outcome) return refuse(outcome.refusal);
  if (outcome.data) {
    try {
      await tg.editWidgetData(q.chatId, q.messageId, outcome.data);
    } catch (err) {
      deps.logger.warn({ err, purpose: 'bot_widget' }, 'Telegram: данные виджета не обновлены');
    }
  }
  await answer(outcome.note || undefined);
  const to = { userId: user.userId, chatId: q.chatId };
  if (outcome.ask) await sendBotMessage(deps, to, outcome.ask, 'bot_ask', 'bot_ask');
  await flushEvents(deps, user.orgId, outcome.queued);
}

/**
 * Утреннее обновление виджетов организации (задача расписания напоминаний, во «Время сводки»): виджеты,
 * присланные за последнюю неделю, получают свежий список без нового сообщения. Сотрудник ушёл, потерял
 * право, отвязал этот чат или Telegram выключен — виджет не обновляется.
 */
export async function refreshOrgWidgets(
  ctx: JobContext,
  orgId: string,
  day: IsoDate,
): Promise<number> {
  const tg = ctx.telegram;
  if (!tg) return 0;
  const texts = await widgetTexts(ctx);
  const edits = await withOrgContext(ctx.db, { orgId, kind: 'job' }, async (tx) => {
    const { features } = await orgMenuSettings(tx, orgId);
    if (!features.telegram) return [];
    const out: { chatId: number; messageId: number; data: string }[] = [];
    for (const w of await telegramWidgetsSince(tx, addDays(day, -BOT_WIDGET_REFRESH_DAYS))) {
      // Сотрудник действующий и этот чат всё ещё привязан к его учётной записи.
      const e = await widgetEmployee(tx, w.userId);
      if (!e || e.chatId !== w.chatId) continue;
      const access = await loadEmployeeAccess(tx, e.employeeId);
      if (!access || !hasPermission(access.subject, 'repView')) continue;
      const c = await widgetContent(tx, {
        employeeId: e.employeeId,
        today: day,
        now: ctx.clock.now(),
        texts,
        version: nextVersion(w.data),
      });
      const data = JSON.stringify(c.data);
      await updateTelegramWidget(tx, w.userId, { items: c.ids, data });
      out.push({ chatId: w.chatId, messageId: w.messageId, data });
    }
    return out;
  });
  for (const e of edits) {
    try {
      await tg.editWidgetData(e.chatId, e.messageId, e.data);
    } catch (err) {
      ctx.logger.warn({ err, purpose: 'bot_widget' }, 'Telegram: виджет не обновлён утром');
    }
  }
  return edits.length;
}
