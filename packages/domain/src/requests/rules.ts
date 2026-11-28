/**
 * Запросы пользователей администратору платформы (доработки 28.11.2026: запросы пользователей
 * администратору; прототип v169 modules/requests.js: `REQ_KINDS`, `REQ_CLOSED`, `RQF`, `reqFidOf`,
 * `reqSees`, `reqUnread`, `reqStText`, `reqClip`, `reqForm`, `reqSay`, `reqSetSt`). Здесь — правила
 * без базы: виды и статусы, переходы, кто видит, пределы, формы и тема, очистка «Где».
 */
import { diffDays, type IsoDate } from '../common/dates';

/** Вид запроса: «Вопрос», «Ошибка», «Опечатка», «Добавить в справочник» (блок 1). */
export const REQUEST_KINDS = ['q', 'bug', 'typo', 'dict'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/**
 * Статус: «Новый» → «В работе» → «Решён» / «Добавлено»; «Отклонён» и «Отозван» — конечные вне шкалы
 * (блок 4, пункт 1). Прежний «Отклонено» — тот же код `rejected`, на экране «Отклонён».
 */
export const REQUEST_STATUSES = [
  'new',
  'in_work',
  'solved',
  'added',
  'rejected',
  'withdrawn',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Закрытые статусы (прототип `REQ_CLOSED`). */
export const REQUEST_CLOSED: ReadonlySet<RequestStatus> = new Set([
  'solved',
  'added',
  'rejected',
  'withdrawn',
]);

/** Шкала статуса в карточке: «Отклонён» и «Отозван» — вне шкалы (прототип `reqSteps`). */
export const REQUEST_SCALE: readonly RequestStatus[] = ['new', 'in_work', 'solved'];
export const REQUEST_SCALE_DICT: readonly RequestStatus[] = ['new', 'in_work', 'added'];

/** Пределы (блок 1, пункт 4; блок 2, пункт 4; блок 4, пункт 3). */
export const REQUEST_LIMITS = {
  /** Запросов за час на организацию, всех видов вместе. */
  perHour: 20,
  /** Сообщений переписки за час на организацию (без сообщений администратора и смен статуса). */
  messagesPerHour: 60,
  /** Знаков в сообщении и в поле-абзаце формы. */
  text: 4000,
  /** Снимков к запросу или сообщению; размер одного — в мегабайтах. */
  shots: 3,
  shotMb: 5,
  /** Дней после закрытия, когда автор ещё может ответить и вернуть запрос «В работу». */
  reopenDays: 30,
  /** Первый номер запроса: номера сквозные по платформе, с 1201. */
  firstNo: 1201,
} as const;

/** Текст поля «Тема» вопроса, однострочного поля формы справочника, «Как написано» опечатки. */
export const REQUEST_TOPIC_MAX = 200;
export const REQUEST_LINE_MAX = 300;
export const REQUEST_TYPO_MAX = 500;

/* ───────────── Статус, переходы, кто видит ───────────── */

export const requestOpen = (status: RequestStatus) => !REQUEST_CLOSED.has(status);

/**
 * Кто видит запрос в организации (блок 4, пункт 4; прототип `reqSees`): «Добавить в справочник» —
 * все, кто видит модуль «Справочники»; «Вопрос», «Ошибка», «Опечатка» — автор и владелец.
 * Прототип показывает «Добавить в справочник» всем в организации; здесь — строже, по ТЗ.
 */
export function requestVisible(
  request: { kind: RequestKind; authorId: string },
  viewer: { userId: string; owner: boolean; seesDicts: boolean },
): boolean {
  if (request.kind === 'dict') return viewer.seesDicts || viewer.owner;
  return request.authorId === viewer.userId || viewer.owner;
}

/** Кто может отправить запрос вида (блок 1, пункт 2): «Добавить в справочник» — кто видит «Справочники». */
export const requestCanSend = (kind: RequestKind, viewer: { owner: boolean; seesDicts: boolean }) =>
  kind !== 'dict' || viewer.owner || viewer.seesDicts;

/** «Отозвать запрос» — только автор и только пока запрос «Новый» (блок 4, пункт 1). */
export const requestCanWithdraw = (status: RequestStatus, isAuthor: boolean) =>
  isAuthor && status === 'new';

/**
 * Что будет с сообщением организации (прототип `reqSay`, блок 4, пункт 3): открытый запрос — просто
 * сообщение; закрытый не дольше 30 дней (кроме «Отозван») — вернуть «В работу»; иначе — закрыт.
 */
export function requestReplyEffect(
  status: RequestStatus,
  closedAt: IsoDate | null,
  today: IsoDate,
): 'post' | 'reopen' | 'closed' {
  if (requestOpen(status)) return 'post';
  if (status === 'withdrawn') return 'closed';
  return diffDays(today, closedAt ?? today) > REQUEST_LIMITS.reopenDays ? 'closed' : 'reopen';
}

/** Сообщение администратора: ответ, вопрос автору («Ждёт вашего ответа»). Заметка — отдельно. */
export type RequestAdminSay = 'msg' | 'ask';

/** Переходы, которые делает администратор платформы (прототип `reqTake`, `reqClose`). */
export type RequestAdminAction = 'take' | 'solve' | 'add' | 'reject';

/**
 * Статус после действия администратора (прототип `reqCard`, `reqTake`, `reqClose`); null — действие
 * недоступно. Всё — только у открытого запроса. «Взять в работу» у запроса «В работе» статус не меняет
 * (меняется «Ведёт»). «Добавлено» — только у «Добавить в справочник», «Решён» — у остальных.
 */
export function requestAdminNext(
  status: RequestStatus,
  kind: RequestKind,
  action: RequestAdminAction,
): RequestStatus | null {
  if (!requestOpen(status)) return null;
  switch (action) {
    case 'take':
      return 'in_work';
    case 'solve':
      return kind !== 'dict' ? 'solved' : null;
    case 'add':
      return kind === 'dict' ? 'added' : null;
    case 'reject':
      return 'rejected';
  }
}

/** «Ждёт вашего ответа» видит только автор; остальные — «Ждёт ответа автора» (прототип `reqStText`). */
export function requestStatusLabel(
  status: RequestStatus,
  wait: boolean,
  viewerIsAuthor: boolean,
): 'wait_you' | 'wait_author' | RequestStatus {
  if (status === 'in_work' && wait) return viewerIsAuthor ? 'wait_you' : 'wait_author';
  return status;
}

/** Сообщение ленты для отметки «непрочитано»: кто написал и что это. */
export interface RequestFeedItem {
  /** Номер сообщения в запросе: 1, 2, … */
  n: number;
  byAdmin: boolean;
  kind: 'msg' | 'ask' | 'st';
  /** У смены статуса — на какой. */
  to?: RequestStatus;
}

/**
 * Есть ли непрочитанное (прототип `reqUnread`): у автора — ответ или решение администратора после
 * последнего прочитанного (кроме «Взят в работу»); у администратора — сообщение организации.
 */
export function requestUnread(
  feed: readonly RequestFeedItem[],
  readUpTo: number,
  side: 'author' | 'admin',
): boolean {
  return feed.some((x) => {
    if (x.n <= readUpTo) return false;
    if (side === 'admin') return !x.byAdmin;
    return x.byAdmin && !(x.kind === 'st' && x.to === 'in_work');
  });
}

/** «Не больше 20 запросов за час»: можно ли отправить ещё один (счёт ведёт сервер). */
export const requestHourOk = (sentLastHour: number) => sentLastHour < REQUEST_LIMITS.perHour;
export const requestMessageHourOk = (sentLastHour: number) =>
  sentLastHour < REQUEST_LIMITS.messagesPerHour;

/* ───────────── Формы ───────────── */

/** Форма справочника (прототип `RQF`): у каждого справочника свои поля (блок 3). */
export const REQUEST_DICT_FORMS = [
  'type',
  'tax',
  'ben',
  'base',
  'gked',
  'ugns',
  'organ',
  'bank',
  'cat',
  'reason',
  'dm',
  'other',
] as const;
export type RequestDictForm = (typeof REQUEST_DICT_FORMS)[number];

export type RequestFieldType = 'text' | 'area' | 'sel' | 'organ' | 'date' | 'dictsel';
export interface RequestField {
  key: string;
  type: RequestFieldType;
  required?: boolean;
  /** Значения выбора у `sel`: пустое — «—». */
  options?: readonly string[];
}

const ACT = ['', 'Сдача', 'Уплата', 'Сдача + уплата'] as const;
const PER = ['', 'Ежемесячно', 'Ежеквартально', 'Раз в полгода', 'Ежегодно', 'Разово'] as const;
const f = (
  key: string,
  type: RequestFieldType = 'text',
  required = false,
  options?: readonly string[],
) =>
  ({
    key,
    type,
    ...(required ? { required } : {}),
    ...(options ? { options } : {}),
  }) as RequestField;

/** Поля форм — как в прототипе; подписи — словарь `rq.f.<форма>.<поле>`. */
export const REQUEST_FORM_FIELDS: Readonly<Record<RequestDictForm, readonly RequestField[]>> = {
  type: [
    f('name', 'text', true),
    f('organ', 'organ'),
    f('code'),
    f('act', 'sel', false, ACT),
    f('per', 'sel', false, PER),
    f('due'),
    f('who'),
    f('law'),
  ],
  tax: [f('name', 'text', true), f('rate'), f('who'), f('from', 'date'), f('law')],
  ben: [f('name', 'text', true), f('what', 'area'), f('law')],
  base: [f('name', 'text', true), f('reps', 'area')],
  gked: [f('code', 'text', true), f('name')],
  ugns: [f('name', 'text', true), f('code'), f('area')],
  organ: [f('name', 'text', true), f('code'), f('area')],
  bank: [
    f('name', 'text', true),
    f('bik'),
    f('type', 'sel', false, ['', 'Банк', 'Электронный кошелёк']),
  ],
  cat: [f('name', 'text', true)],
  reason: [f('name', 'text', true)],
  dm: [f('name', 'text', true), f('cols', 'area')],
  other: [f('dict', 'dictsel', true), f('name', 'text', true)],
};

/** Название справочника формы — как в прототипе (`RQF[fid].dict`); у «Другое» — из поля «Справочник». */
export const REQUEST_FORM_DICT: Readonly<Record<RequestDictForm, string>> = {
  type: 'Виды отчётов',
  tax: 'Налоги и ставки',
  ben: 'Налоговые льготы и особые статусы',
  base: 'Основания для отчётов',
  gked: 'ГКЭД',
  ugns: 'Налоговые органы (УГНС)',
  organ: 'Органы',
  bank: 'Банковские провайдеры',
  cat: 'Категории задач',
  reason: 'Причины изменения срока',
  dm: 'Витрина данных',
  other: '',
};

/**
 * Форма у прежнего запроса «Попросить добавить» по коду справочника продукта (перенос миграции 0178 и
 * `createDictRequest` до этапа 2): как `reqFidOf` по названию справочника — «Налоговые режимы» идут в
 * «Налог или ставка», «Формы собственности» — в «Другое» с названием справочника.
 */
export const REQUEST_FORM_OF_DICT = {
  types: 'type',
  regimes: 'tax',
  forms: 'other',
  organs: 'organ',
  benefits: 'ben',
  banks: 'bank',
  cats: 'cat',
  reasons: 'reason',
  ugns: 'ugns',
  bases: 'base',
  dm: 'dm',
} as const satisfies Record<string, RequestDictForm>;

/** Название справочника у «Другое» прежнего запроса (поле формы `dict`). */
export const REQUEST_OTHER_DICT_TITLE: Readonly<Record<string, string>> = {
  forms: 'Формы собственности',
};

/** Справочник прежнего запроса по названию → форма (прототип `reqFidOf`). */
export function requestFormOf(dictTitle: string | null | undefined): RequestDictForm {
  const t = String(dictTitle ?? '');
  if (/УГНС|Налоговые органы/.test(t)) return 'ugns';
  if (/Льгот|особ.. статус/i.test(t)) return 'ben';
  if (/Виды отчётов|Вид отчёта/i.test(t)) return 'type';
  if (/Основани/.test(t)) return 'base';
  if (/ГКЭД/.test(t)) return 'gked';
  if (/^Органы|^Орган$/.test(t)) return 'organ';
  if (/Банк|БИК/i.test(t)) return 'bank';
  if (/Категори/.test(t)) return 'cat';
  if (/Причин/.test(t)) return 'reason';
  if (/Витрин/.test(t)) return 'dm';
  if (/Налог|ставк/i.test(t)) return 'tax';
  return 'other';
}

/** Сжать пробелы и обрезать с «…» (прототип `reqClip`). */
export function requestClip(text: string | null | undefined, max = 80): string {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Что отправлено формой: значения полей, обрезанные по краям; пустые поля не хранятся. */
export type RequestFormValues = Readonly<Record<string, string>>;

export type RequestFormProblem =
  'empty' | 'too_long' | 'bad_option' | 'bad_date' | 'unknown_field' | 'bad_form';

/**
 * Проверка формы на сервере (прототип `reqForm` → «Отправить запрос»): обязательные поля, длины,
 * выбор из списка, дата; лишних полей нет. Пусто — можно отправить.
 */
export function requestFormProblems(
  kind: RequestKind,
  form: RequestFormValues,
  dictForm: RequestDictForm | null,
): Record<string, RequestFormProblem> {
  const out: Record<string, RequestFormProblem> = {};
  const fields: {
    key: string;
    type: RequestFieldType;
    required?: boolean;
    max: number;
    options?: readonly string[];
  }[] =
    kind === 'q'
      ? [
          { key: 'topic', type: 'text', required: true, max: REQUEST_TOPIC_MAX },
          { key: 'text', type: 'area', required: true, max: REQUEST_LIMITS.text },
        ]
      : kind === 'bug'
        ? [
            { key: 'what', type: 'area', required: true, max: REQUEST_LIMITS.text },
            { key: 'exp', type: 'area', max: REQUEST_LIMITS.text },
          ]
        : kind === 'typo'
          ? [
              { key: 'was', type: 'area', required: true, max: REQUEST_TYPO_MAX },
              { key: 'right', type: 'area', max: REQUEST_TYPO_MAX },
            ]
          : dictForm && REQUEST_DICT_FORMS.includes(dictForm)
            ? [
                ...REQUEST_FORM_FIELDS[dictForm].map((x) => ({
                  ...x,
                  max: x.type === 'area' ? REQUEST_LIMITS.text : REQUEST_LINE_MAX,
                })),
                { key: 'note', type: 'area' as const, max: REQUEST_LIMITS.text },
              ]
            : [];
  if (kind === 'dict' && fields.length === 0) return { form: 'bad_form' };
  if (kind !== 'dict' && dictForm) out.form = 'bad_form';
  const known = new Set(fields.map((x) => x.key));
  for (const key of Object.keys(form)) if (!known.has(key)) out[key] = 'unknown_field';
  for (const x of fields) {
    const v = (form[x.key] ?? '').trim();
    if (!v) {
      if (x.required) out[x.key] = 'empty';
      continue;
    }
    if (v.length > x.max) out[x.key] = 'too_long';
    else if (x.type === 'sel' && !x.options?.includes(v)) out[x.key] = 'bad_option';
    else if (x.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) out[x.key] = 'bad_date';
  }
  return out;
}

/** Тема запроса (прототип `reqForm`): у вопроса — своя, у ошибки — начало «Что случилось», у опечатки — «…» в кавычках. */
export function requestTopic(
  kind: RequestKind,
  form: RequestFormValues,
  dictForm: RequestDictForm | null,
): string {
  const v = (k: string) => (form[k] ?? '').trim();
  if (kind === 'q') return v('topic');
  if (kind === 'bug') return requestClip(v('what'), 90);
  if (kind === 'typo') return `«${requestClip(v('was'), 70)}»`;
  if (dictForm === 'gked') return [v('code'), v('name')].filter(Boolean).join(' ');
  return v('name');
}

/** Значения формы, которые хранятся: обрезанные, без пустых и без темы вопроса (она в `topic`). */
export function requestFormStored(kind: RequestKind, form: RequestFormValues): RequestFormValues {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(form)) {
    const v = raw.trim();
    if (v && !(kind === 'q' && k === 'topic')) out[k] = v;
  }
  return out;
}

/* ───────────── «Где» ───────────── */

/** «Где» (блок 2, пункт 2): модуль → вкладка → окно, адрес экрана, версия, браузер, размер, время. */
export interface RequestWhere {
  path: string;
  hash: string;
  ver: string;
  br: string;
  scr: string;
  at: string;
}

const WHERE_MAX = { path: 300, hash: 120, ver: 20, br: 40, scr: 20, at: 16 } as const;

/**
 * Очистка «Где» на сервере: только известные поля и их длины; адрес экрана — без параметров (после
 * «?» могут быть значения фильтров и поиска), размер — «1280×800», время — «ГГГГ-ММ-ДД ЧЧ:ММ».
 * Значения полей, суммы и пароли сюда не попадают: их в «Где» нет по устройству. Ничего не осталось — null.
 */
export function requestWhereClean(raw: unknown): RequestWhere | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (k: keyof RequestWhere) =>
    typeof r[k] === 'string'
      ? (r[k] as string)
          // eslint-disable-next-line no-control-regex -- управляющие знаки в «Где» заменяются пробелом
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, WHERE_MAX[k])
      : '';
  const hash = str('hash').split('?')[0]!;
  const out: RequestWhere = {
    path: str('path'),
    hash: /^#[\w.\-/]*$/.test(hash) ? hash : '',
    ver: /^[\w.\- ]*$/.test(str('ver')) ? str('ver') : '',
    br: str('br'),
    scr: /^\d{2,5}×\d{2,5}$/.test(str('scr')) ? str('scr') : '',
    at: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(str('at')) ? str('at') : '',
  };
  return out.path ? out : null;
}
