'use client';

import { TransferContractorsPreview } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Field,
  inputClass,
  KeyValues,
  Modal,
  Note,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { formOptionsQuery, useContractorsRefresh } from './contractor-data';

/*
 * Закрепление контрагентов (ТЗ «Контрагенты» → «Закрепление»; прототип modules/contractors.js —
 * respDlg, transferCp; modules/staff.js — transferDlg): «Сменить ответственного» одному, «Назначить
 * ответственного» выбранным в списке и «Передать контрагентов» сотрудника. Незавершённые отчёты,
 * открытые задачи (и остаток денег — с задачами денег) переходят к новому ответственному на сервере.
 */

/** Контрагент для окна: номер, название и нынешний ответственный. */
export interface ResponsibleTarget {
  id: string;
  name: string;
  responsibleId: string | null;
}

/** «Сменить ответственного» (один контрагент) и «Ответственный для N контрагентов» (выбранные). */
export function ResponsibleDialog({
  targets,
  open,
  onClose,
  onDone,
}: {
  targets: readonly ResponsibleTarget[];
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const id = useId();
  const options = useQuery(formOptionsQuery);
  const one = targets.length === 1 ? targets[0]! : null;
  const [to, setTo] = useState(one?.responsibleId ?? '');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!to) return setError(t('cp.resp.required'));
    if (one && one.responsibleId === to) return onClose();
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors.assign.$post({
        json: { ids: targets.map((c) => c.id), responsibleEmployeeId: to },
      }),
    );
    setBusy(false);
    if (!res.ok) return setError(errorText(res.error));
    refresh();
    onDone?.();
    onClose();
    toast(one ? t('cp.resp.done_one') : t('cp.resp.done_many', { n: targets.length }), {
      icon: 'user',
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={one ? t('cp.resp.title_one') : t('cp.resp.title_many', { n: targets.length })}
      sub={one?.name}
      dirty={to !== (one?.responsibleId ?? '')}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-resp-ok=""
            className={buttonClass('cta')}
            disabled={busy || !options.data}
            onClick={() => void save()}
          >
            {t('cp.resp.ok')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-resp-dialog="">
        <Field id={`${id}-to`} label={t('cp.resp.field')} required error={error}>
          {(control) => (
            <select
              {...control}
              className={`${inputClass()} cursor-pointer`}
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setError(undefined);
              }}
            >
              <option value="">{t('cp.resp.choose')}</option>
              {(options.data?.employees ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.shortName}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Note icon="info">{t('cp.resp.note')}</Note>
      </div>
    </Modal>
  );
}

/**
 * «Передать контрагентов» сотрудника (прототип transferDlg): «Кому» — по умолчанию главный бухгалтер;
 * «Что перейдёт» — контрагенты, незавершённые отчёты и открытые задачи по ним (считает сервер). Передача
 * пишется в историю каждого контрагента.
 */
export function TransferDialog({
  from,
  open,
  onClose,
  onDone,
}: {
  from: { id: string; name: string };
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const id = useId();
  const options = useQuery(formOptionsQuery);
  const preview = useQuery({
    queryKey: ['contractors', 'transfer', from.id],
    queryFn: async () => {
      const res = await api.api.contractors.transfer.$get({ query: { from: from.id } });
      if (!res.ok) throw await apiFailure(res);
      return TransferContractorsPreview.parse(await res.json());
    },
    staleTime: 0,
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const to = picked ?? preview.data?.defaultTo ?? '';
  const p = preview.data;

  const save = async () => {
    if (!to) return setError(t('cp.resp.required'));
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors.transfer.$post({ json: { from: from.id, to } }),
    );
    setBusy(false);
    if (!res.ok) return setError(errorText(res.error));
    refresh();
    onDone?.();
    onClose();
    const name = options.data?.employees.find((e) => e.id === to)?.shortName ?? '';
    toast(t('cp.transfer.done', { n: p?.contractors ?? 0, name }), { icon: 'refresh' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('cp.transfer.title')}
      sub={t('cp.transfer.from', { name: from.name })}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-transfer-ok=""
            className={buttonClass('cta')}
            disabled={busy || !p || p.contractors === 0}
            onClick={() => void save()}
          >
            {t('cp.transfer.ok')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-transfer-dialog="">
        <Field id={`${id}-to`} label={t('cp.transfer.to')} required error={error}>
          {(control) => (
            <select
              {...control}
              className={`${inputClass()} cursor-pointer`}
              value={to}
              onChange={(e) => {
                setPicked(e.target.value);
                setError(undefined);
              }}
            >
              <option value="">{t('cp.resp.choose')}</option>
              {(options.data?.employees ?? [])
                .filter((e) => e.id !== from.id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.shortName}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Box title={t('cp.transfer.what')}>
          {p ? (
            <KeyValues
              items={[
                {
                  id: 'cps',
                  label: t('cp.transfer.cps'),
                  value: <b data-transfer-cps="">{p.contractors}</b>,
                },
                { id: 'reports', label: t('cp.transfer.reports'), value: String(p.reports) },
                { id: 'tasks', label: t('cp.transfer.tasks'), value: String(p.tasks) },
              ]}
            />
          ) : preview.isError ? (
            <Note tone="bad">{t('err.unknown')}</Note>
          ) : null}
          <div className="mt-1.5 text-[12px] leading-[1.45] text-muted">
            {t('cp.transfer.hint')}
          </div>
        </Box>
      </div>
    </Modal>
  );
}
