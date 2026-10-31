import {
  contextOrgName,
  messageTemplates,
  notifyTarget, telegramChat, telegramFeatureOn, type Tx } from '@buhuchet/db';
import {
  fillTemplate,
  formatText,
  notifyOn,
  TELEGRAM_TEMPLATE_DEFAULTS,
  withOrganization,
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
    'task_new' | 'task_on_confirm' | 'task_confirmed' | 'task_rework' | 'task_cancelled' | 'report_fix'
  >;
  /** Кому (сотрудник). */
  to: string;
  /** Кто сделал (сотрудник): себе сообщение не пишется. */
  by: string | null;
  template: TelegramTemplateKey;
  values: Readonly<Record<string, string | number>>;
  /** Куда ведёт ссылка: список задач или отчётов. */
  link: 'tasks' | 'reports';
}

const LINKS = { tasks: '/app/tasks/mine', reports: '/app/reports/all' } as const;

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
    const body = fillTemplate(templates[e.template] ?? TELEGRAM_TEMPLATE_DEFAULTS[e.template], e.values);
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
  return queueEvents(tx, messages);
}
