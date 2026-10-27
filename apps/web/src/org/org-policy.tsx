'use client';

import {
  FEATURE_REQUIRES,
  featureChangeProblem,
  FEATURES,
  isValidConfirmWaitDays,
  isValidRemindDays,
  normalizePageSections,
  PAGE_SECTION_FEATURE,
  PAGE_SECTIONS,
  pluralForm,
  type Feature,
  type PageSection,
} from '@buhuchet/domain';
import { OrgPolicy, type UpdateOrgPolicyRequest } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CheckRow,
  Chip,
  Field,
  fieldControl,
  FormGrid,
  Hint,
  Icon,
  inputClass,
  Modal,
  Note,
  Pill,
  RecordChangedNotice,
  Timeline,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useId, useState } from 'react';
import { api, callApi } from '../api-client';
import { useFeatureLesson } from '../kb/kb-provider';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { policyHistoryQuery, policyQuery, useOrgRefresh } from './org-data';
import { policyHistoryItem } from './policy-history';

/** Сколько записей истории видно (прототип: `h.slice(0, 20)`); в заголовке — сколько всего. */
const HISTORY_SHOWN = 20;

type PolicyPatch = Omit<UpdateOrgPolicyRequest, 'version'>;

/**
 * «Моя организация» → «Учётная политика» (прототип modules/org.js, renderOrg → policy): функции с
 * «что даёт» и разделами страницы контрагента, подтверждение задач и сдачи отчётов, «Сдача отчёта только
 * после оплаты», дни напоминаний по умолчанию и история изменений. Каждое изменение сохраняется сразу,
 * как в прототипе; менять может только владелец (право «Настройки и учётная политика»), остальные видят
 * то же только для просмотра. Опросник — своя задача (поток Г).
 */
export function OrgPolicyTab() {
  const t = useT();
  const { access } = useShell();
  const policy = useQuery(policyQuery);
  if (policy.isError) return <Note tone="bad">{t('org.load_error')}</Note>;
  if (!policy.data) return null;
  return <PolicyEdit policy={policy.data} readOnly={!access.can('org')} />;
}

function PolicyEdit({ policy, readOnly }: { policy: OrgPolicy; readOnly: boolean }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useOrgRefresh();
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  /** Только что включённая функция — окно «Функция «…» включена». */
  const [enabled, setEnabled] = useState<Feature | null>(null);
  const [enabledOpen, setEnabledOpen] = useState(false);
  /** «Пройти урок» — когда урок функции есть в «Базе знаний» (задача 2.30). */
  const learn = useFeatureLesson(enabled);
  const off = readOnly || busy || changed;
  const feature = (f: Feature) => t(`org.feature.${f}`);

  /** Сохранить сразу; `done` — уведомление после сохранения, `shell` — перечитать и меню. */
  const save = async (patch: PolicyPatch, done?: string, shell = false) => {
    setBusy(true);
    const res = await callApi(() =>
      api.api.org.policy.$patch({ json: { version: policy.version, ...patch } }),
    );
    setBusy(false);
    if (res.ok) {
      client.setQueryData(policyQuery.queryKey, OrgPolicy.parse(res.data));
      refresh(shell);
      if (done) toast(done, { icon: 'check' });
      return true;
    }
    if (res.error.code === 'record_changed') setChanged(true);
    else toast(errorText(res.error), { bad: true, icon: 'alert' });
    return false;
  };

  const reload = async () => {
    setBusy(true);
    await client.invalidateQueries({ queryKey: policyQuery.queryKey });
    setBusy(false);
    setChanged(false);
  };

  const toggleFeature = async (f: Feature, on: boolean) => {
    const problem = featureChangeProblem(policy.features, { ...policy.features, [f]: on });
    if (problem) {
      const key =
        problem.code === 'feature_requires' ? 'org.feature.requires' : 'org.feature.required_by';
      return toast(t(key, { name: feature(problem.feature) }), { bad: true, icon: 'alert' });
    }
    if (!(await save({ features: { [f]: on } }, undefined, true))) return;
    if (on) {
      setEnabled(f);
      setEnabledOpen(true);
    } else {
      toast(t('org.feature.off', { name: feature(f) }), { icon: 'check' });
    }
  };

  const togglePage = (section: PageSection, on: boolean) => {
    const next = new Set(policy.pageSections);
    if (on) next.add(section);
    else next.delete(section);
    void save({ pageSections: normalizePageSections([...next]) }, t('org.saved'));
  };

  return (
    <div className="flex flex-col gap-3.5">
      {readOnly ? <Note icon="lock">{t('org.policy.readonly')}</Note> : null}
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={busy}
        />
      ) : null}
      <Box title={t('org.policy.features')}>
        <span className="-mt-1 text-[11.5px] leading-[1.4] text-faint">
          {t('org.policy.features_hint')}
        </span>
        {FEATURES.map((f) => {
          const needs = FEATURE_REQUIRES[f]?.[0];
          return (
            <Fragment key={f}>
              <CheckRow
                data-feat-row={f}
                checked={policy.features[f]}
                disabled={off}
                onChange={(on) => void toggleFeature(f, on)}
                label={feature(f)}
              >
                <Hint>
                  {t(`org.feature.${f}.hint`)}
                  {needs ? ` · ${t('org.feature.needs', { name: feature(needs) })}` : null}
                </Hint>
                <Hint>
                  {t('org.feature.benefit_line', { text: t(`org.feature.${f}.benefit`) })}
                </Hint>
              </CheckRow>
              {f === 'cppage' && policy.features.cppage ? (
                <PageSections policy={policy} disabled={off} onToggle={togglePage} />
              ) : null}
            </Fragment>
          );
        })}
      </Box>
      {policy.features.tasks ? (
        <Box title={t('org.policy.tasks')}>
          <CheckRow
            checked={policy.taskConfirm}
            disabled={off}
            onChange={(on) =>
              void save(
                { taskConfirm: on },
                t(on ? 'org.policy.task_confirm_on' : 'org.policy.task_confirm_off'),
              )
            }
            label={t('org.policy.task_confirm')}
          >
            <Hint>{t('org.policy.task_confirm_hint')}</Hint>
          </CheckRow>
        </Box>
      ) : null}
      <Box title={t('org.policy.reports')}>
        <CheckRow
          checked={policy.reportConfirm}
          disabled={off}
          onChange={(on) =>
            void save(
              { reportConfirm: on },
              t(on ? 'org.policy.report_confirm_on' : 'org.policy.report_confirm_off'),
            )
          }
          label={t('org.policy.report_confirm')}
        >
          <Hint>{t('org.policy.report_confirm_hint')}</Hint>
        </CheckRow>
        {policy.reportConfirm ? (
          <WaitDays
            key={policy.confirmWaitDays}
            value={policy.confirmWaitDays}
            disabled={off}
            onSave={(n) => void save({ confirmWaitDays: n }, t('org.saved'))}
          />
        ) : null}
        {policy.features.taxpay ? (
          <CheckRow
            checked={policy.payBeforeSubmit}
            disabled={off}
            onChange={(on) =>
              void save(
                { payBeforeSubmit: on },
                t(on ? 'org.policy.pay_first_on' : 'org.policy.pay_first_off'),
              )
            }
            label={t('org.policy.pay_first')}
          >
            <Hint>{t('org.policy.pay_first_hint')}</Hint>
          </CheckRow>
        ) : null}
      </Box>
      <RemindDays
        days={policy.remindDays}
        readOnly={readOnly}
        disabled={off}
        onSave={(days, done) => void save({ remindDays: days }, done)}
      />
      <PolicyHistory />
      <Modal
        open={enabledOpen}
        onClose={() => setEnabledOpen(false)}
        kind="message"
        size="mid"
        title={enabled ? t('org.feature.on_title', { name: feature(enabled) }) : ''}
        footer={
          <>
            <div className="flex-1" />
            <button
              type="button"
              className={buttonClass('ghost')}
              onClick={() => setEnabledOpen(false)}
            >
              {t('org.feature.later')}
            </button>
            {learn ? (
              <button
                type="button"
                className={buttonClass('cta')}
                onClick={() => {
                  setEnabledOpen(false);
                  learn();
                }}
              >
                <Icon name="play" size="sm" />
                {t('kb.feat_on.learn')}
              </button>
            ) : null}
          </>
        }
      >
        {enabled ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-line px-3 py-2">
            <span className="inline-grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] bg-info-bg text-info">
              <Icon name="ok" />
            </span>
            <div className="min-w-0 grow">
              <b>{feature(enabled)}</b>
              <p className="mt-[3px] mb-0 text-[13px] leading-[1.45] text-muted">
                {t(`org.feature.${enabled}.benefit`)}
              </p>
            </div>
          </div>
        ) : null}
        {learn ? <p className="m-0 text-muted">{t('kb.feat_on.text')}</p> : null}
      </Modal>
    </div>
  );
}

/**
 * Разделы страницы контрагента под переключателем «Страница контрагента по ссылке» (прототип
 * modules/org.js, pgPolHtml): раздел функции, которая выключена, недоступен с пояснением.
 */
function PageSections({
  policy,
  disabled,
  onToggle,
}: {
  policy: OrgPolicy;
  disabled: boolean;
  onToggle: (section: PageSection, on: boolean) => void;
}) {
  const t = useT();
  return (
    <div data-page-sections="" className="-mt-1 mb-1.5 ml-[52px] flex flex-col gap-0.5 max-md:ml-0">
      <Hint>{t('org.page.hint')}</Hint>
      {PAGE_SECTIONS.map((s) => {
        const needs = PAGE_SECTION_FEATURE[s];
        const unavailable = needs !== undefined && !policy.features[needs];
        return (
          <CheckRow
            key={s}
            kind="check"
            compact
            data-page-section={s}
            checked={policy.pageSections.includes(s)}
            disabled={disabled || unavailable}
            onChange={(on) => onToggle(s, on)}
            label={t(`org.page.section.${s}`)}
          >
            {unavailable ? (
              <Hint>{t('org.page.needs', { name: t(`org.feature.${needs}`) })}</Hint>
            ) : null}
          </CheckRow>
        );
      })}
    </div>
  );
}

/** «Напомнить о неподтверждённой сдаче через, дней»: 1–30, сохраняется при уходе из поля. */
function WaitDays({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (n: number) => void;
}) {
  const t = useT();
  const id = useId();
  const [error, setError] = useState<string | undefined>();
  return (
    <FormGrid>
      <Field
        id={id}
        label={t('org.policy.wait_days')}
        hint={t('org.policy.wait_days_hint')}
        error={error}
      >
        {(c) => (
          <input
            {...c}
            type="text"
            inputMode="numeric"
            defaultValue={value}
            disabled={disabled}
            className={inputClass()}
            onChange={() => setError(undefined)}
            onBlur={(e) => {
              const n = Number(e.target.value.trim());
              if (!isValidConfirmWaitDays(n)) {
                setError(t('err.confirm_wait_days_invalid'));
                e.target.value = String(value);
                return;
              }
              if (n !== value) onSave(n);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        )}
      </Field>
    </FormGrid>
  );
}

/**
 * «Напоминания о сроках по умолчанию» (прототип: chip «за N дней» с крестиком, поле «+ день» по Enter,
 * метка «в день срока — всегда»): дни от 1 до 60 — иначе ошибка под полем «От 1 до 60 дней» (ТЗ
 * «Учётная политика»), от большего к меньшему; повтор не добавляется — уведомление «За N дней уже есть
 * в наборе».
 */
function RemindDays({
  days,
  readOnly,
  disabled,
  onSave,
}: {
  days: readonly number[];
  readOnly: boolean;
  disabled: boolean;
  onSave: (days: number[], done?: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const id = `${useId()}-day`;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();
  const add = () => {
    const n = Number(draft.trim());
    if (!draft.trim()) return;
    if (!isValidRemindDays([n])) return setError(t('err.remind_days_invalid'));
    setDraft('');
    if (days.includes(n)) return toast(t(`org.remind.exists.${pluralForm(n)}`, { n }));
    onSave([...days, n], t('org.remind.saved'));
  };
  return (
    <Box title={t('org.remind.title')}>
      <div className="flex flex-wrap items-center gap-2" data-remind-days="">
        {days.map((d) => (
          <Chip
            key={d}
            id={String(d)}
            clear={t('org.remind.remove')}
            onClear={
              readOnly
                ? undefined
                : () => {
                    if (!disabled) onSave(days.filter((x) => x !== d));
                  }
            }
          >
            {t(`org.remind.day.${pluralForm(d)}`, { n: d })}
          </Chip>
        ))}
        {readOnly ? null : (
          <input
            {...fieldControl({ id, error })}
            type="text"
            inputMode="numeric"
            aria-label={t('org.remind.add_label')}
            placeholder={t('org.remind.add')}
            value={draft}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
            className={`${inputClass({ full: false })} w-24`}
          />
        )}
        <Pill tone="ok" icon="lock">
          {t('org.remind.deadline')}
        </Pill>
      </div>
      {error ? (
        <div id={`${id}-err`} className="flex items-start gap-[5px] text-[12px] text-danger">
          <Icon name="alert" size="sm" className="mt-px" />
          <span>{error}</span>
        </div>
      ) : null}
      <Hint>{t('org.remind.hint')}</Hint>
    </Box>
  );
}

/** «История изменений учётной политики · N»: последние 20 записей лентой, сначала новые. */
function PolicyHistory() {
  const t = useT();
  const history = useQuery(policyHistoryQuery);
  if (!history.data) return null;
  const items = history.data.items
    .slice(0, HISTORY_SHOWN)
    .map((h, i) => policyHistoryItem(h, i, t));
  const title = t('org.history.title', { n: history.data.total });
  return (
    <Box title={title}>
      {items.length > 0 ? (
        <Timeline items={items} label={title} />
      ) : (
        <span className="text-faint">{t('org.history.empty')}</span>
      )}
    </Box>
  );
}
