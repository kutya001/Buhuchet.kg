import { describe, expect, it } from 'vitest';
import { messageTemplateMax, TOPIC_NAME_MAX } from '../platform-dicts/admin-system';
import { fillTemplate, TELEGRAM_TEMPLATE_DEFAULTS, type TelegramTemplateKey } from './messages';
import { OUTBOX_KINDS } from './notify';
import { botTopicName, botTopicOf, chatTopicKey, topicOrgId } from './topics';

const templates = (key: TelegramTemplateKey) => fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS[key], {});

describe('Темы в чате с ботом (прототип v104 tg-topics.js)', () => {
  it('вид сообщения → тема: отчёты, задачи, заявки, безопасность; рассылки и ответы — без темы', () => {
    expect(botTopicOf('reminders')).toBe('rep');
    expect(botTopicOf('report_fix')).toBe('rep');
    expect(botTopicOf('nudge')).toBe('rep');
    expect(botTopicOf('task_new')).toBe('task');
    expect(botTopicOf('task_done')).toBe('task');
    expect(botTopicOf('lead')).toBe('lead');
    for (const k of ['code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'not_me'] as const)
      expect(botTopicOf(k), k).toBe('sec');
    for (const k of ['broadcast', 'bot_test', 'bot_cmd', 'bot_ask', 'alert'] as const)
      expect(botTopicOf(k), k).toBeNull();
    expect(botTopicOf('unknown_kind')).toBeNull();
    // Каждый вид журнала разобран: тема или явное «без темы».
    expect(OUTBOX_KINDS.length).toBeGreaterThan(20);
  });

  it('чат нескольких организаций — тема на организацию для отчётов и задач; «Безопасность» общая', () => {
    expect(chatTopicKey('rep', { orgId: 'o1', orgs: 1 })).toBe('rep');
    expect(chatTopicKey('rep', { orgId: 'o1', orgs: 2 })).toBe('org:o1');
    expect(chatTopicKey('task', { orgId: 'o2', orgs: 2 })).toBe('org:o2');
    expect(chatTopicKey('sec', { orgId: 'o1', orgs: 2 })).toBe('sec');
    expect(chatTopicKey('lead', { orgId: null, orgs: 2 })).toBe('lead');
    expect(chatTopicKey('rep', { orgId: null, orgs: 2 })).toBe('rep');
    expect(topicOrgId('org:o1')).toBe('o1');
    expect(topicOrgId('rep')).toBeNull();
  });

  it('название темы — шаблон или название организации, до 128 знаков с многоточием', () => {
    expect(botTopicName('rep', { templates, orgName: null })).toBe('Отчёты');
    expect(botTopicName('sec', { templates, orgName: 'ОсОО «А»' })).toBe('Безопасность');
    expect(botTopicName('org:o1', { templates, orgName: '  ОсОО  «Бухгалтер Плюс» ' })).toBe(
      'ОсОО «Бухгалтер Плюс»',
    );
    const long = botTopicName('org:o1', { templates, orgName: 'Я'.repeat(300) });
    expect(long).toHaveLength(TOPIC_NAME_MAX);
    expect(long.endsWith('…')).toBe(true);
    expect(botTopicName('org:o1', { templates, orgName: '' })).toBe('—');
    expect(messageTemplateMax('tgTopicReports')).toBe(TOPIC_NAME_MAX);
  });
});
