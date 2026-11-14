import { TOPIC_NAME_MAX } from '../platform-dicts/admin-system';
import type { TelegramTemplateKey } from './messages';
import type { OutboxKind } from './notify';

/*
 * Темы в чате с ботом (поток Т, задача Т7; пакет заказчика 13.11.2026, идея 6; прототип v104
 * `modules/tg-topics.js`). Режим тем включается для всего бота (в @BotFather), поэтому у нас он за
 * переключателем администратора платформы. Темы не меняют, кому и что приходит, — только в какую
 * папку чата.
 */

/** Темы по видам: «Отчёты», «Задачи», «Заявки» (у администратора платформы), «Безопасность». */
export const BOT_TOPICS = ['rep', 'task', 'lead', 'sec'] as const;
export type BotTopic = (typeof BOT_TOPICS)[number];

/** Шаблон названия темы («Справочники платформы» → «Шаблоны»). */
export const BOT_TOPIC_TEMPLATES: Record<BotTopic, TelegramTemplateKey> = {
  rep: 'tgTopicReports',
  task: 'tgTopicTasks',
  lead: 'tgTopicLeads',
  sec: 'tgTopicSecurity',
};

/**
 * Тема вида сообщения (прототип `tgIn` при сборке сообщений): отчёты, задачи, заявки, безопасность;
 * `null` — без темы («Общее»: рассылки, проверка бота, оповещения о сбоях). Ответ на команду и на
 * нажатие (`bot_cmd`, `bot_ask`) идёт в тему, где команду или кнопку нажали, — её знает вебхук.
 */
const KIND_TOPICS: Partial<Record<OutboxKind, BotTopic>> = {
  reminders: 'rep',
  report_fix: 'rep',
  nudge: 'rep',
  // Запрос клиента на подключение Telegram контрагента (поток К) — ответственному, в «Отчёты».
  cp_tg_request: 'rep',
  task_new: 'task',
  task_on_confirm: 'task',
  task_confirmed: 'task',
  task_rework: 'task',
  task_cancelled: 'task',
  task_started: 'task',
  task_done: 'task',
  lead: 'lead',
  code: 'sec',
  linked: 'sec',
  relinked: 'sec',
  unlinked: 'sec',
  pass_changed: 'sec',
  pass_reset: 'sec',
  login_locked: 'sec',
  relink_code: 'sec',
  page_closed: 'sec',
  not_me: 'sec',
};

export function botTopicOf(kind: string): BotTopic | null {
  return (KIND_TOPICS as Record<string, BotTopic | undefined>)[kind] ?? null;
}

/**
 * Ключ темы в чате: если чат привязан к учётным записям нескольких организаций, отчёты и задачи — в
 * тему своей организации (`org:<id>`), «Безопасность» и «Заявки» — общие.
 */
export function chatTopicKey(topic: BotTopic, o: { orgId: string | null; orgs: number }): string {
  if ((topic === 'rep' || topic === 'task') && o.orgId && o.orgs > 1) return `org:${o.orgId}`;
  return topic;
}

/** Организация темы `org:<id>`; у темы по виду — null. */
export function topicOrgId(key: string): string | null {
  return key.startsWith('org:') ? key.slice(4) || null : null;
}

/** Название темы для Telegram: шаблон или название организации, не длиннее 128 знаков. */
export function botTopicName(
  key: string,
  o: { templates: (key: TelegramTemplateKey) => string; orgName: string | null },
): string {
  const raw = topicOrgId(key)
    ? o.orgName || ''
    : o.templates(BOT_TOPIC_TEMPLATES[key as BotTopic] ?? 'tgTopicReports');
  const clean = raw.replace(/\s+/g, ' ').trim() || '—';
  if (clean.length <= TOPIC_NAME_MAX) return clean;
  let out = '';
  for (const ch of clean) {
    if (out.length + ch.length > TOPIC_NAME_MAX - 1) break;
    out += ch;
  }
  return `${out}…`;
}
