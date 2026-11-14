import {
  contractorPageSectionShown,
  contractorTaxTransfer,
  feeTransfer,
  messageTemplates,
  type TransferOf,
  type Tx,
} from '@buhuchet/db';
import {
  botTemplate,
  fillTemplate,
  type ContractorKind,
  transferBlock,
  type PaysTo,
  type TelegramTemplateKey,
  type TransferBlock,
  type Translate,
} from '@buhuchet/domain';

/*
 * Реквизиты для перевода в сообщениях клиенту (доработки 14.11.2026, блок 4, пункты 1–3; прототип v110
 * modules/cp-telegram.js: `pgTaxAcc`, `pgFeeAcc`, `pgRqText`, `pgRqBtn`). Клиент получает реквизиты
 * только пока ему показан раздел «Как оплатить» страницы контрагента: бот не отдаёт того, чего не
 * отдаёт страница (docs/deviations.md п. К-9). Ответ на отправку сотруднику реквизитов не содержит;
 * окно «Напомнить в Telegram» показывает основной счёт организации для обслуживания, как прототип
 * (его и так видит любой сотрудник в счетах организации; docs/deviations.md п. К-10).
 */

/** Блок «Реквизиты для перевода — …» и кнопка копирования: подписи — из словаря и шаблонов бота. */
async function blockOf(tx: Tx, t: Translate, of: TransferOf): Promise<TransferBlock> {
  const templates = await messageTemplates(tx);
  const fill = (key: TelegramTemplateKey, values: Readonly<Record<string, string>> = {}) =>
    fillTemplate(botTemplate(key, templates[key]), values);
  const who =
    of.requisite.owner === 'org'
      ? fill('tgRqOrg', { организация: of.ownerName })
      : fill('tgRqEmp', { сотрудник: of.ownerName });
  return transferBlock(of.requisite, fill('tgRqHead', { чьи: who }), {
    phone: t('cppage.tg.rq.phone'),
    banks: t('cppage.tg.rq.banks'),
    bank: t('cppage.tg.rq.bank'),
    wallet: t('cppage.tg.rq.wallet'),
    account: t('cppage.tg.rq.account'),
    bik: t('cppage.tg.rq.bik'),
    holder: t('cppage.tg.rq.holder'),
    copyPhone: fill('tgBtnCpCopyPhone'),
    copyRequisites: fill('tgBtnCpCopyReq'),
  });
}

/**
 * Реквизиты для налогов в «К оплате»: `hidden` — раздел «Как оплатить» клиенту не показан, `none` —
 * реквизита нет (тогда «К оплате» не уходит ни вручную, ни само).
 */
export type PayRequisite = { state: 'ok'; block: TransferBlock } | { state: 'none' | 'hidden' };

/** Контрагент для реквизита: кому переводит деньги на налоги и кто ответственный. */
export interface RequisiteContractor {
  id: string;
  paysTo: PaysTo;
  responsible: { id: string } | null;
}

/** Есть ли реквизиты для налогов, которые можно отдать клиенту (без сборки сообщения). */
export async function payRequisiteState(
  tx: Tx,
  cp: RequisiteContractor,
): Promise<PayRequisite['state']> {
  if (!(await contractorPageSectionShown(tx, cp.id, 'pay'))) return 'hidden';
  const of = await contractorTaxTransfer(tx, {
    paysTo: cp.paysTo,
    responsibleId: cp.responsible?.id ?? null,
  });
  return of ? 'ok' : 'none';
}

/** Реквизиты для налогов (прототип `pgTaxAcc`) — блок текста и кнопка копирования. */
export async function payRequisite(
  tx: Tx,
  t: Translate,
  cp: RequisiteContractor,
): Promise<PayRequisite> {
  if (!(await contractorPageSectionShown(tx, cp.id, 'pay'))) return { state: 'hidden' };
  const of = await contractorTaxTransfer(tx, {
    paysTo: cp.paysTo,
    responsibleId: cp.responsible?.id ?? null,
  });
  return of ? { state: 'ok', block: await blockOf(tx, t, of) } : { state: 'none' };
}

/**
 * Реквизиты для обслуживания для клиента: есть (`ok`), нет (`none`) или скрыт раздел страницы, без
 * которого они клиенту не уходят (`hidden`: «Как оплатить» или «Оплата за обслуживание»; у разового
 * контрагента раздела платы нет).
 */
export type FeeRequisite =
  | { state: 'ok'; block: TransferBlock }
  | { state: 'none' }
  | { state: 'hidden'; section: 'pay' | 'fee' };

async function feeTransferOf(
  tx: Tx,
  cp: { id: string; oneOff: boolean },
): Promise<
  { state: 'ok'; of: TransferOf } | { state: 'none' } | { state: 'hidden'; section: 'pay' | 'fee' }
> {
  if (!(await contractorPageSectionShown(tx, cp.id, 'pay')))
    return { state: 'hidden', section: 'pay' };
  if (cp.oneOff || !(await contractorPageSectionShown(tx, cp.id, 'fee'))) {
    return { state: 'hidden', section: 'fee' };
  }
  const of = await feeTransfer(tx);
  return of ? { state: 'ok', of } : { state: 'none' };
}

/**
 * Реквизиты для обслуживания (прототип `pgFeeAcc`): основной счёт организации для обслуживания, пока
 * клиенту показан «Как оплатить». Функцию «Плата за обслуживание» проверяет вызывающий. Как на странице
 * (`showFee`): ещё и пока показан раздел «Оплата за обслуживание» и контрагент не разовый — бот не
 * отдаёт того, чего не отдаёт страница (docs/deviations.md п. К-9).
 */
export async function feeRequisiteOf(
  tx: Tx,
  t: Translate,
  cp: { id: string; oneOff: boolean },
): Promise<FeeRequisite> {
  const r = await feeTransferOf(tx, cp);
  return r.state === 'ok' ? { state: 'ok', block: await blockOf(tx, t, r.of) } : r;
}

/** Реквизиты для обслуживания блоком для сообщения; null — нет или клиенту не показаны. */
export async function feeRequisite(
  tx: Tx,
  t: Translate,
  cp: { id: string; kind: ContractorKind },
): Promise<TransferBlock | null> {
  const r = await feeRequisiteOf(tx, t, { id: cp.id, oneOff: cp.kind === 'oneoff' });
  return r.state === 'ok' ? r.block : null;
}
