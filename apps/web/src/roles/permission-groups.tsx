'use client';

import type { Feature, PermissionId, Scope, ScopeGroupId } from '@buhuchet/domain';
import {
  buttonClass,
  Icon,
  inputClass,
  PHONE_QUERY,
  Segments,
  Tag,
  useMediaQuery,
} from '@buhuchet/ui';
import { useState } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import {
  permissionGroupsView,
  toggleGroup,
  type CatalogPermission,
  type PermissionGroupView,
  type PermissionLockOf,
  type PermissionState,
  type ScopeLockOf,
} from './permission-view';

/** Подсветка права «Просматривать …» группы (прототип `.pg-p.pg-v`). */
const VIEW_ROW = '-mx-3.5 px-3.5 bg-[color-mix(in_srgb,var(--bu-blue-bg)_45%,transparent)]';

/**
 * Права роли по группам модулей (ТЗ «Сотрудники» → «Вкладка Роли»; прототип modules/staff.js,
 * permGroupsHtml, permGroupsBind, pgSearch; css/cards.css `.pg`): поиск по названию и описанию права;
 * в заголовке группы — «Выбрано N из M», «Выбрать все» / «Снять все» и область «Свои / Все
 * контрагенты» (закрытая — с причиной под ней); под каждым правом — что оно разрешает, у неактивной
 * галочки — почему. Выключенный в
 * учётной политике модуль — серым и свёрнут. На ПК группы раскрыты, шире 1100 px — в две колонки; на
 * телефоне свёрнуты. Без `onChange` — только просмотр (карточка роли): «есть» и «нет» вместо галочек.
 */
export function PermissionGroups({
  catalog,
  state,
  lockWith,
  scopeLock,
  feature,
  onChange,
}: {
  catalog: readonly CatalogPermission[];
  state: PermissionState;
  /** Почему галочка закрыта при данном наборе прав (`roleFormLock`). */
  lockWith: (selected: ReadonlySet<PermissionId>) => PermissionLockOf;
  /** Почему переключатель области группы закрыт (`roleScopeLock`). */
  scopeLock?: ScopeLockOf;
  /**
   * Включён ли модуль в учётной политике; по умолчанию — у вошедшего. У шаблона роли в Админке
   * учётной политики нет — все модули включены.
   */
  feature?: (feature: Feature) => boolean;
  onChange?: (next: PermissionState) => void;
}) {
  const t = useT();
  const { access } = useShell();
  const phone = useMediaQuery(PHONE_QUERY);
  const [query, setQuery] = useState('');
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const lock = lockWith(state.selected);
  const groups = permissionGroupsView({
    catalog,
    state,
    lock,
    readOnly: !onChange,
    query,
    toggled,
    phone,
    feature: feature ?? access.feature,
    scopeLock,
  });
  const flip = (id: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const check = (id: PermissionId, on: boolean) => {
    const selected = new Set(state.selected);
    if (on) selected.add(id);
    else selected.delete(id);
    onChange?.({ ...state, selected });
  };

  return (
    <>
      <input
        type="search"
        className={inputClass()}
        value={query}
        placeholder={t('roles.search')}
        aria-label={t('roles.search_label')}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.length ? (
        <div
          data-permission-groups=""
          className="grid grid-cols-1 items-start gap-3 min-[1101px]:grid-cols-2"
        >
          {groups.map((g) => (
            <section
              key={g.id}
              data-permission-group={g.id}
              data-open={g.open ? '' : undefined}
              className={`min-w-0 rounded-xl border border-line bg-raised ${g.off ? 'opacity-[.62]' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                <button
                  type="button"
                  aria-expanded={g.open}
                  onClick={() => flip(g.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span
                    className={`inline-flex transition-transform duration-150 ${g.open ? 'rotate-90' : ''}`}
                  >
                    <Icon name="right" size="sm" />
                  </span>
                  <b className="text-[14px]">{t(`roles.group.${g.id}`)}</b>
                </button>
                <span data-group-count="" className="text-[12px] whitespace-nowrap text-muted">
                  {t('roles.selected', { n: g.count, total: g.total })}
                </span>
                {g.toggle && onChange ? (
                  <button
                    type="button"
                    className={buttonClass('default', 'sm')}
                    onClick={() =>
                      onChange({
                        ...state,
                        selected: toggleGroup(catalog, g.id, state.selected, lockWith, g.toggle!),
                      })
                    }
                  >
                    {t(g.toggle === 'clear' ? 'roles.clear_all' : 'roles.select_all')}
                  </button>
                ) : null}
                {g.scope ? (
                  <GroupScope
                    t={t}
                    group={g}
                    phone={phone}
                    onChange={
                      onChange &&
                      ((scope) =>
                        onChange({
                          ...state,
                          scopes: { ...state.scopes, [g.id as ScopeGroupId]: scope },
                        }))
                    }
                  />
                ) : null}
                {g.off ? (
                  <span className="flex basis-full items-start gap-1 text-[12px] text-faint">
                    <Icon name="lock" size="sm" className="mt-px" />
                    {t('roles.module_off')}
                  </span>
                ) : null}
              </div>
              {g.open ? (
                <div className="border-t border-line px-3.5 pt-0.5 pb-1.5">
                  {g.shown.map((p) =>
                    onChange ? (
                      <PermissionRow
                        key={p.id}
                        t={t}
                        p={p}
                        isView={g.view === p.id}
                        on={state.selected.has(p.id)}
                        why={lock(p.id)}
                        onCheck={(on) => check(p.id, on)}
                      />
                    ) : (
                      <PermissionView
                        key={p.id}
                        t={t}
                        p={p}
                        isView={g.view === p.id}
                        on={state.selected.has(p.id)}
                      />
                    ),
                  )}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <div className="text-faint">{t('roles.nothing')}</div>
      )}
    </>
  );
}

/** Название права и что оно разрешает (прототип `.pg-d`). */
function PermissionText({ p, muted = false }: { p: CatalogPermission; muted?: boolean }) {
  return (
    <>
      <b className={muted ? 'font-medium text-faint' : ''}>{p.name}</b>
      <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-muted">{p.description}</span>
    </>
  );
}

/** Право в форме роли: галочка; закрытая — с причиной (прототип `.pg-why`). */
function PermissionRow({
  t,
  p,
  isView,
  on,
  why,
  onCheck,
}: {
  t: Translate;
  p: CatalogPermission;
  isView: boolean;
  on: boolean;
  why: ReturnType<PermissionLockOf>;
  onCheck: (on: boolean) => void;
}) {
  return (
    <label
      data-permission={p.id}
      className={`flex items-start gap-2.5 border-b border-line py-[9px] last:border-b-0 ${why ? 'cursor-default' : 'cursor-pointer'} ${isView ? VIEW_ROW : ''}`}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={why !== null}
        aria-label={p.name}
        onChange={(e) => onCheck(e.target.checked)}
        className="m-0 mt-0.5 h-4 w-4 flex-none cursor-pointer accent-accent disabled:cursor-default"
      />
      <span className="min-w-0">
        <PermissionText p={p} />
        {why ? (
          <span
            data-lock={why}
            className="mt-[3px] flex items-center gap-1 text-[12px] text-caution-label"
          >
            <Icon name="lock" size="sm" />
            {t(`roles.lock.${why}`)}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** Право в карточке роли: зелёная галочка — есть, серый крестик — нет (прототип `.pg-p.ro`). */
function PermissionView({
  t,
  p,
  isView,
  on,
}: {
  t: Translate;
  p: CatalogPermission;
  isView: boolean;
  on: boolean;
}) {
  return (
    <div
      data-permission={p.id}
      data-granted={on ? '' : undefined}
      className={`flex items-start gap-2.5 border-b border-line py-[9px] last:border-b-0 ${isView ? VIEW_ROW : ''}`}
    >
      <span className={`mt-px inline-flex flex-none ${on ? 'text-ok' : 'text-faint'}`}>
        <Icon name={on ? 'check' : 'x'} size="sm" />
        <span className="sr-only">{t(on ? 'roles.granted' : 'roles.not_granted')}</span>
      </span>
      <span className="min-w-0">
        <PermissionText p={p} muted={!on} />
      </span>
    </div>
  );
}

/**
 * Область группы (прототип scopeHtml): в форме — переключатель «Свои / Все контрагенты» (на телефоне
 * во всю ширину); в карточке и при праве «Видеть все отчёты и всех контрагентов» — ярлык без выбора.
 */
function GroupScope({
  t,
  group,
  phone,
  onChange,
}: {
  t: Translate;
  group: PermissionGroupView;
  phone: boolean;
  onChange: ((scope: Scope) => void) | undefined;
}) {
  const value = group.scope ?? 'own';
  const label = (s: Scope) => t(s === 'all' ? 'roles.scope.all' : 'roles.scope.own');
  return (
    <div className="flex basis-full flex-wrap items-center gap-2 pl-[22px] text-[12.5px] max-md:pl-0">
      <span className="text-muted">{t('roles.scope')}</span>
      {onChange && !group.scopeFixed ? (
        <>
          <div className={phone ? 'min-w-0 flex-1' : 'flex-none'}>
            <Segments
              options={[
                { value: 'own', label: label('own') },
                { value: 'all', label: label('all') },
              ]}
              value={value}
              onChange={onChange}
              label={t('roles.scope_label')}
              fill={phone}
              size="sm"
              disabled={group.scopeLock !== null}
            />
          </div>
          {group.scopeLock ? (
            <span
              data-lock={group.scopeLock}
              className="flex basis-full items-center gap-1 text-[12px] text-caution-label"
            >
              <Icon name="lock" size="sm" />
              {t(`roles.lock.${group.scopeLock}`)}
            </span>
          ) : null}
        </>
      ) : (
        <Tag
          icon={value === 'all' ? 'building' : 'user'}
          title={group.scopeFixed ? t('roles.scope.fixed') : t('roles.scope_label')}
        >
          {label(value)}
        </Tag>
      )}
    </div>
  );
}
