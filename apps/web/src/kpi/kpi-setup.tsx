'use client';

import { monthText } from '@buhuchet/domain';
import { Indicators, type Indicator } from '@buhuchet/shared';
import {
  ActionMenu,
  buttonClass,
  ConfirmDialog,
  EmptyState,
  Hint,
  Icon,
  iconButtonClass,
  Note,
  PHONE_QUERY,
  pillClass,
  Segments,
  Tag,
  useMediaQuery,
  useToast,
  type MenuPlace,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { indicatorsQuery, useKpiRefresh } from './kpi-data';
import { setKpiChoice, useKpiChoice } from './kpi-state';
import { KpiWhoView } from './kpi-who';

/*
 * Вкладка «Настройка показателей» (задача 2.27; ТЗ «Вкладка «Настройка показателей»»; прототип
 * modules/kpi.js: kpiSetup, kpiSetupList): переключатель «Показатели / Кому вести»; список показателей
 * организации — порядок перетаскиванием (на телефоне — стрелками), «Изменить», «В архив», «Удалить» (только
 * без значений), «Добавить показатель». Видна с правом «Настраивать показатели».
 */

export function KpiSetupTab({ onEdit }: { onEdit: (id: string | null) => void }) {
  const t = useT();
  const { setupView } = useKpiChoice();
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <Segments<'list' | 'who'>
          label={t('kpi.setup.view')}
          value={setupView}
          options={[
            { value: 'list', label: t('kpi.setup.list'), icon: 'list' },
            { value: 'who', label: t('kpi.setup.who'), icon: 'matrix' },
          ]}
          onChange={(v) => setKpiChoice({ setupView: v })}
        />
      </div>
      {setupView === 'who' ? <KpiWhoView /> : <IndicatorList onEdit={onEdit} />}
    </div>
  );
}

/** «всем контрагентам», «всем, кроме 2», «выбранным: 5, новые — автоматически» (прототип `kWhoTxt`). */
function whoText(t: Translate, i: Indicator, contractors: number): string {
  if (i.scope === 'all') {
    return i.on < contractors
      ? t('kpi.setup.who_all_but', { n: contractors - i.on })
      : t('kpi.setup.who_all');
  }
  return t(i.autoNew ? 'kpi.setup.who_selected_auto' : 'kpi.setup.who_selected', { n: i.on });
}

function IndicatorList({ onEdit }: { onEdit: (id: string | null) => void }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useKpiRefresh();
  const phone = useMediaQuery(PHONE_QUERY);
  const query = useQuery(indicatorsQuery);
  const [menu, setMenu] = useState<{ indicator: Indicator; place: MenuPlace } | null>(null);
  const [removing, setRemoving] = useState<Indicator | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);

  if (query.isError) return <Note tone="bad">{t('kpi.load_error')}</Note>;
  if (!query.data) return null;
  const { items, contractors } = query.data;

  const apply = (data: unknown) => {
    client.setQueryData(indicatorsQuery.queryKey, Indicators.parse(data));
    void refresh();
  };

  const move = async (id: string, to: number) => {
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    const res = await callApi(() => api.api.kpi['indicators-order'].$put({ json: { ids } }));
    if (!res.ok) {
      void refresh();
      return toast(errorText(res.error), { bad: true });
    }
    apply(res.data);
  };

  const archive = async (i: Indicator) => {
    const res = await callApi(() =>
      api.api.kpi.indicators[':id'].archive.$post({
        param: { id: i.id },
        json: { archived: !i.archived, version: i.version },
      }),
    );
    if (!res.ok) {
      void refresh();
      return toast(errorText(res.error), { bad: true });
    }
    apply(res.data);
    toast(t(i.archived ? 'kpi.setup.restored' : 'kpi.setup.archived'), { icon: 'archive' });
  };

  const remove = async (i: Indicator) => {
    const res = await callApi(() =>
      api.api.kpi.indicators[':id'].$delete({
        param: { id: i.id },
        query: { version: String(i.version) },
      }),
    );
    if (!res.ok) {
      void refresh();
      return toast(errorText(res.error), { bad: true });
    }
    apply(res.data);
    toast(t('kpi.setup.deleted'), { icon: 'trash' });
  };

  const dropOn = (e: DragEvent, target: string) => {
    e.preventDefault();
    if (drag && drag.id !== target)
      void move(
        drag.id,
        items.findIndex((x) => x.id === target),
      );
    setDrag(null);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Note>{t('kpi.setup.note')}</Note>
      {items.length === 0 ? (
        <EmptyState icon="gauge" title={t('kpi.no_indicators')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-kpi-setup-list="">
          {items.map((i, j) => (
            <li
              key={i.id}
              draggable={!phone}
              data-kpi-indicator={i.name}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                setDrag({ id: i.id, over: null });
              }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (drag && drag.over !== i.id) setDrag({ ...drag, over: i.id });
              }}
              onDrop={(e) => dropOn(e, i.id)}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('button')) onEdit(i.id);
              }}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border bg-pane px-3 py-2.5 ${i.archived ? 'opacity-65' : ''} ${drag?.id === i.id ? 'opacity-40' : ''} ${drag?.over === i.id && drag.id !== i.id ? 'border-brand-blue shadow-[0_0_0_2px_var(--bu-sel)]' : 'border-line'}`}
            >
              <span className="cursor-grab text-faint" aria-hidden="true">
                <Icon name="grip" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{i.name}</b>
                  <Tag>{i.unit || '—'}</Tag>
                  {i.required ? (
                    <span className={`${pillClass('sm')} bg-info-bg text-info-label`}>
                      {t('kpi.setup.required')}
                    </span>
                  ) : null}
                  {i.archived ? <Tag>{t('kpi.archived_tag')}</Tag> : null}
                </div>
                <Hint>
                  {[
                    t(`kpi.type.${i.type}`),
                    t('kpi.setup.main_total', { total: t(`kpi.total.${i.total}`).toLowerCase() }),
                    whoText(t, i, contractors),
                    t('kpi.setup.since', { month: monthText(i.start) }),
                    t('kpi.setup.due', { day: i.dueDay }),
                    t('kpi.setup.values', { n: i.valueCount }),
                  ].join(' · ')}
                </Hint>
                {i.description ? <Hint>{i.description}</Hint> : null}
              </div>
              <button
                type="button"
                className={iconButtonClass('sm')}
                disabled={j === 0}
                aria-label={t('kpi.setup.up')}
                title={t('kpi.setup.up')}
                onClick={() => void move(i.id, j - 1)}
              >
                <Icon name="up" size="sm" />
              </button>
              <button
                type="button"
                className={iconButtonClass('sm')}
                disabled={j === items.length - 1}
                aria-label={t('kpi.setup.down')}
                title={t('kpi.setup.down')}
                onClick={() => void move(i.id, j + 1)}
              >
                <Icon name="dn" size="sm" />
              </button>
              <button
                type="button"
                className={iconButtonClass('sm')}
                aria-label={t('grid.actions')}
                title={t('grid.actions')}
                data-kpi-more={i.name}
                onClick={(e) => setMenu({ indicator: i, place: { anchor: e.currentTarget } })}
              >
                <Icon name="more" size="sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button type="button" className={buttonClass('cta')} onClick={() => onEdit(null)}>
          <Icon name="plus" />
          {t('kpi.setup.add')}
        </button>
      </div>
      {menu ? (
        <ActionMenu
          label={menu.indicator.name}
          place={menu.place}
          onClose={() => setMenu(null)}
          items={[
            {
              id: 'edit',
              label: t('kpi.setup.edit'),
              icon: 'edit',
              run: () => onEdit(menu.indicator.id),
            },
            {
              id: 'archive',
              label: t(menu.indicator.archived ? 'kpi.setup.restore' : 'kpi.setup.archive'),
              icon: 'archive',
              ...(menu.indicator.archived ? {} : { sub: t('kpi.setup.archive_sub') }),
              run: () => void archive(menu.indicator),
            },
            { id: 'sep', separator: true },
            {
              id: 'delete',
              label: t('kpi.setup.delete'),
              icon: 'trash',
              danger: true,
              disabled: menu.indicator.hasRows,
              ...(menu.indicator.hasRows ? { reason: t('err.indicator_has_values') } : {}),
              run: () => setRemoving(menu.indicator),
            },
          ]}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? t('kpi.setup.delete_title', { name: removing.name }) : ''}
        text={t('kpi.setup.delete_text')}
        ok={t('kpi.setup.delete')}
        danger
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
      />
    </div>
  );
}
