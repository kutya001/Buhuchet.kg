/**
 * Файлы от контрагентов (доработки 14.11.2026, блок 2; прототип v112 `modules/cp-sent.js`): контрагент
 * отправляет файлы со своей страницы или из Telegram, у контрагента они лежат в «Отправленных файлах»
 * со статусом «Новый» → «Принят» или «Отклонён» (с причиной). Принятый становится обычным файлом
 * контрагента, непринятые удаляются через 30 дней после отправки вместе с файлом в хранилище.
 */
import { addDays, diffDays, type IsoDate } from '../common/dates';
import type { PageSection } from '../org/policy';
import { MEMORY_FULL_CONTRACTOR_MESSAGE } from '../subscriptions/memory';
import {
  cleanFileNote,
  fileExtension,
  FILE_MAX_BYTES,
  FILE_NAME_MAX_LENGTH,
  fileUploadProblem,
  type FileProblem,
} from './files';
import {
  SENT_FILE_COMMENT_MAX,
  SENT_FILE_KEEP_DAYS,
  SENT_FILE_REASON_MAX,
  SENT_FILES_PER_DAY,
  SENT_FILES_PER_SEND,
  type SentFileStatus,
} from './sent-files';

/** Отказы (тексты прототипа `pubUpDlg`, `sntRejectDlg`). `{n}` — число, `{files}` — имена файлов. */
export const SENT_FILE_MESSAGES = {
  sent_none: 'Выберите хотя бы один файл',
  sent_too_many: 'За раз можно отправить не больше 10 файлов',
  sent_too_large: 'Файл больше 20 МБ: {files}',
  sent_forbidden: 'Такие файлы не принимаются: {files}',
  sent_name_invalid: 'Неверное имя файла: {files}',
  sent_day_left: 'За сутки можно отправить не больше 20 файлов. Сегодня осталось: {n}',
  sent_day_limit: 'За сутки можно отправить не больше 20 файлов. Попробуйте завтра',
  sent_off: 'Ваш бухгалтер сейчас не принимает файлы через страницу',
  sent_reason_empty: 'Укажите причину',
  sent_reason_long: 'Причина длиннее 300 знаков',
  sent_decided: 'Файл уже принят или отклонён',
  // Память организации заполнена (доработки 20.11.2026, блок 2, пункт 5).
  sent_mem_full: MEMORY_FULL_CONTRACTOR_MESSAGE,
} as const;
export type SentFileProblem = keyof typeof SENT_FILE_MESSAGES;

/** Отказ с подстановками: какие файлы и сколько ещё можно. */
export interface SentFileRefusal {
  code: SentFileProblem;
  files?: string[];
  n?: number;
}

/**
 * Может ли контрагент отправлять файлы (прототип `sntUpOn`): страница включена и не закрыта, раздел
 * «Файлы» показан ему (`sections` — `pageVisibleSections`: функция «Файлы в карточках» включена, раздел
 * есть у организации и не скрыт у контрагента), галочки «Контрагент может отправлять файлы» в учётной
 * политике и у контрагента включены.
 */
export function sentUploadOn(o: {
  pageOpen: boolean;
  sections: readonly PageSection[];
  orgUpload: boolean;
  contractorUpload: boolean;
}): boolean {
  return o.pageOpen && o.sections.includes('files') && o.orgUpload && o.contractorUpload;
}

/** Текст отказа с подстановками. */
export function sentFileRefusalText(r: SentFileRefusal): string {
  return SENT_FILE_MESSAGES[r.code]
    .replace('{files}', (r.files ?? []).join(', '))
    .replace('{n}', String(r.n ?? 0));
}

/**
 * Документы с макросами от контрагента (со страницы по ссылке и из Telegram) не принимаются: макрос
 * выполняется у сотрудника, открывшего файл, а прислать файл может любой, кто знает ссылку и код.
 * Сотрудники такие файлы загружают сами, как прежде. Отсекаются форматы, у которых макрос виден по
 * расширению, и надстройки (`xlam`, `xla`, `ppam`, `ppa`); старые `.doc`, `.xls`, `.ppt` и их шаблоны
 * принимаются, как в прототипе: макрос в них по имени не отличить.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-10
export const SENT_BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'xla', 'pptm', 'potm', 'ppam', 'ppa', 'ppsm', 'sldm',
]); // prettier-ignore

/** Что не так с файлом от контрагента: как у любой загрузки, и ещё документы с макросами. */
function sentFileProblem(name: string): FileProblem | null {
  const problem = fileUploadProblem({ name, size: 0 });
  if (problem) return problem;
  return SENT_BLOCKED_EXTENSIONS.has(fileExtension(name.trim()) ?? '')
    ? 'file_type_forbidden'
    : null;
}

const BY_FILE: Partial<Record<FileProblem, SentFileProblem>> = {
  file_name_invalid: 'sent_name_invalid',
  file_type_forbidden: 'sent_forbidden',
  file_too_large: 'sent_too_large',
};

/**
 * Что мешает отправить файлы (порядок проверок — как в прототипе `pubUpDlg`): ни одного файла, больше 10
 * за раз, файл больше 20 МБ, запрещённый тип, лимит за сутки. `sentLastDay` — сколько файлов контрагент
 * уже отправил за последние 24 часа (со страницы и из Telegram).
 */
export function sentFilesSendRefusal(
  files: readonly { name: string; size: number }[],
  sentLastDay: number,
): SentFileRefusal | null {
  if (!files.length) return { code: 'sent_none' };
  if (files.length > SENT_FILES_PER_SEND) return { code: 'sent_too_many' };
  // Размер проверяется отдельно от имени и типа: «big.exe» больше 20 МБ — сначала «больше 20 МБ», как в прототипе.
  const problems = files.map((f) => ({
    name: f.name,
    p: f.size > FILE_MAX_BYTES ? 'file_too_large' : sentFileProblem(f.name),
  }));
  for (const p of ['file_name_invalid', 'file_too_large', 'file_type_forbidden'] as const) {
    const bad = problems.filter((x) => x.p === p).map((x) => x.name);
    if (bad.length) return { code: BY_FILE[p] ?? 'sent_forbidden', files: bad };
  }
  const left = Math.max(0, SENT_FILES_PER_DAY - sentLastDay);
  if (files.length > left)
    return left > 0 ? { code: 'sent_day_left', n: left } : { code: 'sent_day_limit' };
  return null;
}

/** Комментарий контрагента, как его хранят: одной строкой, не длиннее 300 знаков (прототип обрезает). */
export function sentFileNote(raw: string): string {
  return cleanFileNote(raw).slice(0, SENT_FILE_COMMENT_MAX);
}

/** Причина отказа: одной строкой, обязательна и не длиннее 300 знаков. */
export function sentFileReason(raw: string): { reason: string } | { problem: SentFileProblem } {
  const reason = cleanFileNote(raw);
  if (!reason) return { problem: 'sent_reason_empty' };
  if (reason.length > SENT_FILE_REASON_MAX) return { problem: 'sent_reason_long' };
  return { reason };
}

/**
 * Сколько дней осталось до удаления непринятого файла (прототип `sntLeft`): 30 минус прошедшие дни по
 * Бишкеку, не меньше нуля; у принятого — null (он не удаляется).
 */
export function sentFileDaysLeft(
  file: { status: SentFileStatus; sentDate: IsoDate },
  today: IsoDate,
): number | null {
  if (file.status === 'accepted') return null;
  return Math.max(0, SENT_FILE_KEEP_DAYS - diffDays(today, file.sentDate));
}

/**
 * Удаление через 30 дней (прототип `sntPurge`): непринятые файлы, отправленные в этот день по Бишкеку и
 * раньше, удаляются. Задача по расписанию удаляет строки с датой отправки не позже возвращённой.
 */
export function sentFilePurgeUpTo(today: IsoDate): IsoDate {
  return addDays(today, -SENT_FILE_KEEP_DAYS);
}

/**
 * Имя принятого файла среди файлов контрагента (прототип `sntAccept`): занятое имя получает « (2)»,
 * « (3)»… перед расширением. Имена сравниваются без учёта регистра (так их видит Windows).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-7
export function acceptedFileName(name: string, taken: Iterable<string>): string {
  const busy = new Set([...taken].map((n) => n.toLowerCase()));
  if (!busy.has(name.toLowerCase())) return name;
  const i = name.lastIndexOf('.');
  const [base, ext] = i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
  for (let k = 2; ; k++) {
    const tail = ` (${k})${ext}`;
    const next = base.slice(0, FILE_NAME_MAX_LENGTH - tail.length) + tail;
    if (!busy.has(next.toLowerCase())) return next;
  }
}
