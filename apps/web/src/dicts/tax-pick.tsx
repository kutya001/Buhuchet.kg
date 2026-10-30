'use client';

import {
  mainTaxPicks,
  REMIND_DAY_MAX,
  searchText,
  taxPickGroupCodes,
  taxPickGroups,
  type TaxPickGroup,
} from '@buhuchet/domain';
import {
  OrgReportTypesConnected,
  type OrgReportTypeSettings,
  type ReportType,
} from '@buhuchet/shared';
import {
  ActPill,
  buttonClass,
  CHECKBOX_CLASS,
  EmptyState,
  Field,
  Icon,
  inputClass,
  Modal,
  PHONE_QUERY,
  Tag,
  useMediaQuery,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useId,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import {
  catalogQuery,
  taxesQuery,
  typeSettingsQuery,
  useDictsRefresh,
  type Catalog,
} from './dicts-data';
import { periodOwn, TypeDesc } from './type-guide';

/** Периодичность в строке: «разовый», «по назначению», «квартал» (прототип perTxt). */
const periodShort = (x: ReportType, t: Translate) =>
  x.oneOff
    ? t('dicts.tx.per.oneoff')
    : periodOwn(x)
      ? t('dicts.tx.per.own')
      : t(`dicts.tx.per.${x.period.toLowerCase() as 'm' | 'q' | 'h' | 'y'}`);

/** Дни из поля «Напоминать до срока, за дней»: числа через запятую или пробел, от 1 до 60, без повторов. */
const parseDays = (text: string) => [
  ...new Set(
    text
      .split(/[,;\s]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0 && n <= REMIND_DAY_MAX),
  ),
];

/**
 * Окно «Выбор налогов» — «Подключить из каталога» в «Справочники» → «Виды отчётов» (ТЗ «Первый запуск
 * организации», экран 6, и «Справочники» → «Виды отчётов»; прототип modules/tax-pick.js, txDlg): весь
 * каталог видов отчётов группами (`taxPickGroups`), уже подключённые отмечены и подписаны «Подключён»;
 * у группы — «кому это нужно», «Выбрано N из M» и «Выбрать всю группу», на телефоне группы свёрнуты, на
 * ПК раскрыта первая. Строка раскрывает описание вида. Поиск по названию и коду формы, «Отметить
 * основные», «Снять все»; поле «Напоминать до срока, за дней» — дни для новых подключённых видов (пусто
 * — набор из учётной политики). «Подключить» подключает отмеченные и отключает снятые одним запросом.
 */
function TaxPickDialog({
  catalog,
  settings,
  open,
  onClose,
  onDone,
}: {
  catalog: Catalog;
  settings: OrgReportTypeSettings;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const was = useMemo(
    () => new Set(settings.items.filter((s) => s.enabled).map((s) => s.code)),
    [settings],
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(was);
  const initialDays = settings.remindDays.join(', ');
  const [days, setDays] = useState(initialDays);
  const [busy, setBusy] = useState(false);

  const connect = [...selected].filter((c) => !was.has(c));
  const disconnect = [...was].filter((c) => !selected.has(c));

  const submit = async () => {
    const remindDays = parseDays(days);
    setBusy(true);
    const res = await callApi(() =>
      api.api['org-report-types'].connect.$post({
        json: { connect, disconnect, ...(remindDays.length ? { remindDays } : {}) },
      }),
    );
    setBusy(false);
    if (!res.ok) {
      toast(errorText(res.error), { bad: true, icon: 'alert' });
      return;
    }
    const done = OrgReportTypesConnected.parse(res.data);
    onDone();
    onClose();
    toast(
      done.disconnected
        ? t('dicts.tx.done_off', { on: done.connected, off: done.disconnected })
        : t('dicts.tx.done', { on: done.connected }),
      { icon: 'check' },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={t('dicts.tx.title')}
      sub={t('dicts.tx.sub')}
      dirty={connect.length > 0 || disconnect.length > 0 || days !== initialDays}
      footer={
        <>
          <span data-tx-total="" className="text-[13px] text-muted">
            {t('dicts.tx.selected', { n: selected.size })}
            {connect.length ? ` · ${t('dicts.tx.new', { n: connect.length })}` : ''}
            {disconnect.length ? (
              <>
                {' · '}
                <span className="text-danger-label">
                  {t('dicts.tx.off', { n: disconnect.length })}
                </span>
              </>
            ) : null}
          </span>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy || (!connect.length && !disconnect.length)}
            onClick={() => void submit()}
          >
            <Icon name="check" size="sm" />
            {t('dicts.tx.connect')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <TaxPickList catalog={catalog} selected={selected} setSelected={setSelected} was={was} />
        <div className="mt-2.5">
          <Field id={`${id}-days`} label={t('dicts.type.days')} hint={t('dicts.tx.days_hint')} full>
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="numeric"
                className={inputClass()}
                value={days}
                placeholder={t('dicts.tx.days_placeholder')}
                onChange={(e) => setDays(e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Список «Выбора налогов» (прототип txHtml и txMount): поиск по названию и коду формы, «Отметить
 * основные», «Снять все» и каталог группами. Его показывают окно «Подключить из каталога» и последний
 * экран приветствия (задача 2.33); `was` — уже подключённые (метка «Подключён»), у приветствия пусто.
 */
export function TaxPickList({
  catalog,
  selected,
  setSelected,
  was,
}: {
  catalog: Catalog;
  selected: ReadonlySet<string>;
  setSelected: Dispatch<SetStateAction<ReadonlySet<string>>>;
  was: ReadonlySet<string>;
}) {
  const t = useT();
  const toast = useToast();
  const phone = useMediaQuery(PHONE_QUERY);
  const taxes = useQuery(taxesQuery).data;
  const groups = useMemo(() => taxPickGroups(catalog.pick, t), [catalog, t]);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() =>
    phone || !groups[0] ? new Set() : new Set([groups[0].id]),
  );
  const [row, setRow] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const query = searchText(q.trim());
  const hit = (x: ReportType) =>
    !query ||
    [x.shortName, x.name, x.formCode, x.statIndex].some((v) => searchText(v).includes(query));

  const toggle = (codes: readonly string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  const toggleGroup = (g: TaxPickGroup) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(g.id)) next.delete(g.id);
      else next.add(g.id);
      return next;
    });

  const rowView = (x: ReportType, key: string): ReactNode => {
    const on = selected.has(x.code);
    const expanded = row === x.code;
    return (
      <div key={key} className="mx-2.5 mt-1.5">
        <div
          data-tx-row={x.code}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('input,button,a')) return;
            setRow(expanded ? null : x.code);
          }}
          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-[9px] hover:bg-row-hover ${on ? 'bg-[color-mix(in_srgb,var(--bu-green-bg)_45%,var(--bu-raised))]' : 'bg-raised'}`}
        >
          <input
            type="checkbox"
            className={`${CHECKBOX_CLASS} mt-0.5 h-[18px] w-[18px]`}
            checked={on}
            aria-label={x.shortName}
            onChange={(e) => toggle([x.code], e.target.checked)}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <div className="flex flex-wrap items-center gap-1.5 text-[13.5px]">
              <b>{x.shortName}</b>
              <ActPill act={x.act} label={t(`report.act.${x.act}`)} />
              <span className="text-[12px] text-muted">
                {catalog.authority(x.authorityCode)} · {periodShort(x, t)}
              </span>
            </div>
            {x.formCode ? (
              <div className="text-[12px] leading-[1.35] text-faint">{x.formCode}</div>
            ) : null}
          </div>
          <span className="flex-none self-center">
            {was.has(x.code) ? <Tag>{t('dicts.tx.connected')}</Tag> : null}
          </span>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={t('dicts.tx.desc_label', { name: x.shortName })}
            onClick={() => setRow(expanded ? null : x.code)}
            className="grid h-6 w-6 flex-none cursor-pointer place-items-center self-center rounded border-0 bg-transparent text-faint"
          >
            <Icon name={expanded ? 'up' : 'down'} size="sm" />
          </button>
        </div>
        {expanded ? (
          <div className="pt-0.5 pr-1 pb-2 pl-9 max-md:px-0 max-md:pt-1 max-md:[&>div]:rounded-lg max-md:[&>div]:border max-md:[&>div]:border-line max-md:[&>div]:bg-raised max-md:[&>div]:p-3">
            <TypeDesc type={x} catalog={catalog} taxes={taxes} />
          </div>
        ) : null}
      </div>
    );
  };

  const shown = groups.flatMap((g) => {
    const codes = taxPickGroupCodes(g);
    if (query && !codes.some((c) => hitCode(c))) return [];
    const n = codes.filter((c) => selected.has(c)).length;
    const all = n === codes.length;
    const isOpen = !!query || opened.has(g.id);
    return [
      <div
        key={g.id}
        data-tx-group={g.id}
        className={`overflow-hidden rounded-xl border border-line ${isOpen ? 'pb-2' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-2.5 py-1 pr-3 hover:bg-row-hover max-md:pr-2.5">
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => toggleGroup(g)}
            className="flex min-w-0 flex-[1_1_260px] cursor-pointer items-center gap-2.5 border-0 bg-transparent py-2 pl-3 text-left text-ink"
          >
            <Icon
              name="right"
              size="sm"
              className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
            />
            <span className="flex min-w-0 flex-col gap-px">
              <b>{g.title}</b>
              <span className="text-[11.5px] leading-[1.4] text-faint">{g.who}</span>
            </span>
          </button>
          <span
            data-tx-count=""
            className={`text-[12.5px] font-semibold max-md:ml-[34px] ${all ? 'text-ok' : 'text-muted'}`}
          >
            {t('dicts.tx.group_count', { n, total: codes.length })}
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] whitespace-nowrap text-muted">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={all}
              onChange={(e) => {
                toggle(codes, e.target.checked);
                setOpened((prev) => new Set(prev).add(g.id));
              }}
            />
            {t('dicts.tx.group_all')}
          </label>
        </div>
        {isOpen
          ? g.subs.map((s, i) => {
              const items = s.codes.flatMap((c) => {
                const x = catalog.type(c);
                return x && hit(x) ? [x] : [];
              });
              if (!items.length) return null;
              return (
                <div key={i}>
                  {s.title ? (
                    <div className="mx-2.5 mt-2.5 text-[12px] font-[650] tracking-[.04em] text-muted uppercase">
                      {s.title}
                    </div>
                  ) : null}
                  {items.map((x) => rowView(x, `${g.id}-${x.code}`))}
                </div>
              );
            })
          : null}
      </div>,
    ];
  });

  function hitCode(code: string) {
    const x = catalog.type(code);
    return !!x && hit(x);
  }

  return (
    <div className="flex flex-col gap-2" data-tax-pick="">
      <div className="sticky -top-px z-[2] flex flex-wrap items-center gap-2 bg-raised pt-1 pb-2">
        <span className="relative flex min-w-[220px] flex-1 items-center max-md:basis-full">
          <Icon
            name="search"
            size="sm"
            className="pointer-events-none absolute left-2.5 text-faint"
          />
          <input
            type="search"
            className={`${inputClass()} pl-8`}
            value={q}
            placeholder={t('dicts.tx.search')}
            aria-label={t('dicts.tx.search_label')}
            onChange={(e) => setQ(e.target.value)}
          />
        </span>
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() => {
            toggle(mainTaxPicks(catalog.pick.types), true);
            toast(t('dicts.tx.main_done'));
          }}
        >
          <Icon name="star" size="sm" />
          {t('dicts.tx.main')}
        </button>
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          onClick={() => setSelected(new Set())}
        >
          {t('dicts.tx.none')}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {shown.length ? (
          shown
        ) : (
          <EmptyState
            icon="search"
            title={t('dicts.tx.nothing')}
            text={t('dicts.tx.nothing_text')}
          />
        )}
      </div>
    </div>
  );
}

/**
 * «Подключить из каталога»: окно «Выбор налогов» открывается, когда каталог и настройки организации
 * загружены (налоги для описаний догружаются в окне).
 */
export function useTaxPick(): { open: () => void; dialog: ReactNode } {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const refresh = useDictsRefresh();
  const [slot, setSlot] = useState<DialogSlot<{
    catalog: Catalog;
    settings: OrgReportTypeSettings;
  }> | null>(null);

  const open = async () => {
    try {
      const [catalog, settings] = await Promise.all([
        client.fetchQuery(catalogQuery),
        client.fetchQuery({ ...typeSettingsQuery, staleTime: 0 }),
      ]);
      setSlot(openSlot({ catalog, settings }));
    } catch {
      toast(t('dicts.tx.load_error'), { bad: true });
    }
  };

  const dialog = slot ? (
    <TaxPickDialog
      key={`tax-pick-${slot.n}`}
      catalog={slot.data.catalog}
      settings={slot.data.settings}
      open={slot.open}
      onClose={() => setSlot(closeSlot)}
      onDone={refresh}
    />
  ) : null;

  return { open: () => void open(), dialog };
}
