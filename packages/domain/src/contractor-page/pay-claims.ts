/*
 * «Я оплатил» на странице контрагента и «Оплатил» в Telegram (доработки 14.11.2026, блоки 4 и 6): это
 * не онлайн-оплата, а сообщение клиента, что он перевёл деньги. «Оплачено» считается только по деньгам,
 * которые бухгалтер принял; до этого у месяца — «Ожидает подтверждения».
 */

/** Откуда сообщение: со страницы контрагента или кнопкой «Оплатил» в Telegram. */
export const PAY_CLAIM_SOURCES = ['page', 'telegram'] as const;
export type PayClaimSource = (typeof PAY_CLAIM_SOURCES)[number];

/** Что оплачено: налоги или обслуживание. */
export const PAY_CLAIM_PURPOSES = ['tax', 'fee'] as const;
export type PayClaimPurpose = (typeof PAY_CLAIM_PURPOSES)[number];

/** Ждёт подтверждения → деньги приняты или сообщение отклонено. */
export const PAY_CLAIM_STATUSES = ['wait', 'done', 'rejected'] as const;
export type PayClaimStatus = (typeof PAY_CLAIM_STATUSES)[number];

/** Комментарий клиента — до 300 знаков. */
export const PAY_CLAIM_COMMENT_MAX = 300;
