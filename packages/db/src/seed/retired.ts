import { and, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../client';
import { messageTemplateTexts, news, uiTexts } from '../schema';
import type { SeedOptions } from './platform';

/**
 * Что убрала новая версия прототипа, а наполнение прежней успело завести: наполнение только добавляет
 * и обновляет, поэтому с `--update` это удаляется здесь. Темы в чате с ботом убраны решением заказчика
 * 14.11.2026 (прототип v109, docs/decisions.md п. Т-10): новость «Версия 104», шаблоны названий тем,
 * тексты переключателя Админки и подписи шаблонов. Новость, которую правил администратор платформы
 * (`updated_by` задан), остаётся — это уже его запись; шаблоны и тексты нигде не используются.
 * Прототип v110 (пакет 14.11, блок 4) заменил кнопки «Скопировать реквизиты», «Реквизиты для налогов» и
 * «Реквизиты для обслуживания» кнопками по виду реквизита: их шаблоны и подписи убраны; пока сообщения
 * не перешли на новые кнопки, бот берёт прежние подписи из текстов по умолчанию (`TELEGRAM_TEMPLATE_DEFAULTS`).
 */
export const RETIRED = {
  news: ['v104'],
  messageTemplates: [
    'tgTopicReports',
    'tgTopicTasks',
    'tgTopicLeads',
    'tgTopicSecurity',
    'tgBtnCpReq',
    'tgBtnCpReqTax',
    'tgBtnCpReqFee',
  ],
  uiTexts: [
    'tgadm.view.topics',
    'tgadm.view.topics_hint',
    'tgadm.view.topics_ready',
    'tgadm.view.topics_ready_on',
    'tgadm.view.topics_ready_off',
    'tgadm.view.topics_ready_unknown',
    'tgadm.view.topics_on',
    'tgadm.view.topics_off',
    'pdicts.tpl.label.tg_topic_reports',
    'pdicts.tpl.label.tg_topic_tasks',
    'pdicts.tpl.label.tg_topic_leads',
    'pdicts.tpl.label.tg_topic_security',
    'pdicts.tpl.label.tg_btn_cp_req',
    'pdicts.tpl.label.tg_btn_cp_req_tax',
    'pdicts.tpl.label.tg_btn_cp_req_fee',
  ],
} as const;

/** Удалить убранное прототипом (только с `--update`); ответ — сколько строк удалено. */
export async function seedRemoveRetired(
  db: Db,
  options: SeedOptions,
): Promise<{ removed: number }> {
  if (!options.update) return { removed: 0 };
  const gone = [
    ...(await db
      .delete(news)
      .where(and(inArray(news.id, [...RETIRED.news]), isNull(news.updatedBy)))
      .returning({ id: news.id })),
    ...(await db
      .delete(messageTemplateTexts)
      .where(inArray(messageTemplateTexts.key, [...RETIRED.messageTemplates]))
      .returning({ id: messageTemplateTexts.key })),
    ...(await db
      .delete(uiTexts)
      .where(inArray(uiTexts.key, [...RETIRED.uiTexts]))
      .returning({ id: uiTexts.key })),
  ];
  return { removed: gone.length };
}
