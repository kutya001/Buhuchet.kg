import {
  contractorBellStaff,
  insertBellRows,
  loadEmployeeAccess,
  notifyTarget,
  type Tx,
} from '@buhuchet/db';
import {
  bellText,
  bishkekDate,
  canSeeContractor,
  formatSomWithUnit,
  formatText,
  hasPermission,
  monthLabel,
  type BellKind,
  type BellTarget,
  type PermissionId,
  type Translate,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { serverTexts } from '../l10n/texts';

/*
 * Колокольчик уведомлений (доработки 16.11.2026, блок 3; поток Т; прототип v122 `modules/bell.js`).
 * Стык «Положить уведомление» (/mnt/project-files/stream-t/bell-contract.md): в колокольчик попадает всё,
 * что человек получает в Telegram, по тем же правилам, получателям и настройкам профиля, — и без
 * привязанного Telegram, и при выключенных «Напоминаниях в Telegram». Одно событие — одна строка у
 * человека (ключ события), видно только то, что человек видит по правам сейчас, строки хранятся 90 дней.
 */

/** Строка колокольчика одному человеку. */
export interface BellPut {
  userId: string;
  kind: BellKind;
  event: string;
  target?: { kind: BellTarget; id: string } | null;
  contractorId?: string | null;
  need?: PermissionId | null;
  text: string;
  eventKey: string;
}

/**
 * Положить строки — в транзакции действия, только через `tx` (откатилось действие — строки нет). Повтор с
 * тем же ключом у того же человека ничего не добавляет. Возвращает, сколько строк добавлено.
 */
export async function putBell(tx: Tx, rows: readonly BellPut[], now: Date): Promise<number> {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const key = `${r.userId} ${r.eventKey}`;
    if (seen.has(key) || !r.text.trim()) return false;
    seen.add(key);
    return true;
  });
  return insertBellRows(
    tx,
    unique.map((r) => ({
      userId: r.userId,
      kind: r.kind,
      event: r.event,
      targetKind: r.target?.kind ?? null,
      targetId: r.target?.id ?? null,
      contractorId: r.contractorId ?? null,
      need: r.need ?? null,
      text: bellText(r.text),
      eventKey: r.eventKey,
    })),
    now,
  );
}

/**
 * Кому строка о событии контрагента (файл, «Я оплатил», «Оплатил», запрос на подключение, вопрос клиента,
 * страница закрыта): ответственному — даже без Telegram — и тому, кому ушло сообщение Telegram (первый с
 * Telegram из ответственного и владельцев, прототип `pgTgStaff`); ни у кого нет Telegram и нет
 * ответственного — первому владельцу (прототип v122 `bellCpTo`). Заблокированные и уволенные не получают.
 * `need` — право, без которого строку не видно: сумма за обслуживание — как сообщение Telegram (п. К-10),
 * строка идёт только тем, у кого это право и контрагент в области группы «Контрагенты»; файлы от
 * контрагента — «Просматривать файлы» и область группы «Файловый менеджер» (имя и «Открыть» в Telegram —
 * так же, п. И-10).
 */
export async function bellContractorUsers(
  tx: Tx,
  contractorId: string,
  need: PermissionId | null = null,
): Promise<string[]> {
  const staff = await contractorBellStaff(tx, contractorId);
  if (!staff) return [];
  const cp = { responsibleEmployeeId: staff.responsibleId };
  const allowed = async (employeeId: string) => {
    if (!need) return true;
    const access = await loadEmployeeAccess(tx, employeeId);
    return (
      !!access &&
      hasPermission(access.subject, need) &&
      canSeeContractor(access.subject, need === 'filesView' ? 'files' : 'cps', cp)
    );
  };
  const resp =
    staff.responsibleId && (await allowed(staff.responsibleId))
      ? await notifyTarget(tx, staff.responsibleId)
      : null;
  const owners = [];
  for (const id of staff.ownerIds) {
    const target = await notifyTarget(tx, id);
    if (target && (await allowed(id))) owners.push(target);
  }
  // Кому ушло в Telegram: ответственному с Telegram, иначе первому владельцу с Telegram.
  const tg = resp?.chatId != null ? resp : (owners.find((o) => o.chatId !== null) ?? null);
  const users = [resp?.userId, tg?.userId].filter((u): u is string => !!u);
  if (!users.length && owners[0]) users.push(owners[0].userId);
  return [...new Set(users)];
}

/** Событие контрагента для колокольчика (прототип v122 `bellCp`, `sntNotify`, `pgClosedNotify`). */
export type ContractorBell =
  /** Файлы от контрагента (страница или бот): одна строка на отправку. */
  | { event: 'cp_file'; sendId: string; n: number }
  /** «Я оплатил» со страницы: чек — номер файла. */
  | {
      event: 'cp_paid_page';
      fileId: string;
      purpose: 'tax' | 'fee';
      month: YearMonth | null;
      amount: Tyiyn;
    }
  /** «Оплатил» налоги в Telegram: номер сообщения клиенту. */
  | { event: 'cp_paid_tg'; messageId: string; month: YearMonth; amount: Tyiyn }
  /** «Оплатил» обслуживание в Telegram: номер сообщения клиенту. */
  | { event: 'fee_paid'; messageId: string; amount: Tyiyn }
  /** Запрос на подключение Telegram: номер подключения и имя из Telegram. */
  | { event: 'cp_tg_request'; linkId: string; name: string }
  /** Вопрос клиента: номер сообщения-просьбы и текст вопроса. */
  | { event: 'cp_question'; messageId: string; question: string }
  /** Страница закрыта после 5 неверных кодов за сутки. */
  | { event: 'page_closed'; failures: number }
  /**
   * «Не отправлено «К оплате»: нет реквизитов для перевода» за месяц (приёмка «Колокольчик против
   * Telegram», доработки 16.11.2026, блок 3, пункт 3; прототип v126 `pgNoReqWhy`).
   */
  | { event: 'cp_no_req'; month: YearMonth };

/** Длина вопроса клиента в строке (прототип v122: `slice(0,200)`). */
const BELL_QUESTION_MAX = 200;

function contractorBellRow(
  e: ContractorBell,
  contractorId: string,
  t: Translate,
  now: Date,
): Omit<BellPut, 'userId'> {
  const cp = (kind: BellTarget) => ({ kind, id: contractorId });
  const sum = (amount: Tyiyn) => formatSomWithUnit(amount);
  switch (e.event) {
    case 'cp_file':
      return {
        kind: 'files',
        event: 'cp_file',
        target: cp('cp_sent'),
        need: 'filesView',
        text: e.n > 1 ? t('bell.line.cp_file.many', { n: e.n }) : t('bell.line.cp_file.one'),
        eventKey: `cp_file:${e.sendId}`,
      };
    case 'cp_paid_page': {
      const what = e.month
        ? t(`bell.line.cp_paid.${e.purpose}_month`, { month: monthLabel(e.month) })
        : t(`bell.line.cp_paid.${e.purpose}`);
      return {
        kind: 'money',
        event: 'cp_paid',
        target: cp('cp_sent'),
        // ОТКЛОНЕНИЕ: docs/deviations.md#К-10 — сумма за обслуживание только тому, кто её видит.
        need: e.purpose === 'fee' ? 'fee' : null,
        text: t('bell.line.cp_paid.page', { what, sum: sum(e.amount) }),
        eventKey: `cp_paid:${e.fileId}`,
      };
    }
    case 'cp_paid_tg':
      return {
        kind: 'money',
        event: 'cp_paid',
        target: cp('cp_money'),
        text: t('bell.line.cp_paid.tg', { month: monthLabel(e.month), sum: sum(e.amount) }),
        eventKey: `cp_paid:${e.messageId}`,
      };
    case 'fee_paid':
      return {
        kind: 'money',
        event: 'fee_paid',
        target: cp('cp_fee'),
        need: 'fee',
        text: t('bell.line.fee_paid', { sum: sum(e.amount) }),
        eventKey: `fee_paid:${e.messageId}`,
      };
    case 'cp_tg_request':
      return {
        kind: 'other',
        event: 'cp_tg_request',
        target: cp('contractor'),
        text: t('bell.line.cp_tg_request', { name: e.name }),
        eventKey: `cp_tg_request:${contractorId}:${e.linkId}`,
      };
    case 'cp_question':
      return {
        kind: 'other',
        event: 'cp_question',
        target: cp('contractor'),
        text: t('bell.line.cp_question', {
          text: bellText(e.question).slice(0, BELL_QUESTION_MAX),
        }),
        eventKey: `cp_question:${e.messageId}`,
      };
    case 'cp_no_req':
      return {
        kind: 'money',
        event: 'cp_no_req',
        target: cp('contractor'),
        text: t('bell.line.cp_no_req', { month: monthLabel(e.month) }),
        // Как сообщение Telegram: одно на контрагента и месяц.
        eventKey: `cp_no_req:${contractorId}:${e.month}`,
      };
    case 'page_closed':
      return {
        kind: 'other',
        event: 'page_closed',
        target: cp('contractor'),
        text: t('bell.line.page_closed', { n: e.failures }),
        eventKey: `page_closed:${contractorId}:${bishkekDate(now)}`,
      };
  }
}

/** Часы и тексты словаря для `bellContractor`, прочитанные до транзакции действия (`bellContext`). */
export type BellContext = { readonly now: Date; readonly t: Translate };

/** Часы и тексты словаря до транзакции: тогда `bellContractor` внутри неё не трогает `deps`. */
export async function bellContext(deps: ApiDeps): Promise<BellContext> {
  return { now: deps.clock.now(), t: await serverTexts(deps) };
}

/**
 * Строка колокольчика о событии контрагента (стык «Положить уведомление», вызывают потоки К и И) — в
 * транзакции действия, только через `tx`, и без бота, и без привязанного Telegram, и при выключенных
 * «Напоминаниях в Telegram». Кому — `bellContractorUsers`. Лучше передать первым параметром
 * `bellContext(deps)`, прочитанный до транзакции; с `deps` часы берутся здесь, тексты словаря — из
 * `texts` или здесь же (у словаря своё соединение, п. О-46).
 */
export async function bellContractor(
  ctx: BellContext,
  tx: Tx,
  contractorId: string,
  e: ContractorBell,
): Promise<number>;
export async function bellContractor(
  deps: ApiDeps,
  tx: Tx,
  contractorId: string,
  e: ContractorBell,
  texts?: Translate,
): Promise<number>;
export async function bellContractor(
  ctx: ApiDeps | BellContext,
  tx: Tx,
  contractorId: string,
  e: ContractorBell,
  texts?: Translate,
): Promise<number> {
  const pre = 'clock' in ctx ? null : ctx;
  const now = pre ? pre.now : (ctx as ApiDeps).clock.now();
  const t = pre ? pre.t : (texts ?? (await serverTexts(ctx as ApiDeps)));
  const tr: Translate = (key, params) => formatText(t(key), params);
  const row = contractorBellRow(e, contractorId, tr, now);
  const users = await bellContractorUsers(tx, contractorId, row.need ?? null);
  return putBell(
    tx,
    users.map((userId) => ({ ...row, userId, contractorId })),
    now,
  );
}
