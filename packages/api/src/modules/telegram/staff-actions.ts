import {
  changeTaskStatus,
  confirmReport,
  getTask,
  lockReport,
  lockTask,
  orgMenuSettings,
  reportMessageFacts,
  reportReadyFiles,
  ReportRefusedError,
  ReportStateError,
  reportTypeFiles,
  returnReportForFix,
  setReportStep,
  submitReport,
  taskReadyFiles,
  type ReportConfirmContext,
  type TaskLock,
  type TaskRecord,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  BOT_ASK_CANCEL,
  botAskLive,
  botReturnReason,
  formatText,
  hasPermission,
  periodFull,
  RecordNotFoundError,
  reportConfirmRefusal,
  reportFileRequired,
  reportHasAmount,
  reportReceiptRequired,
  reportSubmittable,
  reportWaiting,
  STAFF_BOT_ACTIONS,
  submitNeedsPayment,
  taskDoneStatus,
  taskOpen,
  type AccessSubject,
  type TelegramTemplateKey,
  type Translate,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { attachStoredFile } from '../files/attach';
import { serverTexts } from '../l10n/texts';
import { assigneeScopeOf, reportScopeOf } from '../reports/common';
import { taskAccessOf } from '../tasks/common';
import type { TelegramEvent } from './events';
import { botReportNames, fixView } from './staff-view';
import type {
  BotAction,
  BotPressAccess,
  BotPressResult,
  BotReply,
  BotReplyContext,
  BotReplyFile,
  BotReplyResult,
} from './press';

/*
 * Действия сотрудника из чата бота (поток Т, задача Т2; пакет заказчика 13.11.2026, идеи 1, 3 и 7;
 * прототип v97 modules/tg-staff.js): отчёт — «В работе», «Сдан»; задача — «Взять в работу»,
 * «Выполнена»; сдача ждёт подтверждения — «Подтвердить», «Вернуть» с причиной. Правила — те же, что у
 * сайта, и проверяются при каждом нажатии: право (ядро), область «Свои / Все» и статус записи (здесь),
 * запись делают те же функции слоя данных, что и методы сайта. Чего в чате сделать нельзя, бот объясняет
 * скрытым ответом и отправляет на сайт: «Сдан» без суммы налога, «Сдан» до оплаты налога и возврат
 * переплаты по уточнённому отчёту (деньги — только на сайте), подтверждение без обязательной квитанции.
 * Решение заказчика 13.11.2026: если для «Сдан» нужен файл, бот просит прислать его ответом на
 * сообщение; пока файла нет, отчёт не сдан. Так же закрывается задача с «Требуется файл».
 */

type Ctx = BotReplyContext;
type Access = NonNullable<BotPressAccess>;

/** Тексты словаря с подстановками — для названий отчётов и подписей нажатых кнопок. */
async function translator(deps: ApiDeps): Promise<Translate> {
  const texts = await serverTexts(deps);
  return (key, params) => formatText(texts(key), params);
}

const refused = async (
  ctx: Ctx,
  key: TelegramTemplateKey,
  values = {},
): Promise<BotPressResult> => ({
  reply: await ctx.text(key, values),
  alert: true,
});

/** Что знает действие с отчётом: учётная политика, область и кто действует — как у методов сайта. */
async function reportContext(
  ctx: Ctx,
  tx: Tx,
  subject: AccessSubject,
  t: Translate,
): Promise<ReportConfirmContext> {
  const { features, reportConfirm, payFirst } = await orgMenuSettings(tx, ctx.user.orgId!);
  return {
    today: bishkekDate(ctx.deps.clock.now()),
    scope: reportScopeOf(subject),
    contractorScope: assigneeScopeOf(subject),
    confirmOn: reportConfirm,
    filesOn: features.files,
    payFirst,
    t,
    confirmer: {
      canConfirm: hasPermission(subject, 'repConfirm'),
      userId: ctx.user.userId,
      isOwner: subject.isOwner,
    },
  };
}

type ReportRow = Awaited<ReturnType<typeof lockReport>>;

interface ReportOpened {
  r: ReportRow;
  rc: ReportConfirmContext;
  t: Translate;
  full: string;
}

/**
 * Отчёт кнопки глазами нажавшего: заблокирован до конца транзакции. Отказ — ключ шаблона: отчёта нет —
 * «Кнопка устарела», отчёт есть, но вне области «Свои» (контрагента передали другому) или контрагент в
 * архиве — «Нет права» (прототип `tgRepIn`).
 */
async function openReport(
  ctx: Ctx,
  tx: Tx,
  access: BotPressAccess,
): Promise<ReportOpened | TelegramTemplateKey> {
  if (!access || !ctx.user.orgId || !ctx.arg) return 'tgActNoRight';
  const t = await translator(ctx.deps);
  const rc = await reportContext(ctx, tx, access.subject, t);
  const facts = await reportMessageFacts(tx, ctx.arg);
  if (!facts) return 'tgActStale';
  if (facts.contractorArchived) return 'tgActNoRight';
  let r: ReportRow;
  try {
    r = await lockReport(tx, ctx.arg, rc.scope);
  } catch (err) {
    if (err instanceof RecordNotFoundError) return 'tgActNoRight';
    throw err;
  }
  return { r, rc, t, full: botReportNames(facts, t).full };
}

/** Отказ слоя данных (статус уже другой, прежняя версия) — «Кнопка устарела». */
async function staleOnRefusal<T>(run: () => Promise<T>): Promise<T | 'tgActStale'> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ReportRefusedError || err instanceof ReportStateError) return 'tgActStale';
    throw err;
  }
}

const reportWork: BotAction = {
  change: true,
  permission: 'changeStatus',
  run: (ctx) =>
    ctx.asUser(async (tx, access) => {
      const o = await openReport(ctx, tx, access);
      if (typeof o === 'string') return refused(ctx, o);
      const { r, rc, t, full } = o;
      if (!reportSubmittable(r) || r.status !== 'todo') return refused(ctx, 'tgActStale');
      const done = await staleOnRefusal(() =>
        setReportStep(tx, r.id, 'in_progress', { ...rc, version: r.version }),
      );
      if (done === 'tgActStale') return refused(ctx, done);
      return {
        done: t('telegram.done.work'),
        reply: await ctx.text('tgActRepWork', { отчёт: full }),
      };
    }),
};

/**
 * Что мешает отметить «Сдан» из чата (прототип `tgRepDoneWhy`); null — можно. Деньги — только на сайте:
 * сумму вводят там, оплату отмечают там, возврат переплаты по уточнённому отчёту создаётся там.
 */
function reportDoneRefusal(
  r: ReportRow,
  rc: ReportConfirmContext,
  type: { needFile: boolean; needReceipt: boolean },
): TelegramTemplateKey | null {
  const amount = r.amount === null ? null : Number(r.amount);
  const paid = Number(r.paid);
  if (
    submitNeedsPayment(
      { act: r.act, status: r.status, sum: amount, paid, superseded: r.superseded },
      rc.payFirst,
    )
  ) {
    return 'tgActRepPay';
  }
  if (reportHasAmount(r.act) && amount === null) return 'tgActRepSum';
  if (r.revision > 0 && paid > (amount ?? 0)) return 'tgActRepSite';
  // Виду нужен файл, а «Файлы в карточках» выключены: прикрепить нечем — на сайт.
  if ((type.needFile || (!rc.confirmOn && type.needReceipt)) && !rc.filesOn) return 'tgActRepSite';
  return null;
}

/** «Сдан» сегодняшней датой — та же запись, что делает окно «Отметить сданным» сайта. */
async function submitFromChat(
  ctx: Ctx,
  tx: Tx,
  o: ReportOpened,
  fileIds: readonly string[],
): Promise<{ done: string; off: string[]; text: string } | TelegramTemplateKey> {
  const { r, rc, t, full } = o;
  const out = await staleOnRefusal(() =>
    submitReport(
      tx,
      r.id,
      { date: rc.today, amount: null, lines: null, repeat: false, fileIds },
      {
        ...rc,
        version: r.version,
        texts: {
          repeat: t('report.amount.repeat'),
          afterPayment: t('report.reason.after_payment'),
        },
      },
    ),
  );
  if (out === 'tgActStale') return out;
  // «Сдача только после оплаты» проверена заранее; если всё же сработала — отчёт не сдан.
  if (out.waitsPayment) throw new ReportStateError(r.id, 'not_open');
  const waiting = reportWaiting(
    { status: 'submitted', act: r.act, confirmed: false },
    rc.confirmOn,
  );
  return {
    done: t('telegram.done.submitted'),
    off: [STAFF_BOT_ACTIONS.reportWork],
    text: await ctx.text(waiting ? 'tgActRepWait' : 'tgActRepDone', { отчёт: full }),
  };
}

const reportDone: BotAction = {
  change: true,
  permission: 'changeStatus',
  run: (ctx) =>
    ctx.asUser(async (tx, access) => {
      const o = await openReport(ctx, tx, access);
      if (typeof o === 'string') return refused(ctx, o);
      const { r, rc, full } = o;
      if (!reportSubmittable(r)) return refused(ctx, 'tgActStale');
      const type = await reportTypeFiles(tx, r.reportTypeCode);
      const why = reportDoneRefusal(r, rc, type);
      if (why) return refused(ctx, why, { отчёт: full });
      if (reportFileRequired(type, rc) && (await reportReadyFiles(tx, r.id)).length === 0) {
        return {
          ask: {
            text: await ctx.text('tgRepAskFile', { отчёт: full }),
            action: STAFF_BOT_ACTIONS.reportFile,
            kind: 'file',
          },
        };
      }
      const done = await submitFromChat(ctx, tx, o, []);
      if (typeof done === 'string') return refused(ctx, done);
      return { done: done.done, off: done.off, reply: done.text };
    }),
};

/** Прикрепить присланный файл к записи по правилам сайта; отказ — ключ шаблона. */
async function attachFromChat(
  ctx: Ctx,
  tx: Tx,
  subject: AccessSubject,
  source: { kind: 'report' | 'task'; id: string },
  reply: { file: BotReplyFile; note: string | null },
): Promise<{ id: string } | TelegramTemplateKey> {
  const attached = await attachStoredFile(ctx.deps, tx, subject, ctx.user.orgId!, {
    id: reply.file.id,
    source,
    name: reply.file.name,
    size: reply.file.size,
    contentType: reply.file.contentType,
    storageKey: reply.file.storageKey,
    note: reply.note,
  });
  if (attached === 'files_off') return 'tgActRepSite';
  if (attached === 'not_found' || attached === 'forbidden') return 'tgActNoRight';
  return attached;
}

const said = async (ctx: Ctx, key: TelegramTemplateKey, values = {}): Promise<BotReplyResult> => ({
  say: await ctx.text(key, values),
});

const reportFile: BotAction = {
  change: true,
  permission: 'changeStatus',
  reply: (ctx, reply: BotReply) =>
    ctx.asUser(async (tx, access) => {
      if (!('file' in reply)) return { again: await ctx.text('tgAskNeedFile') };
      const o = await openReport(ctx, tx, access);
      if (typeof o === 'string') return said(ctx, o);
      const { r, rc, full } = o;
      if (!reportSubmittable(r)) return said(ctx, 'tgActStale');
      const why = reportDoneRefusal(r, rc, await reportTypeFiles(tx, r.reportTypeCode));
      if (why) return said(ctx, why, { отчёт: full });
      const file = await attachFromChat(
        ctx,
        tx,
        access!.subject,
        { kind: 'report', id: r.id },
        reply,
      );
      if (typeof file === 'string') return said(ctx, file, { отчёт: full });
      const done = await submitFromChat(ctx, tx, o, [file.id]);
      // Отчёт не сдан — файл не прикрепляется: транзакция откатывается целиком.
      if (typeof done === 'string') throw new ReportStateError(r.id, 'not_open');
      return { done: done.done, off: done.off, say: done.text, fileKept: true };
    }),
};

/**
 * Подтвердить или вернуть сдачу можно (как на сайте, `reportConfirmRefusal`); отказ — ключ шаблона:
 * отчёт уже не ждёт подтверждения — «Кнопка устарела», свой сданный — «нельзя» (владельцу можно).
 */
function confirmRefusal(o: ReportOpened): TelegramTemplateKey | null {
  const { r, rc } = o;
  if (r.superseded) return 'tgActStale';
  const refusal = reportConfirmRefusal(
    { status: r.status, act: r.act, confirmed: r.confirmedAt !== null, submittedBy: r.submittedBy },
    rc.confirmer,
    rc.confirmOn,
  );
  if (refusal === 'report_not_waiting') return 'tgActStale';
  if (refusal === 'report_confirm_right') return 'tgActNoRight';
  if (refusal === 'report_confirm_own') return 'tgActConfOwn';
  return null;
}

const confirmOk: BotAction = {
  change: true,
  permission: 'repConfirm',
  run: (ctx) =>
    ctx.asUser(async (tx, access) => {
      const o = await openReport(ctx, tx, access);
      if (typeof o === 'string') return refused(ctx, o);
      const { r, rc, t, full } = o;
      const no = confirmRefusal(o);
      if (no) return refused(ctx, no);
      const type = await reportTypeFiles(tx, r.reportTypeCode);
      if (reportReceiptRequired(type, rc) && (await reportReadyFiles(tx, r.id)).length === 0) {
        return refused(ctx, 'tgActConfRcpt', { отчёт: full });
      }
      const done = await staleOnRefusal(() =>
        confirmReport(tx, r.id, { note: '', fileIds: [] }, { ...rc, version: r.version }),
      );
      if (done === 'tgActStale') return refused(ctx, done);
      return {
        done: t('telegram.done.confirmed'),
        off: [STAFF_BOT_ACTIONS.confirmBack],
        reply: await ctx.text('tgActConfOk', { отчёт: full }),
      };
    }),
};

const confirmBack: BotAction = {
  change: true,
  permission: 'repConfirm',
  run: (ctx) =>
    ctx.asUser(async (tx, access) => {
      const o = await openReport(ctx, tx, access);
      if (typeof o === 'string') return refused(ctx, o);
      const no = confirmRefusal(o);
      if (no) return refused(ctx, no);
      return {
        ask: {
          text: await ctx.text('tgConfAskWhy', { отчёт: o.full }),
          action: STAFF_BOT_ACTIONS.confirmWhy,
          kind: 'text',
        },
      };
    }),
};

/**
 * Причина возврата — текст до 500 знаков; без причины отчёт не возвращается. Запись та же, что делает «На
 * исправление» сайта; ответственный получает причину и кнопки отчёта (прототип `confWhy`, `tgFixMsg`).
 */
const confirmWhy: BotAction = {
  change: true,
  permission: 'repConfirm',
  reply: (ctx, reply) =>
    ctx.asUser(async (tx, access) => {
      const reason = 'text' in reply ? botReturnReason(reply.text) : '';
      if (!reason) return { again: await ctx.text('tgAskNeedText') };
      const o = await openReport(ctx, tx, access);
      if (typeof o === 'string') return said(ctx, o);
      const { r, rc, t, full } = o;
      const no = confirmRefusal(o);
      if (no) return said(ctx, no);
      const back = await staleOnRefusal(() =>
        returnReportForFix(tx, r.id, reason, { ...rc, version: r.version }),
      );
      if (back === 'tgActStale') return said(ctx, back);
      const by = access!.subject.employeeId;
      const events: TelegramEvent[] =
        r.responsibleEmployeeId && r.responsibleEmployeeId !== by
          ? [
              {
                kind: 'report_fix',
                to: r.responsibleEmployeeId,
                by,
                template: 'tgFix',
                values: {
                  отчёт: t('telegram.item.report', await reportItemValues(tx, r.id, t)),
                  причина: reason,
                  автор: access!.shortName,
                },
                link: 'reports',
                ...(await fixView(ctx.deps, r.id)),
              },
            ]
          : [];
      return {
        done: t('telegram.done.returned'),
        off: [STAFF_BOT_ACTIONS.confirmOk],
        say: await ctx.text('tgConfBackOk', { отчёт: full }),
        events,
      };
    }),
};

/** Подстановки «вид за период — контрагент» строки отчёта в сообщениях бота. */
async function reportItemValues(tx: Tx, id: string, t: Translate) {
  const facts = (await reportMessageFacts(tx, id))!;
  return {
    type: facts.typeShort,
    period: periodFull({ period: facts.period, start: facts.periodStart }, t),
    contractor: facts.contractorName,
  };
}

/**
 * Задача кнопки глазами нажавшего: заблокирована, нажал исполнитель, задача ему видна. Задачи нет —
 * «Кнопка устарела»; задача есть, но нажал не исполнитель (её передали другому) — «Нет права».
 */
async function openTask(
  ctx: Ctx,
  tx: Tx,
  access: BotPressAccess,
): Promise<
  | { task: TaskRecord; lock: TaskLock; filesOn: boolean; subject: Access['subject'] }
  | TelegramTemplateKey
> {
  if (!access || !ctx.user.orgId || !ctx.arg) return 'tgActNoRight';
  const { features } = await orgMenuSettings(tx, ctx.user.orgId);
  if (!features.tasks) return 'tgActNoRight';
  const lock = await lockTask(tx, ctx.arg);
  if (!lock) return 'tgActStale';
  // Кнопки задачи — только её исполнителю (прототип `tgTaskIn`).
  if (lock.executorEmployeeId !== access.subject.employeeId) return 'tgActNoRight';
  const task = await getTask(tx, ctx.arg, taskAccessOf(access.subject));
  if (!task) return 'tgActNoRight';
  return { task, lock, filesOn: features.files, subject: access.subject };
}

/** Сообщение постановщику о нажатии исполнителя (прототип `tgTaskTell`); себе — не пишется. */
function taskEvent(
  task: TaskRecord,
  kind: 'task_started' | 'task_done' | 'task_on_confirm',
  template: 'tgTaskTook' | 'tgTaskDoneBy' | 'tgTaskWaitBy',
): TelegramEvent[] {
  return [
    {
      kind,
      to: task.author.id,
      by: task.executor.id,
      template,
      values: { задача: task.title, исполнитель: task.executor.shortName },
      link: 'tasks',
    },
  ];
}

const taskWork: BotAction = {
  change: true,
  run: (ctx) =>
    ctx.asUser(async (tx, access) => {
      const o = await openTask(ctx, tx, access);
      if (typeof o === 'string') return refused(ctx, o);
      if (o.lock.status !== 'todo') return refused(ctx, 'tgActStale');
      await changeTaskStatus(tx, o.lock.id, { from: o.lock.status, to: 'in_progress' });
      const t = await translator(ctx.deps);
      return {
        done: t('telegram.done.work'),
        reply: await ctx.text('tgActTaskWork'),
        events: taskEvent(o.task, 'task_started', 'tgTaskTook'),
      };
    }),
};

/** «Выполнена» — та же запись, что делает окно сайта: с подтверждением — «На подтверждении». */
async function finishTask(
  ctx: Ctx,
  tx: Tx,
  o: { task: TaskRecord; lock: TaskLock },
  fileId: string | null,
) {
  const to = taskDoneStatus(o.lock.confirm);
  await changeTaskStatus(
    tx,
    o.lock.id,
    { from: o.lock.status, to, fileId },
    { doneAt: ctx.deps.clock.now(), reworkReason: '' },
  );
  const t = await translator(ctx.deps);
  return {
    done: t('telegram.done.task'),
    off: [STAFF_BOT_ACTIONS.taskWork],
    text: await ctx.text(o.lock.confirm ? 'tgActTaskWait' : 'tgActTaskDone'),
    events: o.lock.confirm
      ? taskEvent(o.task, 'task_on_confirm', 'tgTaskWaitBy')
      : taskEvent(o.task, 'task_done', 'tgTaskDoneBy'),
  };
}

const taskDone: BotAction = {
  change: true,
  run: (ctx) =>
    ctx.asUser(async (tx, access) => {
      const o = await openTask(ctx, tx, access);
      if (typeof o === 'string') return refused(ctx, o);
      if (!taskOpen(o.lock.status)) return refused(ctx, 'tgActStale');
      // «Требуется файл» действует при включённых «Файлах в карточках» — как на сайте (п. Б-1).
      const files = await taskReadyFiles(tx, o.lock.id);
      if (o.lock.needFile && o.filesOn && files.length === 0) {
        return {
          ask: {
            text: await ctx.text('tgTaskAskFile', { задача: o.task.title }),
            action: STAFF_BOT_ACTIONS.taskFile,
            kind: 'file',
          },
        };
      }
      const done = await finishTask(ctx, tx, o, files.at(-1)?.id ?? null);
      return { done: done.done, off: done.off, reply: done.text, events: done.events };
    }),
};

const taskFile: BotAction = {
  change: true,
  reply: (ctx, reply) =>
    ctx.asUser(async (tx, access) => {
      if (!('file' in reply)) return { again: await ctx.text('tgAskNeedFile') };
      const o = await openTask(ctx, tx, access);
      if (typeof o === 'string') return said(ctx, o);
      if (!taskOpen(o.lock.status)) return said(ctx, 'tgActStale');
      const file = await attachFromChat(ctx, tx, o.subject, { kind: 'task', id: o.lock.id }, reply);
      if (typeof file === 'string')
        return said(ctx, file === 'tgActRepSite' ? 'tgActFailed' : file);
      const done = await finishTask(ctx, tx, o, file.id);
      return {
        done: done.done,
        off: done.off,
        say: done.text,
        events: done.events,
        fileKept: true,
      };
    }),
};

/** «Отмена» под просьбой бота: бот перестаёт ждать ответ, запись не меняется (прототип `askCancel`). */
const askCancel: BotAction = {
  run: async (ctx) => {
    if (!botAskLive(ctx.message, bishkekDate(ctx.deps.clock.now()))) {
      return refused(ctx, 'tgActStale');
    }
    const t = await translator(ctx.deps);
    return {
      done: t('telegram.done.cancelled'),
      closeAsk: true,
      reply: await ctx.text('tgActCancelled'),
    };
  },
};

/** Действия сотрудника в чате бота — в реестр нажатий (`BOT_ACTIONS`). */
export const STAFF_BOT_HANDLERS: Readonly<Record<string, BotAction>> = {
  [STAFF_BOT_ACTIONS.reportWork]: reportWork,
  [STAFF_BOT_ACTIONS.reportDone]: reportDone,
  [STAFF_BOT_ACTIONS.reportFile]: reportFile,
  [STAFF_BOT_ACTIONS.taskWork]: taskWork,
  [STAFF_BOT_ACTIONS.taskDone]: taskDone,
  [STAFF_BOT_ACTIONS.taskFile]: taskFile,
  [STAFF_BOT_ACTIONS.confirmOk]: confirmOk,
  [STAFF_BOT_ACTIONS.confirmBack]: confirmBack,
  [STAFF_BOT_ACTIONS.confirmWhy]: confirmWhy,
  [BOT_ASK_CANCEL]: askCancel,
};
