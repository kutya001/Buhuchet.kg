import type { RdKind } from '../contractors/regdocs';
import type { OrgLegalForm } from '../org/legal-form';
import { slugOf } from '../org/slug';
import type { LeadStatus } from './leads';

/*
 * Документы заявки с лендинга (доработки 14.11.2026, блок 1): регистрация организации по выписке и
 * свидетельству. Файлы видит только администратор платформы; после «Одобрить» они переходят в «Файловый
 * менеджер» новой организации с источником «Заявка на подключение».
 */

/** Виды документов: ИП — «Свидетельство ГНС»; ОсОО — «Выписка» и «Свидетельство Минюста». */
export const LEAD_DOC_KINDS = ['gns_cert', 'extract', 'minjust_cert'] as const;
export type LeadDocKind = (typeof LEAD_DOC_KINDS)[number];

/** Ключ словаря с названием документа (тексты лендинга прототипа v114: `land.f.doc.<вид>`). */
export const LEAD_DOC_TEXT_KEYS: Readonly<Record<LeadDocKind, string>> = {
  gns_cert: 'land.f.doc.gns',
  extract: 'land.f.doc.vyp',
  minjust_cert: 'land.f.doc.mj',
};

/** Какие документы обязательны для формы. */
export const LEAD_DOCS_BY_FORM: Readonly<Record<OrgLegalForm, readonly LeadDocKind[]>> = {
  ip: ['gns_cert'],
  osoo: ['extract', 'minjust_cert'],
};

/** Документ — только PDF, до 20 МБ (общий предел файлов платформы). */
export const LEAD_DOC_CONTENT_TYPE = 'application/pdf';

/** Файлы отклонённой заявки удаляются через 7 дней после отказа, неразобранной — через 30 дней. */
export const LEAD_DOCS_KEEP_REJECTED_DAYS = 7;
export const LEAD_DOCS_KEEP_DAYS = 30;

/** Пределы данных, найденных в документах (заявитель правит их до отправки). */
export const LEAD_ADDRESS_MAX = 300;
export const LEAD_HEAD_MAX = 200;

/*
 * Загрузка документов с лендинга (прототип v114 modules/lead-docs.js: ldDocErr, ldParse, ldCheck).
 * Документ кладётся в хранилище по подписанной ссылке до отправки заявки и сразу разбирается на сервере
 * тем же разбором, что «Из свидетельства и выписки» карточки контрагента, — без распознавания сканов
 * (ТЗ: «скан без текстового слоя — поля пустые и заполняются вручную»). Документы одной формы до
 * отправки связаны черновиком: номер черновика знает только браузер заявителя.
 */

/** Вид документа заявки по виду, который узнал разбор: свидетельство ИП, выписка, свидетельство Минюста. */
export const LEAD_DOC_OF_RD = {
  ipsv: 'gns_cert',
  vyp: 'extract',
  svid: 'minjust_cert',
} as const satisfies Record<RdKind, LeadDocKind>;

/** Предел PDF документа заявки — 20 МБ (решение заказчика 14.11.2026). */
export const LEAD_DOC_MAX_BYTES = 20 * 1024 * 1024;

/** Документов в черновике — не больше видов документов (новый файл того же вида заменяет прежний). */
export const LEAD_DRAFT_DOCS_MAX = LEAD_DOC_KINDS.length;

/** Черновик, который не стал заявкой, удаляется вместе с файлами через сутки. */
export const LEAD_DRAFT_HOURS = 24;

/** Начать загрузку документа: не больше 10 за час с одного адреса (у человека — 1–2 файла и повторы). */
export const LEAD_UPLOAD_LIMIT = 10;
/** Разобрать документ: не больше 20 за час с одного адреса и по одному одновременно. */
export const LEAD_READ_LIMIT = 20;
export const LEAD_READ_WINDOW_SECONDS = 3600;
/** Разбор одного документа на лендинге — не дольше 20 секунд (без распознавания сканов). */
export const LEAD_READ_TIMEOUT_MS = 20_000;

/** Что нашёл разбор документов формы (прототип `LD.found`): данные, ничего, документы разных организаций. */
export const LEAD_DOCS_FOUND = ['found', 'none', 'diff'] as const;
export type LeadDocsFound = (typeof LEAD_DOCS_FOUND)[number];

/** Поля формы, которые заполняются из документов (прототип `LD_REG`). */
export interface LeadDocValues {
  firm: string;
  inn: string;
  okpo: string;
  head: string;
  address: string;
}

const text = (v: string | number | undefined) => (v === undefined ? '' : String(v).trim());

/**
 * Итог разбора документов формы для лендинга (прототип ldParse): из итога `rdToCp` — название, ИНН,
 * ОКПО, руководитель и юридический адрес; документы разных организаций — `diff` без данных; ничего не
 * нашлось — `none`.
 */
export function leadDocValues(
  out: { err: string } | { err: null; res: { v: Partial<Record<string, string | number>> } } | null,
): { found: LeadDocsFound; values: LeadDocValues } {
  const v = out && out.err === null ? out.res.v : {};
  const values: LeadDocValues = {
    firm: text(v.name),
    inn: text(v.inn),
    okpo: text(v.okpo),
    head: text(v.head),
    address: text(v.addr),
  };
  if (out?.err === 'diff') {
    return { found: 'diff', values: { firm: '', inn: '', okpo: '', head: '', address: '' } };
  }
  return { found: Object.values(values).some(Boolean) ? 'found' : 'none', values };
}

/** Каких документов формы не хватает (прототип ldCheck): по порядку формы. */
export function leadDocsMissing(form: OrgLegalForm, kinds: readonly LeadDocKind[]): LeadDocKind[] {
  return LEAD_DOCS_BY_FORM[form].filter((k) => !kinds.includes(k));
}

/** ИНН организации — 14 цифр (прототип ldCheck: `land.e.inn`). */
export const LEAD_INN_PATTERN = /^[0-9]{14}$/;

/*
 * «Одобрить» (прототип v114 ldApproveWhy, ldApproveDlg): заявка с документами становится организацией и
 * её владельцем; неактивна с причиной.
 */

/** Почему «Одобрить» неактивна — по порядку проверок прототипа. */
export const LEAD_APPROVE_REFUSALS = [
  'lead_org_exists',
  'lead_rejected',
  'lead_no_telegram',
  'lead_docs_gone',
  'lead_docs_pending',
  'lead_inn_invalid',
  'lead_inn_taken',
] as const;
export type LeadApproveRefusal = (typeof LEAD_APPROVE_REFUSALS)[number];

export interface LeadApproveState {
  hasOrg: boolean;
  status: LeadStatus;
  /** Заявитель подключил Telegram (нажал «Старт» в боте). */
  tgLinked: boolean;
  /** Состояние документов: загружены, ещё копируются, удалены по сроку (null). */
  docsState: 'ready' | 'pending' | null;
  inn: string | null;
  /** Организация с этим ИНН уже есть на платформе. */
  innTaken: boolean;
}

export function leadApproveRefusal(s: LeadApproveState): LeadApproveRefusal | null {
  if (s.hasOrg) return 'lead_org_exists';
  if (s.status === 'rejected') return 'lead_rejected';
  if (!s.tgLinked) return 'lead_no_telegram';
  if (s.docsState === null) return 'lead_docs_gone';
  if (s.docsState !== 'ready') return 'lead_docs_pending';
  if (!s.inn || !LEAD_INN_PATTERN.test(s.inn)) return 'lead_inn_invalid';
  if (s.innTaken) return 'lead_inn_taken';
  return null;
}

/** Тексты причин и отказов «Одобрить» (сервер и экран берут один текст; `{inn}`, `{name}`). */
export const LEAD_APPROVE_MESSAGES: Record<
  LeadApproveRefusal | 'lead_has_docs' | 'lead_no_docs',
  string
> = {
  lead_org_exists: 'По заявке уже создана организация',
  lead_rejected: 'Заявка отклонена: сначала снимите «Отказ»',
  lead_no_telegram: 'Заявитель ещё не подключил Telegram',
  lead_docs_gone: 'Файлы заявки удалены: срок хранения истёк',
  lead_docs_pending: 'Документы заявки не загрузились',
  lead_inn_invalid: 'ИНН — 14 цифр',
  lead_inn_taken: 'Организация с ИНН {inn} уже есть на платформе: «{name}»',
  lead_has_docs: 'У заявки с документами организацию создаёт «Одобрить»',
  lead_no_docs: 'У заявки без документов организацию создаёт «Создать организацию»',
};

/** Тексты отказов загрузки и чтения документа формы заявки (сервер и экран берут один текст). */
export const LEAD_UPLOAD_MESSAGES = {
  lead_upload_limit: 'Слишком много загрузок за час. Попробуйте позже',
  lead_read_busy: 'Документ ещё читается',
  lead_read_limit: 'Слишком много документов за час. Попробуйте позже',
  lead_upload_missing: 'Файл не загрузился. Попробуйте ещё раз',
} as const;

/** Длина логина, который подставляется в окне «Одобрить» (прототип ldLoginOf: 24 знака). */
const LEAD_LOGIN_BASE_MAX = 24;

/**
 * Логин владельца в окне «Одобрить» (прототип ldLoginOf): латиницей по имени заявителя (нет — по
 * фирме, иначе `owner`), дефисы — точками; занятый — с номером: `nurlan.kasymov2`.
 */
export function leadOwnerLogin(
  name: string,
  firm: string,
  taken: (login: string) => boolean,
): string {
  const base = leadOwnerLoginBase(name, firm);
  let login = base;
  for (let n = 2; taken(login) && n < 1000; n++) login = `${base}${n}`;
  return login;
}

/** Основа логина владельца без номера (прототип ldLoginOf): по ней сервер ищет занятые логины. */
export function leadOwnerLoginBase(name: string, firm: string): string {
  return (
    (slugOf(name || firm || 'owner') || 'owner')
      .replace(/-+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, LEAD_LOGIN_BASE_MAX)
      .replace(/\.+$/, '') || 'owner'
  );
}
