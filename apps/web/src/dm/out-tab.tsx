'use client';

import { bishkekDate, REPORT_STATUSES } from '@buhuchet/domain';
import type { DmParam, DmTemplateCard } from '@buhuchet/shared';
import {
  buttonClass,
  EmptyState,
  Field,
  Icon,
  inputClass,
  Note,
  type FieldControl,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { ApiFailure } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import { outCatalogQuery, outOrgsQuery, runOutQuery, type DmRunRequest } from './out-data';
import {
  outAutoRun,
  outParamProblems,
  outParamsOf,
  outParamsToSend,
  outResult,
  outResultKey,
  outRunFailure,
  outTemplateGroups,
  outYearOptions,
  type DmParamProblem,
  type DmParamValues,
  type DmTemplateGroup,
} from './out-model';
import { OutTable, type OutExport } from './out-table';
import { saveParams, savedParams, setOutChoice, useOutChoice } from './out-state';
import type { DmSide } from './tokens-data';

/** Поле параметра над таблицей (прототип `.dm-pars .fld`; первое — шире, на телефоне — во всю строку). */
const PAR_CLASS = 'min-w-[150px] flex-[0_1_auto] max-md:min-w-0 max-md:flex-[1_1_100%]';
const FIRST_PAR_CLASS =
  'min-w-[240px] max-w-[420px] flex-[1_1_280px] max-md:min-w-0 max-md:max-w-none max-md:flex-[1_1_100%]';

/** Пустой запуск для выключенного запроса: ключ не совпадает ни с одним настоящим. */
const NO_RUN: DmRunRequest = { code: '-', params: {}, orgId: null, n: -1 };

/**
 * «Витрина данных» → «Вывод» (доработки 20.11.2026: Витрина данных, блок 4; прототип v155
 * `renderDmOut`, `dmOptHtml`, `dmParHtml`, `dmParRead`, `dmDraw`): выбор шаблона по группам, у Админки
 * для шаблона организаций — «Глазами организации», параметры с последними значениями пользователя,
 * «Показать» и таблица результата. Выбор живёт, пока открыта страница (`out-state.ts`).
 */
export function OutTab({ side }: { side: DmSide }) {
  const t = useT();
  const errorText = useErrorText();
  const catalog = useQuery(outCatalogQuery(side));
  const choice = useOutChoice();
  if (catalog.isError) {
    const error = catalog.error instanceof ApiFailure ? catalog.error.error : null;
    return (
      <Note tone="bad" icon="alert">
        {error ? errorText(error) : t('grid.load_error')}
      </Note>
    );
  }
  if (!catalog.data) return null;
  const { items, canExport } = catalog.data;
  if (!items.length) {
    return (
      <EmptyState
        icon="table"
        title={t('dm.out.none_title')}
        text={t(side === 'admin' ? 'dm.out.none_admin' : 'dm.out.none_org')}
      />
    );
  }
  const tpl = items.find((x) => x.code === choice.tpl) ?? items[0]!;
  return (
    <OutBody key={tpl.code} side={side} items={items} tpl={tpl} canExport={canExport} />
  );
}

function OutBody({
  side,
  items,
  tpl,
  canExport,
}: {
  side: DmSide;
  items: readonly DmTemplateCard[];
  tpl: DmTemplateCard;
  canExport: boolean;
}) {
  const t = useT();
  const errorText = useErrorText();
  const { userId } = useShell();
  const choice = useOutChoice();
  const admin = side === 'admin';
  const orgSel = admin && tpl.audience === 'org';
  const orgs = useQuery({ ...outOrgsQuery(), enabled: orgSel });
  const orgId = orgSel ? (choice.org ?? orgs.data?.[0]?.id ?? null) : null;
  const shown = choice.shown?.tpl === tpl.code ? choice.shown : null;
  const [values, setValues] = useState<DmParamValues>(
    () => shown?.params ?? outParamsOf(tpl.params, savedParams(userId, tpl.code)),
  );
  const [errors, setErrors] = useState<Record<string, DmParamProblem>>({});
  // Прототип рисует результат сразу при открытии вкладки — с последними параметрами пользователя.
  const [auto] = useState<DmRunRequest | null>(() =>
    !shown && outAutoRun(tpl, values, admin)
      ? { code: tpl.code, params: outParamsToSend(tpl.params, values), orgId: null, n: 0 }
      : null,
  );
  const run: DmRunRequest | null = shown
    ? {
        code: tpl.code,
        params: outParamsToSend(tpl.params, shown.params),
        orgId: shown.org,
        n: shown.n,
      }
    : auto;
  // Сломанный шаблон организация не запускает; Админка — по «Показать», чтобы увидеть ошибку базы.
  const live = run !== null && (tpl.state === 'published' || (admin && shown !== null));
  const res = useQuery({
    ...runOutQuery(side, run ?? NO_RUN),
    enabled: live,
    placeholderData: (prev) => prev,
  });
  const result = useMemo(() => (res.data ? outResult(res.data) : null), [res.data]);
  const failure =
    live && res.error instanceof ApiFailure
      ? { ...outRunFailure(res.error.error.code, res.error.error.details), api: res.error.error }
      : null;
  const fieldErrors: Record<string, DmParamProblem> =
    failure?.kind === 'param' ? { [failure.param]: failure.problem, ...errors } : errors;

  const exportRun: OutExport | undefined =
    canExport && run
      ? { side, code: tpl.code, params: run.params, orgId: run.orgId }
      : undefined;

  const show = () => {
    const problems = outParamProblems(tpl.params, values);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    saveParams(userId, tpl.code, values);
    setOutChoice({
      ...(orgSel && orgId ? { org: orgId } : {}),
      shown: { tpl: tpl.code, params: values, org: orgId, n: (choice.shown?.n ?? 0) + 1 },
    });
  };

  // Сломанный шаблон: «Шаблон временно не работает»; Админка после «Показать» видит и ошибку базы.
  const brokenView = failure?.kind === 'broken' || (tpl.state === 'broken' && !res.data);
  let below: ReactNode = null;
  if (brokenView) {
    below = (
      <div data-dm-out-broken="">
        <EmptyState icon="alert" title={t('err.dm_template_broken')}>
          {admin && failure?.kind === 'broken' && failure.error ? (
            <span className="max-w-[520px] break-words" data-dm-out-db-error="">
              {failure.error}
            </span>
          ) : null}
        </EmptyState>
      </div>
    );
  } else if (failure && failure.kind === 'other') {
    below = (
      <Note tone="bad" icon="alert" alert>
        <span data-dm-out-error="">{errorText(failure.api)}</span>
      </Note>
    );
  } else if (result && res.data) {
    below = (
      <div className={res.isPlaceholderData ? 'opacity-60' : undefined}>
        <OutTable
          result={result}
          run={outResultKey(res.data)}
          exportRun={res.isPlaceholderData ? undefined : exportRun}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5" data-dm-out="">
      <section
        data-box=""
        className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-raised px-4 py-3.5"
      >
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2.5" data-dm-pars="">
          <div className={FIRST_PAR_CLASS}>
            <Field id="dm-t" label={t('dm.out.tpl')}>
              {(c) => (
                <select
                  {...c}
                  className={inputClass()}
                  value={tpl.code}
                  data-dm-out-tpl=""
                  onChange={(e) => setOutChoice({ tpl: e.target.value, shown: null })}
                >
                  {outTemplateGroups(items, admin).map((g) => (
                    <optgroup key={g.key} label={groupLabel(t, g)}>
                      {g.items.map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.state === 'broken' ? t('dm.out.broken_opt', { name: x.name }) : x.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {orgSel ? (
            <div className={PAR_CLASS}>
              <Field id="dm-org" label={t('dm.out.org')}>
                {(c) => (
                  <select
                    {...c}
                    className={inputClass()}
                    value={orgId ?? ''}
                    data-dm-out-org=""
                    onChange={(e) => setOutChoice({ org: e.target.value })}
                  >
                    {(orgs.data ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          ) : null}
          {tpl.params.map((p) => (
            <div key={p.code} className={PAR_CLASS}>
              <Field
                id={`dmp-${p.code}`}
                label={p.name}
                required={p.required}
                error={fieldErrors[p.code] ? t(`dm.par.err.${fieldErrors[p.code]!}`) : undefined}
              >
                {(c) => (
                  <ParamInput
                    t={t}
                    param={p}
                    control={c}
                    value={values[p.code] ?? ''}
                    onChange={(v) => {
                      setValues((old) => ({ ...old, [p.code]: v }));
                      setErrors((old) => {
                        const next = { ...old };
                        delete next[p.code];
                        return next;
                      });
                    }}
                  />
                )}
              </Field>
            </div>
          ))}
          <button
            type="button"
            className={`${buttonClass('cta')} min-h-9 max-md:w-full max-md:justify-center`}
            data-dm-out-show=""
            disabled={orgSel && !orgId}
            onClick={show}
          >
            <Icon name="play" size="sm" />
            {t('dm.out.show')}
          </button>
        </div>
        {tpl.description ? (
          <span className="text-[12px] leading-[1.4] text-muted" data-dm-out-desc="">
            {tpl.description}
          </span>
        ) : null}
      </section>
      {below}
    </div>
  );
}

/** Подпись группы выбора (прототип `dmOptHtml`). */
function groupLabel(t: Translate, g: DmTemplateGroup): string {
  if ('admin' in g.label) return t('dm.group.admin');
  const mod = t(`dm.mod.${g.label.module ?? 'other'}`);
  return g.label.prefix ? t('dm.out.group_org', { mod }) : mod;
}

/** Поле параметра по типу (прототип `dmParHtml`): дата, месяц, год, статус, «Да / Нет», иначе текст. */
function ParamInput({
  t,
  param,
  control,
  value,
  onChange,
}: {
  t: Translate;
  param: DmParam;
  control: FieldControl;
  value: string;
  onChange: (v: string) => void;
}) {
  const props = {
    ...control,
    className: inputClass(),
    value,
    'data-dm-par': param.code,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  switch (param.type) {
    case 'date':
      return <input type="date" {...props} />;
    case 'month':
      return <input type="month" {...props} />;
    case 'year':
      return (
        <select {...props}>
          {outYearOptions(bishkekDate(new Date()), value).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      );
    case 'list:status':
      return (
        <select {...props}>
          <option value="">{t('dm.par.all_status')}</option>
          {REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.report.${s}`)}
            </option>
          ))}
        </select>
      );
    case 'bool':
      return (
        <select {...props}>
          <option value="">{t('dm.par.any')}</option>
          <option value="1">{t('dm.out.yes')}</option>
          <option value="0">{t('dm.out.no')}</option>
        </select>
      );
    default:
      return <input type="text" {...props} />;
  }
}
