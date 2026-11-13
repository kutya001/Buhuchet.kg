'use client';

import { isValidRemindDays, normalizeRemindDays, pluralForm } from '@buhuchet/domain';
import {
  OrgReportTypeList,
  OrgReportTypesBulkResult,
  type OrgReportTypeRow,
  type OrgReportTypesBulk,
} from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  Chip,
  ConfirmDialog,
  Field,
  FormGrid,
  Hint,
  inputClass,
  Modal,
  Pill,
  useToast,
  type GridBulkAction,
} from '@buhuchet/ui';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import {
  bulkNames,
  disconnectPlan,
  EMPTY_BULK_DRAFT,
  setupBody,
  setupCounts,
  type BulkDraft,
  type BulkTri,
} from './types-bulk-model';

/*
 * Массовые изменения видов отчётов (прототип v84 modules/dicts.js: typesBulkOn, typesBulkDlg;
 * docs/deviations.md п. О-74): отметьте виды галочками — «Подключить», «Настроить» (файл при сдаче,
 * квитанция о приёме, дни напоминаний) и «Отключить» для всех выбранных сразу. Вид, назначенный
 * действующим контрагентам, не отключается; «Файл при сдаче» не ставится видам «только оплата».
 */

type Rows = readonly OrgReportTypeRow[];

/**
 * Отмеченные виды, какие они сейчас: список хранит строку такой, какой она была в момент отметки, а
 * вид с тех пор могли подключить, отключить или назначить контрагенту (прототип берёт строки в момент
 * нажатия). Не удалось перечитать — остаются отмеченные строки: изменения всё равно решает сервер.
 */
async function freshRows(picked: Rows): Promise<Rows> {
  const res = await callApi(() => api.api['org-report-types'].$get({ query: { size: 'all' } }));
  if (!res.ok) return picked;
  const byCode = new Map(OrgReportTypeList.parse(res.data).items.map((r) => [r.code, r]));
  return picked.map((r) => byCode.get(r.code) ?? r);
}
/** Окно, открытое по отмеченным строкам; `done` снимает галочки списка после изменения. */
interface Picked {
  rows: Rows;
  done: () => void;
}

/** «Отключить»: подключённые среди отмеченных — назначенные контрагентам и остальные. */
type OffPicked = Picked & { busy: Rows; ok: Rows };

/**
 * Действия панели «Выбрано: N» списка «Виды отчётов» и их окна. `policyDays` — дни учётной политики:
 * с них начинается набор «Задать заново»; `onChanged` — обновить список.
 */
export function useTypesBulk({
  policyDays,
  onChanged,
}: {
  policyDays: readonly number[];
  onChanged: () => void;
}): { actions: GridBulkAction<OrgReportTypeRow>[]; dialogs: ReactNode } {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const [setup, setSetup] = useState<DialogSlot<Picked> | null>(null);
  const [off, setOff] = useState<DialogSlot<OffPicked> | null>(null);

  const actions = useMemo(() => {
    const alert = (text: string) => toast(text, { bad: true, icon: 'alert' });
    /** Отправить изменение; ответ — итог, null — ошибка (она уже показана). */
    const send = async (json: OrgReportTypesBulk, done: () => void) => {
      const res = await callApi(() => api.api['org-report-types'].bulk.$post({ json }));
      onChanged();
      if (!res.ok) {
        alert(errorText(res.error));
        return null;
      }
      done();
      return OrgReportTypesBulkResult.parse(res.data);
    };
    const connect = async (picked: Rows, done: () => void) => {
      const list = (await freshRows(picked)).filter((r) => !r.enabled);
      if (!list.length) return toast(t('dicts.bulk.all_connected'));
      const out = await send({ action: 'connect', codes: list.map((r) => r.code) }, done);
      if (out) toast(t('dicts.bulk.connected', { n: out.changed }));
    };
    const disconnect = async (picked: Rows, done: () => void) => {
      const { on, busy, ok } = disconnectPlan(await freshRows(picked));
      if (!on.length) return toast(t('dicts.bulk.none_connected'));
      if (!ok.length)
        return alert(t(busy.length === 1 ? 'dicts.bulk.busy_one' : 'dicts.bulk.busy_all'));
      setOff(openSlot<OffPicked>({ rows: on, done, busy, ok }));
    };
    const list: GridBulkAction<OrgReportTypeRow>[] = [
      {
        id: 'connect',
        label: t('dicts.bulk.connect'),
        icon: 'check',
        run: (rows, done) => void connect(rows, done),
      },
      {
        id: 'setup',
        label: t('dicts.bulk.setup'),
        icon: 'sliders',
        run: (rows, done) =>
          void freshRows(rows).then((fresh) => setSetup(openSlot<Picked>({ rows: fresh, done }))),
      },
      {
        id: 'disconnect',
        label: t('dicts.bulk.disconnect'),
        icon: 'ban',
        danger: true,
        run: (rows, done) => void disconnect(rows, done),
      },
    ];
    return { list, send };
  }, [t, toast, errorText, onChanged]);

  const confirmOff = async (picked: Picked) => {
    const out = await actions.send(
      { action: 'disconnect', codes: picked.rows.map((r) => r.code) },
      picked.done,
    );
    if (!out) return;
    toast(
      out.busy
        ? t('dicts.bulk.disconnected_busy', { n: out.changed, busy: out.busy })
        : t('dicts.bulk.disconnected', { n: out.changed }),
    );
  };

  const dialogs = (
    <>
      {setup ? (
        <TypesBulkSetup
          key={`setup-${setup.n}`}
          rows={setup.data.rows}
          policyDays={policyDays}
          open={setup.open}
          onClose={() => setSetup(closeSlot)}
          onApply={async (json) => {
            const out = await actions.send(json, setup.data.done);
            if (!out) return false;
            toast(
              out.changed
                ? t('dicts.bulk.changed', { n: out.changed, total: out.total })
                : t('dicts.bulk.unchanged'),
            );
            return true;
          }}
        />
      ) : null}
      {off ? (
        <ConfirmDialog
          key={`off-${off.n}`}
          open={off.open}
          onClose={() => setOff(closeSlot)}
          title={t(`dicts.bulk.off_title.${pluralForm(off.data.ok.length)}`, {
            n: off.data.ok.length,
          })}
          text={
            <span data-types-bulk-off="">
              {t('dicts.bulk.off_text')}
              {off.data.busy.length
                ? ` ${t('dicts.bulk.off_busy', {
                    names: off.data.busy.map((r) => r.shortName).join(', '),
                  })}`
                : ''}
            </span>
          }
          ok={t('dicts.bulk.disconnect')}
          danger
          onConfirm={() => void confirmOff(off.data)}
        />
      ) : null}
    </>
  );
  return { actions: actions.list, dialogs };
}

/** Окно «Настроить виды отчётов: N» (прототип typesBulkDlg). */
function TypesBulkSetup({
  rows,
  policyDays,
  open,
  onClose,
  onApply,
}: {
  rows: Rows;
  policyDays: readonly number[];
  open: boolean;
  onClose: () => void;
  /** Отправить изменение: true — применено (окно закрывается). */
  onApply: (json: OrgReportTypesBulk) => Promise<boolean>;
}) {
  const t = useT();
  const toast = useToast();
  const id = useId();
  const [draft, setDraft] = useState<BulkDraft>(EMPTY_BULK_DRAFT);
  const [day, setDay] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const { off, pay } = setupCounts(rows);
  const { names, more } = bulkNames(rows);
  // Как в прототипе: любое изменение в окне — несохранённое, в том числе переключатель подключения.
  const dirty =
    draft.file !== '' ||
    draft.receipt !== '' ||
    draft.days !== null ||
    day !== '' ||
    draft.connect !== EMPTY_BULK_DRAFT.connect;

  /** Дни с числом из поля «+ день»; false — число неверное (ошибка под полем). */
  const daysWithDraft = (): readonly number[] | null | false => {
    const raw = day.trim();
    if (!draft.days || !raw) return draft.days;
    const n = Number(raw);
    if (!isValidRemindDays([n])) {
      setError(t('dicts.bulk.days_invalid'));
      return false;
    }
    return normalizeRemindDays([...draft.days, n]);
  };
  const addDay = () => {
    const days = daysWithDraft();
    if (days === false) return;
    setDay('');
    setDraft({ ...draft, days });
  };
  const apply = async () => {
    const days = daysWithDraft();
    if (days === false) return;
    const json = setupBody(rows, { ...draft, days });
    if (!json) {
      toast(t('err.types_bulk_empty'), { bad: true, icon: 'alert' });
      return;
    }
    setBusy(true);
    const ok = await onApply(json);
    setBusy(false);
    if (ok) onClose();
  };

  const tri = (key: 'file' | 'receipt', label: string, hint: string) => (
    <Field id={`${id}-${key}`} label={label} hint={hint}>
      {(c) => (
        <select
          {...c}
          data-types-bulk={key}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value as BulkTri })}
          className={`${inputClass()} cursor-pointer`}
        >
          <option value="">{t('dicts.bulk.keep')}</option>
          <option value="1">{t('dicts.bulk.required')}</option>
          <option value="0">{t('dicts.bulk.optional')}</option>
        </select>
      )}
    </Field>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('dicts.bulk.title', { n: rows.length })}
      sub={more ? t('dicts.bulk.more', { names, n: more }) : names}
      kind="form"
      size="mid"
      dirty={dirty}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy}
            data-types-bulk-apply=""
            onClick={() => void apply()}
          >
            {t('dicts.bulk.apply')}
          </button>
        </>
      }
    >
      <div data-types-bulk-form="">
        <FormGrid>
          {tri(
            'file',
            t('dicts.bulk.file'),
            pay ? t('dicts.bulk.file_pay_hint', { n: pay }) : t('dicts.type.file_hint'),
          )}
          {tri('receipt', t('dicts.bulk.receipt'), t('dicts.bulk.receipt_hint'))}
          <Field
            id={`${id}-days`}
            label={t('dicts.type.days')}
            full
            hint={t(draft.days ? 'dicts.bulk.days_set_hint' : 'dicts.bulk.days_keep_hint')}
            error={error}
          >
            {(c) => (
              <div className="flex flex-wrap items-center gap-2" data-types-bulk-days="">
                <select
                  id={c.id}
                  aria-describedby={`${c.id}-hint`}
                  data-types-bulk="days"
                  value={draft.days ? 'set' : ''}
                  onChange={(e) => {
                    setError(undefined);
                    setDay('');
                    setDraft({
                      ...draft,
                      days: e.target.value ? normalizeRemindDays(policyDays) : null,
                    });
                  }}
                  className={`${inputClass({ full: false })} w-auto cursor-pointer`}
                >
                  <option value="">{t('dicts.bulk.keep')}</option>
                  <option value="set">{t('dicts.bulk.days_set')}</option>
                </select>
                {draft.days ? (
                  <>
                    {draft.days.map((d) => (
                      <Chip
                        key={d}
                        id={String(d)}
                        clear={t('org.remind.remove')}
                        onClear={() =>
                          setDraft({ ...draft, days: draft.days!.filter((x) => x !== d) })
                        }
                      >
                        {t(`dicts.type.day.${pluralForm(d)}`, { n: d })}
                      </Chip>
                    ))}
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label={t('org.remind.add_label')}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${c.id}-err` : undefined}
                      placeholder={t('org.remind.add')}
                      data-types-bulk="day"
                      value={day}
                      onChange={(e) => {
                        setDay(e.target.value);
                        setError(undefined);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addDay();
                        }
                      }}
                      className={`${inputClass({ full: false })} w-[90px]`}
                    />
                  </>
                ) : null}
                <Pill tone="ok" icon="lock">
                  {t('org.remind.deadline')}
                </Pill>
              </div>
            )}
          </Field>
          {off ? (
            <div className="col-span-full">
              <CheckRow
                checked={draft.connect}
                onChange={(on) => setDraft({ ...draft, connect: on })}
                label={t('dicts.bulk.connect_off', { n: off })}
                plain
                data-types-bulk-connect=""
              >
                <Hint>{t('dicts.bulk.connect_off_hint')}</Hint>
              </CheckRow>
            </div>
          ) : null}
        </FormGrid>
      </div>
    </Modal>
  );
}
