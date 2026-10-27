'use client';

import { DEFAULT_ORG_BANK_CODE, purposeServes, type AccountPurpose } from '@buhuchet/domain';
import { OrgAccounts, type OrgAccount } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CheckRow,
  ConfirmDialog,
  Field,
  FormGrid,
  Hint,
  Icon,
  iconButtonClass,
  inputClass,
  MiniTable,
  miniWide,
  MONO_CLASS,
  Modal,
  Note,
  Pill,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { phoneCodesQuery } from '../staff/staff-data';
import { banksQuery, orgAccountsQuery } from './money-data';
import {
  bankText,
  banksOf,
  checkDraft,
  draftOf,
  kindText,
  numberText,
  RequisiteFields,
  type BankItem,
  type PhoneCodeItem,
  type RequisiteDraft,
  type RequisiteErrors,
} from './requisite-form';

/*
 * «Моя организация» → «Реквизиты для приёма денег от контрагентов» (задача 2.18; прототип
 * modules/org.js `orgAccRows`, `orgAccDlg`): счета организации, «Добавить счёт», «Изменить» и «Удалить»
 * с правом «Настройки и учётная политика»; без права и в окне профиля организации — только просмотр.
 */

const PURPOSES: AccountPurpose[] = ['both', 'tax', 'fee'];

/** Отказы сервера, которые показываются под своим полем. */
const FIELD_OF: Record<string, keyof RequisiteErrors> = {
  bank_required: 'bankCode',
  account_no_invalid: 'accountNo',
  bik_invalid: 'bik',
  invalid_phone: 'phone',
  phone_banks_required: 'phoneBanks',
};

export function OrgAccountsBox({
  editable,
  orgName,
}: {
  /** Право «Настройки и учётная политика» на вкладке «Основное»; в окне профиля — false. */
  editable: boolean;
  /** «Получатель» нового счёта по умолчанию. */
  orgName: string;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const accounts = useQuery(orgAccountsQuery);
  const banks = useQuery(banksQuery);
  const codes = useQuery(phoneCodesQuery);
  const [dialog, setDialog] = useState<{ account: OrgAccount | null } | null>(null);
  const [removing, setRemoving] = useState<OrgAccount | null>(null);

  if (accounts.isError || banks.isError || codes.isError) {
    return <Note tone="bad">{t('money.load_error')}</Note>;
  }
  if (!accounts.data || !banks.data || !codes.data) return null;
  const list = accounts.data;
  const bankList = banks.data;

  const remove = async (account: OrgAccount) => {
    const res = await callApi(() =>
      api.api.org.accounts[':id'].$delete({
        param: { id: account.id },
        query: { version: String(account.version) },
      }),
    );
    if (!res.ok) {
      void client.invalidateQueries({ queryKey: orgAccountsQuery.queryKey });
      return toast(errorText(res.error), { bad: true });
    }
    client.setQueryData(orgAccountsQuery.queryKey, OrgAccounts.parse(res.data).items);
    toast(t('money.org.deleted'), { icon: 'trash' });
  };

  const main = (label: string, on: boolean) =>
    on ? (
      <Pill tone="ok" icon="star">
        {label}
      </Pill>
    ) : null;

  return (
    <Box
      title={t('money.org.title')}
      actions={
        editable ? (
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            data-org-account-add
            onClick={() => setDialog({ account: null })}
          >
            <Icon name="plus" size="sm" />
            {t('money.org.add')}
          </button>
        ) : null
      }
    >
      <MiniTable
        label={t('money.org.title')}
        empty={t('money.org.empty')}
        columns={[
          { key: 'kind', label: t('money.col.kind') },
          { key: 'bank', label: t('money.col.bank') },
          { key: 'number', label: t('money.col.number') },
          { key: 'holder', label: t('money.col.holder') },
          { key: 'purpose', label: t('money.col.purpose') },
          { key: 'main', label: t('money.col.main') },
          ...(editable ? [{ key: 'actions', label: '', actions: true }] : []),
        ]}
        rows={list.map((a) => ({
          key: a.id,
          wide: miniWide({
            bank: bankText(a, bankList),
            number: `${numberText(a, codes.data)}${a.kind === 'acc' && a.bik ? t('money.bik_value', { bik: a.bik }) : ''}`,
            holder: a.holderName,
            main: [
              a.mainTax && purposeServes(a.purpose, 'tax') ? t('money.main.tax') : '',
              a.mainFee && purposeServes(a.purpose, 'fee') ? t('money.main.fee') : '',
            ].join(' '),
          }),
          cells: {
            kind: (
              <span className="inline-flex items-center gap-1.5">
                <Icon name={a.kind === 'phone' ? 'phone' : 'building'} size="sm" />
                {kindText(t, a.kind, 'org')}
              </span>
            ),
            bank: bankText(a, bankList),
            number: (
              <span>
                <span className={MONO_CLASS}>{numberText(a, codes.data)}</span>
                {a.kind === 'acc' && a.bik ? (
                  <Hint>{t('money.bik_value', { bik: a.bik })}</Hint>
                ) : null}
              </span>
            ),
            holder: a.holderName || '—',
            purpose: t(`money.purpose.${a.purpose}`),
            main: (
              <span className="inline-flex flex-wrap gap-1">
                {main(t('money.main.tax'), a.mainTax && purposeServes(a.purpose, 'tax'))}
                {main(t('money.main.fee'), a.mainFee && purposeServes(a.purpose, 'fee'))}
              </span>
            ),
            actions: (
              <span className="inline-flex whitespace-nowrap max-md:flex-col">
                <button
                  type="button"
                  className={iconButtonClass('sm')}
                  title={t('money.edit')}
                  aria-label={t('money.org.edit_aria')}
                  onClick={() => setDialog({ account: a })}
                >
                  <Icon name="edit" size="sm" />
                </button>
                <button
                  type="button"
                  className={iconButtonClass('sm')}
                  title={t('money.delete')}
                  aria-label={t('money.org.delete_aria')}
                  onClick={() => setRemoving(a)}
                >
                  <Icon name="trash" size="sm" />
                </button>
              </span>
            ),
          },
        }))}
      />
      {editable ? <Hint>{t('money.org.hint')}</Hint> : null}
      {dialog ? (
        <OrgAccountDialog
          open
          onClose={() => setDialog(null)}
          account={dialog.account}
          first={list.length === 0}
          orgName={orgName}
          banks={bankList}
          codes={codes.data}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? t('money.org.delete_title', { bank: bankText(removing, bankList) }) : ''}
        text={t('money.org.delete_text')}
        ok={t('money.delete')}
        danger
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
      />
    </Box>
  );
}

/** Окно «Счёт организации» / «Изменить счёт организации» (прототип orgAccDlg). */
function OrgAccountDialog({
  open,
  onClose,
  account,
  first,
  orgName,
  banks,
  codes,
}: {
  open: boolean;
  onClose: () => void;
  account: OrgAccount | null;
  /** Счетов ещё нет: оба «Основной» включены. */
  first: boolean;
  orgName: string;
  banks: readonly BankItem[];
  codes: readonly PhoneCodeItem[];
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const [current, setCurrent] = useState(account);
  const initial = () => ({
    draft: draftOf(
      current,
      {
        bankCode: banks.some((b) => b.code === DEFAULT_ORG_BANK_CODE && b.active)
          ? DEFAULT_ORG_BANK_CODE
          : (banks.find((b) => b.active)?.code ?? ''),
        holderName: orgName,
      },
      codes,
    ),
    purpose: current?.purpose ?? ('both' as AccountPurpose),
    mainTax: current ? current.mainTax : first,
    mainFee: current ? current.mainFee : first,
  });
  const [start, setStart] = useState(initial);
  const [draft, setDraft] = useState<RequisiteDraft>(start.draft);
  const [purpose, setPurpose] = useState(start.purpose);
  const [mainTax, setMainTax] = useState(start.mainTax);
  const [mainFee, setMainFee] = useState(start.mainFee);
  const [errors, setErrors] = useState<RequisiteErrors>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const keep = banksOf(current);
  const dirty =
    JSON.stringify([draft, purpose, mainTax, mainFee]) !==
    JSON.stringify([start.draft, start.purpose, start.mainTax, start.mainFee]);

  const focusFirst = (found: RequisiteErrors) => {
    const field = (['bankCode', 'bik', 'accountNo', 'phone', 'phoneBanks'] as const).find(
      (f) => found[f],
    );
    const target = {
      bankCode: 'bank',
      bik: 'bik',
      accountNo: 'number',
      phone: 'phone',
      phoneBanks: 'banks',
    } as const;
    if (field) document.getElementById(`${id}-${target[field]}`)?.focus();
  };

  const reload = async () => {
    setReloading(true);
    const fresh = await client.fetchQuery({ ...orgAccountsQuery, staleTime: 0 }).catch(() => null);
    setReloading(false);
    const row = fresh?.find((a) => a.id === account?.id);
    if (!row) return onClose();
    setCurrent(row);
    const next = {
      draft: draftOf(row, { bankCode: '', holderName: '' }, codes),
      purpose: row.purpose,
      mainTax: row.mainTax,
      mainFee: row.mainFee,
    };
    setStart(next);
    setDraft(next.draft);
    setPurpose(next.purpose);
    setMainTax(next.mainTax);
    setMainFee(next.mainFee);
    setErrors({});
    setChanged(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = checkDraft(draft, 'org', banks, codes, keep, t);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length > 0) return focusFirst(checked.errors);
    const json = {
      ...checked.value,
      purpose,
      mainTax: mainTax && purposeServes(purpose, 'tax'),
      mainFee: mainFee && purposeServes(purpose, 'fee'),
    };
    setBusy(true);
    const res = await callApi(() =>
      current
        ? api.api.org.accounts[':id'].$patch({
            param: { id: current.id },
            json: { ...json, version: current.version },
          })
        : api.api.org.accounts.$post({ json }),
    );
    setBusy(false);
    if (res.ok) {
      client.setQueryData(orgAccountsQuery.queryKey, OrgAccounts.parse(res.data).items);
      onClose();
      return toast(t(current ? 'money.org.changed' : 'money.org.added'), { icon: 'check' });
    }
    const code = res.error.code;
    if (code === 'record_changed') return setChanged(true);
    const field =
      FIELD_OF[code] ??
      (code === 'bank_unavailable' ? (draft.kind === 'acc' ? 'bankCode' : 'phoneBanks') : null);
    if (field) {
      const found = { [field]: errorText(res.error) };
      setErrors(found);
      return focusFirst(found);
    }
    toast(errorText(res.error), { bad: true });
  };
  const formId = `${id}-form`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t(current ? 'money.org.dialog.edit' : 'money.org.dialog.new')}
      sub={t('money.org.dialog.sub')}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={busy || changed}
          >
            {t(current ? 'btn.save' : 'btn.add')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <FormGrid>
          <RequisiteFields
            id={id}
            owner="org"
            draft={draft}
            onChange={(patch, field) => {
              setDraft((d) => ({ ...d, ...patch }));
              if (field) setErrors((e) => ({ ...e, [field]: undefined }));
            }}
            errors={errors}
            banks={banks}
            codes={codes}
            keep={keep}
            t={t}
            holder={{ label: t('money.col.holder'), hint: t('money.org.field.holder_hint') }}
            after={
              <Field
                id={`${id}-purpose`}
                label={t('money.col.purpose')}
                hint={t('money.org.field.purpose_hint')}
              >
                {(control) => (
                  <select
                    {...control}
                    className={`${inputClass()} cursor-pointer`}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value as AccountPurpose)}
                  >
                    {PURPOSES.map((p) => (
                      <option key={p} value={p}>
                        {t(`money.purpose.${p}`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            }
          />
        </FormGrid>
        <div className="flex flex-col">
          {purposeServes(purpose, 'tax') ? (
            <CheckRow
              data-main="tax"
              plain
              checked={mainTax}
              onChange={setMainTax}
              label={t('money.main.tax')}
            >
              <Hint>{t('money.org.main_tax_hint')}</Hint>
            </CheckRow>
          ) : null}
          {purposeServes(purpose, 'fee') ? (
            <CheckRow
              data-main="fee"
              plain
              checked={mainFee}
              onChange={setMainFee}
              label={t('money.main.fee')}
            >
              <Hint>{t('money.org.main_fee_hint')}</Hint>
            </CheckRow>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
