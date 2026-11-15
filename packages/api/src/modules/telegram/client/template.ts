import { messageTemplates, type Db, type Tx } from '@buhuchet/db';
import { botTemplate, fillTemplate, type TelegramTemplateKey } from '@buhuchet/domain';

/**
 * Текст шаблона бота: справочник платформы, а пока шаблона там нет — текст по умолчанию. Внутри
 * транзакции — только с `tx` (второе соединение пула не занимается).
 */
export async function botTemplateText(
  db: Db | Tx,
  key: TelegramTemplateKey,
  values: Readonly<Record<string, string | number>> = {},
): Promise<string> {
  const templates = await messageTemplates(db);
  return fillTemplate(botTemplate(key, templates[key]), values);
}
