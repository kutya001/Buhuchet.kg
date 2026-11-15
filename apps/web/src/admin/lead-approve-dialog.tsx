'use client';

import { formatPhone, isValidLogin, normalizeLogin } from '@buhuchet/domain';
import { LeadApproved, type AdminLeadCard } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Field,
  inputClass,
  KeyValues,
  Modal,
  Note,
  RecordChangedNotice,
  useToast,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useErrorText, useT } from '../l10n/provider';
import { phoneCodesQuery } from '../staff/staff-data';
import { approveLead, leadCardQuery } from './leads-data';

/*
 * «Одобрить заявку» (доработки 14.11.2026, блок 1; прототип v114 modules/lead-docs.js — ldApproveDlg):
 * что будет создано, данные из документов, владелец и телефон, «Логин владельца» (подставлен, уникален
 * на всей платформе). После «Одобрить» — организация и владелец без временного пароля: бот присылает
 * владельцу «Организация создана» и ссылку, по которой он задаёт пароль (поток Т). Окно открывается по
 * свежей заявке (`fetchQuery`), с причиной отказа — не открывается (уведомление с причиной).
 */

const faint = <span className="text-faint">—</span>;
const mono = (v: string | null) => (v ? <span className="font-mono">{v}</span> : faint);

/** Отказы сервера, которые встают под поле логина. */
const LOGIN_ERRORS = new Set(['invalid_login', 'login_taken']);

export function LeadApproveDialog({
  lead,
  open,
  onClose,
  onDone,
}: {
  /** Заявка с документами, «Одобрить» у неё доступна (`approve.refusal` — null). */
  lead: AdminLeadCard;
  open: boolean;
  onClose: () => void;
  /** Одобрена: перечитать список, окно заявки и организации. */
  onDone: () => void;
}) {
  const t = useT();
  const id = useId();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const codes = useQuery(phoneCodesQuery);
  const [l, setLead] = useState(lead);
  const [login, setLogin] = useState(lead.approve?.login ?? '');
  const [loginError, setLoginError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);

  /** «Перечитать» после «Запись изменена»: свежая заявка и версия; отказ — окно закрывается. */
  const reload = async () => {
    setReloading(true);
    try {
      const fresh = await client.fetchQuery({ ...leadCardQuery(l.id), staleTime: 0 });
      setLead(fresh);
      setChanged(false);
      if (!fresh.approve || fresh.approve.refusal) {
        onClose();
        if (fresh.approve?.message) toast(fresh.approve.message, { bad: true, icon: 'lock' });
      }
    } catch {
      toast(t('err.network'), { bad: true });
    } finally {
      setReloading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = normalizeLogin(login);
    if (!isValidLogin(value)) return setLoginError(t('leads.approve.login_invalid'));
    setLoginError(undefined);
    setBusy(true);
    const res = await approveLead(l.id, { login: value, version: l.version });
    setBusy(false);
    if (res.ok) {
      const done = LeadApproved.safeParse(res.data);
      onDone();
      onClose();
      return toast(
        t(
          done.success && done.data.setup === 'sent'
            ? 'leads.approve.done'
            : 'leads.approve.done_no_tg',
        ),
        { icon: 'building' },
      );
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    if (LOGIN_ERRORS.has(res.error.code)) return setLoginError(errorText(res.error));
    // Отказ по заявке (Telegram отключили, файлы удалены, ИНН занят…) — окно закрывается с причиной.
    onDone();
    onClose();
    toast(errorText(res.error), { bad: true, icon: 'lock' });
  };

  const items: KeyValueItem[] = [
    {
      id: 'form',
      label: t('leads.docs.form'),
      value: l.legalForm ? t(`land.f.form.${l.legalForm}`) : faint,
    },
    { id: 'firm', label: t('leads.docs.name'), value: l.firm },
    { id: 'inn', label: t('leads.docs.inn'), value: mono(l.inn) },
    { id: 'okpo', label: t('leads.docs.okpo'), value: mono(l.okpo) },
    { id: 'address', label: t('leads.docs.address'), value: l.address || faint },
    { id: 'head', label: t('leads.docs.head'), value: l.head || faint },
    { id: 'owner', label: t('leads.approve.owner'), value: l.name },
    {
      id: 'phone',
      label: t('leads.approve.phone'),
      value: formatPhone(l.phone, codes.data ?? []),
    },
  ];
  const formId = `${id}-form`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('leads.approve.title')}
      sub={`${l.firm} · ${l.name}`}
      dirty={normalizeLogin(login) !== (lead.approve?.login ?? '')}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('leads.approve.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            data-lead-approve-ok=""
            className={buttonClass('cta')}
            disabled={busy || changed}
          >
            {t('leads.approve.ok')}
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
      <form
        id={formId}
        onSubmit={(e) => void submit(e)}
        noValidate
        className="flex flex-col gap-3.5"
        data-lead-approve={l.id}
      >
        <Note icon="building">{t('leads.approve.note')}</Note>
        <Box>
          <KeyValues items={items} />
        </Box>
        <Field
          id={`${id}-login`}
          label={t('leads.approve.login')}
          required
          full
          hint={t('leads.approve.login_hint')}
          error={loginError}
        >
          {(control) => (
            <input
              {...control}
              type="text"
              data-lead-approve-login=""
              className={inputClass({ mono: true })}
              value={login}
              maxLength={64}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => {
                setLogin(e.target.value);
                setLoginError(undefined);
              }}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}

/**
 * Свежая заявка для окна «Одобрить» (прототип ldApproveDlg: неактивна — уведомление с причиной): `lead` —
 * можно открыть, `refusal` — текст причины, `failed` — заявку не прочитать.
 */
export async function freshApprovableLead(
  client: QueryClient,
  id: string,
): Promise<{ lead: AdminLeadCard } | { refusal: string } | { failed: unknown }> {
  try {
    const lead = await client.fetchQuery({ ...leadCardQuery(id), staleTime: 0 });
    if (!lead.approve || lead.approve.refusal) return { refusal: lead.approve?.message ?? '' };
    return { lead };
  } catch (failed) {
    return { failed };
  }
}
