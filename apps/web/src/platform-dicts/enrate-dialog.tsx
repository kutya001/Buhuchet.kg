'use client';

import type { AdminEnRate } from '@buhuchet/shared';
import {
  buttonClass,
  FormGrid,
  Hint,
  Modal,
  Note,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import {
  gkedFieldError,
  GkedRuleFields,
  useGkedRuleDraft,
  type GkedFieldError,
} from './gked-rule-fields';
import { fetchAdminEnRate, usePdictsRefresh } from './pdicts-data';

/**
 * Ставка единого налога → «Виды деятельности (ГКЭД)» (задача 2.38; прототип admin/gked-admin.js
 * enRateDlg): перечень и «Кроме» для подбора ставки по основному ГКЭД контрагента; «Когда
 * применяется» — пояснением сверху. Признак «только основной» сервер ставит сам.
 */
export function EnRateDialog({
  open,
  onClose,
  code,
}: {
  open: boolean;
  onClose: () => void;
  code: string;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = usePdictsRefresh();
  const id = useId();
  const rate = useQuery({
    queryKey: ['admin', 'pdicts', 'enrate', code],
    queryFn: () => fetchAdminEnRate(code),
    staleTime: 0,
    gcTime: 0,
  });
  const [current, setCurrent] = useState<AdminEnRate | null>(null);
  const gked = useGkedRuleDraft(null);
  const [error, setError] = useState<GkedFieldError>();
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  // Окно открывается сразу, перечень приходит следом: черновик — из первого ответа.
  if (rate.data && !current) {
    setCurrent(rate.data);
    gked.reset(rate.data.gked);
  }

  const reload = async () => {
    const fresh = (await rate.refetch()).data;
    if (!fresh) return toast(t('err.unknown'), { bad: true });
    setCurrent(fresh);
    gked.reset(fresh.gked);
    setChanged(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!current) return;
    if (!gked.dirty) return onClose();
    setError(undefined);
    setBusy(true);
    const res = await callApi(() =>
      api.api.admin['platform-enrates'][':code'].gked.$put({
        param: { code },
        json: { gked: gked.value(), version: current.version },
      }),
    ).finally(() => setBusy(false));
    if (res.ok) {
      refresh('enrates');
      onClose();
      return toast(t('pdicts.toast.saved'), { icon: 'check' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    if (res.error.code === 'gked_unknown') {
      return setError(gkedFieldError(res.error, errorText(res.error)));
    }
    toast(errorText(res.error), { bad: true });
  };
  const formId = `${id}-form`;
  const x = current ?? rate.data;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={x ? t('pdicts.enrate.title', { code: x.code, name: x.activity }) : code}
      sub={
        x ? t('pdicts.enrate.sub', { rate: x.rate, art: x.article || t('pdicts.enrate.art') }) : ''
      }
      dirty={gked.dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={busy || changed || !current}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={rate.isFetching}
        />
      ) : null}
      {x?.explanation ? (
        <Note icon="info">
          <b>{t('pdicts.enrate.when')}</b> {x.explanation}
        </Note>
      ) : null}
      <form
        id={formId}
        onSubmit={(e) => void submit(e)}
        noValidate
        className="flex flex-col gap-3.5"
      >
        {current ? (
          <FormGrid>
            <GkedRuleFields id={id} state={gked} error={error} />
            <div className="col-span-full">
              <Hint>{t('pdicts.enrate.hint')}</Hint>
            </div>
          </FormGrid>
        ) : null}
      </form>
    </Modal>
  );
}
