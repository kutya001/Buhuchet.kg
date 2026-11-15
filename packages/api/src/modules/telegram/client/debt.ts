import {
  autoFeeLinkIds,
  contractorDebtSwitch,
  contractorMoneyOf,
  contractorsWithTelegram,
  contractorTelegramChats,
  contractorTelegramDebtSettings,
  contractorPageSectionShown,
  contractorTelegramRecipients,
  cpNoticeSettingsOf,
  debtLinkIds,
  feeSubject,
  getContractor,
  insertContractorTelegramMessage,
  contractorTaxTransfer,
  feeTransfer,
  messageTemplates,
  orgIds,
  payClaimMonths,
  refreshContractorTelegramMessage,
  setContractorTelegramNoDebt,
  unsentDebtMessages,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  addMonths,
  botMessageProblem,
  botTemplate,
  contractorFees,
  cpDebt,
  cpNoticeDay,
  cpNoticeDayDue,
  cpTgDebtOnCommand,
  debtBotMessage,
  debtReminderDue,
  debtWeek,
  feeSoon,
  feeSoonBotMessage,
  fillTemplate,
  formatDateRu,
  formatSomWithUnit,
  formatText,
  lastDayOf,
  monthLabel,
  monthOf,
  monthReconciliation,
  weekdayMondayFirst,
  type BotMessage,
  type CpDebt,
  type IsoDate,
  type TelegramTemplateKey,
  type Translate,
  type Tyiyn,
} from '@buhuchet/domain';
import type { ApiDeps, Job, JobContext } from '../../../deps';
import { serverTexts } from '../../l10n/texts';
import { sendNow } from '../bot';
import { deliverClientMessages, type PreparedClientMessage } from './pay';
import { clientFilesOn } from './receipt';
import { feeRequisiteOf } from './requisite';

/*
 * Напоминание клиенту о долге в Telegram (доработки 13.11.2026, задача К5; прототип v94
 * modules/cp-telegram.js: `pgDebt`, `pgDebtTo`, `pgDebtMsg`, `tgAct('cp-nodebt')`). Раз в неделю, в
 * день и время строки «Оплата за обслуживание» блока «Telegram-уведомления» (по умолчанию — в
 * понедельник в 10:00; прототип v115), подключившим Telegram: недостача денег на налоги этого месяца и
 * долг за обслуживание; в отмеченные дни до срока — «Оплата за обслуживание до …». Клиент получает только то, что видит на своей странице: часть долга, раздел которой
 * ему не показан, в напоминание не входит, реквизиты — только пока показан раздел «Как оплатить».
 */

/** Сколько раз задача пробует отправить напоминание недели. */
const DEBT_MAX_ATTEMPTS = 3;

async function templateText(
  tx: Tx | JobContext['db'],
  key: TelegramTemplateKey,
  values: Readonly<Record<string, string | number>> = {},
): Promise<string> {
  const templates = await messageTemplates(tx);
  return fillTemplate(botTemplate(key, templates[key]), values);
}

/**
 * Долг контрагента для напоминания (прототип pgDebt): долг за обслуживание — при функции «Плата за
 * обслуживание» (у разового контрагента его нет), недостача на налоги месяца — при «Учёте оплаты
 * налогов». Каждая часть считается так же, как на странице контрагента, и только пока её раздел
 * клиенту показан («Оплата за обслуживание», «Деньги на налоги»): бот не пишет клиенту того, чего тот
 * не видит на своей странице.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-5
export async function contractorClientDebt(
  tx: Tx,
  o: { contractorId: string; oneOff: boolean; today: IsoDate; fee: boolean; taxpay: boolean },
): Promise<CpDebt> {
  let fee: Tyiyn | null = null;
  if (o.fee && !o.oneOff && (await contractorPageSectionShown(tx, o.contractorId, 'fee'))) {
    const found = await feeSubject(tx, o.contractorId, undefined);
    if (found) fee = contractorFees(found.subject, found.payments, o.today).debt;
  }
  let short: Tyiyn | null = null;
  if (o.taxpay && (await contractorPageSectionShown(tx, o.contractorId, 'money'))) {
    const money = await contractorMoneyOf(tx, o.contractorId);
    const { verdict } = monthReconciliation(
      money.money,
      money.reports,
      lastDayOf(monthOf(o.today)),
    );
    short = verdict.state === 'short' ? verdict.amount : 0;
  }
  return cpDebt({ fee, short });
}

/**
 * Напоминание о долге (прототип v110 pgDebtMsg): кнопка «Показать реквизиты для перевода» — одна на
 * обе части долга, если реквизиты хотя бы для одной есть и клиенту показан раздел «Как оплатить»;
 * сами реквизиты бот присылает по нажатию (`clientPress`, доработки 14.11.2026, блок 4, пункт 3).
 * Тексты словаря (`t`) читаются до транзакции.
 */
async function debtMessage(
  tx: Tx,
  t: Translate,
  cp: {
    id: string;
    name: string;
    paysTo: 'emp' | 'org';
    responsible: { id: string } | null;
  },
  debt: CpDebt,
): Promise<BotMessage> {
  const payShown = await contractorPageSectionShown(tx, cp.id, 'pay');
  const [tax, fee] = await Promise.all([
    payShown && debt.short
      ? contractorTaxTransfer(tx, {
          paysTo: cp.paysTo,
          responsibleId: cp.responsible?.id ?? null,
        })
      : null,
    payShown && debt.fee ? feeTransfer(tx) : null,
  ]);
  const [text, showRequisites, noDebt] = await Promise.all([
    templateText(tx, 'tgCpDebt', { контрагент: cp.name, сумма: formatSomWithUnit(debt.sum) }),
    templateText(tx, 'tgBtnCpShowReq'),
    templateText(tx, 'tgBtnCpNoDebt'),
  ]);
  const message = debtBotMessage({
    contractor: cp.name,
    debt,
    requisites: { tax: !!tax, fee: !!fee },
    text,
    labels: {
      heading: t('cppage.tg.debt.heading'),
      what: t('cppage.tg.debt.what'),
      amount: t('cppage.tg.debt.amount'),
      short: t('cppage.tg.debt.short'),
      fee: t('cppage.tg.debt.fee'),
      showRequisites,
      noDebt,
    },
  });
  const problem = botMessageProblem(message);
  if (problem) throw new Error(`Напоминание о долге контрагенту: ${problem}`);
  return message;
}

/**
 * «Оплата за обслуживание до …» одному контрагенту (доработки 14.11.2026, блок 3, пункт 3, этап 2;
 * прототип v115 `pgFeeSoon`, `pgFeeSoonMsg`): в отмеченный день «за N» до дня оплаты обслуживания —
 * ближайшее неоплаченное начисление этого или следующего месяца, пока клиент не нажал «Оплатил» за этот
 * месяц (и сообщение не отклонено) и деньги за него не приняты. Одно на чат в день (ключ в базе).
 * Клиенту — только пока ему показан раздел «Оплата за обслуживание» страницы: бот не пишет того, чего
 * клиент не видит на своей странице; реквизиты — пока показан и «Как оплатить».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-11
async function prepareFeeSoon(
  tx: Tx,
  t: Translate,
  cp: { id: string; name: string; kind: string; serviceStatus: string },
  recipients: readonly { linkId: string; chatId: number }[],
  today: IsoDate,
  days: readonly number[],
): Promise<PreparedClientMessage[]> {
  if (cp.kind === 'oneoff' || cp.serviceStatus === 'archived') return [];
  if (!(await contractorPageSectionShown(tx, cp.id, 'fee'))) return [];
  const found = await feeSubject(tx, cp.id, undefined);
  if (!found) return [];
  // Начисления — с запасом до конца следующего месяца: «ближайшее» бывает и следующего месяца.
  const fees = contractorFees(
    found.subject,
    found.payments,
    lastDayOf(addMonths(monthOf(today), 1)),
  );
  const soon = feeSoon(fees.months, today, await payClaimMonths(tx, cp.id, 'fee'));
  if (!soon || !cpNoticeDayDue(today, soon.due, days)) return [];
  const done = await autoFeeLinkIds(tx, cp.id, today);
  const fresh = recipients.filter((r) => !done.has(r.linkId));
  if (!fresh.length) return [];
  const requisite = await feeRequisiteOf(tx, t, { id: cp.id, oneOff: false });
  const [heading, text, paid, receipt] = await Promise.all([
    templateText(tx, 'tgCpFeeHead', { срок: formatDateRu(soon.due) }),
    templateText(tx, 'tgCpFeeSoon', {
      контрагент: cp.name,
      месяц: monthLabel(soon.month).toLowerCase(),
      сумма: formatSomWithUnit(soon.sum),
      срок: formatDateRu(soon.due),
    }),
    templateText(tx, 'tgBtnCpPaid'),
    clientFilesOn(tx, cp.id).then((on) => (on ? templateText(tx, 'tgBtnCpReceipt') : null)),
  ]);
  const message = feeSoonBotMessage({
    heading,
    contractor: cp.name,
    text,
    requisite: requisite.state === 'ok' ? requisite.block : null,
    paid,
    receipt,
  });
  const problem = botMessageProblem(message);
  if (problem) throw new Error(`«Оплата за обслуживание до …» контрагенту: ${problem}`);
  const out: PreparedClientMessage[] = [];
  for (const r of fresh) {
    const id = await insertContractorTelegramMessage(tx, {
      contractorId: cp.id,
      linkId: r.linkId,
      chatId: r.chatId,
      kind: 'fee',
      month: soon.month,
      total: soon.sum,
      auto: true,
      day: today,
      payload: message,
    });
    if (id) out.push({ id, chatId: r.chatId, message });
  }
  return out;
}

/**
 * Строка «Оплата за обслуживание» одной организации: что отправить. Всё — в одной транзакции задачи.
 * null — время отправки организации не в этом запуске. В выбранный день недели (`create`) записываются
 * новые напоминания о долге; в остальные дни — только повтор не ушедших в тот день, сегодняшним
 * сообщением (долг погашен — повтора нет). «Оплата за обслуживание до …» — в отмеченные дни до срока.
 */
async function prepareDebt(
  tx: Tx,
  t: Translate,
  orgId: string,
  slot: Date,
): Promise<PreparedClientMessage[] | null> {
  const settings = await contractorTelegramDebtSettings(tx);
  if (!settings.on) return null;
  const notices = await cpNoticeSettingsOf(tx, orgId);
  const today = cpNoticeDay(notices.feeAt, slot);
  if (!today) return null;
  // День недели — по дню времени отправки, а не по часам запуска: запуск 00:00 отправляет за 23:56–23:59
  // прошлого дня.
  const create = weekdayMondayFirst(today) + 1 === notices.debtWeekDay;
  const week = debtWeek(today);
  const out: PreparedClientMessage[] = [];
  for (const contractorId of await contractorsWithTelegram(tx)) {
    // Клиент нажал «Не напоминать» — этому чату не идут ни напоминания о долге, ни «до срока».
    const recipients = (await contractorTelegramRecipients(tx, contractorId)).filter(
      (r) => !r.noDebt,
    );
    if (!recipients.length) continue;
    const cp = await getContractor(tx, contractorId, { scope: undefined, today });
    if (!cp) continue;
    // «До срока» — не напоминание о долге: выключатель сотрудника «Напоминать о долге в Telegram» его
    // не останавливает (прототип v115 pgFeeSoon → pgFeeTo смотрит только «Не напоминать» клиента).
    if (settings.fee) {
      out.push(...(await prepareFeeSoon(tx, t, cp, recipients, today, notices.feeDays)));
    }
    const own = await contractorDebtSwitch(tx, contractorId);
    if (!own || own.off) continue;
    const done = await debtLinkIds(tx, contractorId, week);
    const fresh = create ? recipients.filter((r) => !done.has(r.linkId)) : [];
    const retry = (await unsentDebtMessages(tx, contractorId, week, DEBT_MAX_ATTEMPTS)).filter(
      (m) => recipients.some((r) => r.linkId === m.linkId),
    );
    if (!fresh.length && !retry.length) continue;
    const debt = await contractorClientDebt(tx, {
      contractorId,
      oneOff: cp.kind === 'oneoff',
      today,
      fee: settings.fee,
      taxpay: settings.taxpay,
    });
    const due = debtReminderDue({
      orgOn: true,
      contractorOff: false,
      archived: cp.serviceStatus === 'archived',
      debt,
    });
    if (!due) continue;
    const message = await debtMessage(tx, t, cp, debt);
    for (const r of retry) {
      const ok = await refreshContractorTelegramMessage(tx, r.id, {
        total: debt.sum,
        payload: message,
      });
      if (ok) out.push({ id: r.id, chatId: r.chatId, message });
    }
    for (const r of fresh) {
      const id = await insertContractorTelegramMessage(tx, {
        contractorId,
        linkId: r.linkId,
        chatId: r.chatId,
        kind: 'debt',
        total: debt.sum,
        week,
        payload: message,
      });
      if (id) out.push({ id, chatId: r.chatId, message });
    }
  }
  return out;
}

/**
 * «Напоминать контрагентам о долге» (строка «Оплата за обслуживание» блока «Telegram-уведомления»,
 * прототип v115: «раз в неделю в выбранный день в своё время, пока есть долг; до срока — в отмеченные
 * дни»): запуск каждые 5 минут, организация — в запуск, на который приходится её время отправки, каждая
 * — своей транзакцией. Одно напоминание на неделю и подключение, одно «до срока» на подключение и день
 * (ключи в базе): повтор и одновременный запуск второй строки не создают. В остальные дни недели
 * задача только повторяет то, что в выбранный день не ушло (до трёх попыток), — сбой Telegram не
 * оставляет клиента без напоминания на неделю. Заблокированной организации бот не пишет. Организация, у
 * которой запуск упал, остальным не мешает.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-11
export const contractorDebtJob: Job = {
  name: 'contractor-page.telegram-debt',
  // Каждые 5 минут по Бишкеку: время отправки организации — любая минута суток (`cpNoticeDay`).
  cron: '*/5 * * * *',
  lookbackMinutes: 60,
  async run(ctx, slot) {
    const texts = await serverTexts(ctx);
    const t: Translate = (key, params) => formatText(texts(key), params);
    const failed: string[] = [];
    let sent = 0;
    let orgs = 0;
    for (const orgId of await orgIds(ctx.db)) {
      try {
        const prepared = await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
          prepareDebt(tx, t, orgId, slot),
        );
        if (!prepared) continue;
        orgs += 1;
        sent += await deliverClientMessages(ctx, { orgId, userId: null }, prepared);
      } catch (err) {
        failed.push(orgId);
        ctx.logger.error(
          { job: 'contractor-page.telegram-debt', orgId, err },
          'Напоминания о долге контрагентам организации не отправлены',
        );
      }
    }
    if (orgs) {
      ctx.logger.info(
        { job: 'contractor-page.telegram-debt', orgs, sent },
        'Напоминания о долге отправлены',
      );
    }
    if (failed.length) {
      throw new Error(`contractor-page.telegram-debt: не отправлено организаций: ${failed.length}`);
    }
  },
};

/**
 * Клиент написал боту «Напоминать»: напоминания о долге у этого чата включаются снова (шаблон
 * `tgCpNoDebtOk` обещает эту команду; в прототипе её нет). Чат подключён к нескольким контрагентам —
 * включаются у всех, где клиент их выключил. false — это не команда или у чата нет действующих
 * подключений: отвечает обычный разбор.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-5
export async function clientDebtOn(deps: ApiDeps, chatId: number, text: string): Promise<boolean> {
  if (!cpTgDebtOnCommand(text)) return false;
  const links = await contractorTelegramChats(deps.db, chatId);
  if (links.length === 0) return false;
  // Только действующие подключения — то же правило, что у «Не напоминать» и у получателей
  // напоминания: функции учётной политики включены, раздел «Telegram» страницы показан, контрагент
  // не в архиве, организация работает.
  const names: string[] = [];
  let active = 0;
  for (const link of links) {
    const changed = await withOrgContext(
      deps.db,
      { orgId: link.orgId, userId: null },
      async (tx) => {
        if (!(await contractorPageSectionShown(tx, link.contractorId, 'tg'))) return null;
        const recipients = await contractorTelegramRecipients(tx, link.contractorId);
        if (!recipients.some((r) => r.linkId === link.linkId)) return null;
        const row = await setContractorTelegramNoDebt(tx, {
          linkId: link.linkId,
          chatId,
          noDebt: false,
        });
        return { changed: row !== null };
      },
    );
    if (!changed) continue;
    active += 1;
    if (changed.changed) names.push(link.contractor);
  }
  if (active === 0) return false;
  const t = await serverTexts(deps);
  await sendNow(
    deps,
    chatId,
    names.length
      ? formatText(t('cppage.tg.debt_on'), { contractor: names.join(', ') })
      : t('cppage.tg.debt_on_already'),
    'cp_telegram',
  );
  return true;
}
