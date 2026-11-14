import type { OrgLegalForm } from '../org/legal-form';

/*
 * Документы заявки с лендинга (доработки 14.11.2026, блок 1): регистрация организации по выписке и
 * свидетельству. Файлы видит только администратор платформы; после «Одобрить» они переходят в «Файловый
 * менеджер» новой организации с источником «Заявка на подключение».
 */

/** Виды документов: ИП — «Свидетельство ГНС»; ОсОО — «Выписка» и «Свидетельство Минюста». */
export const LEAD_DOC_KINDS = ['gns_cert', 'extract', 'minjust_cert'] as const;
export type LeadDocKind = (typeof LEAD_DOC_KINDS)[number];

/** Какие документы обязательны для формы. */
export const LEAD_DOCS_BY_FORM: Readonly<Record<OrgLegalForm, readonly LeadDocKind[]>> = {
  ip: ['gns_cert'],
  osoo: ['extract', 'minjust_cert'],
};

/** Документ — только PDF, до 20 МБ (общий предел файлов платформы). */
export const LEAD_DOC_CONTENT_TYPE = 'application/pdf';

/** Одноразовая ссылка «Подключить Telegram» заявителя действует 24 часа. */
export const LEAD_TG_LINK_HOURS = 24;

/** Ссылка владельца «задать пароль» после «Одобрить» действует 7 дней. */
export const PASSWORD_SETUP_LINK_DAYS = 7;

/** Файлы отклонённой заявки удаляются через 7 дней после отказа, неразобранной — через 30 дней. */
export const LEAD_DOCS_KEEP_REJECTED_DAYS = 7;
export const LEAD_DOCS_KEEP_DAYS = 30;

/** Пределы данных, найденных в документах (заявитель правит их до отправки). */
export const LEAD_ADDRESS_MAX = 300;
export const LEAD_HEAD_MAX = 200;
