import { adminLeadById, type Tx } from '@buhuchet/db';
import type { ApiDeps } from '../../deps';

/*
 * Telegram заявителя (доработки 14.11.2026, блок 1; прототип v113 modules/tg-lead.js) — контракт
 * потока Т, договорённость 15.11.2026. ЗАГЛУШКА потока И с теми же подписями: настоящие функции делает
 * поток Т (ссылка на бота на сутки, «Старт» → «Заявка получена», привязка Telegram владельца, «Организация
 * создана» и ссылка для пароля, сообщение об отказе). При общей сборке этапа файл берётся из ветки
 * потока Т целиком.
 */

/** Ссылка «Подключить Telegram» на сутки; `linked` — заявитель уже подключил бота; null — бота нет. */
export type LeadTgLink = { url: string; token: string; expiresAt: Date } | { linked: true } | null;

/**
 * Ссылка на бота для только что отправленной заявки — в транзакции заявки. Ловушке (`leadId` null) —
 * такая же, но ненастоящая. Повтор с того же телефона получает ссылку заявки, только если браузер
 * принёс живой токен этой заявки (`prior`, cookie `bu_lead_tg`): чужой человек с тем же телефоном
 * Telegram первой заявки к себе не привяжет.
 */
export async function issueLeadTgLink(
  _tx: Tx,
  _p: {
    leadId: string | null;
    repeat: boolean;
    prior: string | null;
    now: Date;
    botUsername: string | undefined;
  },
): Promise<LeadTgLink> {
  return null;
}

/**
 * «Одобрить»: Telegram заявителя — Telegram владельца новой организации (в транзакции создания, после
 * `connectLeadToOrganization`). false — заявитель Telegram не подключил: «Одобрить» отказывает.
 */
export async function linkLeadOwnerTelegram(
  tx: Tx,
  p: { leadId: string; userId: string },
): Promise<boolean> {
  const lead = await adminLeadById(tx, p.leadId);
  return lead?.tgLinkedAt != null;
}

/** После «Одобрить»: владельцу — «Организация создана» и ссылка для пароля. Не бросает. */
export async function sendOwnerSetup(
  _deps: ApiDeps,
  _p: { userId: string; adminId: string },
): Promise<'sent' | 'no_telegram' | 'failed'> {
  return 'no_telegram';
}

/**
 * После «Отклонить» (после коммита транзакции отказа): заявителю — причина отказа в Telegram. `adminId` —
 * администратор платформы, который отклонил заявку: причину база отдаёт только ему. Не бросает.
 */
export async function sendLeadRefused(
  _deps: ApiDeps,
  _p: { leadId: string; adminId: string },
): Promise<'sent' | 'not_linked' | 'failed'> {
  return 'not_linked';
}
