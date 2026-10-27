'use client';

import { Wallets, type Wallet } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CHECKBOX_CLASS,
  ConfirmDialog,
  FormGrid,
  Hint,
  Icon,
  iconButtonClass,
  linkButtonClass,
  MiniTable,
  miniWide,
  MONO_CLASS,
  Modal,
  Note,
  Pill,
  RecordChangedNotice,
  Tag,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { phoneCodesQuery } from '../staff/staff-data';
import { banksQuery, employeeWalletsQuery, myWalletsQuery } from './money-data';
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
 * Реквизиты сотрудника для переводов (задача 2.18): «Мой профиль» → «Мои реквизиты для переводов»
 * (прототип modules/profile.js, walletDlg) и блок «Реквизиты для переводов» в карточке сотрудника
 * (прототип modules/staff.js empCard; кто видит — docs/deviations.md п. В-1, решение А).
 */

/** Отказы сервера, которые показываются под своим полем. */
const FIELD_OF: Record<string, keyof RequisiteErrors> = {
  bank_required: 'bankCode',
  wallet_no_invalid: 'accountNo',
  invalid_phone: 'phone',
  phone_banks_required: 'phoneBanks',
};

const WALLET_KEYS = ['bankCode', 'accountNo', 'phone', 'phoneBanks'] as const;
const FIELD_ID = {
  bankCode: 'bank',
  accountNo: 'number',
  phone: 'phone',
  phoneBanks: 'banks',
} as const;

/** Поля реквизита для API без БИКа (его у сотрудника нет). */
const walletBody = ({ bik: _bik, ...value }: ReturnType<typeof checkDraft>['value']) => value;

function kindCell(t: ReturnType<typeof useT>, w: Wallet) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name={w.kind === 'phone' ? 'phone' : 'wallet'} size="sm" />
      {kindText(t, w.kind, 'employee')}
    </span>
  );
}

/** «Мой профиль» → «Мои реквизиты для переводов»: добавить, изменить, удалить, «Сделать основным». */
export function MyWalletsBox({ holderDefault }: { holderDefault: string }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const wallets = useQuery(myWalletsQuery);
  const banks = useQuery(banksQuery);
  const codes = useQuery(phoneCodesQuery);
  const [dialog, setDialog] = useState<{ wallet: Wallet | null } | null>(null);
  const [removing, setRemoving] = useState<Wallet | null>(null);

  if (wallets.isError || banks.isError || codes.isError) {
    return <Note tone="bad">{t('money.load_error')}</Note>;
  }
  if (!wallets.data || !banks.data || !codes.data) return null;
  const list = wallets.data;
  const bankList = banks.data;

  const done = (res: Awaited<ReturnType<typeof callApi>>, ok?: string) => {
    if (!res.ok) {
      void client.invalidateQueries({ queryKey: myWalletsQuery.queryKey });
      return toast(errorText(res.error), { bad: true });
    }
    client.setQueryData(myWalletsQuery.queryKey, Wallets.parse(res.data).items);
    if (ok) toast(ok, { icon: 'trash' });
  };

  const makeMain = async (w: Wallet) => {
    const { id, version, ...rest } = w;
    done(
      await callApi(() =>
        api.api.profile.wallets[':id'].$patch({
          param: { id },
          json: { ...rest, isMain: true, version },
        }),
      ),
    );
  };

  const remove = async (w: Wallet) => {
    done(
      await callApi(() =>
        api.api.profile.wallets[':id'].$delete({
          param: { id: w.id },
          query: { version: String(w.version) },
        }),
      ),
      t('money.wallets.deleted'),
    );
  };

  return (
    <Box
      title={t('money.wallets.title')}
      actions={
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() => setDialog({ wallet: null })}
        >
          <Icon name="plus" size="sm" />
          {t('btn.add')}
        </button>
      }
    >
      {list.length > 0 ? (
        <MiniTable
          label={t('money.wallets.title')}
          empty=""
          columns={[
            { key: 'kind', label: t('money.col.kind') },
            { key: 'bank', label: t('money.col.bank') },
            { key: 'number', label: t('money.col.number') },
            { key: 'holder', label: t('money.col.holder') },
            { key: 'main', label: '' },
            { key: 'actions', label: '', actions: true },
          ]}
          rows={list.map((w) => ({
            key: w.id,
            wide: miniWide({
              bank: bankText(w, bankList),
              number: numberText(w, codes.data),
              holder: w.holderName,
            }),
            cells: {
              kind: kindCell(t, w),
              bank: bankText(w, bankList),
              number: <span className={MONO_CLASS}>{numberText(w, codes.data)}</span>,
              holder: w.holderName || '—',
              main: w.isMain ? (
                <Pill tone="ok" icon="star">
                  {t('money.main')}
                </Pill>
              ) : (
                <button
                  type="button"
                  className={linkButtonClass()}
                  onClick={() => void makeMain(w)}
                >
                  {t('money.wallets.make_main')}
                </button>
              ),
              actions: (
                <span className="inline-flex whitespace-nowrap max-md:flex-col">
                  <button
                    type="button"
                    className={iconButtonClass('sm')}
                    title={t('money.edit')}
                    aria-label={t('money.wallets.edit_aria')}
                    onClick={() => setDialog({ wallet: w })}
                  >
                    <Icon name="edit" size="sm" />
                  </button>
                  <button
                    type="button"
                    className={iconButtonClass('sm')}
                    title={t('money.delete')}
                    aria-label={t('money.wallets.delete_aria')}
                    onClick={() => setRemoving(w)}
                  >
                    <Icon name="trash" size="sm" />
                  </button>
                </span>
              ),
            },
          }))}
        />
      ) : (
        <Note>{t('money.wallets.empty')}</Note>
      )}
      <Hint>{t('money.wallets.hint')}</Hint>
      {dialog ? (
        <WalletDialog
          open
          onClose={() => setDialog(null)}
          wallet={dialog.wallet}
          first={list.length === 0}
          holderDefault={holderDefault}
          banks={bankList}
          codes={codes.data}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('money.wallets.delete_title')}
        text={
          removing
            ? t('money.wallets.delete_text', {
                bank: bankText(removing, bankList),
                number: numberText(removing, codes.data),
              })
            : ''
        }
        ok={t('money.delete')}
        danger
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
      />
    </Box>
  );
}

/** Окно «Новый реквизит» / «Изменить реквизит» (прототип walletDlg). */
function WalletDialog({
  open,
  onClose,
  wallet,
  first,
  holderDefault,
  banks,
  codes,
}: {
  open: boolean;
  onClose: () => void;
  wallet: Wallet | null;
  /** Реквизитов ещё нет: «Основной» отмечен. */
  first: boolean;
  holderDefault: string;
  banks: readonly BankItem[];
  codes: readonly PhoneCodeItem[];
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const [current, setCurrent] = useState(wallet);
  const initial = () => ({
    draft: draftOf(
      current,
      { bankCode: banks.find((b) => b.active)?.code ?? '', holderName: holderDefault },
      codes,
    ),
    isMain: current ? current.isMain : first,
  });
  const [start, setStart] = useState(initial);
  const [draft, setDraft] = useState<RequisiteDraft>(start.draft);
  const [isMain, setIsMain] = useState(start.isMain);
  const [errors, setErrors] = useState<RequisiteErrors>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const keep = banksOf(current);
  const dirty = JSON.stringify([draft, isMain]) !== JSON.stringify([start.draft, start.isMain]);

  const focusFirst = (found: RequisiteErrors) => {
    const field = WALLET_KEYS.find((f) => found[f]);
    if (field) document.getElementById(`${id}-${FIELD_ID[field]}`)?.focus();
  };

  const reload = async () => {
    setReloading(true);
    const fresh = await client.fetchQuery({ ...myWalletsQuery, staleTime: 0 }).catch(() => null);
    setReloading(false);
    const row = fresh?.find((w) => w.id === wallet?.id);
    if (!row) return onClose();
    setCurrent(row);
    const next = {
      draft: draftOf(row, { bankCode: '', holderName: '' }, codes),
      isMain: row.isMain,
    };
    setStart(next);
    setDraft(next.draft);
    setIsMain(next.isMain);
    setErrors({});
    setChanged(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = checkDraft(draft, 'employee', banks, codes, keep, t);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length > 0) return focusFirst(checked.errors);
    const json = { ...walletBody(checked.value), isMain };
    setBusy(true);
    const res = await callApi(() =>
      current
        ? api.api.profile.wallets[':id'].$patch({
            param: { id: current.id },
            json: { ...json, version: current.version },
          })
        : api.api.profile.wallets.$post({ json }),
    );
    setBusy(false);
    if (res.ok) {
      client.setQueryData(myWalletsQuery.queryKey, Wallets.parse(res.data).items);
      onClose();
      return toast(t(current ? 'money.wallets.changed' : 'money.wallets.added'), {
        icon: 'check',
      });
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
      title={t(current ? 'money.wallets.dialog.edit' : 'money.wallets.dialog.new')}
      sub={t('money.wallets.dialog.sub')}
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
            owner="employee"
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
            holder={{
              label: t('money.wallets.field.holder'),
              hint: t('money.wallets.field.holder_hint'),
            }}
            after={
              <div className="flex min-w-0 flex-col justify-end gap-[5px]">
                <label className="inline-flex min-h-[33px] cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={isMain}
                    onChange={(e) => setIsMain(e.target.checked)}
                  />
                  {t('money.main')}
                </label>
              </div>
            }
          />
        </FormGrid>
      </form>
    </Modal>
  );
}

/**
 * Блок «Реквизиты для переводов» в карточке сотрудника — только просмотр: свои, а чужие — владельцу и
 * роли с правами «Учёт денег и оплата налогов» и «Видеть все отчёты и всех контрагентов» (решение А).
 */
export function EmployeeWalletsBox({ employeeId }: { employeeId: string }) {
  const t = useT();
  const shell = useShell();
  const allowed =
    shell.employeeId === employeeId || (shell.access.can('money') && shell.access.can('viewAll'));
  const wallets = useQuery({ ...employeeWalletsQuery(employeeId), enabled: allowed });
  const banks = useQuery({ ...banksQuery, enabled: allowed });
  const codes = useQuery({ ...phoneCodesQuery, enabled: allowed });
  if (!allowed) return null;
  if (wallets.isError || banks.isError || codes.isError) {
    return <Note tone="bad">{t('money.load_error')}</Note>;
  }
  if (!wallets.data || !banks.data || !codes.data) return null;
  return (
    <Box title={t('money.staff.title')}>
      {wallets.data.length > 0 ? (
        <MiniTable
          label={t('money.staff.title')}
          headless
          empty=""
          columns={[
            { key: 'kind', label: t('money.col.kind') },
            { key: 'bank', label: t('money.col.bank') },
            { key: 'number', label: t('money.col.number') },
            { key: 'holder', label: t('money.col.holder') },
            { key: 'main', label: '' },
          ]}
          rows={wallets.data.map((w) => ({
            key: w.id,
            wide: miniWide({
              bank: bankText(w, banks.data),
              number: numberText(w, codes.data),
              holder: w.holderName,
            }),
            cells: {
              kind: kindCell(t, w),
              bank: bankText(w, banks.data),
              number: <span className={MONO_CLASS}>{numberText(w, codes.data)}</span>,
              holder: w.holderName,
              main: w.isMain ? <Tag>{t('money.main.tag')}</Tag> : null,
            },
          }))}
        />
      ) : (
        <span className="text-faint">{t('money.staff.empty')}</span>
      )}
    </Box>
  );
}
