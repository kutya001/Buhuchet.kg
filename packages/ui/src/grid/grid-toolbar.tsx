'use client';

import {
  GROUP_AGGS,
  groupAggOf,
  groupLevels,
  isNumericColumn,
  type GridViewSettings,
  type GroupAggChoice,
} from '@buhuchet/domain';
import { useId, useState, type DragEvent } from 'react';
import { ActionList } from '../action-menu';
import { buttonClass, iconButtonClass, TOUCH_AREA } from '../button';
import { inputClass } from '../form';
import { Icon } from '../icon';
import { Popover } from '../popover';
import { withGroup } from './grid-groups';
import {
  isHidden,
  moveColumn,
  orderedKeys,
  setColumnVisible,
  setView as withView,
  screenVisibleKeys,
  visibleKeys,
} from './grid-state';
import type { GridBulkAction, GridColumn, GridLabels } from './types';

/**
 * Кнопка панели на телефоне — значок 36 px с подложкой (`.gtools .icon-btn.sm.raised`), область
 * касания — 44 px (`TOUCH_AREA`).
 */
const PHONE_TOOL = `${TOUCH_AREA} inline-grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-lg border-0 bg-btn text-muted shadow-btn hover:text-ink [&_svg]:h-[17px] [&_svg]:w-[17px]`;

/** Кнопка «Настройки вида» на ПК (`.icon-btn.sm.raised`). */
const RAISED_ICON = `${iconButtonClass('sm')} bg-btn! shadow-btn`;

interface ToolbarProps<Row> {
  columns: readonly GridColumn<Row>[];
  defaultVisible: readonly string[];
  settings: GridViewSettings;
  onSettingsChange: (settings: GridViewSettings) => void;
  onResetView: () => void;
  view: 'table' | 'cards';
  fixedView?: 'table' | 'cards';
  phone: boolean;
  total: number | null;
  /** Отмеченные строки и массовые действия: при выборе вместо числа записей — «Выбрано: N». */
  selection?: GridSelectionBar<Row>;
  /** Столбцы группировки (до двух). */
  group: readonly string[];
  /** «Группировка» сменила уровни — свёрнутые группы снова раскрыты. */
  onGroupChange: () => void;
  /** «В Excel»: есть — кнопка на панели; `exporting` — файл собирается. */
  onExport?: () => void;
  exporting?: boolean;
  labels: GridLabels;
}

export interface GridSelectionBar<Row> {
  count: number;
  actions: readonly GridBulkAction<Row>[];
  onRun: (action: GridBulkAction<Row>) => void;
  onClear: () => void;
}

/**
 * Панель над списком (прототип ui/grid.js, `.gtools`; ТЗ «Панель над списком»): число записей, вид
 * «Таблица / Карточки», «Столбцы (видно / всего)» и «Настройки вида». На телефоне (до 768 px) кнопки —
 * только значками с подсказкой, вид — одна кнопка-переключатель.
 */
export function GridToolbar<Row>({
  columns,
  defaultVisible,
  settings,
  onSettingsChange,
  onResetView,
  view,
  fixedView,
  phone,
  total,
  selection,
  group,
  onGroupChange,
  onExport,
  exporting = false,
  labels,
}: ToolbarProps<Row>) {
  const keys = columns.map((c) => c.key);
  const visible = screenVisibleKeys(columns, settings, defaultVisible, phone);
  const shown = visible.length;
  const columnsLabel = `${labels.columns} (${shown}/${keys.length})`;
  const groupLabel = group.length ? labels.groupN(group.length) : labels.group;
  const setView = (next: 'table' | 'cards') => onSettingsChange(withView(settings, phone, next));

  return (
    <div className="flex min-h-[33px] flex-wrap items-center gap-2">
      {selection && selection.count > 0 ? (
        <GridBulkBar selection={selection} labels={labels} />
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {total !== null && <span data-grid-count>{labels.count(total)}</span>}
        </div>
      )}
      <div className="flex-1" />
      {!fixedView &&
        (phone ? (
          <PhoneViewToggle view={view} onChange={setView} labels={labels} />
        ) : (
          <div
            role="group"
            aria-label={labels.view}
            className="inline-flex gap-0.5 rounded-lg border border-line bg-pane-alt p-[3px]"
          >
            {(['table', 'cards'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                title={labels[v]}
                onClick={() => setView(v)}
                className={`inline-flex min-h-[26px] cursor-pointer items-center gap-1.5 rounded-md border-0 px-2.5 py-1 text-[12.5px] font-[550] ${view === v ? 'bg-raised text-ink shadow-btn' : 'bg-transparent text-muted'}`}
              >
                <Icon name={v} size="sm" />
                <span>{labels[v]}</span>
              </button>
            ))}
          </div>
        ))}
      <Popover
        label={labels.group}
        placement="bottom-end"
        padded
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={id}
            aria-haspopup="dialog"
            data-grid-group-button
            title={phone ? groupLabel : labels.groupButtonHint}
            aria-label={phone ? groupLabel : undefined}
            className={
              phone
                ? `${PHONE_TOOL} ${group.length ? 'text-ink' : ''}`
                : buttonClass('default', 'sm')
            }
          >
            <Icon name="layers" size="sm" />
            {phone && group.length > 0 && (
              <span
                aria-hidden="true"
                className="absolute -top-1 -right-1 h-[15px] min-w-[15px] rounded-lg bg-accent px-[3px] text-center text-[9.5px] leading-[15px] font-bold text-on-accent"
              >
                {group.length}
              </span>
            )}
            {!phone && groupLabel}
          </button>
        )}
      >
        {(close) => (
          <GroupPanel
            columns={columns}
            keys={keys}
            visible={visible}
            settings={settings}
            onApply={(next) => {
              onSettingsChange(next);
              onGroupChange();
              close();
            }}
            labels={labels}
          />
        )}
      </Popover>
      <Popover
        label={labels.columns}
        placement="bottom-end"
        padded
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={id}
            aria-haspopup="dialog"
            data-grid-columns-button
            title={phone ? columnsLabel : undefined}
            aria-label={phone ? columnsLabel : undefined}
            className={phone ? PHONE_TOOL : buttonClass('default', 'sm')}
          >
            <Icon name="columns" size="sm" />
            {!phone && columnsLabel}
          </button>
        )}
      >
        {() => (
          <ColumnsPanel
            columns={columns}
            defaultVisible={defaultVisible}
            settings={settings}
            onSettingsChange={onSettingsChange}
            labels={labels}
          />
        )}
      </Popover>
      <Popover
        label={labels.viewOptions}
        role="menu"
        placement="bottom-end"
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={id}
            aria-haspopup="menu"
            title={labels.viewOptionsHint}
            aria-label={labels.viewOptions}
            className={phone ? PHONE_TOOL : RAISED_ICON}
          >
            <Icon name="sliders" size="sm" />
          </button>
        )}
      >
        {(close) => (
          <ActionList
            onPick={close}
            items={[
              {
                id: 'normal',
                label: labels.densityNormal,
                icon: 'list',
                on: (settings.density ?? 'normal') === 'normal',
                run: () => onSettingsChange({ ...settings, density: 'normal' }),
              },
              {
                id: 'compact',
                label: labels.densityCompact,
                icon: 'menu',
                on: settings.density === 'compact',
                run: () => onSettingsChange({ ...settings, density: 'compact' }),
              },
              { id: 'sep1', separator: true },
              {
                id: 'full',
                label: labels.widthFull,
                icon: 'columns',
                on: (settings.width ?? 'full') === 'full',
                run: () => onSettingsChange({ ...settings, width: 'full' }),
              },
              {
                id: 'center',
                label: labels.widthCenter,
                icon: 'table',
                on: settings.width === 'center',
                run: () => onSettingsChange({ ...settings, width: 'center' }),
              },
              { id: 'sep2', separator: true },
              {
                id: 'reset',
                label: labels.resetView,
                icon: 'refresh',
                sub: labels.resetViewSub,
                run: onResetView,
              },
            ]}
          />
        )}
      </Popover>
      {onExport &&
        (phone ? (
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            aria-busy={exporting}
            title={labels.excel}
            aria-label={labels.excel}
            data-grid-export
            className={`${PHONE_TOOL} disabled:cursor-wait disabled:opacity-60`}
          >
            <Icon name="download" size="sm" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            aria-busy={exporting}
            title={labels.excelHint}
            data-grid-export
            className={buttonClass('default', 'sm')}
          >
            <Icon name="download" size="sm" />
            {labels.excel}
          </button>
        ))}
    </div>
  );
}

/**
 * Окно «Группировка» (прототип ui/grid.js, groupPop; ТЗ «Группировка»): «Уровень 1» и «Уровень 2
 * (внутри первого)» — любой столбец списка; итоги в строке группы у видимых числовых столбцов — «Не
 * считать», «Сумма» (по умолчанию), «Среднее», «Минимум», «Максимум», «Количество». «Убрать» снимает
 * группировку, «Применить» сохраняет её в настройках вида.
 */
export function GroupPanel<Row>({
  columns,
  keys,
  visible,
  settings,
  onApply,
  labels,
}: {
  columns: readonly GridColumn<Row>[];
  keys: readonly string[];
  visible: readonly string[];
  settings: GridViewSettings;
  onApply: (settings: GridViewSettings) => void;
  labels: GridLabels;
}) {
  const id = useId();
  const saved = (settings.group ?? []).filter((k) => keys.includes(k));
  const [first, setFirst] = useState(saved[0] ?? '');
  const [second, setSecond] = useState(saved[1] ?? '');
  const numeric = orderedKeys(keys, settings.order)
    .map((k) => columns.find((c) => c.key === k)!)
    .filter((c) => visible.includes(c.key) && isNumericColumn(c.type));
  const [aggs, setAggs] = useState<Record<string, GroupAggChoice>>(() =>
    Object.fromEntries(
      numeric.map((c) => [c.key, groupAggOf(c.type, settings.agg?.[c.key]) ?? 'none']),
    ),
  );
  const ordered = orderedKeys(keys, settings.order).map((k) => columns.find((c) => c.key === k)!);
  const options = [
    <option key="" value="">
      {labels.groupNone}
    </option>,
    ...ordered.map((c) => (
      <option key={c.key} value={c.key}>
        {c.label}
      </option>
    )),
  ];
  const field = 'flex flex-col gap-1';
  const caption = 'text-[12.5px] font-[550] text-muted';

  return (
    <>
      <h4 className="m-0 text-[12px] font-[650] tracking-[0.07em] text-faint uppercase">
        {labels.group}
      </h4>
      <div className={field}>
        <label htmlFor={`${id}-1`} className={caption}>
          {labels.groupLevel1}
        </label>
        <select
          id={`${id}-1`}
          className={inputClass()}
          value={first}
          onChange={(e) => {
            setFirst(e.target.value);
            if (!e.target.value) setSecond('');
          }}
        >
          {options}
        </select>
      </div>
      <div className={field}>
        <label htmlFor={`${id}-2`} className={caption}>
          {labels.groupLevel2}
        </label>
        <select
          id={`${id}-2`}
          className={inputClass()}
          value={first ? second : ''}
          disabled={!first}
          onChange={(e) => setSecond(e.target.value)}
        >
          {options}
        </select>
      </div>
      {numeric.length > 0 && (
        <>
          <div className={`${caption} mt-1`}>{labels.groupAggs}</div>
          {numeric.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <label htmlFor={`${id}-a-${c.key}`} className="flex-1 text-[13px]">
                {c.label}
              </label>
              <select
                id={`${id}-a-${c.key}`}
                className={`${inputClass()} w-[140px]!`}
                value={aggs[c.key] ?? 'none'}
                onChange={(e) =>
                  setAggs((prev) => ({ ...prev, [c.key]: e.target.value as GroupAggChoice }))
                }
              >
                <option value="none">{labels.aggNone}</option>
                {GROUP_AGGS.map((how) => (
                  <option key={how} value={how}>
                    {labels.agg[how]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </>
      )}
      <div className="text-[11.5px] leading-[1.4] text-faint">{labels.groupHint}</div>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => onApply(withGroup(settings, []))}
          className={buttonClass('ghost', 'sm')}
        >
          {labels.groupRemove}
        </button>
        <button
          type="button"
          onClick={() =>
            onApply({
              ...withGroup(settings, groupLevels(first, first ? second : '')),
              agg: { ...settings.agg, ...aggs },
            })
          }
          className={buttonClass('cta', 'sm')}
        >
          {labels.apply}
        </button>
      </div>
    </>
  );
}

/**
 * Панель массовых действий (прототип `.bulkbar`; ТЗ «Действия над записью» → «Выбор нескольких строк
 * галочками и массовые действия»): «Выбрано: N», кнопки действий и «Снять выбор».
 */
export function GridBulkBar<Row>({
  selection,
  labels,
}: {
  selection: GridSelectionBar<Row>;
  labels: GridLabels;
}) {
  return (
    <div
      role="toolbar"
      aria-label={labels.selected(selection.count)}
      data-grid-bulk
      className="flex animate-slide-up flex-wrap items-center gap-1.5 rounded-full border border-line-strong bg-raised py-[3px] pr-1 pl-3 text-[13px] shadow-pane"
    >
      <b>{labels.selected(selection.count)}</b>
      {selection.actions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => selection.onRun(a)}
          className={buttonClass(a.danger ? 'danger' : 'default', 'sm')}
        >
          <Icon name={a.icon ?? 'check'} size="sm" />
          {a.label}
        </button>
      ))}
      <button
        type="button"
        onClick={selection.onClear}
        aria-label={labels.clearSelection}
        title={labels.clearSelection}
        className={iconButtonClass('sm')}
      >
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}

function PhoneViewToggle({
  view,
  onChange,
  labels,
}: {
  view: 'table' | 'cards';
  onChange: (view: 'table' | 'cards') => void;
  labels: GridLabels;
}) {
  const to = view === 'table' ? 'cards' : 'table';
  return (
    <button
      type="button"
      title={labels[to]}
      aria-label={labels.viewTo(labels[to])}
      onClick={() => onChange(to)}
      className={PHONE_TOOL}
    >
      <Icon name={to} size="sm" />
    </button>
  );
}

/**
 * Меню «Столбцы» (прототип ui/grid.js, colsPop): галочка показывает столбец, порядок меняется
 * перетаскиванием строки или стрелками «Выше» / «Ниже»; последний видимый столбец скрыть нельзя.
 * Служебные столбцы помечены «системный».
 */
export function ColumnsPanel<Row>({
  columns,
  defaultVisible,
  settings,
  onSettingsChange,
  labels,
}: {
  columns: readonly GridColumn<Row>[];
  defaultVisible: readonly string[];
  settings: GridViewSettings;
  onSettingsChange: (settings: GridViewSettings) => void;
  labels: GridLabels;
}) {
  const keys = columns.map((c) => c.key);
  const order = orderedKeys(keys, settings.order);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const visibleCount = visibleKeys(keys, settings, defaultVisible).length;
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);

  const move = (key: string, to: number) => {
    onSettingsChange(moveColumn(keys, settings, key, to));
    setMoved(key);
  };
  const dropOn = (e: DragEvent, key: string) => {
    if (!drag) return;
    e.preventDefault();
    const from = drag;
    setDrag(null);
    setOver(null);
    move(from, order.indexOf(key));
  };

  return (
    <>
      <h4 className="m-0 text-[12px] font-[650] tracking-[0.07em] text-faint uppercase">
        {labels.columns}
      </h4>
      <div
        className="flex max-h-[340px] flex-col overflow-auto rounded-lg border border-line p-1"
        data-columns-list
      >
        {order.map((key, i) => {
          const column = byKey.get(key)!;
          const checked = !isHidden(key, settings, defaultVisible);
          const lastVisible = checked && visibleCount === 1;
          return (
            <div
              key={key}
              draggable
              data-column={key}
              onDragStart={(e) => {
                setDrag(key);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', key);
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                setOver(key);
              }}
              onDrop={(e) => dropOn(e, key)}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              className={`flex items-center gap-0.5 rounded-[5px] ${drag === key ? 'opacity-45' : ''} ${over === key && drag !== key ? 'shadow-[inset_0_2px_0_var(--bu-accent)]' : ''} ${moved === key ? 'bg-sel' : ''}`}
            >
              <span title={labels.dragHint} className="inline-flex cursor-grab px-0.5 text-faint">
                <Icon name="grip" size="sm" />
              </span>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[5px] px-[7px] py-[5px] text-[13px]">
                <input
                  type="checkbox"
                  className="m-0 h-4 w-4 flex-none cursor-pointer accent-accent disabled:cursor-not-allowed"
                  checked={checked}
                  disabled={lastVisible}
                  onChange={(e) =>
                    onSettingsChange(
                      setColumnVisible(keys, settings, defaultVisible, key, e.target.checked),
                    )
                  }
                />
                <span className="truncate">{column.label}</span>
                {column.audit && (
                  <span className="ml-auto text-[11px] text-faint">{labels.system}</span>
                )}
              </label>
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(key, i - 1)}
                aria-label={`${labels.moveUp}: ${column.label}`}
                title={labels.moveUp}
                className={`${iconButtonClass('sm')} h-6! w-6! disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon name="up" size="sm" />
              </button>
              <button
                type="button"
                disabled={i === order.length - 1}
                onClick={() => move(key, i + 1)}
                aria-label={`${labels.moveDown}: ${column.label}`}
                title={labels.moveDown}
                className={`${iconButtonClass('sm')} h-6! w-6! disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon name="dn" size="sm" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="text-[11.5px] leading-[1.4] text-faint">{labels.columnsHint}</div>
    </>
  );
}
