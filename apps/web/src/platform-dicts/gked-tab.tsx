'use client';

import {
  GKED_GROUP_TARGETS,
  gkedGroupAct,
  gkedGroupActText,
  gkedLevelKey,
  packGkedGroupActs,
  pluralForm,
  splitGkedCodes,
  type GkedGroupAct,
  type GkedGroupTarget,
  type IoSectionDict,
} from '@buhuchet/domain';
import type { AdminGkedGroup, AdminGkedGroups } from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  buttonClass,
  ConfirmDialog,
  Field,
  FormGrid,
  Hint,
  Icon,
  iconButtonClass,
  inputClass,
  MiniTable,
  Modal,
  Note,
  RecordChangedNotice,
  Segments,
  StatusPill,
  useToast,
  type ActionEntry,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useId, useMemo, useState, type FormEvent } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import { DictHistory } from './dict-history-box';
import { GkedDialog, gkedUsedText, type GkedItem } from './gked-dialog';
import { ExportDialog, ImportDialog } from './io-dialogs';
import { pdictsGkedGroupsQuery, pdictsGkedItemsQuery, usePdictsRefresh } from './pdicts-data';
import { ValueDictList } from './value-list';

/*
 * Админка → «Справочники платформы» → «ГКЭД» (задача 2.38; ТЗ «ГКЭД»; прототип admin/gked-admin.js
 * renderGked): пояснение с числом кодов, «Дерево» или «Список» (выбор запоминается), «Группы кодов» —
 * что каждый код делает в едином налоге и в тарифе СПиНО; «Выгрузить» и «Загрузить» у кодов и у групп;
 * «История изменений». Действия кода — «Изменить», «Снять / Вернуть «Действует»», «Удалить» (только
 * нигде не указанный код без вложенных).
 */

const pd = api.api.admin['platform-dicts'];

/** Вид вкладки запоминается в браузере (прототип `store.get('gk.view')`). */
const VIEW_KEY = 'buhuchet.pdicts.gked.view';
type GkedView = 'tree' | 'list';

function readView(): GkedView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'tree';
  } catch {
    return 'tree';
  }
}

/** Поиск по ГКЭД (прототип gkSearch): начало кода или все слова в названии; «ё» = «е». */
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
function searchGked(items: readonly GkedItem[], q: string): GkedItem[] {
  const s = norm(q).trim();
  if (!s) return [];
  const words = s.split(/\s+/).filter(Boolean);
  return items.filter(
    (x) => x.code.toLowerCase().startsWith(s) || words.every((w) => norm(x.name).includes(w)),
  );
}

/** Сколько совпадений поиска показывается (прототип: первые 200). */
const SEARCH_SHOWN = 200;

/**
 * Действия кода (прототип gkActions): «Изменить», «Снять «Действует»» / «Вернуть «Действует»»,
 * «Удалить» — нельзя у указанного где-либо кода и у кода с вложенными.
 */
export function gkedActions(
  t: Translate,
  x: GkedItem,
  run: {
    edit: (x: GkedItem) => void;
    active: (x: GkedItem, on: boolean) => void;
    remove: (x: GkedItem) => void;
  },
): ActionEntry[] {
  const used = gkedUsedText(t, x);
  return [
    { id: 'edit', label: t('pdicts.action.edit'), icon: 'edit', run: () => run.edit(x) },
    { id: 'sep', separator: true },
    x.active
      ? {
          id: 'off',
          label: t('pdicts.gked.off'),
          icon: 'ban',
          sub: t('pdicts.gked.off_sub'),
          run: () => run.active(x, false),
        }
      : {
          id: 'on',
          label: t('pdicts.gked.on'),
          icon: 'check',
          run: () => run.active(x, true),
        },
    {
      id: 'delete',
      label: t('pdicts.action.delete'),
      icon: 'trash',
      danger: true,
      disabled: x.used > 0 || x.children > 0,
      ...(x.used > 0
        ? { reason: t('pdicts.gked.del_used', { used }) }
        : x.children > 0
          ? { reason: t('pdicts.gked.del_kids') }
          : {}),
      run: () => run.remove(x),
    },
  ];
}

/**
 * «Снять / Вернуть «Действует»» и «Удалить» кода: одно действие за раз, ответ — уведомлением;
 * дерево, список и история перечитываются.
 */
export function useGkedActions() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = usePdictsRefresh();
  const [busy, setBusy] = useState(false);
  const send = async (
    call: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
    done: string,
  ) => {
    if (busy) return;
    setBusy(true);
    const res = await callApi(call).finally(() => setBusy(false));
    refresh('gked');
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(done, { icon: 'check' });
  };
  return {
    active: (x: GkedItem, on: boolean) =>
      void send(
        () =>
          pd[':dict'][':code'].active.$post({
            param: { dict: 'gked', code: x.code },
            json: { active: on, version: x.version },
          }),
        t(on ? 'pdicts.gked.on_done' : 'pdicts.gked.off_done'),
      ),
    remove: (x: GkedItem) =>
      void send(
        () =>
          pd[':dict'][':code'].$delete({
            param: { dict: 'gked', code: x.code },
            query: { version: String(x.version) },
          }),
        t('pdicts.toast.deleted'),
      ),
  };
}

/** Строка дерева или поиска: код, название, у кода с контрагентами — число, «не действует», «⋯». */
function TreeRow({
  x,
  kids,
  open,
  path,
  onToggle,
  onOpen,
  actions,
}: {
  x: GkedItem;
  kids: number;
  open: boolean;
  /** Путь кода при поиске: «Подкласс · A › 01 › 01.1». */
  path?: string;
  onToggle?: () => void;
  onOpen: () => void;
  actions: ActionEntry[];
}) {
  const t = useT();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const leaf = x.level === 'subclass';
  return (
    <div
      data-gked-row={x.code}
      className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-pane-alt ${x.active ? '' : 'opacity-60'}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        onOpen();
      }}
    >
      {onToggle && kids ? (
        <button
          type="button"
          className={iconButtonClass('sm')}
          aria-label={t(open ? 'pdicts.gked.collapse' : 'pdicts.gked.expand')}
          aria-expanded={open}
          onClick={onToggle}
        >
          <Icon name="right" size="sm" className={open ? 'rotate-90' : ''} />
        </button>
      ) : onToggle ? (
        <span className="w-[22px] flex-none" />
      ) : null}
      <span className={`min-w-16 font-mono ${leaf && !path ? '' : 'font-semibold'}`}>{x.code}</span>
      <span className="min-w-0 grow">
        {x.name}
        {path ? <small className="block text-faint">{path}</small> : null}
      </span>
      {leaf && x.contractors && !path ? (
        <span
          className="rounded-full bg-pane-alt px-2 text-[12px] font-semibold text-muted"
          title={t('pdicts.gked.cps_title')}
        >
          {x.contractors}
        </span>
      ) : null}
      {x.active ? null : (
        <StatusPill tone="faint" icon="ban" label={t('pdicts.gked.off_pill')} size="sm" />
      )}
      <button
        type="button"
        className={iconButtonClass('sm')}
        aria-label={t('grid.actions')}
        data-row-menu=""
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <Icon name="more" size="sm" />
      </button>
      {menu ? (
        <ActionMenu
          items={actions}
          place={{ anchor: menu }}
          label={t('grid.actions')}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Дерево (прототип gkTree): секции → подсекции → разделы → группы → классы → подклассы; нажатие на
 * строку с вложенными раскрывает её, иначе открывает окно кода. Поиск показывает совпадения списком с
 * путём — первые 200.
 */
function GkedTree({
  items,
  actions,
  onEdit,
}: {
  items: readonly GkedItem[];
  actions: (x: GkedItem) => ActionEntry[];
  onEdit: (x: GkedItem) => void;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const { kids, byCode } = useMemo(() => {
    const kids = new Map<string, GkedItem[]>();
    for (const x of items) {
      const k = x.parentCode ?? '';
      kids.set(k, [...(kids.get(k) ?? []), x]);
    }
    return { kids, byCode: new Map(items.map((x) => [x.code, x])) };
  }, [items]);
  const toggle = (code: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const pathOf = (x: GkedItem) => {
    const up: string[] = [];
    let p = x.parentCode ? byCode.get(x.parentCode) : undefined;
    for (let n = 0; p && n < 8; n++) {
      up.unshift(p.code);
      p = p.parentCode ? byCode.get(p.parentCode) : undefined;
    }
    return [t(gkedLevelKey(x.level)), up.join(' › ')].filter(Boolean).join(' · ');
  };
  const row = (x: GkedItem) => {
    const children = kids.get(x.code) ?? [];
    const isOpen = open.has(x.code);
    return (
      <div key={x.code}>
        <TreeRow
          x={x}
          kids={children.length}
          open={isOpen}
          onToggle={() => toggle(x.code)}
          onOpen={() => (children.length ? toggle(x.code) : onEdit(x))}
          actions={actions(x)}
        />
        {isOpen && children.length ? <div className="pl-[22px]">{children.map(row)}</div> : null}
      </div>
    );
  };
  const hits = q.trim() ? searchGked(items, q) : null;
  return (
    <Box>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5">
        <Icon name="search" size="sm" className="text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('pdicts.gked.search')}
          aria-label={t('pdicts.gked.search_label')}
          className="min-h-9 grow border-0 bg-transparent outline-none"
        />
      </div>
      <div data-gked-tree="">
        {hits ? (
          <>
            <Hint>
              {hits.length > SEARCH_SHOWN
                ? t('pdicts.gked.found_more', { n: hits.length, max: SEARCH_SHOWN })
                : t('pdicts.gked.found', { n: hits.length })}
            </Hint>
            {hits.slice(0, SEARCH_SHOWN).map((x) => (
              <TreeRow
                key={x.code}
                x={x}
                kids={0}
                open={false}
                path={pathOf(x)}
                onOpen={() => onEdit(x)}
                actions={actions(x)}
              />
            ))}
          </>
        ) : (
          (kids.get('') ?? []).filter((x) => x.level === 'section').map(row)
        )}
      </div>
    </Box>
  );
}

/** Окно группы кодов: поля и действия кодов в едином налоге и СПиНО. */
interface GroupDraft {
  name: string;
  codes: string;
  acts: Record<GkedGroupTarget, Record<string, GkedGroupAct | ''>>;
  ask: string;
  why: string;
}

const draftOf = (g: AdminGkedGroup): GroupDraft => ({
  name: g.name,
  codes: g.codes.join(', '),
  acts: {
    en: Object.fromEntries(g.codes.map((c) => [c, gkedGroupAct(g, 'en', c)])),
    spino: Object.fromEntries(g.codes.map((c) => [c, gkedGroupAct(g, 'spino', c)])),
  },
  ask: g.ask,
  why: g.why,
});

/**
 * Окно группы кодов (прототип gkGrpDlg): название и коды обязательны; у каждого кода — что он делает в
 * едином налоге и в тарифе СПиНО; вопрос при предупреждении и «Почему». Внизу — что изменит правка:
 * режим, виды отчётов и налоги с тем же перечнем, статус ЛЬГ-29. Сохранение сразу правит их «Кроме» и
 * «Предупреждать при ГКЭД».
 */
function GkedGroupDialog({
  open,
  onClose,
  group,
  groups,
  names,
}: {
  open: boolean;
  onClose: () => void;
  group: AdminGkedGroup;
  groups: AdminGkedGroups;
  names: ReadonlyMap<string, string>;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = usePdictsRefresh();
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(group));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; codes?: string }>({});
  const [version, setVersion] = useState(groups.version);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const codes = splitGkedCodes(draft.codes);
  const set = (patch: Partial<GroupDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const setAct = (k: GkedGroupTarget, code: string, a: GkedGroupAct | '') =>
    set({ acts: { ...draft.acts, [k]: { ...draft.acts[k], [code]: a } } });

  const reload = async () => {
    const fresh = await refetchGroups();
    const g = fresh?.items.find((x) => x.id === group.id);
    if (!fresh || !g) return toast(t('err.unknown'), { bad: true });
    setDraft(draftOf(g));
    setVersion(fresh.version);
    setDirty(false);
    setChanged(false);
  };
  const groupsQuery = useQuery({ ...pdictsGkedGroupsQuery, enabled: false });
  const refetchGroups = async () => (await groupsQuery.refetch()).data;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return onClose();
    const name = draft.name.trim();
    const next = {
      name: name ? undefined : t('pdicts.err.name_required'),
      codes: codes.length ? undefined : t('pdicts.err.gked_codes_required'),
    };
    setErrors(next);
    if (next.name || next.codes) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.admin['platform-gked'].groups[':id'].$put({
        param: { id: group.id },
        json: {
          name,
          codes,
          en: packGkedGroupActs(codes, draft.acts.en),
          spino: packGkedGroupActs(codes, draft.acts.spino),
          ask: draft.ask.trim(),
          why: draft.why.trim(),
          version,
        },
      }),
    ).finally(() => setBusy(false));
    if (res.ok) {
      refresh('gked');
      onClose();
      return toast(t('pdicts.gkgrp.saved'), { icon: 'check' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    if (res.error.code === 'gked_unknown') return setErrors({ codes: errorText(res.error) });
    toast(errorText(res.error), { bad: true });
  };
  const formId = `${id}-form`;
  const targets = (k: GkedGroupTarget) =>
    groups.targets[k].map((x) => t(`pdicts.gkgrp.target.${x.kind}`, { name: x.name })).join(', ') ||
    '—';

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={group.name}
      sub={t('pdicts.gkgrp.dlg.sub')}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={busy || changed}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={groupsQuery.isFetching}
        />
      ) : null}
      <form
        id={formId}
        onSubmit={(e) => void submit(e)}
        noValidate
        className="flex flex-col gap-3.5"
      >
        <FormGrid>
          <Field
            id={`${id}-name`}
            label={t('pdicts.gkgrp.dlg.name')}
            required
            error={errors.name}
            full
          >
            {(c) => (
              <input
                {...c}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                className={inputClass()}
              />
            )}
          </Field>
          <Field
            id={`${id}-codes`}
            label={t('pdicts.gkgrp.dlg.codes')}
            required
            hint={t('pdicts.gkgrp.dlg.codes_hint')}
            error={errors.codes}
            full
          >
            {(c) => (
              <input
                {...c}
                value={draft.codes}
                onChange={(e) => set({ codes: e.target.value })}
                className={inputClass({ mono: true })}
              />
            )}
          </Field>
          <div className="col-span-full flex flex-col gap-[5px]">
            <span className="text-[12px] font-semibold tracking-[.01em] text-muted">
              {t('pdicts.gkgrp.dlg.acts')}
            </span>
            <MiniTable
              label={t('pdicts.gkgrp.dlg.acts')}
              empty={t('pdicts.err.gked_codes_required')}
              columns={[
                { key: 'code', label: t('pdicts.gkgrp.dlg.code') },
                { key: 'en', label: t('pdicts.gkgrp.col.en'), width: 170 },
                { key: 'spino', label: t('pdicts.gkgrp.col.spino'), width: 170 },
              ]}
              rows={codes.map((code) => ({
                key: code,
                cells: {
                  code: (
                    <span>
                      <span className="font-mono font-semibold">{code}</span>{' '}
                      <span className="text-faint">{names.get(code) ?? ''}</span>
                    </span>
                  ),
                  ...Object.fromEntries(
                    GKED_GROUP_TARGETS.map((k) => [
                      k,
                      <select
                        key={k}
                        aria-label={`${code}: ${t(`pdicts.gkgrp.col.${k}`)}`}
                        value={draft.acts[k][code] ?? ''}
                        onChange={(e) => setAct(k, code, e.target.value as GkedGroupAct | '')}
                        className={`${inputClass()} cursor-pointer`}
                      >
                        <option value="">—</option>
                        <option value="ex">{t('pdicts.gked.act.ex')}</option>
                        <option value="warn">{t('pdicts.gked.act.warn')}</option>
                      </select>,
                    ]),
                  ),
                },
              }))}
            />
            <Hint>{t('pdicts.gkgrp.dlg.acts_hint')}</Hint>
          </div>
          <Field id={`${id}-ask`} label={t('pdicts.gkgrp.dlg.ask')} full>
            {(c) => (
              <input
                {...c}
                value={draft.ask}
                onChange={(e) => set({ ask: e.target.value })}
                placeholder={t('pdicts.gkgrp.dlg.ask_ph')}
                className={inputClass()}
              />
            )}
          </Field>
          <Field id={`${id}-why`} label={t('pdicts.gkgrp.dlg.why')} full>
            {(c) => (
              <textarea
                {...c}
                value={draft.why}
                onChange={(e) => set({ why: e.target.value })}
                className={`${inputClass({ multiline: true })} min-h-[56px]`}
              />
            )}
          </Field>
          <dl className="col-span-full m-0 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {GKED_GROUP_TARGETS.map((k) => (
              <div key={k}>
                <dt className="text-[12px] font-semibold text-muted">
                  {t(`pdicts.gkgrp.dlg.${k}`)}
                </dt>
                <dd className="m-0">{targets(k)}</dd>
              </div>
            ))}
          </dl>
        </FormGrid>
      </form>
    </Modal>
  );
}

/** «Группы кодов» (прототип renderGked `adm-gkgrp`): таблица, «Выгрузить» и «Загрузить» групп. */
function GkedGroupsBox({
  names,
  onIo,
}: {
  names: ReadonlyMap<string, string>;
  onIo: (dict: 'gkgroups', action: 'export' | 'import') => void;
}) {
  const t = useT();
  const groups = useQuery(pdictsGkedGroupsQuery);
  const [edit, setEdit] = useState<DialogSlot<AdminGkedGroup> | null>(null);
  const data = groups.data;
  const open = (code: string) => {
    const g = data?.items.find((x) => x.id === code);
    if (g) setEdit(openSlot(g));
  };
  return (
    <Box title={t('pdicts.gkgrp.title')}>
      <div className="flex flex-wrap items-center gap-2" data-gkgroups-bar="">
        <span className="min-w-0 grow text-[12.5px] text-faint">{t('pdicts.gkgrp.hint')}</span>
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() => onIo('gkgroups', 'export')}
        >
          <Icon name="download" size="sm" />
          {t('pdicts.io.bar.export')}
        </button>
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() => onIo('gkgroups', 'import')}
        >
          <Icon name="upload" size="sm" />
          {t('pdicts.io.bar.import')}
        </button>
      </div>
      <MiniTable
        label={t('pdicts.gkgrp.title')}
        empty={t('grid.empty')}
        onOpen={open}
        columns={[
          { key: 'name', label: t('pdicts.gkgrp.col.name') },
          { key: 'codes', label: t('pdicts.gkgrp.col.codes') },
          { key: 'en', label: t('pdicts.gkgrp.col.en') },
          { key: 'spino', label: t('pdicts.gkgrp.col.spino') },
          { key: 'edit', label: '', actions: true, width: 44 },
        ]}
        rows={(data?.items ?? []).map((g) => ({
          key: g.id,
          cells: {
            name: <span className="font-semibold">{g.name}</span>,
            codes: <span className="font-mono">{g.codes.join(', ')}</span>,
            en: gkedGroupActText(g, 'en', t),
            spino: gkedGroupActText(g, 'spino', t),
            edit: (
              <button
                type="button"
                className={iconButtonClass('sm')}
                aria-label={t('pdicts.action.edit')}
                title={t('pdicts.action.edit')}
                onClick={() => open(g.id)}
              >
                <Icon name="edit" size="sm" />
              </button>
            ),
          },
        }))}
      />
      {edit && data ? (
        <GkedGroupDialog
          key={`grp-${edit.n}`}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          group={edit.data}
          groups={data}
          names={names}
        />
      ) : null}
    </Box>
  );
}

type IoSlot = { dict: 'gked' | Extract<IoSectionDict, 'gkgroups'>; action: 'export' | 'import' };

/**
 * Вкладка «ГКЭД»: пояснение, строка «Выгрузить / Загрузить» с выбором вида, «Группы кодов», дерево
 * или список, «История изменений». «+ Добавить» → «Код ГКЭД», «Выгрузить в Excel», «Загрузить из
 * Excel».
 */
export function GkedTab() {
  const t = useT();
  const items = useQuery(pdictsGkedItemsQuery);
  const refresh = usePdictsRefresh();
  const run = useGkedActions();
  const [view, setView] = useState<GkedView>('tree');
  useEffect(() => setView(readView()), []);
  const pickView = (v: GkedView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Браузер не даёт запомнить — вид действует до перезагрузки.
    }
  };
  const [edit, setEdit] = useState<DialogSlot<GkedItem | null> | null>(null);
  const [io, setIo] = useState<DialogSlot<IoSlot> | null>(null);
  const [askDelete, setAskDelete] = useState<GkedItem | null>(null);
  const all = items.data ?? [];
  const names = useMemo(() => new Map(all.map((x) => [x.code, x.name])), [all]);
  const actions = (x: GkedItem) =>
    gkedActions(t, x, {
      edit: (y) => setEdit(openSlot<GkedItem | null>(y)),
      active: run.active,
      remove: setAskDelete,
    });

  // «+ Добавить»: «Код ГКЭД», «Выгрузить в Excel», «Загрузить из Excel».
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'pdicts' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'gked') setEdit(openSlot<GkedItem | null>(null));
    else if (actionId === 'io_export') setIo(openSlot<IoSlot>({ dict: 'gked', action: 'export' }));
    else if (actionId === 'io_import') setIo(openSlot<IoSlot>({ dict: 'gked', action: 'import' }));
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);

  const leaves = all.filter((x) => x.level === 'subclass').length;
  const off = all.filter((x) => !x.active).length;
  const note = [
    t('pdicts.gked.note', {
      n: t(`pdicts.gked.codes.${pluralForm(all.length)}`, { n: all.length }),
      leaves: t(`pdicts.gked.leaves.${pluralForm(leaves)}`, { n: leaves }),
    }),
    off ? t('pdicts.gked.note_off', { n: off }) : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-3.5">
      {items.data ? <Note icon="info">{note}</Note> : null}
      <div className="flex flex-wrap items-center gap-2" data-io-bar="">
        <span className="min-w-[220px] flex-1 text-[13px] text-muted">
          {t('pdicts.gked.io_note')}
        </span>
        <Segments
          label={t('pdicts.gked.view')}
          value={view}
          onChange={pickView}
          options={[
            { value: 'tree', label: t('pdicts.gked.view.tree') },
            { value: 'list', label: t('pdicts.gked.view.list') },
          ]}
        />
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() => setIo(openSlot<IoSlot>({ dict: 'gked', action: 'export' }))}
        >
          <Icon name="download" size="sm" />
          {t('pdicts.io.bar.export')}
        </button>
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() => setIo(openSlot<IoSlot>({ dict: 'gked', action: 'import' }))}
        >
          <Icon name="upload" size="sm" />
          {t('pdicts.io.bar.import')}
        </button>
      </div>
      <GkedGroupsBox
        names={names}
        onIo={(dict, action) => setIo(openSlot<IoSlot>({ dict, action }))}
      />
      {view === 'tree' ? (
        <GkedTree
          items={all}
          actions={actions}
          onEdit={(x) => setEdit(openSlot<GkedItem | null>(x))}
        />
      ) : (
        <ValueDictList dict="gked" bare onGkedEdit={(x) => setEdit(openSlot<GkedItem | null>(x))} />
      )}
      <DictHistory dict="gked" />
      {edit ? (
        <GkedDialog
          key={`gked-${edit.n}`}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          item={edit.data}
          names={names}
          onDone={() => refresh('gked')}
        />
      ) : null}
      {io?.data.action === 'export' ? (
        <ExportDialog
          key={`io-${io.n}`}
          dict={io.data.dict}
          open={io.open}
          onClose={() => setIo(closeSlot)}
        />
      ) : io ? (
        <ImportDialog
          key={`io-${io.n}`}
          dict={io.data.dict}
          open={io.open}
          onClose={() => setIo(closeSlot)}
        />
      ) : null}
      <ConfirmDialog
        open={askDelete !== null}
        onClose={() => setAskDelete(null)}
        title={t('pdicts.gked.del_title', { code: askDelete?.code ?? '' })}
        text={t('pdicts.gked.del_text')}
        ok={t('pdicts.action.delete')}
        danger
        onConfirm={() => askDelete && run.remove(askDelete)}
      />
    </div>
  );
}
