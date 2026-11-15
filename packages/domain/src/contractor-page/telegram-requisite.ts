import type { RequisiteKind } from '../money/requisites';
import { BOT_COPY_MAX, type BotButton, type BotMessage } from '../telegram/bot-message';

/*
 * Реквизиты для перевода в сообщениях клиенту в Telegram (доработки 14.11.2026, блок 4, пункты 1–3;
 * прототип v110 modules/cp-telegram.js: `pgRqWho`, `pgRqLines`, `pgRqText`, `pgRqBtn`, `tgAct('cp-req')`).
 * Реквизиты видны прямо в тексте — блоком «Реквизиты для перевода — <чьи>», под ним кнопка копирования
 * по виду реквизита. Какой реквизит и можно ли его показать клиенту, решает вызывающий (сервер).
 */

/** Реквизит для перевода: счёт организации или реквизит ответственного сотрудника. */
export interface TransferRequisite {
  /** Чей: у счёта организации — банк, счёт и БИК; у сотрудника — «Банк или кошелёк» и счёт. */
  owner: 'org' | 'employee';
  kind: RequisiteKind;
  /** Номер телефона, как на странице контрагента (`localPhoneText`). */
  phoneText: string;
  /** У номера телефона — банки и кошельки, к которым он привязан; у счёта — его банк. */
  bankNames: readonly string[];
  accountNo: string | null;
  bik: string | null;
  holderName: string;
}

/** Подписи строк реквизита (словарь, прототип `pgRqLines`). */
export interface TransferLabels {
  /** «Перевод по номеру телефона» */
  phone: string;
  /** «Банки и кошельки» */
  banks: string;
  /** «Банк» */
  bank: string;
  /** «Банк или кошелёк» — у счёта или кошелька сотрудника. */
  wallet: string;
  /** «Счёт» */
  account: string;
  /** «БИК» */
  bik: string;
  /** «Получатель» */
  holder: string;
}

/**
 * Строки реквизита (прототип `pgRqLines`): по номеру телефона — номер, банки и кошельки, получатель;
 * расчётный счёт организации — банк, счёт, БИК, получатель; счёт или кошелёк сотрудника — «Банк или
 * кошелёк», счёт, получатель (без БИК). Пустые строки не выводятся.
 */
export function transferLines(r: TransferRequisite, l: TransferLabels): string[] {
  const bank = r.bankNames[0] ?? '';
  const lines: [string, string][] =
    r.kind === 'phone'
      ? [
          [l.phone, r.phoneText],
          [l.banks, r.bankNames.join(', ')],
        ]
      : r.owner === 'org'
        ? [
            [l.bank, bank],
            [l.account, r.accountNo ?? ''],
            [l.bik, r.bik ?? ''],
          ]
        : [
            [l.wallet, bank],
            [l.account, r.accountNo ?? ''],
          ];
  lines.push([l.holder, r.holderName]);
  return lines.filter(([, value]) => value.trim()).map(([label, value]) => `${label}: ${value}`);
}

/** Блок реквизитов в тексте (прототип `pgRqText`): заголовок «Реквизиты для перевода — …» и строки. */
export const transferText = (head: string, lines: readonly string[]): string =>
  [head, ...lines].join('\n');

/**
 * Кнопка копирования по виду реквизита (прототип `pgRqBtn`): у номера телефона — «Скопировать номер
 * телефона», копирует только номер без пробелов; у счёта — «Скопировать реквизиты для перевода»,
 * копирует строки реквизита. Копирует сразу, без нового сообщения в чате. Текст длиннее предела
 * кнопки копирования (длинное имя получателя) — кнопки нет: реквизиты и так в тексте сообщения.
 */
export function transferCopyButton(
  r: TransferRequisite,
  lines: readonly string[],
  labels: { phone: string; requisites: string },
): BotButton | null {
  const copy = r.kind === 'phone' ? r.phoneText.replace(/\s/g, '') : lines.join('\n');
  if (!copy || copy.length > BOT_COPY_MAX) return null;
  return { text: r.kind === 'phone' ? labels.phone : labels.requisites, copy };
}

/** Реквизиты для сообщения: блок текста и кнопка копирования. */
export interface TransferBlock {
  text: string;
  copy: BotButton | null;
}

/** Блок реквизитов и кнопка копирования одним вызовом (`head` — заполненный `tgRqHead`). */
export function transferBlock(
  r: TransferRequisite,
  head: string,
  labels: TransferLabels & { copyPhone: string; copyRequisites: string },
): TransferBlock {
  const lines = transferLines(r, labels);
  return {
    text: transferText(head, lines),
    copy: transferCopyButton(r, lines, {
      phone: labels.copyPhone,
      requisites: labels.copyRequisites,
    }),
  };
}

/**
 * Для каких сумм долга «Показать реквизиты для перевода» (`CP_TG_REQ_ACTION`) присылает реквизиты:
 * `arg` кнопки — «tax», «fee» или «tax-fee» (знаки данных кнопки — `botPressData`).
 */
export type CpReqParts = { tax: boolean; fee: boolean };

export const cpReqArg = (p: CpReqParts): string =>
  [p.tax ? 'tax' : null, p.fee ? 'fee' : null].filter(Boolean).join('-');

/** Разбор `arg` кнопки; неизвестное — ничего. */
export function parseCpReqArg(arg: string | null | undefined): CpReqParts {
  const parts = new Set((arg ?? '').split('-'));
  return { tax: parts.has('tax'), fee: parts.has('fee') };
}

/**
 * Сообщение с реквизитами по нажатию «Показать реквизиты для перевода» (прототип `tgAct('cp-req')`):
 * заголовок «Для налогов» или «Для обслуживания», контрагент, блок реквизитов без сумм и кнопка
 * копирования.
 */
export function transferBotMessage(o: {
  heading: string;
  contractor: string;
  block: TransferBlock;
}): BotMessage {
  return {
    heading: o.heading,
    sub: o.contractor,
    text: o.block.text,
    ...(o.block.copy ? { buttons: [[o.block.copy]] } : {}),
  };
}
