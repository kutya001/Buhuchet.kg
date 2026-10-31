'use client';

import { monthText, pluralForm } from '@buhuchet/domain';
import { WhoChanged, type KpiWho, type WhoContractor } from '@buhuchet/shared';
import {
  ActionMenu,
  buttonClass,
  CHECKBOX_CLASS,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  inputClass,
  Note,
  NothingFound,
  PHONE_QUERY,
  SWITCH_CLASS,
  useMediaQuery,
  useToast,
  type MenuPlace,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, callApi } from '../api-client';
import { ContractorLink } from '../contractors/contractor-link';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { useKpiRefresh, whoQuery } from './kpi-data';
import { monthGenName } from './kpi-format';
import { FIRST_CLASS, HEAD_CLASS, TABLE_CLASS, WRAP_CLASS } from './kpi-table';
import { whoFilter, WhoFilters, whoSub, type WhoFilter } from './kpi-who-filter';

/*
 * «Кому вести» (задача 2.27; ТЗ «Переключатель вида «Показатели / Кому вести»»; прототип modules/kpi.js:
 * kpiWho, kWhoMass): строки — контрагенты, столбцы — показатели, в ячейке галочка «Вести»; галочка в
 * заголовке столбца — всем в фильтре, в заголовке строки — все показатели контрагенту; «Включить
 * показатель…» и «Выключить показатель…» по фильтру с подтверждением «Изменится у N контрагентов». На
 * телефоне — выбор показателя и список с переключателями. Менять — право «Настраивать показатели».
 */

type Change = { indicatorId: string; contractorId: string; on: boolean };

const cellOf = (c: WhoContractor, indicatorId: string) =>
  c.cells.find((x) => x.indicatorId === indicatorId)!;

export function KpiWhoView() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useKpiRefresh();
  const phone = useMediaQuery(PHONE_QUERY);
  const { access } = useShell();
  const editable = access.can('indSetup');
  const query = useQuery(whoQuery);
  const [filter, setFilter] = useState<WhoFilter>({});
  const [ask, setAsk] = useState<{
    indicator: KpiWho['indicators'][number];
    on: boolean;
    changes: Change[];
    open: boolean;
  } | null>(null);
  const [menu, setMenu] = useState<{ on: boolean; place: MenuPlace } | null>(null);
  const [phoneInd, setPhoneInd] = useState<string | null>(null);
  const id = useId();

  if (query.isError) return <Note tone="bad">{t('kpi.load_error')}</Note>;
  if (!query.data) return null;
  const { indicators, contractors, reenableMonth } = query.data;
  if (indicators.length === 0) {
    return (
      <EmptyState icon="gauge" title={t('kpi.no_indicators')} text={t('kpi.who.create_first')} />
    );
  }
  const shown = whoFilter(contractors, filter);
  const isOn = (c: WhoContractor, indicatorId: string) => cellOf(c, indicatorId).on;
  const offText = (c: WhoContractor, indicatorId: string) => {
    const cell = cellOf(c, indicatorId);
    return !cell.on && cell.offSince
      ? t('kpi.off_since', { month: monthGenName(t, cell.offSince) })
      : null;
  };

  const send = async (changes: Change[]) => {
    if (changes.length === 0) return null;
    const res = await callApi(() => api.api.kpi.who.$put({ json: { changes } }));
    void refresh();
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return null;
    }
    return WhoChanged.parse(res.data).changed;
  };

  /** Показатель группе контрагентов (прототип `kWhoMass`): у нескольких — с подтверждением. */
  const mass = (indicator: KpiWho['indicators'][number], on: boolean) => {
    const changes = shown
      .filter((c) => isOn(c, indicator.id) !== on)
      .map((c) => ({ indicatorId: indicator.id, contractorId: c.id, on }));
    if (changes.length === 0) {
      return toast(t(on ? 'kpi.who.already_on' : 'kpi.who.already_off'));
    }
    if (changes.length === 1) return void runMass(indicator, on, changes);
    setAsk({ indicator, on, changes, open: true });
  };

  const runMass = async (indicator: { name: string }, on: boolean, changes: Change[]) => {
    const n = await send(changes);
    if (n === null) return;
    const form = pluralForm(changes.length);
    toast(
      t(`kpi.who.${on ? 'done_on' : 'done_off'}.${form}`, {
        name: indicator.name,
        n: changes.length,
      }),
      {
        icon: 'gauge',
      },
    );
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-muted" data-kpi-who-count="">
        {shown.length < contractors.length
          ? t('kpi.who.count_of', { n: shown.length, of: contractors.length })
          : t('kpi.who.count', { n: shown.length })}
      </span>
      <span className="flex-1" />
      {editable ? (
        <>
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            onClick={(e) => setMenu({ on: true, place: { anchor: e.currentTarget } })}
          >
            <Icon name="check" size="sm" />
            {t('kpi.who.on_menu')}
          </button>
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            onClick={(e) => setMenu({ on: false, place: { anchor: e.currentTarget } })}
          >
            <Icon name="x" size="sm" />
            {t('kpi.who.off_menu')}
          </button>
        </>
      ) : null}
    </div>
  );

  let body;
  if (shown.length === 0) {
    body = (
      <NothingFound
        title={t('grid.not_found')}
        resetLabel={t('grid.reset_filters')}
        onReset={() => setFilter({})}
      />
    );
  } else if (phone) {
    const ind = indicators.find((i) => i.id === phoneInd) ?? indicators[0]!;
    const n = shown.filter((c) => isOn(c, ind.id)).length;
    body = (
      <div className="flex flex-col gap-2">
        <Field id={`${id}-ind`} label={t('kpi.col.indicator')}>
          {(control) => (
            <select
              {...control}
              className={`${inputClass()} cursor-pointer`}
              value={ind.id}
              onChange={(e) => setPhoneInd(e.target.value)}
            >
              {indicators.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">{t('kpi.who.on_of', { n, of: shown.length })}</span>
          <span className="flex-1" />
          {editable ? (
            <label className="flex items-center gap-2">
              {t('kpi.who.all_in_filter')}
              <input
                type="checkbox"
                role="switch"
                className={SWITCH_CLASS}
                checked={n === shown.length}
                onChange={() => mass(ind, n !== shown.length)}
              />
            </label>
          ) : null}
        </div>
        <div className="flex flex-col overflow-hidden rounded-lg border border-line">
          {shown.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer flex-wrap items-center gap-2.5 border-b border-line bg-raised px-3 py-[9px] last:border-b-0"
            >
              <span className="min-w-0 flex-1 basis-full">
                <b>{c.name}</b>
                <small className="mt-px block text-[12px] text-faint">
                  {whoSub(t, c, offText(c, ind.id))}
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                className={`${SWITCH_CLASS} ml-auto`}
                checked={isOn(c, ind.id)}
                disabled={!editable}
                aria-label={t('kpi.who.cell_label', { name: c.name, ind: ind.name })}
                onChange={(e) =>
                  void send([{ indicatorId: ind.id, contractorId: c.id, on: e.target.checked }])
                }
              />
            </label>
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <div className={WRAP_CLASS} data-no-swipe="">
        <table className={TABLE_CLASS} data-kpi-who-table="">
          <thead>
            <tr>
              <th className={`${HEAD_CLASS} ${FIRST_CLASS} z-[3]`}>{t('kpi.col.contractor')}</th>
              {indicators.map((i) => {
                const n = shown.filter((c) => isOn(c, i.id)).length;
                return (
                  <th key={i.id} className={`${HEAD_CLASS} min-w-[120px] whitespace-normal!`}>
                    <label
                      className="flex cursor-pointer items-start gap-1.5 font-[650]"
                      title={t('kpi.who.col_title')}
                    >
                      <input
                        type="checkbox"
                        className={`${CHECKBOX_CLASS} mt-0.5`}
                        data-kpi-who-col={i.name}
                        checked={n === shown.length}
                        ref={(el) => {
                          if (el) el.indeterminate = n > 0 && n < shown.length;
                        }}
                        disabled={!editable}
                        onChange={() => mass(i, n !== shown.length)}
                      />
                      <span>{i.name}</span>
                    </label>
                    <small>{t('kpi.n_of', { n, of: shown.length })}</small>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const n = indicators.filter((i) => isOn(c, i.id)).length;
              return (
                <tr key={c.id} className={c.paused ? 'text-muted' : ''} data-kpi-who-row={c.name}>
                  <td className={FIRST_CLASS}>
                    <label
                      className="flex cursor-pointer items-start gap-2"
                      title={t('kpi.who.row_title')}
                    >
                      <input
                        type="checkbox"
                        className={`${CHECKBOX_CLASS} mt-[3px]`}
                        checked={n === indicators.length}
                        ref={(el) => {
                          if (el) el.indeterminate = n > 0 && n < indicators.length;
                        }}
                        disabled={!editable}
                        aria-label={t('kpi.who.row_label', { name: c.name })}
                        onChange={async (e) => {
                          const on = e.target.checked;
                          const changes = indicators
                            .filter((i) => isOn(c, i.id) !== on)
                            .map((i) => ({ indicatorId: i.id, contractorId: c.id, on }));
                          const done = await send(changes);
                          if (done !== null) {
                            toast(
                              t(on ? 'kpi.who.row_on' : 'kpi.who.row_off', {
                                name: c.name,
                                n: changes.length,
                              }),
                              { icon: 'gauge' },
                            );
                          }
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate">
                          <ContractorLink id={c.id} name={c.name} tab="kpi" />
                        </span>
                        <small className="block text-[11.5px] text-faint">{whoSub(t, c)}</small>
                      </span>
                    </label>
                  </td>
                  {indicators.map((i) => {
                    const on = isOn(c, i.id);
                    const off = cellOf(c, i.id);
                    return (
                      <td key={i.id} className="text-center!">
                        <input
                          type="checkbox"
                          className={`${CHECKBOX_CLASS} h-[17px] w-[17px]`}
                          checked={on}
                          disabled={!editable}
                          data-kpi-who-cell={`${c.name}|${i.name}`}
                          aria-label={t('kpi.who.cell_label', { name: c.name, ind: i.name })}
                          title={offText(c, i.id) ?? t(on ? 'kpi.on' : 'kpi.off')}
                          onChange={(e) =>
                            void send([
                              { indicatorId: i.id, contractorId: c.id, on: e.target.checked },
                            ])
                          }
                        />
                        {!on && off.offSince ? (
                          <small className="block text-[10.5px] leading-tight text-faint">
                            {monthText(off.offSince)}
                          </small>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Note>{t('kpi.who.note')}</Note>
      <WhoFilters contractors={contractors} value={filter} onChange={setFilter} />
      {toolbar}
      {body}
      {menu ? (
        <ActionMenu
          label={t(menu.on ? 'kpi.who.on_menu' : 'kpi.who.off_menu')}
          place={menu.place}
          onClose={() => setMenu(null)}
          items={indicators.map((i) => ({
            id: i.id,
            label: i.name,
            icon: 'gauge' as const,
            sub: t(menu.on ? 'kpi.who.off_in_filter' : 'kpi.who.on_in_filter', {
              n: shown.filter((c) => isOn(c, i.id) !== menu.on).length,
            }),
            run: () => mass(i, menu.on),
          }))}
        />
      ) : null}
      {ask ? (
        <ConfirmDialog
          open={ask.open}
          onClose={() => setAsk({ ...ask, open: false })}
          title={t(ask.on ? 'kpi.who.on_title' : 'kpi.who.off_title', { name: ask.indicator.name })}
          text={`${t(`kpi.who.mass_text.${pluralForm(ask.changes.length)}`, { n: ask.changes.length })} ${
            ask.on
              ? t('kpi.who.on_effect', { month: monthGenName(t, reenableMonth) })
              : t('kpi.who.off_effect')
          }`}
          ok={t(ask.on ? 'kpi.who.on_ok' : 'kpi.who.off_ok')}
          danger={!ask.on}
          onConfirm={() => void runMass(ask.indicator, ask.on, ask.changes)}
        />
      ) : null}
    </div>
  );
}
