'use client';

import {
  baseToggle,
  isSingleTaxType,
  isStatForm,
  isTypeOff,
  PICK_SECTIONS,
  reportPick,
  reportPickAllWhy,
  reportPickAuto,
  reportPickChanges,
  reportsNotNeeded,
  searchText,
  STAT_BASE,
  statBaseAuto,
  type PickResult,
  type PickSection,
} from '@buhuchet/domain';
import {
  ReportPickApplied,
  ReportPickPreview,
  type ReportPickContext,
  type ReportPickRequest,
  type ReportType,
  type Taxes,
} from '@buhuchet/shared';
import {
  ActPill,
  buttonClass,
  CHECKBOX_CLASS,
  ConfirmDialog,
  EmptyState,
  Icon,
  inputClass,
  linkButtonClass,
  Modal,
  Note,
  PHONE_QUERY,
  Pill,
  Segments,
  Tag,
  useMediaQuery,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { catalogQuery, taxesQuery, valueDictsQuery, type Catalog } from '../dicts/dicts-data';
import { useTaxPick } from '../dicts/tax-pick';
import { periodOwn, TypeDesc } from '../dicts/type-guide';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { pickDictOf, pickSubjectOf, reportPickQuery } from './report-pick-data';

/*
 * «Подбор отчётов» (ТЗ «Контрагенты» → «Подбор отчётов и налогов, льгот и статусов»; прототип
 * modules/report-pick.js — pkView, pkMount, pickDlg, pkCpTab): одно содержимое для окна (форма
 * создания контрагента) и для вкладки «Подбор отчётов» карточки. Вкладки «Рекомендуемые» (группы по
 * причине подбора) и «Все» (по органам, с фильтрами), основания в шапке, поиск по названию и коду
 * формы, описание вида справа (на телефоне — под строкой). Наборы считает `reportPick` на данных
 * сервера; при «Применить» у созданного контрагента сервер считает их заново.
 */

type ActFilter = '' | ReportType['act'];
type KindFilter = '' | 'regime' | 'cross';
type PeriodFilter = '' | 'M' | 'Q' | 'H' | 'Y' | 'own';

/** Состояние подбора: живёт, пока открыто окно или карточка (прототип pkState). */
export interface PickState {
  tab: 'rec' | 'all';
  q: string;
  /** Вид, описание которого справа (ПК). */
  cur: string | null;
  /** Вид, описание которого раскрыто под строкой (телефон). */
  open: string | null;
  act: ActFilter;
  kind: KindFilter;
  per: PeriodFilter;
  /** Раскрытые свёрнутые группы: «stat» и органы из одних форм Нацстаткома («o:<орган>»). */
  gOpen: ReadonlySet<string>;
  /** Основание «В списке Нацстаткома» включилось само — подсказка над списком. */
  autoBase: boolean;
  sel: ReadonlySet<string>;
  /** Обязательные виды, снятые после подтверждения: код → «обязателен по …». */
  forced: ReadonlyMap<string, string>;
  bases: readonly string[];
}

export const pickState = (sel: Iterable<string>, bases: readonly string[]): PickState => ({
  tab: 'rec',
  q: '',
  cur: null,
  open: null,
  act: '',
  kind: '',
  per: '',
  gOpen: new Set(),
  autoBase: false,
  sel: new Set(sel),
  forced: new Map(),
  bases: [...bases],
});

export const sameSet = (a: Iterable<string>, b: Iterable<string>) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/** Периодичность в строке: «разовый», «по назначению», «квартал» (прототип perTxt). */
const periodShort = (x: ReportType, t: Translate) =>
  x.oneOff
    ? t('cp.pick.ui.per.oneoff')
    : periodOwn(x)
      ? t('cp.pick.ui.per.own')
      : t(`cp.pick.ui.per.${x.period.toLowerCase() as 'm' | 'q' | 'h' | 'y'}`);

/** Названия видов через запятую без точки в конце (прототип pkList). */
const typeList = (codes: readonly string[], catalog: Catalog) =>
  codes
    .map((c) => catalog.type(c)?.shortName ?? c)
    .join(', ')
    .replace(/\.$/, '');

/** Строка о контрагенте над списком (прототип pkCtxLine): режим, статусы, ГКЭД, форма, размер бизнеса. */
export function ContextLine({ ctx, catalog }: { ctx: ReportPickContext; catalog: Catalog }) {
  const t = useT();
  const forms = useQuery(valueDictsQuery).data?.forms;
  const s = ctx.subject;
  const [first, second] = s.regimes;
  const full = first && catalog.regimes.find((r) => r.code === first.code)?.fullName;
  const form = s.form && forms?.find((f) => f.code === s.form?.code);
  const statuses = s.benefits.map((c) => catalog.benefits.find((b) => b.code === c)?.name ?? c);
  const parts: ReactNode[] = [
    first ? (
      t('cp.pick.ui.ctx.regime', {
        name: `${full || first.name}${second ? ` + ${second.name}` : ''}`,
      })
    ) : (
      <b key="r" className="inline-flex items-center gap-1 text-warn-label">
        <Icon name="alert" size="sm" />
        {t('cp.pick.ui.ctx.no_regime')}
      </b>
    ),
    statuses.length
      ? t('cp.pick.ui.ctx.statuses', { names: statuses.join(', ') })
      : t('cp.pick.ui.ctx.no_statuses'),
    s.gked ? t('cp.pick.ui.ctx.gked', { code: s.gked }) : t('cp.pick.ui.ctx.no_gked'),
    form ? form.shortName || form.name : t('cp.pick.ui.ctx.no_form'),
    t(`cp.biz.${s.bizSize}`),
  ];
  return (
    <>
      <div
        data-pick-context=""
        className="rounded-lg border border-line bg-pane-alt px-3 py-2 text-[12.5px] leading-normal text-muted"
      >
        {parts.map((p, i) => (
          <span key={i}>
            {i ? <span className="text-faint"> · </span> : null}
            {p}
          </span>
        ))}
      </div>
      {first ? null : (
        <div className="text-[11.5px] leading-[1.4] text-faint">{t('cp.pick.ui.ctx.hint')}</div>
      )}
    </>
  );
}

/**
 * В организации не подключено ни одного вида (прототип txNote): назначать нечего. «Выбрать налоги» — у
 * сотрудника с правом менять справочники, остальным — «Подключает владелец».
 */
function NoTypesNote({ connect }: { connect: boolean }) {
  const t = useT();
  const pick = useTaxPick();
  return (
    <div data-no-types="">
      <Note icon="book">
        <span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1">
            <b>{t('cp.pick.ui.no_types')}</b> {t('cp.pick.ui.no_types_text')}
          </span>
          {connect ? (
            <button type="button" className={buttonClass('cta', 'sm')} onClick={pick.open}>
              <Icon name="plus" size="sm" />
              {t('cp.pick.ui.no_types_btn')}
            </button>
          ) : (
            <span className="text-[12px] text-faint">{t('cp.pick.ui.no_types_owner')}</span>
          )}
        </span>
      </Note>
      {pick.dialog}
    </div>
  );
}

/** Описание вида для контрагента: сроки по статусу, ближайший срок, ставки ЕН по ГКЭД, тариф Соцфонда. */
function PickTypeDesc({
  type: x,
  ctx,
  catalog,
  taxes,
  footer,
}: {
  type: ReportType;
  ctx: ReportPickContext;
  catalog: Catalog;
  taxes: Taxes | undefined;
  footer: ReactNode;
}) {
  const d = ctx.details.find((r) => r.code === x.code);
  const sf = ctx.socfund?.types.includes(x.code) ? ctx.socfund : null;
  return (
    <TypeDesc
      type={x}
      catalog={catalog}
      taxes={taxes}
      pick={{
        statusDue: d?.statusDue ?? '',
        near: x.oneOff ? null : d?.near || '—',
        enRates: isSingleTaxType(x.code) ? ctx.enRates : '',
        footer: (
          <>
            {sf ? (
              <Note tone={sf.warn ? 'warn' : 'info'} icon={sf.warn ? 'alert' : 'shield'}>
                {sf.title ? <b>{sf.title}</b> : null}
                {sf.text}
              </Note>
            ) : null}
            {footer}
          </>
        ),
      }}
    />
  );
}

interface PickViewProps {
  ctx: ReportPickContext;
  catalog: Catalog;
  st: PickState;
  set: (update: (s: PickState) => PickState) => void;
  /** Назначенные виды («Назначен», «Будет снят»). */
  before: ReadonlySet<string>;
  /** Можно отмечать виды и менять основания. */
  edit: boolean;
  editBases: boolean;
  /**
   * «+ Добавить отчёт» (прототип pickDlg, single): вкладка «Все» без оснований и «Отметить все в
   * группе»; новым отмечается один вид, уже выбранные (`single`) остаются.
   */
  single?: ReadonlySet<string>;
}

/** Итог подбора и названия по коду для окна и вкладки. */
function usePick(ctx: ReportPickContext, catalog: Catalog, bases: readonly string[]) {
  const t = useT();
  const dict = useMemo(() => pickDictOf(catalog, ctx), [catalog, ctx]);
  const subject = useMemo(() => pickSubjectOf(ctx, bases), [ctx, bases]);
  const calc = useMemo(
    () => reportPick(subject, dict, ctx.today, t),
    [subject, dict, ctx.today, t],
  );
  return { dict, subject, calc };
}

/**
 * Подбор для черновика формы без окна (прототип pkCalc): «Рекомендуемые» с причинами и обязательностью —
 * форма подписывает выбранные отчёты и предупреждает о снятых обязательных; `ctx` — ответ сервера (ГКЭД,
 * подключённые виды). null — данные ещё грузятся.
 */
export function useReportPickCalc(
  request: Omit<ReportPickRequest, 'contractorId'> & { contractorId?: string },
): { pick: PickResult; ctx: ReportPickContext; catalog: Catalog } | null {
  const t = useT();
  const catalog = useQuery(catalogQuery).data;
  const query = useQuery(reportPickQuery(request));
  // Прежний ответ, пока перечитывается новый, — набор для прежних полей формы: его не отдаём.
  const ctx = query.isPlaceholderData ? undefined : query.data;
  return useMemo(
    () =>
      catalog && ctx
        ? {
            pick: reportPick(
              pickSubjectOf(ctx, ctx.subject.bases),
              pickDictOf(catalog, ctx),
              ctx.today,
              t,
            ),
            ctx,
            catalog,
          }
        : null,
    [catalog, ctx, t],
  );
}

/**
 * Отчёты, которые отмечаются сами (прототип pkAuto), для черновика формы без окна: форма показывает их
 * в «Сдаёт отчёты» и открывает с ними окно, пока выбор в окне не меняли. null — данные ещё грузятся
 * (окно тогда не открывать: начальный выбор был бы не тот).
 */
export function useReportPickAuto(
  request: Omit<ReportPickRequest, 'contractorId'>,
): string[] | null {
  const calc = useReportPickCalc(request);
  return useMemo(() => (calc ? reportPickAuto(calc.pick) : null), [calc]);
}

/** Содержимое подбора: шапка, поиск, вкладки, список и описание; внизу — итог (`PickSummary`). */
function PickView({ ctx, catalog, st, set, before, edit, editBases, single }: PickViewProps) {
  const t = useT();
  const toast = useToast();
  const phone = useMediaQuery(PHONE_QUERY);
  const taxes = useQuery(taxesQuery).data;
  const { dict, subject, calc } = usePick(ctx, catalog, st.bases);
  const [must, setMust] = useState<{ code: string; must: string; open: boolean } | null>(null);
  const q = searchText(st.q.trim());
  const hit = (x: ReportType) =>
    !q || [x.shortName, x.name, x.formCode, x.statIndex].some((v) => searchText(v).includes(q));
  const on = (code: string) => st.sel.has(code);
  const statName = catalog.base(STAT_BASE);

  const select = (codes: readonly string[]) =>
    set((s) => {
      const sel = new Set(s.sel);
      const forced = new Map(s.forced);
      for (const c of codes) {
        sel.add(c);
        forced.delete(c);
      }
      return { ...s, sel, forced };
    });
  const unselect = (code: string, why?: string) =>
    set((s) => {
      const sel = new Set(s.sel);
      sel.delete(code);
      const forced = new Map(s.forced);
      if (why) forced.set(code, why);
      return { ...s, sel, forced };
    });
  // Форма Нацстаткома без основания: основание «В списке Нацстаткома» включается само, отмечаются
  // заранее отмечаемые формы группы (прототип pkMount, toggle). Без права менять основания — только
  // галочка.
  const toggle = (code: string, value: boolean) => {
    if (value === on(code)) return;
    if (value) {
      const auto = editBases ? statBaseAuto(code, subject, dict, ctx.today, t) : null;
      if (single) {
        // Новым остаётся один вид; формы группы Нацстаткома сами не отмечаются (прототип pkMount).
        set((s) => ({ ...s, sel: new Set([...[...s.sel].filter((c) => single.has(c)), code]) }));
      } else select([code, ...(auto?.select ?? [])]);
      if (auto) {
        set((s) => ({ ...s, bases: auto.bases, autoBase: true }));
        toast(t('cp.pick.ui.auto_base_toast', { name: statName }));
      }
      return;
    }
    const rec = calc.rec.get(code);
    if (rec?.must) setMust({ code, must: rec.must, open: true });
    else unselect(code);
  };
  const toggleBase = (code: string) => {
    const value = !st.bases.includes(code);
    const r = baseToggle(code, value, [...st.sel], subject, dict, ctx.today, t);
    set((s) => ({
      ...s,
      bases: r.bases,
      sel: new Set(r.selected),
      autoBase: code === STAT_BASE && !value ? false : s.autoBase,
    }));
  };
  const toggleGroup = (key: string) =>
    set((s) => {
      const gOpen = new Set(s.gOpen);
      if (gOpen.has(key)) gOpen.delete(key);
      else gOpen.add(key);
      return { ...s, gOpen };
    });

  const tags = (code: string) => (
    <>
      {before.has(code) ? (
        on(code) ? (
          <Tag>{t('cp.pick.ui.tag.assigned')}</Tag>
        ) : (
          <Pill tone="bad" size="sm">
            {t('cp.pick.ui.tag.remove')}
          </Pill>
        )
      ) : on(code) ? (
        <Pill tone="ok" size="sm">
          {t('cp.pick.ui.tag.add')}
        </Pill>
      ) : null}
      {before.has(code) &&
      isTypeOff(catalog.type(code) ?? { active: true, pickGroup: 'regime' }) ? (
        <Pill tone="warn" size="sm">
          {t('cp.pick.ui.tag.off')}
        </Pill>
      ) : null}
    </>
  );

  const desc = (x: ReportType) => {
    const off = calc.off.get(x.code);
    const locked = !!off || isTypeOff(x);
    return (
      <PickTypeDesc
        type={x}
        ctx={ctx}
        catalog={catalog}
        taxes={taxes}
        footer={
          edit && (!locked || on(x.code)) ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass(on(x.code) ? 'default' : 'cta', 'sm')}
                disabled={on(x.code) || locked}
                onClick={() => toggle(x.code, true)}
              >
                <Icon name="check" size="sm" />
                {t('cp.pick.ui.fits')}
              </button>
              <button
                type="button"
                className={buttonClass('default', 'sm')}
                disabled={!on(x.code)}
                onClick={() => toggle(x.code, false)}
              >
                <Icon name="x" size="sm" />
                {t('cp.pick.ui.not_fits')}
              </button>
            </div>
          ) : off ? (
            <Note tone="warn" icon="ban">
              {off}
            </Note>
          ) : null
        }
      />
    );
  };

  const row = (x: ReportType, why: string, disabled: boolean) => {
    const cur = st.cur === x.code;
    const open = phone && st.open === x.code;
    return (
      <div key={x.code}>
        <div
          data-pick-row={x.code}
          data-on={on(x.code) ? '' : undefined}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('input,button,a')) return;
            set((s) => ({
              ...s,
              cur: x.code,
              open: phone ? (s.open === x.code ? null : x.code) : s.open,
            }));
          }}
          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-[9px] hover:bg-row-hover ${cur ? 'border-brand-blue shadow-[inset_0_0_0_1px_var(--bu-b-blue)]' : 'border-line'} ${on(x.code) ? 'bg-[color-mix(in_srgb,var(--bu-green-bg)_45%,var(--bu-raised))]' : 'bg-raised'} ${disabled ? 'opacity-60' : ''}`}
        >
          {edit ? (
            <input
              type="checkbox"
              className={`${CHECKBOX_CLASS} mt-0.5 h-[18px] w-[18px]`}
              checked={on(x.code)}
              disabled={disabled && !on(x.code)}
              aria-label={x.shortName}
              onChange={(e) => toggle(x.code, e.target.checked)}
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <div className="flex flex-wrap items-center gap-1.5 text-[13.5px]">
              <b className={disabled ? 'line-through' : ''}>{x.shortName}</b>
              <ActPill act={x.act} label={t(`report.act.${x.act}`)} />
              <span className="text-[12px] text-muted">
                {catalog.authority(x.authorityCode)} · {periodShort(x, t)}
              </span>
            </div>
            <div
              data-pick-why=""
              className={`text-[12px] leading-[1.35] ${disabled ? 'text-danger-label' : 'text-faint'}`}
            >
              {why}
            </div>
          </div>
          <span className="flex flex-none flex-wrap items-center gap-1 self-center">
            {tags(x.code)}
          </span>
          {phone ? (
            <span className="grid flex-none self-center text-faint" aria-hidden="true">
              <Icon name={open ? 'up' : 'down'} size="sm" />
            </span>
          ) : null}
        </div>
        {open ? (
          <div className="pt-1 pb-2 [&>div]:rounded-lg [&>div]:border [&>div]:border-line [&>div]:bg-raised [&>div]:p-3">
            {desc(x)}
          </div>
        ) : null}
      </div>
    );
  };

  /** Свёрнутая группа: заголовок-кнопка и «отмечено N из M». */
  const foldHead = (key: string, title: string, all: readonly string[], open: boolean) => (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggleGroup(key)}
        className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[12px] tracking-[.06em] text-muted uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
      >
        <Icon
          name="right"
          size="sm"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <b className="font-bold">{title}</b>
      </button>
      <span data-pick-count="" className="text-[12px] tracking-normal normal-case">
        {t('cp.pick.ui.group_count', {
          n: all.filter(on).length,
          total: all.length,
        })}
      </span>
    </>
  );

  const groupHead = (title: string, n: number) => (
    <>
      <b className="font-bold text-muted">{title}</b>
      <span>{n}</span>
    </>
  );

  let list: ReactNode;
  if (st.tab === 'rec') {
    const groups = PICK_SECTIONS.flatMap((g) => {
      const all = [...calc.rec].filter(([, r]) => r.section === g).map(([c]) => c);
      const ids = all.filter((c) => hit(catalog.type(c)!));
      if (!ids.length) return [];
      const fold = g === 'stat';
      const open = !fold || st.gOpen.has(g) || !!q;
      const title = t(`cp.pick.ui.group.${g}` satisfies `cp.pick.ui.group.${PickSection}`);
      return [
        <section key={g} data-pick-group={g} className="mb-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-0.5 pt-0.5 text-[12px] tracking-[.06em] text-faint uppercase">
            {fold ? foldHead(g, title, all, open) : groupHead(title, ids.length)}
            <span className="flex-1" />
            {open && edit && !single && ids.some((c) => !on(c)) ? (
              <button
                type="button"
                className={`${linkButtonClass()} text-[12.5px] tracking-normal normal-case`}
                onClick={() => select(all)}
              >
                {t('cp.pick.ui.group_all')}
              </button>
            ) : null}
          </div>
          {open ? ids.map((c) => row(catalog.type(c)!, calc.rec.get(c)!.why, false)) : null}
        </section>,
      ];
    });
    const hidden = calc.hidden.map((c) => catalog.type(c)?.shortName ?? c);
    list = (
      <>
        {groups.length ? (
          groups
        ) : (
          <EmptyState
            icon="file"
            title={q ? t('cp.pick.ui.empty.found') : t('cp.pick.ui.empty.none')}
            text={
              q
                ? t('cp.pick.ui.empty.found_text')
                : ctx.subject.regimes.length
                  ? t('cp.pick.ui.empty.none_text')
                  : t('cp.pick.ui.empty.no_regime_text')
            }
          />
        )}
        {hidden.length ? (
          <div className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-[1.4] text-faint">
            <Icon name="info" size="sm" />
            <span>
              {t('cp.pick.ui.hidden', {
                names:
                  hidden.length > 8
                    ? t('cp.pick.ui.hidden_more', {
                        names: hidden.slice(0, 8).join(', '),
                        n: hidden.length - 8,
                      })
                    : hidden.join(', '),
              })}
            </span>
          </div>
        ) : null}
      </>
    );
  } else {
    const connected = new Set(ctx.connected);
    const types = catalog.all.filter(
      (x) =>
        ((connected.has(x.code) && x.active) || before.has(x.code)) &&
        (!isTypeOff(x) || before.has(x.code)) &&
        hit(x) &&
        (!st.act || x.act === st.act) &&
        (!st.kind || (st.kind === 'regime' ? x.kind === 'regime' : x.kind !== 'regime')) &&
        (!st.per || (periodOwn(x) ? st.per === 'own' : x.period === st.per)),
    );
    const organs = [...new Set(types.map((x) => x.authorityCode))];
    list = organs.length ? (
      organs.map((organ) => {
        const items = types.filter((x) => x.authorityCode === organ);
        const key = `o:${organ}`;
        const fold = items.every(isStatForm);
        const open = !fold || st.gOpen.has(key) || !!q;
        const title = catalog.authority(organ);
        return (
          <section key={key} data-pick-group={key} className="mb-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-0.5 pt-0.5 text-[12px] tracking-[.06em] text-faint uppercase">
              {fold
                ? foldHead(
                    key,
                    title,
                    items.map((x) => x.code),
                    open,
                  )
                : groupHead(title, items.length)}
            </div>
            {open
              ? items.map((x) => {
                  const r = reportPickAllWhy(x, calc, t);
                  return row(x, r.why, r.disabled);
                })
              : null}
          </section>
        );
      })
    ) : (
      <EmptyState
        icon="search"
        title={t('cp.pick.ui.empty.found')}
        text={t('cp.pick.ui.empty.all_text')}
      />
    );
  }

  const bases = catalog.bases.filter((b) => b.active || st.bases.includes(b.code));
  const cur = st.cur ? catalog.type(st.cur) : undefined;
  const filter = <T extends string>(
    value: T,
    label: string,
    options: readonly (readonly [T, string])[],
    change: (v: T) => void,
  ) => (
    <select
      className={`${inputClass({ full: false })} min-h-8 cursor-pointer py-1 max-md:flex-[1_1_40%]`}
      value={value}
      aria-label={label}
      onChange={(e) => change(e.target.value as T)}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-report-pick="">
      {ctx.connected.length ? null : <NoTypesNote connect={ctx.edit.connect} />}
      <ContextLine ctx={ctx} catalog={catalog} />
      {st.autoBase && st.bases.includes(STAT_BASE) ? (
        <Note>{t('cp.pick.ui.auto_base', { name: statName })}</Note>
      ) : null}
      {bases.length && !single ? (
        <div className="flex flex-wrap items-start gap-2">
          <span className="pt-[5px] text-[12.5px] text-muted">{t('cp.pick.ui.bases')}</span>
          <div
            role="group"
            aria-label={t('cp.pick.ui.bases')}
            data-pick-bases=""
            className="flex min-w-0 flex-1 flex-wrap gap-1.5 max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-0.5 max-md:[scrollbar-width:none]"
          >
            {bases.map((b) => {
              const value = st.bases.includes(b.code);
              return (
                <button
                  key={b.code}
                  type="button"
                  aria-pressed={value}
                  title={b.description || undefined}
                  disabled={!editBases}
                  onClick={() => toggleBase(b.code)}
                  className={`inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-full border px-[11px] py-1 text-[12.5px] font-[550] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 ${value ? 'border-transparent bg-accent text-on-accent shadow-cta' : 'border-line bg-raised text-muted'}`}
                >
                  {value ? <Icon name="check" size="sm" /> : null}
                  {b.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="relative flex min-w-[220px] flex-1 items-center max-md:min-w-0 max-md:basis-full">
          <Icon
            name="search"
            size="sm"
            className="pointer-events-none absolute left-2.5 text-faint"
          />
          <input
            type="search"
            className={`${inputClass()} pl-8`}
            value={st.q}
            placeholder={t('cp.pick.ui.search')}
            aria-label={t('cp.pick.ui.search_label')}
            onChange={(e) => {
              const value = e.target.value;
              set((s) => ({ ...s, q: value }));
            }}
          />
        </span>
        {single ? null : (
          <div className="max-md:w-full max-md:[&>div]:flex max-md:[&>div>button]:flex-1">
            <Segments
              label={t('cp.pick.ui.tabs_label')}
              value={st.tab}
              onChange={(tab) => set((s) => ({ ...s, tab }))}
              options={[
                { value: 'rec', label: t('cp.pick.ui.tab.rec') },
                { value: 'all', label: t('cp.pick.ui.tab.all') },
              ]}
            />
          </div>
        )}
      </div>
      {st.tab === 'all' ? (
        <div className="flex flex-wrap gap-2">
          {filter(
            st.act,
            t('cp.pick.ui.f.act_label'),
            [
              ['', t('cp.pick.ui.f.act')],
              ['sub', t('cp.pick.ui.f.act.sub')],
              ['pay', t('cp.pick.ui.f.act.pay')],
              ['both', t('cp.pick.ui.f.act.both')],
            ],
            (act) => set((s) => ({ ...s, act })),
          )}
          {filter(
            st.kind,
            t('cp.pick.ui.f.kind_label'),
            [
              ['', t('cp.pick.ui.f.kind')],
              ['regime', t('cp.pick.ui.f.kind.regime')],
              ['cross', t('cp.pick.ui.f.kind.cross')],
            ],
            (kind) => set((s) => ({ ...s, kind })),
          )}
          {filter(
            st.per,
            t('cp.pick.ui.f.per_label'),
            [
              ['', t('cp.pick.ui.f.per')],
              ['M', t('cp.pick.ui.f.per.m')],
              ['Q', t('cp.pick.ui.f.per.q')],
              ['H', t('cp.pick.ui.f.per.h')],
              ['Y', t('cp.pick.ui.f.per.y')],
              ['own', t('cp.pick.ui.f.per.own')],
            ],
            (per) => set((s) => ({ ...s, per })),
          )}
        </div>
      ) : null}
      <div className="grid min-h-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-3.5 max-md:block">
        <div className="min-w-0" data-pick-list="">
          {list}
        </div>
        {phone ? null : (
          <div
            data-pick-side=""
            className="sticky top-0 max-h-[calc(100dvh-330px)] overflow-auto rounded-xl border border-line bg-raised px-4 py-3.5"
          >
            {cur ? (
              desc(cur)
            ) : (
              <div className="flex flex-col items-center gap-2 px-2 py-7 text-center text-muted">
                <Icon name="info" size="lg" className="text-faint" />
                <b className="text-[15px] text-ink">{t('cp.pick.ui.side_title')}</b>
                <span className="max-w-[420px]">{t('cp.pick.ui.side_text')}</span>
              </div>
            )}
          </div>
        )}
      </div>
      {must ? (
        <ConfirmDialog
          open={must.open}
          onClose={() => setMust({ ...must, open: false })}
          title={t('cp.pick.ui.must_title')}
          text={t('cp.pick.ui.must_text', {
            must: must.must,
            name: catalog.type(must.code)?.shortName ?? must.code,
          })}
          ok={t('cp.pick.ui.must_ok')}
          danger
          onConfirm={() => unselect(must.code, must.must)}
        />
      ) : null}
    </div>
  );
}

/** Итог внизу (прототип pkView, sum): «Выбрано: 7 · новых 2 · будет снято 1». */
function PickSummary({ st, before }: { st: PickState; before: ReadonlySet<string> }) {
  const t = useT();
  const { add, remove } = reportPickChanges([...before], [...st.sel]);
  return (
    <span data-pick-sum="" className="text-[13px] text-muted">
      {t('cp.pick.ui.sum', { n: st.sel.size })}
      {add.length ? ` · ${t('cp.pick.ui.sum_new', { n: add.length })}` : ''}
      {remove.length ? (
        <>
          {' · '}
          <span className="text-danger-label">
            {t('cp.pick.ui.sum_remove', { n: remove.length })}
          </span>
        </>
      ) : null}
    </span>
  );
}

const ReadOnlyLine = () => {
  const t = useT();
  return <span className="text-[13px] text-muted">{t('cp.pick.ui.readonly')}</span>;
};

/** Пока данные окна грузятся или не загрузились. */
function PickLoading({ failed }: { failed: boolean }) {
  const t = useT();
  return failed ? (
    <EmptyState icon="alert" title={t('cp.pick.ui.load_error')} />
  ) : (
    <div className="flex min-h-40 items-center justify-center text-faint" aria-busy="true">
      <Icon name="refresh" className="animate-spin" />
    </div>
  );
}

/** Что выбрано в окне: отмеченные виды, основания и обязательные, снятые после подтверждения. */
export interface PickChoice {
  sel: string[];
  bases: string[];
  forced: string[];
}

/**
 * Окно «Подбор отчётов» для черновика формы создания контрагента (прототип pickDlg): `request` — поля
 * формы (с признаками тарифа Соцфонда — для пояснения у вида со взносами), `initial` — уже выбранные
 * виды и основания. «Применить» отдаёт выбор форме, ничего не сохраняя. `single` — окно «Добавить
 * отчёт» для кнопки «+ Добавить отчёт»: один новый вид к уже выбранным.
 */
export function ReportPickDialog({
  open,
  onClose,
  request,
  initial,
  title,
  single = false,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  request: Omit<ReportPickRequest, 'contractorId' | 'bases'>;
  initial: { sel: readonly string[]; bases: readonly string[] };
  title?: string;
  single?: boolean;
  onApply: (choice: PickChoice) => void;
}) {
  const t = useT();
  const [st, setSt] = useState<PickState>(() => ({
    ...pickState(initial.sel, initial.bases),
    tab: single ? 'all' : 'rec',
  }));
  const [keep] = useState<ReadonlySet<string>>(() => new Set(initial.sel));
  const catalog = useQuery(catalogQuery);
  const ctx = useQuery(reportPickQuery({ ...request, bases: [...st.bases] }));
  const before = useMemo(() => new Set<string>(), []);
  const ready = catalog.data && ctx.data;
  const edit = !!ctx.data?.edit.types;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      swipeHead
      phoneFull
      title={single ? t('cp.pick.ui.title_single') : t('cp.pick.ui.title')}
      sub={title}
      footer={
        edit ? (
          <>
            <PickSummary st={st} before={before} />
            <div className="flex-1" />
            <button type="button" className={buttonClass('ghost')} onClick={onClose}>
              {t('btn.cancel')}
            </button>
            <button
              type="button"
              className={buttonClass('cta')}
              disabled={!ready || (single && [...st.sel].every((c) => keep.has(c)))}
              onClick={() => {
                onApply({ sel: [...st.sel], bases: [...st.bases], forced: [...st.forced.keys()] });
                onClose();
              }}
            >
              {single ? t('cp.pick.ui.add') : t('cp.pick.ui.apply')}
            </button>
          </>
        ) : (
          <>
            {ready ? <ReadOnlyLine /> : null}
            <div className="flex-1" />
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('btn.close')}
            </button>
          </>
        )
      }
    >
      {ready ? (
        <PickView
          ctx={ctx.data}
          catalog={catalog.data}
          st={st}
          set={setSt}
          before={before}
          edit={edit}
          editBases={ctx.data.edit.bases}
          single={single ? keep : undefined}
        />
      ) : (
        <PickLoading failed={catalog.isError || ctx.isError} />
      )}
    </Modal>
  );
}

/**
 * Вкладка «Подбор отчётов» карточки контрагента (прототип pkCpTab, pkCpMount, pkConfirm): то же
 * содержимое, внизу — итог, «Сбросить» и «Применить». Перед сохранением окно подтверждения
 * перечисляет, что добавится и снимется и сколько отчётов удалится (считает сервер). `onDirty` —
 * есть несохранённый выбор (карточка спросит перед закрытием); `onChanged` — отчёты или основания
 * сохранены.
 */
export function ReportPickTab({
  contractorId,
  onDirty,
  onChanged,
}: {
  contractorId: string;
  onDirty?: (dirty: boolean) => void;
  onChanged?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [st, setSt] = useState<PickState | null>(null);
  const catalog = useQuery(catalogQuery);
  const ctx = useQuery(reportPickQuery({ contractorId, bases: st ? [...st.bases] : undefined }));
  const [saved, setSaved] = useState<{ assigned: string[]; bases: string[] } | null>(null);
  const [confirm, setConfirm] = useState<{
    node: ReactNode;
    danger: boolean;
    open: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Выбор начинается с назначенных видов и сохранённых оснований; после «Применить» — заново со
  // свежего ответа сервера (не с прежнего, который ещё перечитывается). Состояние задаётся прямо при
  // отрисовке: React сразу отрисует вкладку заново, без лишнего кадра «Загрузка».
  if (!st && ctx.data && !ctx.isPlaceholderData && !ctx.isFetching) {
    setSaved({ assigned: ctx.data.assigned, bases: ctx.data.subject.bases });
    setSt(pickState(ctx.data.assigned, ctx.data.subject.bases));
  }

  const before = useMemo(() => new Set(saved?.assigned ?? []), [saved]);
  const dirty =
    !!st && !!saved && (!sameSet(st.sel, saved.assigned) || !sameSet(st.bases, saved.bases));
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  if (!st || !saved || !catalog.data || !ctx.data) {
    return <PickLoading failed={catalog.isError || ctx.isError} />;
  }
  const data = ctx.data;
  const cat = catalog.data;
  const edit = data.edit.types;
  const basesChanged = !sameSet(st.bases, saved.bases);
  const { add, remove } = reportPickChanges(saved.assigned, [...st.sel]);

  const reload = () => {
    setSt(null);
    setSaved(null);
    void client.invalidateQueries({ queryKey: ['contractors'] });
  };

  const save = async () => {
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors[':id']['report-pick'].$put({
        param: { id: contractorId },
        json: {
          assigned: saved.assigned,
          codes: [...st.sel],
          ...(basesChanged ? { bases: [...st.bases], version: data.version ?? 0 } : {}),
          forced: remove.filter((c) => st.forced.has(c)),
        },
      }),
    );
    setBusy(false);
    if (!res.ok) {
      toast(errorText(res.error), { bad: true, icon: 'alert' });
      if (res.status === 409) reload();
      return;
    }
    const done = ReportPickApplied.parse(res.data);
    reload();
    onChanged?.();
    toast(
      done.add.length || done.remove.length
        ? t('cp.pick.ui.done', { add: done.add.length, remove: done.remove.length }) +
            (done.deleted ? t('cp.pick.ui.done_deleted', { n: done.deleted }) : '')
        : basesChanged
          ? t('cp.pick.ui.bases_saved')
          : t('cp.pick.ui.unchanged'),
      { icon: 'check' },
    );
  };

  // Что удалится, считает сервер: текущие и будущие «К сдаче» без движения; остальное остаётся.
  const apply = async () => {
    if (!add.length && !remove.length) {
      await save();
      return;
    }
    let deleted = 0;
    let kept = 0;
    if (remove.length) {
      setBusy(true);
      const res = await callApi(() =>
        api.api.contractors[':id']['report-pick'].preview.$post({
          param: { id: contractorId },
          json: { codes: [...st.sel] },
        }),
      );
      setBusy(false);
      if (!res.ok) {
        toast(errorText(res.error), { bad: true, icon: 'alert' });
        return;
      }
      ({ deleted, kept } = ReportPickPreview.parse(res.data));
    }
    setConfirm({
      open: true,
      danger: remove.length > 0,
      node: (
        <div className="flex flex-col gap-3" data-pick-confirm="">
          {add.length ? (
            <p className="m-0">
              <b>{t('cp.pick.ui.confirm_add')}</b>{' '}
              {t('cp.pick.ui.confirm_add_text', { names: typeList(add, cat) })}
            </p>
          ) : null}
          {remove.length ? (
            <p className="m-0">
              <b>{t('cp.pick.ui.confirm_remove')}</b>{' '}
              {t('cp.pick.ui.confirm_remove_text', { names: typeList(remove, cat), n: deleted })}
              {kept > 0 ? t('cp.pick.ui.confirm_kept', { n: kept }) : ''}
              {t('cp.pick.ui.confirm_past')}
            </p>
          ) : null}
        </div>
      ),
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-pick-tab="">
      <PickView
        ctx={data}
        catalog={cat}
        st={st}
        set={(update) => setSt((s) => (s ? update(s) : s))}
        before={before}
        edit={edit}
        editBases={data.edit.bases}
      />
      <div
        data-pick-apply=""
        className={`sticky -bottom-1.5 z-[3] mt-1 flex flex-wrap items-center gap-2 rounded-xl border bg-raised px-3 py-2.5 shadow-pane ${dirty ? 'border-accent' : 'border-line'}`}
      >
        {edit ? (
          <>
            <PickSummary st={st} before={before} />
            <div className="flex-1" />
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              disabled={!dirty || busy}
              onClick={() => setSt(pickState(saved.assigned, saved.bases))}
            >
              {t('cp.pick.ui.reset')}
            </button>
            <button
              type="button"
              className={buttonClass('cta', 'sm')}
              disabled={!dirty || busy}
              onClick={() => void apply()}
            >
              <Icon name="check" size="sm" />
              {t('cp.pick.ui.apply')}
            </button>
          </>
        ) : (
          <ReadOnlyLine />
        )}
      </div>
      {confirm ? (
        <ConfirmDialog
          open={confirm.open}
          onClose={() => setConfirm({ ...confirm, open: false })}
          title={t('cp.pick.ui.confirm_title')}
          text={confirm.node}
          ok={t('btn.save')}
          danger={confirm.danger}
          onConfirm={() => void save()}
        />
      ) : null}
    </div>
  );
}

/**
 * «По статусу «…» не нужны: …» с кнопкой «Снять» (прототип pkNotNeededNote): назначенные или выбранные
 * отчёты, которые статусы контрагента делают ненужными. Показывает форма контрагента после окна
 * «Льготы и особые статусы»; без `onRemove` — без кнопки.
 */
export function NotNeededNote({
  benefits,
  assigned,
  catalog,
  onRemove,
}: {
  benefits: readonly string[];
  assigned: readonly string[];
  catalog: Catalog;
  onRemove?: (codes: string[]) => void;
}) {
  const t = useT();
  const notes = reportsNotNeeded(benefits, assigned, { benefits: catalog.benefits });
  if (!notes.length) return null;
  return (
    <>
      {notes.map((x) => (
        <Note key={x.benefit} tone="warn">
          <div className="flex flex-wrap items-center gap-2" data-not-needed={x.benefit}>
            <span className="grow">
              {t('cp.pick.ui.not_needed', {
                name: x.name,
                names: x.types.map((c) => catalog.type(c)?.shortName ?? c).join(', '),
              })}
            </span>
            {onRemove ? (
              <button
                type="button"
                className={buttonClass('default', 'sm')}
                onClick={() => onRemove(x.types)}
              >
                {t('cp.pick.ui.not_needed_remove')}
              </button>
            ) : null}
          </div>
        </Note>
      ))}
    </>
  );
}
