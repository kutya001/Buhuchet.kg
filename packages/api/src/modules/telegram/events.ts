import {
  contextOrgName,
  messageTemplates,
  notifyTarget,
  telegramChat,
  telegramFeatureOn,
  type Tx,
} from '@buhuchet/db';
import {
  bellTaskText,
  bellText,
  botMessageProblem,
  botPlainText,
  botTitleLine,
  fillTemplate,
  formatText,
  notifyOn,
  TELEGRAM_TEMPLATE_DEFAULTS,
  withOrganization,
  type BotMessage,
  type OutboxKind,
  type TelegramTemplateKey,
  type Translate,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { putBell, type BellPut } from './bell';
import { queueEvents } from './outbox';

/*
 * Сообщения о событиях задач и отчётов (ТЗ «Уведомления в Telegram»: новая задача, задача ждёт
 * подтверждения — постановщику, подтверждена или возвращена на доработку с причиной — исполнителю;
 * возврат отчёта «На исправление» — ответственному с причиной; прототип modules/tasks.js —
 * `taskDoneDlg`, `taskConfDlg`, `taskReworkDlg`, отмена задачи; ui/status-scale.js — «На исправление»).
 * Сообщение ставится в очередь в транзакции действия и сразу отправляется после неё (`flushEvents`).
 * Не пишется: себе, без привязанного Telegram, при выключенных «Напоминаниях в Telegram», без бота и
 * при отключённом у получателя переключателе («Ручные задачи» или «Возврат моих отчётов на исправление»).
 *
 * Колокольчик (доработки 16.11.2026, блок 3): то же событие — строкой в колокольчик получателя по тем же
 * правилам (не себе, переключатели профиля), но и без привязанного Telegram, без бота и при выключенных
 * «Напоминаниях в Telegram»; в той же транзакции действия.
 */

export interface TelegramEvent {
  kind: Extract<
    OutboxKind,
    | 'task_new'
    | 'task_on_confirm'
    | 'task_confirmed'
    | 'task_rework'
    | 'task_cancelled'
    | 'report_fix'
    | 'task_started'
    | 'task_done'
  >;
  /** Кому (сотрудник). */
  to: string;
  /** Кто сделал (сотрудник): себе сообщение не пишется. */
  by: string | null;
  template: TelegramTemplateKey;
  values: Readonly<Record<string, string | number>>;
  /** Первая строка сообщения: название задачи (в шаблоне «Новой задачи» его нет, прототип v97). */
  heading?: string;
  /**
   * Сообщение с кнопками (поток Т, задача Т2): из заполненного шаблона — описание сообщения. Ссылка
   * «Открыть в Buhuchet.kg» в таком сообщении не дописывается: её заменяет кнопка «Открыть».
   */
  view?: (body: string) => BotMessage;
  /** Куда ведёт ссылка: список задач или отчётов. */
  link: 'tasks' | 'reports';
  /**
   * Строка колокольчика (доработки 16.11.2026, блок 3): задача или отчёт, его контрагент, название
   * (задачи — целиком, отчёта — вид и период без контрагента) и причина возврата.
   */
  bell?: {
    target: { kind: 'task' | 'report'; id: string };
    contractorId: string | null;
    subject: string;
    reason?: string | null;
  };
}

const LINKS = { tasks: '/app/tasks/mine', reports: '/app/reports/all' } as const;

/** Организация (один Telegram на несколько логинов) — первой строкой: в заголовке или в тексте. */
const viewOf = (view: BotMessage, org: string | null, shared: boolean): BotMessage =>
  view.heading
    ? { ...view, heading: withOrganization(view.heading, org, shared) }
    : { ...view, text: withOrganization(view.text ?? '', org, shared) };

/** Поставить сообщения о событиях в очередь в транзакции действия; номера строк — для `flushEvents`. */
export async function queueTelegramEvents(
  deps: ApiDeps,
  tx: Tx,
  events: readonly TelegramEvent[],
): Promise<string[]> {
  const todo = events.filter((e) => e.to !== e.by);
  await bellEvents(deps, tx, todo);
  if (!deps.telegram || !todo.length || !(await telegramFeatureOn(tx))) return [];
  const [templates, t, name] = await Promise.all([
    // Шаблоны — тем же соединением, что и действие: запрос к пулу внутри транзакции ждал бы
    // свободное соединение, а его может не быть (все заняты такими же транзакциями).
    messageTemplates(tx),
    serverTexts(deps),
    contextOrgName(tx),
  ]);
  const messages = [];
  for (const e of todo) {
    const target = await notifyTarget(tx, e.to);
    if (!target?.chatId) continue;
    const kind = e.kind === 'report_fix' ? 'regtasks' : 'tasks';
    if (!notifyOn(target.settings, target.boss, kind)) continue;
    const chat = await telegramChat(tx, target.userId);
    if (!chat) continue;
    const template = templates[e.template] ?? TELEGRAM_TEMPLATE_DEFAULTS[e.template];
    const filled = fillTemplate(template, e.values);
    // Сообщение с кнопками; не собралось (подпись кнопки в шаблоне длиннее предела) — обычным текстом:
    // действие сайта из-за вида сообщения не срывается.
    const message = e.view ? viewOf(e.view(filled), name, chat.shared) : null;
    const problem = message && botMessageProblem(message);
    if (problem) deps.logger.warn({ kind: e.kind, problem }, 'Telegram: сообщение без кнопок');
    if (message && !problem) {
      messages.push({
        userId: target.userId,
        chatId: chat.chatId,
        kind: e.kind,
        text: botPlainText(message),
        message,
      });
      continue;
    }
    // Название не повторяется, если администратор платформы оставил его в тексте шаблона.
    const heading = e.heading && !template.includes('{задача}') ? botTitleLine(e.heading) : '';
    const body = heading ? `${heading}\n${filled}` : filled;
    const link = formatText(t('telegram.open'), {
      link: new URL(LINKS[e.link], deps.config.APP_BASE_URL).href,
    });
    messages.push({
      userId: target.userId,
      chatId: chat.chatId,
      kind: e.kind,
      text: withOrganization(`${body}\n\n${link}`, name, chat.shared),
    });
  }
  return queueEvents(tx, messages, deps.clock.now());
}

/** Фраза строки колокольчика о событии задачи или отчёта. */
function bellEventText(e: TelegramEvent, bell: NonNullable<TelegramEvent['bell']>, tr: Translate) {
  if (e.kind === 'report_fix') {
    const head = tr('bell.line.report_fix', { report: bell.subject });
    return bellText(bell.reason ? head + tr('bell.line.reason', { reason: bell.reason }) : head);
  }
  return bellTaskText(e.kind, bell.subject, bell.reason ?? null, tr);
}

/**
 * Строки колокольчика о событиях: получатель действует и не заблокирован (`notifyTarget`), переключатель
 * профиля включён — как у сообщения Telegram, но без условий про бот, привязку и «Напоминания в Telegram».
 * Ключ — событие, запись и момент: два возврата одной задачи — две строки.
 */
async function bellEvents(deps: ApiDeps, tx: Tx, events: readonly TelegramEvent[]) {
  const list = events.filter((e) => e.bell);
  if (!list.length) return;
  const t = await serverTexts(deps);
  const tr: Translate = (key, params) => formatText(t(key), params);
  const now = deps.clock.now();
  const rows: BellPut[] = [];
  for (const [n, e] of list.entries()) {
    const bell = e.bell!;
    const target = await notifyTarget(tx, e.to);
    if (!target) continue;
    const kind = e.kind === 'report_fix' ? 'regtasks' : 'tasks';
    if (!notifyOn(target.settings, target.boss, kind)) continue;
    rows.push({
      userId: target.userId,
      kind: e.kind === 'report_fix' ? 'reports' : 'tasks',
      event: e.kind,
      target: bell.target,
      // Отчёт с причиной возврата — только пока есть «Просматривать отчёты» (ТЗ, блок 3: права сейчас).
      need: e.kind === 'report_fix' ? 'repView' : null,
      contractorId: bell.contractorId,
      text: bellEventText(e, bell, tr),
      eventKey: `${e.kind}:${bell.target.id}:${now.getTime().toString(36)}.${n}`,
    });
  }
  await putBell(tx, rows, now);
}

/** Строка колокольчика о задаче: название целиком, контрагент задачи, причина возврата. */
export function taskBell(
  task: { id: string; title: string; contractor: { id: string } | null },
  reason?: string | null,
): NonNullable<TelegramEvent['bell']> {
  return {
    target: { kind: 'task', id: task.id },
    contractorId: task.contractor?.id ?? null,
    subject: task.title,
    reason: reason || null,
  };
}

/** Строка колокольчика о возврате отчёта: вид и период (контрагента панель показывает сама). */
export function reportBell(
  id: string,
  item: { type: string; period: string; contractorId: string },
  reason: string,
): NonNullable<TelegramEvent['bell']> {
  return {
    target: { kind: 'report', id },
    contractorId: item.contractorId,
    subject: `${item.type} ${item.period}`,
    reason,
  };
}
