import {
  contextOrgName,
  messageTemplates,
  notifyTarget,
  telegramChat,
  telegramFeatureOn,
  type Tx,
} from '@buhuchet/db';
import {
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
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { queueEvents } from './outbox';

/*
 * Сообщения о событиях задач и отчётов (ТЗ «Уведомления в Telegram»: новая задача, задача ждёт
 * подтверждения — постановщику, подтверждена или возвращена на доработку с причиной — исполнителю;
 * возврат отчёта «На исправление» — ответственному с причиной; прототип modules/tasks.js —
 * `taskDoneDlg`, `taskConfDlg`, `taskReworkDlg`, отмена задачи; ui/status-scale.js — «На исправление»).
 * Сообщение ставится в очередь в транзакции действия и сразу отправляется после неё (`flushEvents`).
 * Не пишется: себе, без привязанного Telegram, при выключенных «Напоминаниях в Telegram», без бота и
 * при отключённом у получателя переключателе («Ручные задачи» или «Регулярные задачи по отчётам»).
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
  if (!deps.telegram || !todo.length || !(await telegramFeatureOn(tx))) return [];
  const [templates, t, name] = await Promise.all([
    messageTemplates(deps.db),
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
