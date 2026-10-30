'use client';

import { pluralForm, type AdminValueDict } from '@buhuchet/domain';
import { AdminBulkResult, type AdminDictValue, type AdminBulkDueInput } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  inputClass,
  Modal,
  Note,
  useToast,
  type GridBulkAction,
} from '@buhuchet/ui';
import { useId, useState, type FormEvent } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { duesNote, useDuesPreview } from './dues-preview';
import { usePdictsRefresh } from './pdicts-data';

/*
 * Массовые действия над отмеченными строками справочника (задача 2.37, часть 3; ТЗ «Выбор нескольких
 * строк»; прототип admin/platform-dicts-edit.js: bulkActive, benActive, bulkDueDlg, markGns):
 * «Включить» / «Отключить», у видов отчётов — «Изменить срок» и «Отметить сверку с ГНС», у ГКЭД —
 * «Снять / Вернуть «Действует»». Отказ у одного значения — отказ всего, ничего не меняется.
 */

const bulk = api.api.admin['platform-dicts-bulk'];

/** Справочники с «Включить» / «Отключить» у отмеченных (прототип `bulk`; у кодов стран — нет). */
const BULK_ACTIVE: ReadonlySet<AdminValueDict> = new Set([
  'types',
  'regimes',
  'benefits',
  'bases',
  'forms',
  'organs',
  'banks',
  'cats',
  'reasons',
  'ugns',
  'gked',
]);

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/** «…; сроки пересчитаны у N несданных отчётов» и «в остальных организациях — в ближайшие минуты». */
function duesDone(t: Translate, r: AdminBulkResult): string {
  const n = r.dues.reports;
  const recalc = n ? t(`pdicts.cal.toast.recalc.${pluralForm(n)}`, { n }) : '';
  return `${recalc}${r.pending ? `. ${t('pdicts.dues.pending')}` : ''}`;
}

/** Отправить массовое действие: итог — уведомлением, список и история перечитываются. */
function useBulkSend(dict: AdminValueDict) {
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = usePdictsRefresh();
  return async (send: () => Promise<JsonResponse>, done: (r: AdminBulkResult) => string) => {
    const res = await callApi(send);
    refresh(dict);
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return false;
    }
    toast(done(AdminBulkResult.parse(res.data)), { icon: 'check' });
    return true;
  };
}

/** Статусы, которые меняют сроки, и меняется их «включён» — перед действием окно с предпросмотром. */
export interface BulkStatusAsk {
  codes: string[];
  names: string[];
  active: boolean;
}

/**
 * Действия панели «Выбрано: N». `askStatus` — у льгот и статусов, меняющих сроки (прототип benActive),
 * `askDue` — «Изменить срок» видов.
 */
export function useBulkActions(
  dict: AdminValueDict,
  ask: {
    status: (x: BulkStatusAsk, done: () => void) => void;
    due: (rows: readonly AdminDictValue[], done: () => void) => void;
  },
): GridBulkAction<AdminDictValue>[] {
  const t = useT();
  const send = useBulkSend(dict);
  if (!BULK_ACTIVE.has(dict)) return [];
  const gked = dict === 'gked';
  const setActive = (rows: readonly AdminDictValue[], active: boolean, done: () => void) => {
    const changing = rows.filter((x) => x.active !== active);
    if (!changing.length) return done();
    const codes = changing.map((x) => x.code);
    if (dict === 'benefits' && changing.some((x) => (x.data.dueRules ?? []).length)) {
      return ask.status({ codes, names: changing.map((x) => x.name), active }, done);
    }
    void send(
      () => bulk[':dict'].active.$post({ param: { dict }, json: { codes, active } }),
      (r) =>
        `${t(
          gked
            ? active
              ? 'pdicts.gked.on_n'
              : 'pdicts.gked.off_n'
            : active
              ? 'pdicts.bulk.on_done'
              : 'pdicts.bulk.off_done',
          { n: r.n },
        )}${duesDone(t, r)}`,
    ).then((ok) => ok && done());
  };
  const onOff: GridBulkAction<AdminDictValue>[] = [
    {
      id: 'bulk-on',
      label: t(gked ? 'pdicts.gked.on' : 'pdicts.bulk.on'),
      icon: 'check',
      run: (rows, done) => setActive(rows, true, done),
    },
    {
      id: 'bulk-off',
      label: t(gked ? 'pdicts.gked.off' : 'pdicts.bulk.off'),
      icon: 'ban',
      run: (rows, done) => setActive(rows, false, done),
    },
  ];
  if (gked) return [onOff[1]!, onOff[0]!];
  if (dict !== 'types') return onOff;
  return [
    { id: 'bulk-due', label: t('pdicts.bulk.due'), icon: 'calendar', run: ask.due },
    {
      id: 'bulk-gns',
      label: t('pdicts.bulk.gns'),
      icon: 'ok',
      run: (rows, done) =>
        void send(
          () => bulk.types.gns.$post({ json: { codes: rows.map((x) => x.code) } }),
          (r) => t('pdicts.bulk.gns_done', { n: r.n }),
        ).then((ok) => ok && done()),
    },
    ...onOff,
  ];
}

/** «Отметить сверку с ГНС» у одного вида — из меню строки. */
export function useMarkGns() {
  const t = useT();
  const send = useBulkSend('types');
  return (x: AdminDictValue) =>
    void send(
      () => bulk.types.gns.$post({ json: { codes: [x.code] } }),
      (r) => t('pdicts.bulk.gns_done', { n: r.n }),
    );
}

/**
 * «Включить» / «Отключить» статусов, которые меняют сроки (прототип benActive): сколько несданных
 * отчётов в скольких организациях изменится, и подтверждение.
 */
export function BulkStatusDialog({
  open,
  onClose,
  ask,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  ask: BulkStatusAsk;
  onDone: () => void;
}) {
  const t = useT();
  const send = useBulkSend('benefits');
  const [busy, setBusy] = useState(false);
  const body = { codes: ask.codes, active: ask.active };
  const dues = useDuesPreview(
    `bulk-active:${ask.codes.join(',')}:${ask.active}`,
    body,
    (json, signal) =>
      bulk[':dict'].active['dues-preview'].$post(
        { param: { dict: 'benefits' }, json },
        { init: { signal } },
      ),
  );
  const many = ask.codes.length > 1;
  const act = t(ask.active ? 'pdicts.bulk.on' : 'pdicts.bulk.off');
  const run = async () => {
    setBusy(true);
    const ok = await send(
      () => bulk[':dict'].active.$post({ param: { dict: 'benefits' }, json: body }),
      (r) =>
        `${t(ask.active ? 'pdicts.bulk.on_done' : 'pdicts.bulk.off_done', { n: r.n })}${duesDone(t, r)}`,
    ).finally(() => setBusy(false));
    if (ok) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="message"
      title={t('pdicts.bulk.status_title', {
        act,
        n: many
          ? t(`pdicts.bulk.statuses.${pluralForm(ask.codes.length)}`, { n: ask.codes.length })
          : `«${ask.names[0] ?? ''}»`,
      })}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass(ask.active ? 'cta' : 'danger')}
            disabled={busy}
            onClick={() => void run()}
          >
            {act}
          </button>
        </>
      }
    >
      <p className="m-0">
        {t(ask.active ? 'pdicts.bulk.status_text_on' : 'pdicts.bulk.status_text_off')}{' '}
        {duesNote(t, dues, 'pdicts.cal.dues')}
      </p>
    </Modal>
  );
}

const toNumber = (v: string): number | undefined => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
};

/**
 * «Изменить срок у N видов» (прототип bulkDueDlg): число, месяцев после периода (у месячных,
 * квартальных и полугодовых), месяц следующего года (у годовых); пусто — не менять. Ниже — у скольких
 * несданных отчётов изменятся сроки.
 */
export function BulkDueDialog({
  open,
  onClose,
  rows,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  rows: readonly AdminDictValue[];
  onDone: () => void;
}) {
  const t = useT();
  const id = useId();
  const send = useBulkSend('types');
  const [day, setDay] = useState('');
  const [after, setAfter] = useState('');
  const [month, setMonth] = useState('');
  const [error, setError] = useState<{ day?: string; after?: string; any?: string }>({});
  const [busy, setBusy] = useState(false);
  const years = rows.filter((x) => x.data.period === 'Y').length;
  const others = rows.length - years;
  const codes = rows.map((x) => x.code);
  const body: AdminBulkDueInput = {
    codes,
    ...(toNumber(day) !== undefined ? { day: toNumber(day)! } : {}),
    ...(others && toNumber(after) !== undefined ? { after: toNumber(after)! } : {}),
    ...(years && toNumber(month) !== undefined ? { month: toNumber(month)! } : {}),
  };
  const valid =
    (body.day === undefined || (body.day >= 1 && body.day <= 31)) &&
    (body.after === undefined || (body.after >= 0 && body.after <= 6));
  const filled = body.day !== undefined || body.after !== undefined || body.month !== undefined;
  const dues = useDuesPreview('bulk-due', valid && filled ? body : null, (json, signal) =>
    bulk.types.due['dues-preview'].$post({ json }, { init: { signal } }),
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = {
      day:
        body.day !== undefined && (body.day < 1 || body.day > 31) ? t('pdicts.err.day') : undefined,
      after:
        body.after !== undefined && (body.after < 0 || body.after > 6)
          ? t('pdicts.bulk_due.after_err')
          : undefined,
      any: filled ? undefined : t('pdicts.err.bulk_due_empty'),
    };
    setError(next);
    if (next.day || next.after || next.any) return;
    setBusy(true);
    const ok = await send(
      () => bulk.types.due.$post({ json: body }),
      (r) => `${t('pdicts.bulk_due.done')}${duesDone(t, r)}`,
    ).finally(() => setBusy(false));
    if (ok) {
      onDone();
      onClose();
    }
  };
  const formId = `${id}-form`;
  const n = rows.length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t(`pdicts.bulk_due.title.${pluralForm(n)}`, { n })}
      sub={rows.map((x) => x.data.shortName || x.name).join(', ')}
      dirty={filled}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button type="submit" form={formId} className={buttonClass('cta')} disabled={busy}>
            {t('pdicts.bulk_due.apply')}
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => void submit(e)}
        noValidate
        className="flex flex-col gap-3.5"
      >
        <FormGrid>
          <Field id={`${id}-day`} label={t('pdicts.bulk_due.day')} error={error.day ?? error.any}>
            {(c) => (
              <input
                {...c}
                type="number"
                min={1}
                max={31}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                placeholder={t('pdicts.bulk_due.keep')}
                className={inputClass()}
              />
            )}
          </Field>
          {others ? (
            <Field
              id={`${id}-after`}
              label={t('pdicts.bulk_due.after')}
              hint={t('pdicts.bulk_due.after_hint')}
              error={error.after}
            >
              {(c) => (
                <input
                  {...c}
                  type="number"
                  min={0}
                  max={6}
                  value={after}
                  onChange={(e) => setAfter(e.target.value)}
                  placeholder={t('pdicts.bulk_due.keep')}
                  className={inputClass()}
                />
              )}
            </Field>
          ) : (
            <div />
          )}
          {years ? (
            <Field
              id={`${id}-month`}
              label={t('pdicts.bulk_due.month')}
              hint={t('pdicts.bulk_due.month_hint')}
            >
              {(c) => (
                <select
                  {...c}
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className={`${inputClass()} cursor-pointer`}
                >
                  <option value="">{t('pdicts.bulk_due.keep')}</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {t(`report.month.${m as 1}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </FormGrid>
        {valid && filled ? (
          <Note tone="warn" icon="alert">
            {duesNote(t, dues, 'pdicts.cal.dues')}
          </Note>
        ) : null}
      </form>
    </Modal>
  );
}
