import { applyPhoneMask, formatPhone, maskDigits, phoneProblem } from '../staff/rules';
import type { PhoneCode, PhoneCodeOption } from '../staff/rules';

/*
 * Реквизиты для переводов (ТЗ «Моя организация» → «Реквизиты организации для приёма денег», «Профиль
 * пользователя» → «Мои реквизиты для переводов», «Банковские провайдеры»; решение заказчика 25.10.2026;
 * прототип core/requisites.js, modules/org.js orgAccDlg, modules/profile.js walletDlg).
 * - Счёт организации: «Расчётный счёт» (банк, номер счёта, БИК) или «Перевод по номеру телефона»
 *   (номер и банки, к которым он привязан), получатель, назначение и «Основной» для налогов и для
 *   обслуживания.
 * - Реквизит сотрудника: «Счёт или кошелёк» (провайдер и номер) или «Перевод по номеру телефона»,
 *   получатель и «Основной».
 */

/** Вид реквизита: счёт (у организации — «Расчётный счёт», у сотрудника — «Счёт или кошелёк») или перевод по номеру. */
export const REQUISITE_KINDS = ['acc', 'phone'] as const;
export type RequisiteKind = (typeof REQUISITE_KINDS)[number];

/** «Назначение» счёта организации: налоги и обслуживание (по умолчанию), только налоги, только обслуживание. */
export const ACCOUNT_PURPOSES = ['both', 'tax', 'fee'] as const;
export type AccountPurpose = (typeof ACCOUNT_PURPOSES)[number];

/** За что контрагент переводит деньги: налоги или плата за обслуживание. */
export type PaymentPurpose = 'tax' | 'fee';

/** Куда контрагент переводит деньги на налоги: на кошелёк ответственного (по умолчанию) или на счёт организации. */
export const PAYS_TO = ['emp', 'org'] as const;
export type PaysTo = (typeof PAYS_TO)[number];

/** Подходит ли счёт с таким назначением для этих денег (прототип `accUse`). */
export function purposeServes(purpose: AccountPurpose, what: PaymentPurpose): boolean {
  return purpose === 'both' || purpose === what;
}

/** Провайдер справочника «Банковские провайдеры» для выбора в реквизите. */
export interface BankOption {
  code: string;
  name: string;
  /** «Переводы по номеру телефона». */
  byPhone: boolean;
  active: boolean;
}

/**
 * Провайдеры для выбора (прототип `rqProvs`): в «Расчётном счёте» и «Счёте или кошельке» — все
 * действующие, в «Переводе по номеру телефона» — только с «Переводы по номеру телефона». Уже выбранные
 * в реквизите (`keep`) остаются, даже если их отключили: реквизит не теряет своё значение.
 */
export function bankChoices(
  banks: readonly BankOption[],
  kind: RequisiteKind,
  keep: readonly string[] = [],
): BankOption[] {
  return banks.filter((b) => (b.active && (kind === 'acc' || b.byPhone)) || keep.includes(b.code));
}

/** Банк нового расчётного счёта организации по умолчанию — как в прототипе: Optima Bank. */
export const DEFAULT_ORG_BANK_CODE = 'БНК-14';

/** Сколько цифр в строке: номер счёта вводят как удобно — с пробелами или без. */
const digitCount = (value: string) => value.replace(/\D/g, '').length;

/** Номер расчётного счёта — 16 цифр (прототип orgAccDlg: «Счёт — 16 цифр»). */
export const ACCOUNT_NO_DIGITS = 16;
/** Номер счёта или кошелька сотрудника — не меньше 6 цифр (прототип walletDlg). */
export const WALLET_NO_MIN_DIGITS = 6;
/** Предел длины номера счёта или кошелька и имени получателя: длиннее не бывает. */
export const REQUISITE_NO_MAX_LENGTH = 40;
export const HOLDER_NAME_MAX_LENGTH = 200;

/** Почему реквизит не сохранить (поле — по коду, текст — `REQUISITE_MESSAGES`). */
export const REQUISITE_PROBLEMS = [
  'bank_required',
  'bank_unavailable',
  'account_no_invalid',
  'bik_invalid',
  'wallet_no_invalid',
  'invalid_phone',
  'phone_banks_required',
] as const;
export type RequisiteProblem = (typeof REQUISITE_PROBLEMS)[number];

export const REQUISITE_MESSAGES: Record<RequisiteProblem, string> = {
  bank_required: 'Выберите банк или кошелёк',
  bank_unavailable: 'Этого банка или кошелька нет среди действующих в справочнике',
  account_no_invalid: 'Счёт — 16 цифр',
  bik_invalid: 'БИК — 6 цифр',
  wallet_no_invalid: 'Введите номер: не меньше 6 цифр',
  invalid_phone: 'Введите номер полностью',
  phone_banks_required: 'Отметьте хотя бы один банк или кошелёк',
};

/** Реквизит из формы: у счёта — банк и номер (у организации ещё БИК), у перевода по номеру — телефон и банки. */
export interface RequisiteInput {
  kind: RequisiteKind;
  bankCode: string | null;
  accountNo: string | null;
  bik: string | null;
  /** «+996555123456». */
  phone: string | null;
  phoneBanks: readonly string[];
}

/** Поле формы реквизита, к которому относится ошибка. */
export type RequisiteField = 'bankCode' | 'accountNo' | 'bik' | 'phone' | 'phoneBanks';

/**
 * Почему реквизит не сохранить — по полю (прототип orgAccDlg и walletDlg: ошибки сразу под всеми
 * неверными полями); пусто — можно. `owner` — чей реквизит: у организации номер счёта — 16 цифр и БИК —
 * 6 цифр, у сотрудника номер — не меньше 6 цифр и БИКа нет. `keep` — коды банков, выбранные в реквизите
 * до правки: отключённый с тех пор банк остаётся допустимым.
 */
export function requisiteProblems(
  input: RequisiteInput,
  owner: 'org' | 'employee',
  banks: readonly BankOption[],
  codes: readonly PhoneCode[],
  keep: readonly string[] = [],
): { problem: RequisiteProblem; field: RequisiteField }[] {
  const allowed = new Set(bankChoices(banks, input.kind, keep).map((b) => b.code));
  const problems: { problem: RequisiteProblem; field: RequisiteField }[] = [];
  const add = (problem: RequisiteProblem, field: RequisiteField) =>
    problems.push({ problem, field });
  if (input.kind === 'acc') {
    if (!input.bankCode) add('bank_required', 'bankCode');
    else if (!allowed.has(input.bankCode)) add('bank_unavailable', 'bankCode');
    const digits = digitCount(input.accountNo ?? '');
    if (owner === 'org') {
      if (digits < ACCOUNT_NO_DIGITS) add('account_no_invalid', 'accountNo');
      if (!/^\d{6}$/.test(input.bik ?? '')) add('bik_invalid', 'bik');
    } else if (digits < WALLET_NO_MIN_DIGITS) {
      add('wallet_no_invalid', 'accountNo');
    }
    return problems;
  }
  if (!input.phone || phoneProblem(input.phone, codes)) add('invalid_phone', 'phone');
  if (input.phoneBanks.length === 0) add('phone_banks_required', 'phoneBanks');
  else if (input.phoneBanks.some((code) => !allowed.has(code))) {
    add('bank_unavailable', 'phoneBanks');
  }
  return problems;
}

/** Первая причина, почему реквизит не сохранить (`requisiteProblems`); null — можно. */
export function requisiteProblem(
  input: RequisiteInput,
  owner: 'org' | 'employee',
  banks: readonly BankOption[],
  codes: readonly PhoneCode[],
  keep: readonly string[] = [],
): { problem: RequisiteProblem; field: RequisiteField } | null {
  return requisiteProblems(input, owner, banks, codes, keep)[0] ?? null;
}

/**
 * Реквизит к сохранению: поля другого вида очищаются (у сотрудника БИКа нет), номер — без пробелов по
 * краям, банки номера — без повторов и по порядку справочника (как в списке флажков формы).
 */
export function normalizeRequisite<T extends RequisiteInput>(
  input: T,
  owner: 'org' | 'employee',
  banks: readonly { code: string }[],
): T {
  if (input.kind === 'acc') {
    return {
      ...input,
      accountNo: input.accountNo?.trim() ?? null,
      bik: owner === 'org' ? (input.bik?.trim() ?? null) : null,
      phone: null,
      phoneBanks: [],
    };
  }
  const order = new Map(banks.map((b, i) => [b.code, i]));
  const place = (code: string) => order.get(code) ?? Number.MAX_SAFE_INTEGER;
  const phoneBanks = [...new Set(input.phoneBanks)].sort((a, b) => place(a) - place(b));
  return { ...input, bankCode: null, accountNo: null, bik: null, phoneBanks };
}

/**
 * Номер так, как его набирают в приложении банка (прототип `phLocal`): у номеров Кыргызстана — с нулём,
 * «0555 123 456»; у других стран — «+7 701 123 45 67». Номер, который не подходит ни к одной маске, —
 * как есть.
 */
export function localPhoneText(phone: string, codes: readonly PhoneCodeOption[]): string {
  const digits = /^\+(\d+)$/.exec(phone)?.[1];
  const code = digits
    ? codes
        .filter(
          (c) => digits.startsWith(c.code) && digits.length === c.code.length + maskDigits(c.mask),
        )
        .sort((a, b) => b.code.length - a.code.length)[0]
    : undefined;
  if (digits && code?.cc === 'KG') {
    return `0${applyPhoneMask(code.mask, digits.slice(code.code.length))}`;
  }
  return formatPhone(phone, codes);
}

/** Номер реквизита в таблицах (прототип `rqNum`): у перевода по номеру — телефон, у счёта — номер. */
export function requisiteNumberText(
  r: { kind: RequisiteKind; accountNo: string | null; phone: string | null },
  codes: readonly PhoneCodeOption[],
): string {
  if (r.kind === 'phone') return r.phone ? localPhoneText(r.phone, codes) : '';
  return r.accountNo ?? '';
}

/**
 * Реквизит одной строкой для сообщения контрагенту (ТЗ «Напоминания контрагенту в WhatsApp», прототип
 * `rqTxt`): «Перевод по номеру 0555 123 456 (M-Bank, Бакай Банк), получатель Асанов А.», «Optima Bank:
 * р/с …, БИК …, получатель ОсОО …», у счёта сотрудника — «M-Bank: 0555 123 456». Тексты — из словаря.
 */
export interface RequisiteTextParts {
  kind: RequisiteKind;
  /** Название банка счёта; у перевода по номеру — названия банков номера по порядку справочника. */
  bankNames: readonly string[];
  accountNo: string | null;
  bik: string | null;
  /** Номер для показа (`localPhoneText`). */
  phoneText: string;
  holderName: string;
}

export function requisiteText(
  r: RequisiteTextParts,
  owner: 'org' | 'employee',
  t: (
    key:
      | 'money.req.text.phone'
      | 'money.req.text.account'
      | 'money.req.text.wallet'
      | 'money.req.text.holder',
    params: Record<string, string>,
  ) => string,
): string {
  const holder = r.holderName ? t('money.req.text.holder', { name: r.holderName }) : '';
  if (r.kind === 'phone') {
    return t('money.req.text.phone', {
      phone: r.phoneText,
      banks: r.bankNames.join(', '),
      holder,
    });
  }
  const bank = r.bankNames[0] ?? '';
  if (owner === 'org') {
    return t('money.req.text.account', {
      bank,
      account: r.accountNo ?? '',
      bik: r.bik ?? '',
      holder,
    });
  }
  return t('money.req.text.wallet', { bank, account: r.accountNo ?? '' });
}

/** Отметки «Основной» счёта организации. */
export interface OrgAccountMain {
  id: string;
  purpose: AccountPurpose;
  mainTax: boolean;
  mainFee: boolean;
}

/**
 * «Основной» для налогов и для обслуживания после добавления, изменения или удаления счёта (прототип
 * orgAccDlg и `rqMainFix`): счёт, отмеченный в форме основным, становится им, а у остальных отметка
 * снимается; у счёта, назначение которого не подходит, отметки нет; если среди подходящих счетов
 * основного не осталось — им становится первый. `accounts` — уже с сохраняемым счётом, по порядку
 * таблицы; `saved` — номер сохраняемого счёта (его отметки — из формы).
 */
export function orgAccountMains<T extends OrgAccountMain>(
  accounts: readonly T[],
  saved?: string,
): T[] {
  const own = accounts.find((a) => a.id === saved);
  const result = accounts.map((a) => ({ ...a }));
  for (const [what, key] of [
    ['tax', 'mainTax'],
    ['fee', 'mainFee'],
  ] as const) {
    const pick = own && own[key] && purposeServes(own.purpose, what) ? own.id : null;
    let seen = false;
    for (const a of result) {
      if (!purposeServes(a.purpose, what) || (pick !== null && a.id !== pick)) a[key] = false;
      if (a[key]) {
        if (seen) a[key] = false;
        seen = true;
      }
    }
    const first = result.find((a) => purposeServes(a.purpose, what));
    if (!seen && first) first[key] = true;
  }
  return result;
}

/**
 * Основной счёт организации для налогов или для обслуживания (прототип `orgMain`): отмеченный, иначе
 * первый подходящий; null — подходящих счетов нет.
 */
export function orgMainAccount<T extends OrgAccountMain>(
  accounts: readonly T[],
  what: PaymentPurpose,
): T | null {
  const serving = accounts.filter((a) => purposeServes(a.purpose, what));
  return serving.find((a) => (what === 'tax' ? a.mainTax : a.mainFee)) ?? serving[0] ?? null;
}

/** Отметка «Основной» реквизита сотрудника. */
export interface WalletMain {
  id: string;
  isMain: boolean;
}

/**
 * «Основной» у реквизитов сотрудника после добавления, изменения, удаления или «Сделать основным»
 * (прототип walletDlg и profileDlg): отмеченный основным становится им, у остальных отметка снимается;
 * если основного не осталось — им становится первый.
 */
export function walletMains<T extends WalletMain>(wallets: readonly T[], saved?: string): T[] {
  const own = wallets.find((w) => w.id === saved);
  const mainId =
    (own?.isMain ? own.id : undefined) ?? wallets.find((w) => w.isMain)?.id ?? wallets[0]?.id;
  return wallets.map((w) => ({ ...w, isMain: w.id === mainId }));
}

/**
 * Куда переводить деньги на налоги контрагента (ТЗ «Счёт организации»: «В карточке контрагента
 * выбирается, куда он переводит деньги на налоги…»; прототип ui/status-scale.js `waDlg`): на счёт
 * организации — её счета для налогов, основной отмечен; на кошелёк ответственного — его реквизиты, основной
 * отмечен. Пусто — реквизитов нет: напоминание без них не отправляется.
 */
export function taxRequisiteChoices<A extends OrgAccountMain, W extends WalletMain>(
  paysTo: PaysTo,
  orgAccounts: readonly A[],
  holderWallets: readonly W[],
): { requisite: A | W; main: boolean }[] {
  if (paysTo === 'org') {
    const main = orgMainAccount(orgAccounts, 'tax');
    return orgAccounts
      .filter((a) => purposeServes(a.purpose, 'tax'))
      .map((a) => ({ requisite: a, main: a === main }));
  }
  return holderWallets.map((w) => ({ requisite: w, main: w.isMain }));
}

/**
 * Один реквизит для налогов на странице контрагента («Как оплатить», прототип cp-page.js): основной счёт
 * организации для налогов или основной реквизит ответственного (без отметки — первый); null — нет.
 */
export function mainTaxRequisite<A extends OrgAccountMain, W extends WalletMain>(
  paysTo: PaysTo,
  orgAccounts: readonly A[],
  holderWallets: readonly W[],
): A | W | null {
  if (paysTo === 'org') return orgMainAccount(orgAccounts, 'tax');
  return holderWallets.find((w) => w.isMain) ?? holderWallets[0] ?? null;
}

/**
 * Предупреждение при удалении счёта (ТЗ: «Если удаляется единственный счёт, а часть контрагентов
 * переводит деньги на счёт организации, система предупреждает…»; прототип renderOrg `noTax && used`):
 * удаляется единственный счёт для налогов, а `payers` контрагентов переводят деньги на налоги на счёт
 * организации.
 */
export function lastTaxAccountWarning(
  accounts: readonly OrgAccountMain[],
  removed: string,
  payers: number,
): boolean {
  const account = accounts.find((a) => a.id === removed);
  if (!account || !purposeServes(account.purpose, 'tax') || payers <= 0) return false;
  return accounts.filter((a) => purposeServes(a.purpose, 'tax')).length === 1;
}
