import {
  contractorDebtSwitch,
  contractorMoneyOf,
  contractorsWithTelegram,
  contractorTaxRequisiteText,
  contractorTelegramChats,
  contractorTelegramDebtSettings,
  contractorPageSectionShown,
  contractorTelegramRecipients,
  debtLinkIds,
  feeSubject,
  getContractor,
  insertContractorTelegramMessage,
  mainFeeRequisite,
  messageTemplates,
  orgIds,
  refreshContractorTelegramMessage,
  setContractorTelegramNoDebt,
  unsentDebtMessages,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  botMessageProblem,
  botTemplate,
  contractorFees,
  cpDebt,
  cpTgDebtOnCommand,
  debtBotMessage,
  debtReminderDue,
  debtWeek,
  fillTemplate,
  formatSomWithUnit,
  formatText,
  lastDayOf,
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

/*
 * Напоминание клиенту о долге в Telegram (доработки 13.11.2026, задача К5; прототип v94
 * modules/cp-telegram.js: `pgDebt`, `pgDebtTo`, `pgDebtMsg`, `tgAct('cp-nodebt')`). Раз в неделю, в
 * понедельник в 10:00, подключившим Telegram: недостача денег на налоги этого месяца и долг за
 * обслуживание. Клиент получает только то, что видит на своей странице: часть долга, раздел которой
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
 * Напоминание о долге (прототип pgDebtMsg). Реквизиты — те же, что в разделе «Как оплатить» страницы
 * контрагента, и только пока этот раздел клиенту показан. Тексты словаря (`t`) читаются до транзакции.
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
  const [taxRequisite, feeRequisite] = await Promise.all([
    payShown && debt.short
      ? contractorTaxRequisiteText(
          tx,
          { paysTo: cp.paysTo, responsibleId: cp.responsible?.id ?? null },
          t,
        )
      : null,
    payShown && debt.fee ? mainFeeRequisite(tx, t).then((r) => r?.text ?? null) : null,
  ]);
  const [text, copyTax, copyFee, noDebt] = await Promise.all([
    templateText(tx, 'tgCpDebt', { контрагент: cp.name, сумма: formatSomWithUnit(debt.sum) }),
    templateText(tx, 'tgBtnCpReqTax'),
    templateText(tx, 'tgBtnCpReqFee'),
    templateText(tx, 'tgBtnCpNoDebt'),
  ]);
  const message = debtBotMessage({
    contractor: cp.name,
    debt,
    taxRequisite,
    feeRequisite,
    text,
    labels: {
      heading: t('cppage.tg.debt.heading'),
      what: t('cppage.tg.debt.what'),
      amount: t('cppage.tg.debt.amount'),
      short: t('cppage.tg.debt.short'),
      fee: t('cppage.tg.debt.fee'),
      copyTax,
      copyFee,
      noDebt,
    },
  });
  const problem = botMessageProblem(message);
  if (problem) throw new Error(`Напоминание о долге контрагенту: ${problem}`);
  return message;
}

/**
 * Напоминания одной организации: что отправить. Всё — в одной транзакции задачи. В понедельник
 * (`create`) записываются новые; в остальные дни недели — только повтор не ушедших в понедельник,
 * сегодняшним сообщением (долг погашен — повтора нет).
 */
async function prepareDebt(
  tx: Tx,
  t: Translate,
  today: IsoDate,
  create: boolean,
): Promise<PreparedClientMessage[]> {
  const settings = await contractorTelegramDebtSettings(tx);
  if (!settings.on) return [];
  const week = debtWeek(today);
  const out: PreparedClientMessage[] = [];
  for (const contractorId of await contractorsWithTelegram(tx)) {
    const own = await contractorDebtSwitch(tx, contractorId);
    if (!own || own.off) continue;
    // Клиент нажал «Не напоминать» — этому чату напоминания не идут.
    const recipients = (await contractorTelegramRecipients(tx, contractorId)).filter(
      (r) => !r.noDebt,
    );
    if (!recipients.length) continue;
    const done = await debtLinkIds(tx, contractorId, week);
    const fresh = create ? recipients.filter((r) => !done.has(r.linkId)) : [];
    const retry = (await unsentDebtMessages(tx, contractorId, week, DEBT_MAX_ATTEMPTS)).filter(
      (m) => recipients.some((r) => r.linkId === m.linkId),
    );
    if (!fresh.length && !retry.length) continue;
    const cp = await getContractor(tx, contractorId, { scope: undefined, today });
    if (!cp) continue;
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
 * «Напоминать контрагентам о долге» (прототип: «раз в неделю, в понедельник в 10:00»): по всем
 * организациям, каждая — своей транзакцией. Одно напоминание на неделю и подключение (ключ в базе):
 * повтор и одновременный запуск второй строки не создают. Задача идёт каждый день: в понедельник
 * записывает и отправляет напоминания, в остальные дни только повторяет то, что в понедельник не ушло
 * (до трёх попыток) — сбой Telegram в понедельник не оставляет клиента без напоминания на неделю.
 * Заблокированной организации бот не пишет. Организация, у которой запуск упал, остальным не мешает.
 */
export const contractorDebtJob: Job = {
  name: 'contractor-page.telegram-debt',
  // 10:00 по Бишкеку (расписания задач — по времени Бишкека).
  cron: '0 10 * * *',
  lookbackMinutes: 24 * 60,
  async run(ctx, slot) {
    const today = bishkekDate(ctx.clock.now());
    // «Понедельник» — по времени запуска из расписания, а не по часам: запуск понедельника, который
    // догоняется во вторник (исполнитель стоял), всё равно создаёт напоминания этой недели.
    const create = weekdayMondayFirst(bishkekDate(slot)) === 0;
    const texts = await serverTexts(ctx);
    const t: Translate = (key, params) => formatText(texts(key), params);
    const failed: string[] = [];
    let sent = 0;
    for (const orgId of await orgIds(ctx.db)) {
      try {
        const prepared = await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
          prepareDebt(tx, t, today, create),
        );
        sent += await deliverClientMessages(ctx, { orgId, userId: null }, prepared);
      } catch (err) {
        failed.push(orgId);
        ctx.logger.error(
          { job: 'contractor-page.telegram-debt', orgId, err },
          'Напоминания о долге контрагентам организации не отправлены',
        );
      }
    }
    ctx.logger.info(
      { job: 'contractor-page.telegram-debt', today, sent },
      'Напоминания о долге отправлены',
    );
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
