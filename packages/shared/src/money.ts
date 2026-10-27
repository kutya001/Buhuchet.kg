import {
  ACCOUNT_PURPOSES,
  BANK_KINDS,
  HOLDER_NAME_MAX_LENGTH,
  REQUISITE_KINDS,
  REQUISITE_NO_MAX_LENGTH,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion, Uuid } from './common';

/*
 * Реквизиты для переводов (задача 2.18): справочник «Банковские провайдеры», счета организации и
 * реквизиты сотрудников. Банки — кодами справочника, телефон — «+996555123456».
 */

/** «Банковские провайдеры» по порядку справочника, с отключёнными: реквизит хранит прежний банк. */
export const Banks = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      kind: z.enum(BANK_KINDS),
      /** «Переводы по номеру телефона». */
      byPhone: z.boolean(),
      note: z.string(),
      active: z.boolean(),
    }),
  ),
});
export type Banks = z.infer<typeof Banks>;

const BankCode = z.string().min(1).max(32);
/** Номер счёта или кошелька — как ввели, с пробелами; цифры проверяет правило домена. */
const RequisiteNo = z.string().trim().max(REQUISITE_NO_MAX_LENGTH);
const Phone = z.string().regex(/^\+\d{6,15}$/);
const HolderName = z.string().trim().max(HOLDER_NAME_MAX_LENGTH);

/** Поля реквизита из формы: у счёта — банк и номер, у перевода по номеру — телефон и банки. */
const RequisiteBody = {
  kind: z.enum(REQUISITE_KINDS),
  bankCode: BankCode.nullable(),
  accountNo: RequisiteNo.nullable(),
  phone: Phone.nullable(),
  phoneBanks: z.array(BankCode).max(50),
  holderName: HolderName,
};

/** Счёт организации («Моя организация» → «Реквизиты для приёма денег от контрагентов»). */
export const OrgAccount = z.object({
  id: Uuid,
  ...RequisiteBody,
  bik: z.string().nullable(),
  purpose: z.enum(ACCOUNT_PURPOSES),
  mainTax: z.boolean(),
  mainFee: z.boolean(),
  version: RecordVersion,
});
export type OrgAccount = z.infer<typeof OrgAccount>;

export const OrgAccounts = z.object({ items: z.array(OrgAccount) });
export type OrgAccounts = z.infer<typeof OrgAccounts>;

/** «Добавить» и «Сохранить» в окне счёта; `version` — при изменении. */
export const OrgAccountSave = z.object({
  ...RequisiteBody,
  bik: z.string().trim().max(6).nullable(),
  purpose: z.enum(ACCOUNT_PURPOSES),
  mainTax: z.boolean(),
  mainFee: z.boolean(),
});
export type OrgAccountSave = z.infer<typeof OrgAccountSave>;

export const OrgAccountUpdate = OrgAccountSave.extend({ version: RecordVersion });
export type OrgAccountUpdate = z.infer<typeof OrgAccountUpdate>;

/** Реквизит сотрудника для переводов («Мой профиль», карточка сотрудника). */
export const Wallet = z.object({
  id: Uuid,
  ...RequisiteBody,
  isMain: z.boolean(),
  version: RecordVersion,
});
export type Wallet = z.infer<typeof Wallet>;

export const Wallets = z.object({ items: z.array(Wallet) });
export type Wallets = z.infer<typeof Wallets>;

export const WalletSave = z.object({ ...RequisiteBody, isMain: z.boolean() });
export type WalletSave = z.infer<typeof WalletSave>;

export const WalletUpdate = WalletSave.extend({ version: RecordVersion });
export type WalletUpdate = z.infer<typeof WalletUpdate>;

/** Номер записи в пути и версия, которую видел пользователь, — для «Удалить». */
export const RequisiteIdParam = z.object({ id: Uuid });
export const RequisiteDeleteQuery = z.object({
  version: z.coerce.number().int().nonnegative(),
});
