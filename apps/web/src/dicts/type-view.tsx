'use client';

import { dueRuleText, isValidRemindDays, normalizeRemindDays, pluralForm } from '@buhuchet/domain';
import {
  OrgReportTypeSetting,
  type OrgReportTypeRow,
  type ReportType,
  type Taxes,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CheckRow,
  Chip,
  fieldControl,
  Hint,
  Icon,
  inputClass,
  Modal,
  Note,
  Pill,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { typeSettingsQuery, type Catalog } from './dicts-data';
import { TypeGuide } from './type-guide';

/** Настройки организации по виду, которые правит форма. */
interface Settings {
  remindDays: number[];
  needFile: boolean;
  needReceipt: boolean;
  version: number;
}

const settingsOf = (row: OrgReportTypeRow): Settings | null =>
  row.enabled && row.version !== null
    ? {
        remindDays: normalizeRemindDays(row.remindDays ?? []),
        needFile: row.needFile,
        needReceipt: row.needReceipt,
        version: row.version,
      }
    : null;

const same = (a: Settings, b: Settings) =>
  a.needFile === b.needFile &&
  a.needReceipt === b.needReceipt &&
  a.remindDays.join() === b.remindDays.join();

/**
 * Форма просмотра вида отчёта (ТЗ «Справочники» → «Виды отчётов», решение заказчика 19.10.2026;
 * прототип modules/dicts.js, typeSettingsDlg): описание вида и налоги, к которым он относится
 * (`TypeGuide`), последним блоком — «Настройки организации»: дни напоминаний (от 1 до 60, «в день срока —
 * всегда»), «Файл при сдаче обязателен» (у вида «Уплата» его нет), «Квитанция о приёме обязательна»;
 * «Сохранить» внизу окна. Без права «Вести справочники организации» — только для просмотра; у
 * неподключённого вида вместо настроек — подсказка «Вид не подключён».
 */
export function TypeView({
  row,
  type,
  catalog,
  taxes,
  canEdit,
  open,
  onClose,
  onSaved,
}: {
  row: OrgReportTypeRow;
  type: ReportType;
  catalog: Catalog;
  taxes: Taxes;
  canEdit: boolean;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = `${useId()}-day`;
  const [base, setBase] = useState(() => settingsOf(row));
  const [state, setState] = useState(base);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const edit = canEdit && state !== null;
  const dirty = !!base && !!state && (!same(base, state) || draft.trim() !== '');

  /** День из поля «+ день»: от 1 до 60, иначе ошибка под полем; повтор — уведомление. */
  const dayOf = (): number | null | false => {
    const raw = draft.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!isValidRemindDays([n])) {
      setError(t('err.remind_days_invalid'));
      return false;
    }
    return n;
  };
  const addDay = () => {
    const n = dayOf();
    if (!n || !state) return;
    setDraft('');
    if (state.remindDays.includes(n)) {
      toast(t(`org.remind.exists.${pluralForm(n)}`, { n }));
      return;
    }
    setState({ ...state, remindDays: normalizeRemindDays([...state.remindDays, n]) });
  };

  const reload = async () => {
    setBusy(true);
    try {
      const fresh = await client.fetchQuery({ ...typeSettingsQuery, staleTime: 0 });
      const own = fresh.items.find((s) => s.code === type.code);
      const next =
        own && own.enabled
          ? {
              remindDays: own.remindDays,
              needFile: own.needFile,
              needReceipt: own.needReceipt,
              version: own.version,
            }
          : null;
      setBase(next);
      setState(next);
      setChanged(false);
      onSaved();
    } catch {
      toast(t('err.unknown'), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!state) return;
    const n = dayOf();
    if (n === false) return;
    const remindDays =
      n && !state.remindDays.includes(n)
        ? normalizeRemindDays([...state.remindDays, n])
        : state.remindDays;
    setBusy(true);
    const res = await callApi(() =>
      api.api['org-report-types'][':code'].$put({
        param: { code: type.code },
        json: {
          remindDays,
          ...(type.act === 'pay' ? {} : { needFile: state.needFile }),
          needReceipt: state.needReceipt,
          version: state.version,
        },
      }),
    );
    setBusy(false);
    if (res.ok) {
      OrgReportTypeSetting.parse(res.data);
      onSaved();
      onClose();
      toast(t('dicts.type.saved'), { icon: 'check' });
      return;
    }
    if (res.error.code === 'record_changed') setChanged(true);
    else toast(errorText(res.error), { bad: true, icon: 'alert' });
  };

  const sub = [
    type.formCode || t('dicts.type.no_code'),
    catalog.authority(type.authorityCode),
    dueRuleText(type, t),
  ].join(' · ');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={type.name}
      sub={sub}
      kind={edit ? 'form' : 'card'}
      size="mid"
      dirty={edit && dirty}
      footer={
        edit ? (
          <>
            <div className="flex-1" />
            <button type="button" className={buttonClass('ghost')} onClick={onClose}>
              {t('btn.cancel')}
            </button>
            <button
              type="button"
              className={buttonClass('cta')}
              disabled={busy || changed}
              onClick={() => void save()}
            >
              {t('btn.save')}
            </button>
          </>
        ) : (
          <>
            <div className="flex-1" />
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('btn.close')}
            </button>
          </>
        )
      }
    >
      <div data-type-view={type.code} className="flex flex-col">
        <TypeGuide type={type} catalog={catalog} taxes={taxes} />
        <div className="mt-3.5" data-type-settings="">
          <Box title={t('dicts.type.settings')}>
            {changed ? (
              <RecordChangedNotice
                message={t('err.record_changed')}
                reloadLabel={t('form.reload')}
                onReload={() => void reload()}
                reloading={busy}
              />
            ) : null}
            {state ? (
              <>
                <div className="flex flex-col gap-[5px]">
                  <span className="text-[12px] font-semibold tracking-[.01em] text-muted">
                    {t('dicts.type.days')}
                  </span>
                  <div className="flex flex-wrap items-center gap-2" data-remind-days="">
                    {state.remindDays.map((d) => (
                      <Chip
                        key={d}
                        id={String(d)}
                        clear={t('org.remind.remove')}
                        onClear={
                          edit
                            ? () =>
                                setState({
                                  ...state,
                                  remindDays: state.remindDays.filter((x) => x !== d),
                                })
                            : undefined
                        }
                      >
                        {t(`dicts.type.day.${pluralForm(d)}`, { n: d })}
                      </Chip>
                    ))}
                    {edit ? (
                      <input
                        {...fieldControl({ id, error })}
                        type="text"
                        inputMode="numeric"
                        aria-label={t('org.remind.add_label')}
                        placeholder={t('org.remind.add')}
                        value={draft}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          setError(undefined);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addDay();
                        }}
                        className={`${inputClass({ full: false })} w-[90px]`}
                      />
                    ) : null}
                    <Pill tone="ok" icon="lock">
                      {t('org.remind.deadline')}
                    </Pill>
                  </div>
                  {error ? (
                    <div
                      id={`${id}-err`}
                      className="flex items-start gap-[5px] text-[12px] text-danger"
                    >
                      <Icon name="alert" size="sm" className="mt-px" />
                      <span>{error}</span>
                    </div>
                  ) : null}
                  <Hint>{t('dicts.type.days_hint')}</Hint>
                </div>
                <div>
                  {type.act === 'pay' ? null : (
                    <CheckRow
                      checked={state.needFile}
                      disabled={!edit}
                      onChange={(on) => setState({ ...state, needFile: on })}
                      label={t('dicts.col.file')}
                      plain
                      data-type-file=""
                    >
                      <Hint>{t('dicts.type.file_hint')}</Hint>
                    </CheckRow>
                  )}
                  <CheckRow
                    checked={state.needReceipt}
                    disabled={!edit}
                    onChange={(on) => setState({ ...state, needReceipt: on })}
                    label={t('dicts.col.receipt')}
                    plain
                    data-type-receipt=""
                  >
                    <Hint>{t('dicts.type.receipt_hint')}</Hint>
                  </CheckRow>
                </div>
              </>
            ) : (
              <Note>{t('dicts.type.not_connected')}</Note>
            )}
          </Box>
        </div>
      </div>
    </Modal>
  );
}
