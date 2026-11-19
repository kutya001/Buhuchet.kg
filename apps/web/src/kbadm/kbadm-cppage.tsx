'use client';

import {
  CP_FAQ_ACTS,
  CP_FAQ_SECS,
  CP_HELP_HINT_KEYS,
  CP_HELP_HINT_VARS,
  CP_HELP_MAX,
  CP_HELP_WELCOME_KEYS,
  CP_TOUR_ALT_SECS,
  cpAnswerLines,
  cpGlossSorted,
  cpHelpCap,
  cpHelpLong,
  cpHelpTextId,
  type CpFaq,
  type CpFaqAct,
  type CpFaqSec,
  type CpGloss,
  type CpHelpDict,
  type CpHelpHintKey,
  type CpHelpWelcomeKey,
  type CpTourSec,
  type CpTourStep,
  type UiTextKey,
} from '@buhuchet/domain';
import { AdminCpHelp, type AdminCpHelpEdit } from '@buhuchet/shared';
import {
  ActionMenu,
  buttonClass,
  ChipSelect,
  ConfirmDialog,
  EmptyState,
  Field,
  FormGrid,
  Icon,
  iconButtonClass,
  inputClass,
  MiniTable,
  Modal,
  Note,
  RecordChangedNotice,
  SWITCH_CLASS,
  useToast,
  type ActionEntry,
  type IconName,
  type MenuPlace,
  type MiniColumn,
  type MiniRow,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { useKbAdmAdd } from './kbadm-add';
import { kb } from './kbadm-data';
import { KbAdmHistory } from './kbadm-history';
import { useKbAdmIo } from './kbadm-io';

/*
 * Админка → «База знаний (содержимое)» → «Страница контрагента» (доработки 15.11.2026, пункт 6;
 * прототип v120 admin/cp-help-admin.js): тексты подсказок и обучения на странице контрагента — один
 * набор для всех организаций. Разделы «Приветствие», «Обзор страницы», «Частые вопросы», «Словарик» и
 * «Подсказки в окнах»; у каждого — «Выгрузить» и «Загрузить», как у «Показов». Что подсвечивает облачко
 * обзора, задаёт разработчик. Каждая правка — одна запись той версии раздела, что видел администратор.
 */

type Sub = 'wel' | 'tour' | 'faq' | 'gloss' | 'hints';
const SUBS: readonly Sub[] = ['wel', 'tour', 'faq', 'gloss', 'hints'];

/** Раздел вкладки → его «Выгрузить» / «Загрузить» и «История изменений» (прототип CPH_DX). */
const SUB_DICT: Readonly<Record<Sub, CpHelpDict>> = {
  wel: 'cpwel',
  tour: 'cptour',
  faq: 'cpfaq',
  gloss: 'cpgloss',
  hints: 'cphints',
};

/** Выбранный раздел — до перезагрузки страницы (прототип `store('cphadm.sub')`). */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-16
const remembered: { sub: Sub } = { sub: 'wel' };

type Help = AdminCpHelp['help'];
/** Правка без версии: версию добавляет вкладка — ту, что сейчас на экране. */
type Edit = AdminCpHelpEdit extends infer U
  ? U extends unknown
    ? Omit<U, 'version'>
    : never
  : never;
type SendResult = { ok: true } | { ok: false; error: ApiErrorLike };
type Send = (edit: Edit) => Promise<SendResult>;

export const cpHelpAdminQuery = queryOptions({
  queryKey: ['kbadm', 'cppage'],
  queryFn: async () => {
    const res = await kb.cppage.$get();
    if (!res.ok) throw await apiFailure(res);
    return AdminCpHelp.parse(await res.json());
  },
  staleTime: 0,
});

const whereOf = (t: Translate, sub: 'wel' | 'hints', key: string) =>
  t(`cph.adm.${sub === 'wel' ? 'wel' : 'hint'}.${cpHelpTextId(key)}` as UiTextKey);
const secLabel = (t: Translate, sec: CpTourSec) => t(`cph.adm.sec.${sec}` as UiTextKey);
const qsecLabel = (t: Translate, sec: CpFaqSec) =>
  t((sec ? `cph.adm.qsec.${cpHelpTextId(sec)}` : 'cph.adm.qsec.all') as UiTextKey);
const actLabel = (t: Translate, act: CpFaqAct) =>
  t((act ? `cph.adm.act.${cpHelpTextId(act)}` : 'cph.adm.act.none') as UiTextKey);
const tourOn = (s: CpTourStep) => s.sec === 'end' || s.on;
const faqSorted = (faq: readonly CpFaq[]) => faq.slice().sort((a, b) => a.ord - b.ord);

type DialogData =
  | { kind: 'text'; sub: 'wel' | 'hints'; key: string }
  | { kind: 'tour'; id: string }
  | { kind: 'faq'; id: string | null }
  | { kind: 'gloss'; w: string | null }
  | { kind: 'delFaq'; id: string; q: string }
  | { kind: 'delGloss'; w: string };

export function KbAdmCpPageTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const help = useQuery(cpHelpAdminQuery);
  const [sub, setSubState] = useState<Sub>(remembered.sub);
  const [dialog, setDialog] = useState<DialogSlot<DialogData> | null>(null);
  const [menu, setMenu] = useState<{ place: MenuPlace; items: ActionEntry[] } | null>(null);
  const io = useKbAdmIo(SUB_DICT[sub]);
  const setSub = (s: Sub) => {
    remembered.sub = s;
    setSubState(s);
  };
  const open = (d: DialogData) => setDialog(openSlot<DialogData>(d));
  // «+ Добавить»: «Вопрос» и «Слово» открывают свой раздел и окно (прототип cphAdmAdd).
  useKbAdmAdd('cph_faq', () => {
    setSub('faq');
    open({ kind: 'faq', id: null });
  });
  useKbAdmAdd('cph_word', () => {
    setSub('gloss');
    open({ kind: 'gloss', w: null });
  });

  const data = help.data;
  const send: Send = async (edit) => {
    if (!data) return { ok: false, error: { code: 'unknown', message: '' } };
    const res = await callApi(() =>
      kb.cppage.$post({ json: { ...edit, version: data.version } as AdminCpHelpEdit }),
    );
    if (!res.ok) return { ok: false, error: res.error };
    client.setQueryData(cpHelpAdminQuery.queryKey, AdminCpHelp.parse(res.data));
    void client.invalidateQueries({ queryKey: ['kbadm', 'history', 'cppage'] });
    return { ok: true };
  };
  /** Действие меню строки («Выше», «Выключить», «Удалить»): отказ — уведомлением, данные — заново. */
  const quick = async (edit: Edit, done?: string) => {
    const r = await send(edit);
    if (r.ok) {
      if (done) toast(done, { icon: 'check' });
      return;
    }
    toast(errorText(r.error), { bad: true });
    if (r.error.code === 'record_changed') void help.refetch();
  };
  const reload = async () => (await help.refetch()).data?.help ?? null;
  const showMenu = (place: MenuPlace, items: ActionEntry[]) => setMenu({ place, items });

  let table: ReactNode = null;
  if (data) {
    const props = { t, help: data.help, open, quick, showMenu };
    table =
      sub === 'wel' || sub === 'hints' ? (
        <TextsTable {...props} sub={sub} />
      ) : sub === 'tour' ? (
        <TourTable {...props} />
      ) : sub === 'faq' ? (
        <FaqTable {...props} />
      ) : (
        <GlossTable {...props} />
      );
  } else if (help.isError) {
    table = <EmptyState icon="alert" title={t('err.unknown')} />;
  }

  const d = dialog?.data;
  const close = () => setDialog(closeSlot);
  const common = { open: !!dialog?.open, onClose: close, send, reload };
  let dialogs: ReactNode = null;
  if (d && data) {
    const key = `cph-${d.kind}-${dialog.n}`;
    if (d.kind === 'text') {
      dialogs = <TextDialog key={key} {...common} help={data.help} sub={d.sub} k={d.key} />;
    } else if (d.kind === 'tour') {
      const step = data.help.tour.find((s) => s.id === d.id);
      if (step) dialogs = <TourDialog key={key} {...common} step={step} />;
    } else if (d.kind === 'faq') {
      const q = d.id ? data.help.faq.find((x) => x.id === d.id) : null;
      if (q !== undefined) dialogs = <FaqDialog key={key} {...common} faq={q} />;
    } else if (d.kind === 'gloss') {
      const g = d.w ? data.help.gloss.find((x) => x.w === d.w) : null;
      if (g !== undefined) dialogs = <GlossDialog key={key} {...common} word={g} />;
    } else if (d.kind === 'delFaq') {
      dialogs = (
        <ConfirmDialog
          key={key}
          open={common.open}
          onClose={close}
          danger
          title={t('cph.adm.faq.delete_t')}
          text={t('cph.adm.faq.delete_x', { name: d.q })}
          ok={t('cph.adm.menu.delete')}
          onConfirm={() => {
            close();
            void quick({ op: 'faqDelete', id: d.id }, t('cph.adm.saved.faq_deleted'));
          }}
        />
      );
    } else {
      dialogs = (
        <ConfirmDialog
          key={key}
          open={common.open}
          onClose={close}
          danger
          title={t('cph.adm.gloss.delete_t')}
          text={t('cph.adm.gloss.delete_x', { name: d.w })}
          ok={t('cph.adm.menu.delete')}
          onConfirm={() => {
            close();
            void quick({ op: 'glossDelete', w: d.w }, t('cph.adm.saved.gloss_deleted'));
          }}
        />
      );
    }
  }

  return (
    <div data-kbadm-cppage={sub} className="flex flex-col gap-3.5">
      <Note icon="info">{t('cph.adm.note')}</Note>
      <ChipSelect
        label={t('cph.adm.subs')}
        value={sub}
        onChange={setSub}
        options={SUBS.map((s) => ({ value: s, label: t(`cph.adm.sub.${s}`) }))}
      />
      {io.bar}
      {table}
      <KbAdmHistory section="cppage" />
      {io.dialogs}
      {dialogs}
      {menu ? (
        <ActionMenu
          items={menu.items}
          place={menu.place}
          label={t('cph.adm.actions')}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

interface TableProps {
  t: Translate;
  help: Help;
  open: (d: DialogData) => void;
  quick: (edit: Edit, done?: string) => Promise<void>;
  showMenu: (place: MenuPlace, items: ActionEntry[]) => void;
}

/** Таблица раздела: строка открывает окно правки, «⋯», правый клик и долгое нажатие — меню строки. */
function SubTable({
  t,
  sub,
  columns,
  rows,
  menuOf,
  onOpen,
  showMenu,
}: {
  t: Translate;
  sub: Sub;
  columns: MiniColumn[];
  rows: (MiniRow & { off?: boolean })[];
  menuOf: (key: string) => ActionEntry[];
  onOpen: (key: string) => void;
  showMenu: TableProps['showMenu'];
}) {
  const more = (key: string) => (
    <button
      type="button"
      data-cph-more={key}
      aria-label={t('cph.adm.actions')}
      className={iconButtonClass('sm')}
      onClick={(e) => showMenu({ anchor: e.currentTarget }, menuOf(key))}
    >
      <Icon name="more" size="sm" />
    </button>
  );
  return (
    <div data-cph-table={sub}>
      <MiniTable
        label={t('cph.adm.table', { sub: t(`cph.adm.sub.${sub}`) })}
        empty="—"
        columns={[...columns, { key: 'more', label: '', width: 44, actions: true }]}
        rows={rows.map((r) => ({
          ...r,
          menu: true,
          cells: Object.fromEntries([
            ...Object.entries(r.cells).map(([k, v]) => [
              k,
              r.off ? <span className="text-faint">{v}</span> : v,
            ]),
            ['more', more(r.key)],
          ]),
        }))}
        onOpen={onOpen}
        onMenu={(key, place) => showMenu(place, menuOf(key))}
      />
    </div>
  );
}

const menuItem = (
  id: string,
  label: string,
  icon: IconName,
  run: () => void,
  o: { disabled?: boolean; danger?: boolean; sub?: string } = {},
): ActionEntry => ({ id, label, icon, run, ...o });

/** «Приветствие» и «Подсказки в окнах» (прототип: «Где» — «Текст»). */
function TextsTable({ t, help, open, showMenu, sub }: TableProps & { sub: 'wel' | 'hints' }) {
  const keys: readonly string[] = sub === 'wel' ? CP_HELP_WELCOME_KEYS : CP_HELP_HINT_KEYS;
  const src: Readonly<Record<string, string | undefined>> =
    sub === 'wel' ? help.welcome : help.hints;
  const edit = (key: string) => open({ kind: 'text', sub, key });
  return (
    <SubTable
      t={t}
      sub={sub}
      showMenu={showMenu}
      onOpen={edit}
      menuOf={(key) => [menuItem('edit', t('cph.adm.menu.edit'), 'edit', () => edit(key))]}
      columns={[
        { key: 'l', label: t('cph.io.col.where'), width: 320 },
        { key: 'x', label: t('cph.io.col.text') },
      ]}
      rows={keys.map((key) => ({
        key,
        cells: {
          l: <b>{whereOf(t, sub, key)}</b>,
          x: src[key] ? src[key] : <span className="text-faint">{t('cph.adm.default')}</span>,
        },
        wide: ['x'],
      }))}
    />
  );
}

/** «Обзор страницы» по порядку облачков; «Готово» — всегда последнее, не двигается и не выключается. */
function TourTable({ t, help, open, quick, showMenu }: TableProps) {
  const list = help.tour;
  const menuOf = (id: string): ActionEntry[] => {
    const k = list.findIndex((s) => s.id === id);
    const s = list[k];
    if (!s) return [];
    const items = [
      menuItem('edit', t('cph.adm.menu.edit'), 'edit', () => open({ kind: 'tour', id })),
    ];
    if (s.sec === 'end') return items;
    const move = (dir: -1 | 1) => () => void quick({ op: 'tourMove', id, dir });
    const flip = () => void quick({ op: 'tour', id, t: s.t, x: s.x, x2: s.x2, on: !s.on });
    return [
      ...items,
      menuItem('up', t('cph.adm.menu.up'), 'up', move(-1), { disabled: k === 0 }),
      menuItem('down', t('cph.adm.menu.down'), 'dn', move(1), {
        disabled: k >= list.length - 1 || list[k + 1]!.sec === 'end',
      }),
      { id: 'sep', separator: true },
      s.on
        ? menuItem('off', t('cph.adm.menu.off'), 'ban', flip, {
            sub: t('cph.adm.menu.tour_off_sub'),
          })
        : menuItem('on', t('cph.adm.menu.on'), 'check', flip),
    ];
  };
  return (
    <SubTable
      t={t}
      sub="tour"
      showMenu={showMenu}
      onOpen={(id) => open({ kind: 'tour', id })}
      menuOf={menuOf}
      columns={[
        { key: 'n', label: t('cph.io.col.n'), width: 50, numeric: true },
        { key: 'sec', label: t('cph.io.col.sec'), width: 190 },
        { key: 't', label: t('cph.io.col.tour_t'), width: 190 },
        { key: 'x', label: t('cph.io.col.tour_x'), width: 380 },
        { key: 'x2', label: t('cph.io.col.tour_x2'), width: 260 },
        { key: 'on', label: t('cph.io.col.tour_on'), width: 100 },
      ]}
      rows={list.map((s, i) => ({
        key: s.id,
        off: !tourOn(s),
        cells: {
          n: i + 1,
          sec: secLabel(t, s.sec),
          t: <b>{s.t}</b>,
          x: s.x,
          x2: s.x2 ?? '',
          on: t(tourOn(s) ? 'cph.adm.yes' : 'cph.adm.no'),
        },
        wide: ['x', 'x2'],
        blank: s.x2 ? [] : ['x2'],
      }))}
    />
  );
}

/** «Частые вопросы» по «Порядку». */
function FaqTable({ t, help, open, quick, showMenu }: TableProps) {
  const list = faqSorted(help.faq);
  const menuOf = (id: string): ActionEntry[] => {
    const k = list.findIndex((q) => q.id === id);
    const q = list[k];
    if (!q) return [];
    const move = (dir: -1 | 1) => () => void quick({ op: 'faqMove', id, dir });
    const flip = () =>
      void quick({ op: 'faq', id, q: q.q, a: q.a, sec: q.sec, act: q.act, on: !q.on });
    return [
      menuItem('edit', t('cph.adm.menu.edit'), 'edit', () => open({ kind: 'faq', id })),
      menuItem('up', t('cph.adm.menu.up'), 'up', move(-1), { disabled: k === 0 }),
      menuItem('down', t('cph.adm.menu.down'), 'dn', move(1), {
        disabled: k === list.length - 1,
      }),
      { id: 'sep', separator: true },
      q.on
        ? menuItem('off', t('cph.adm.menu.off'), 'ban', flip, {
            sub: t('cph.adm.menu.faq_off_sub'),
          })
        : menuItem('on', t('cph.adm.menu.on'), 'check', flip),
      menuItem(
        'delete',
        t('cph.adm.menu.delete'),
        'trash',
        () => open({ kind: 'delFaq', id, q: q.q }),
        { danger: true },
      ),
    ];
  };
  return (
    <SubTable
      t={t}
      sub="faq"
      showMenu={showMenu}
      onOpen={(id) => open({ kind: 'faq', id })}
      menuOf={menuOf}
      columns={[
        { key: 'ord', label: t('cph.io.col.ord'), width: 80, numeric: true },
        { key: 'q', label: t('cph.io.col.q'), width: 260 },
        { key: 'a', label: t('cph.adm.col.answer'), width: 380 },
        { key: 'sec', label: t('cph.io.col.qsec'), width: 180 },
        { key: 'act', label: t('cph.io.col.act'), width: 200 },
        { key: 'on', label: t('cph.io.col.faq_on'), width: 90 },
      ]}
      rows={list.map((q) => ({
        key: q.id,
        off: !q.on,
        cells: {
          ord: q.ord,
          q: <b>{q.q}</b>,
          a: cpAnswerLines(q.a).join(' · '),
          sec: qsecLabel(t, q.sec),
          act: actLabel(t, q.act),
          on: t(q.on ? 'cph.adm.yes' : 'cph.adm.no'),
        },
        wide: ['q', 'a'],
      }))}
    />
  );
}

/** «Словарик» по алфавиту. */
function GlossTable({ t, help, open, showMenu }: TableProps) {
  const list = cpGlossSorted(help.gloss);
  return (
    <SubTable
      t={t}
      sub="gloss"
      showMenu={showMenu}
      onOpen={(w) => open({ kind: 'gloss', w })}
      menuOf={(w) => [
        menuItem('edit', t('cph.adm.menu.edit'), 'edit', () => open({ kind: 'gloss', w })),
        { id: 'sep', separator: true },
        menuItem('delete', t('cph.adm.menu.delete'), 'trash', () => open({ kind: 'delGloss', w }), {
          danger: true,
        }),
      ]}
      columns={[
        { key: 'w', label: t('cph.io.col.word'), width: 200 },
        { key: 'x', label: t('cph.io.col.gloss_x'), width: 480 },
        { key: 'also', label: t('cph.io.col.also'), width: 240 },
      ]}
      rows={list.map((g) => ({
        key: g.w,
        cells: { w: <b>{cpHelpCap(g.w)}</b>, x: g.x, also: g.also ?? '' },
        wide: ['x'],
        blank: g.also ? [] : ['also'],
      }))}
    />
  );
}

/* ───────────── Окна правки ───────────── */

interface DialogProps {
  open: boolean;
  onClose: () => void;
  send: Send;
  /** «Перечитать» после «изменено другим пользователем»: тексты раздела заново. */
  reload: () => Promise<Help | null>;
}

/** Сохранить: отказ «изменено другим» — плашкой над полями, остальное — уведомлением. */
function useDialogSave(onClose: () => void) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const run = async (
    send: () => Promise<SendResult>,
    done: string,
    text: string,
    fieldError?: (e: ApiErrorLike) => boolean,
  ) => {
    setSaving(true);
    const r = await send();
    setSaving(false);
    if (r.ok) {
      onClose();
      // Длинное предложение — подсказка, не запрет (прототип cphLong).
      return cpHelpLong(text)
        ? toast(t('cph.adm.long'), { icon: 'info' })
        : toast(done, { icon: 'check' });
    }
    if (r.error.code === 'record_changed') return setChanged(true);
    if (fieldError?.(r.error)) return;
    toast(errorText(r.error), { bad: true });
  };
  return { saving, changed, setChanged, run };
}

function Changed({ onReload }: { onReload: () => Promise<void> }) {
  const t = useT();
  const [reloading, setReloading] = useState(false);
  return (
    <RecordChangedNotice
      message={t('err.record_changed')}
      reloadLabel={t('form.reload')}
      reloading={reloading}
      onReload={() => {
        setReloading(true);
        void onReload().finally(() => setReloading(false));
      }}
    />
  );
}

function Footer({
  onClose,
  onSave,
  busy,
}: {
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const t = useT();
  return (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <button
        type="button"
        data-cph-save=""
        className={buttonClass('cta')}
        disabled={busy}
        onClick={onSave}
      >
        {t('btn.save')}
      </button>
    </>
  );
}

function Switch({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer flex-wrap items-center gap-2 text-[12px] font-semibold tracking-[.01em] text-muted">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className={SWITCH_CLASS}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

const textareaClass = (min: string) => `${inputClass()} ${min} resize-y leading-normal`;

/** «Текст подсказки» (прототип cphTextDlg): «Приветствие» и «Подсказки в окнах». */
function TextDialog({
  open,
  onClose,
  send,
  reload,
  help,
  sub,
  k,
}: DialogProps & { help: Help; sub: 'wel' | 'hints'; k: string }) {
  const t = useT();
  const id = useId();
  const textOf = (h: Help) =>
    (sub === 'wel' ? h.welcome[k as CpHelpWelcomeKey] : h.hints[k as CpHelpHintKey]) ?? '';
  const [base, setBase] = useState(() => textOf(help));
  const [text, setText] = useState(base);
  const [error, setError] = useState('');
  const save = useDialogSave(onClose);
  const vars = sub === 'hints' && !!CP_HELP_HINT_VARS[k as CpHelpHintKey];
  const submit = () => {
    const v = text.trim();
    if (!v) return setError(t('cph.adm.err.text'));
    if (v === base) return onClose();
    const edit: Edit =
      sub === 'wel'
        ? { op: 'welcome', key: k as CpHelpWelcomeKey, text: v }
        : { op: 'hint', key: k as CpHelpHintKey, text: v };
    void save.run(() => send(edit), t('cph.adm.saved.text'), v);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      noMax
      dirty={text !== base}
      title={t('cph.adm.text.title')}
      sub={whereOf(t, sub, k)}
      footer={<Footer onClose={onClose} onSave={submit} busy={save.saving || save.changed} />}
    >
      {save.changed ? (
        <Changed
          onReload={async () => {
            const h = await reload();
            if (!h) return;
            setBase(textOf(h));
            setText(textOf(h));
            save.setChanged(false);
          }}
        />
      ) : null}
      <FormGrid>
        <Field
          id={`${id}-t`}
          label={t('cph.adm.text.field')}
          required
          full
          error={error || undefined}
          hint={vars ? t('cph.adm.text.vars') : undefined}
        >
          {(c) => (
            <textarea
              {...c}
              data-cph-text=""
              maxLength={CP_HELP_MAX.text}
              className={textareaClass('min-h-[90px]')}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
              }}
            />
          )}
        </Field>
      </FormGrid>
    </Modal>
  );
}

/** «Облачко обзора» (прототип cphTourDlg). */
function TourDialog({ open, onClose, send, reload, step }: DialogProps & { step: CpTourStep }) {
  const t = useT();
  const id = useId();
  const end = step.sec === 'end';
  const alt = CP_TOUR_ALT_SECS.includes(step.sec);
  const [base, setBase] = useState(step);
  const [title, setTitle] = useState(step.t);
  const [text, setText] = useState(step.x);
  const [x2, setX2] = useState(step.x2 ?? '');
  const [on, setOn] = useState(step.on);
  const [errors, setErrors] = useState<{ t?: string; x?: string }>({});
  const save = useDialogSave(onClose);
  const fill = (s: CpTourStep) => {
    setBase(s);
    setTitle(s.t);
    setText(s.x);
    setX2(s.x2 ?? '');
    setOn(s.on);
  };
  const dirty = title !== base.t || text !== base.x || x2 !== (base.x2 ?? '') || on !== base.on;
  const submit = () => {
    const tt = title.trim();
    const tx = text.trim();
    const next = {
      t: tt ? undefined : t('cph.adm.err.title'),
      x: tx ? undefined : t('cph.adm.err.text'),
    };
    setErrors(next);
    if (next.t || next.x) return;
    void save.run(
      () =>
        send({
          op: 'tour',
          id: step.id,
          t: tt,
          x: tx,
          ...(alt ? { x2: x2.trim() } : base.x2 ? { x2: base.x2 } : {}),
          on: end ? true : on,
        }),
      t('cph.adm.saved.tour'),
      tx,
    );
  };
  const sec = secLabel(t, step.sec);
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      noMax
      dirty={dirty}
      title={t('cph.adm.tour.title')}
      sub={sec}
      footer={<Footer onClose={onClose} onSave={submit} busy={save.saving || save.changed} />}
    >
      {save.changed ? (
        <Changed
          onReload={async () => {
            const s = (await reload())?.tour.find((x) => x.id === step.id);
            if (!s) return;
            fill(s);
            save.setChanged(false);
          }}
        />
      ) : null}
      <Note icon="info">{t('cph.adm.tour.note', { sec })}</Note>
      <FormGrid>
        <Field id={`${id}-t`} label={t('cph.io.col.tour_t')} required full error={errors.t}>
          {(c) => (
            <input
              {...c}
              data-cph-tour-t=""
              maxLength={CP_HELP_MAX.tourTitle}
              className={inputClass()}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field
          id={`${id}-x`}
          label={t('cph.io.col.tour_x')}
          required
          full
          error={errors.x}
          hint={t('cph.adm.tour.x_hint')}
        >
          {(c) => (
            <textarea
              {...c}
              data-cph-tour-x=""
              maxLength={CP_HELP_MAX.tourText}
              className={textareaClass('min-h-[70px]')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        {alt ? (
          <Field
            id={`${id}-x2`}
            label={t('cph.io.col.tour_x2')}
            full
            hint={t(step.sec === 'pay' ? 'cph.adm.tour.x2_pay' : 'cph.adm.tour.x2_files')}
          >
            {(c) => (
              <textarea
                {...c}
                maxLength={CP_HELP_MAX.tourText}
                className={textareaClass('min-h-[60px]')}
                value={x2}
                onChange={(e) => setX2(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {end ? null : (
          <Field id={`${id}-on`} label={t('cph.io.col.tour_on')}>
            {(c) => <Switch id={c.id} checked={on} onChange={setOn} label={t('cph.adm.tour.on')} />}
          </Field>
        )}
      </FormGrid>
    </Modal>
  );
}

/** «Частый вопрос» и «Новый вопрос» (прототип cphFaqDlg). */
function FaqDialog({ open, onClose, send, reload, faq }: DialogProps & { faq: CpFaq | null }) {
  const t = useT();
  const id = useId();
  const blank: Omit<CpFaq, 'id' | 'ord'> = { q: '', a: '', sec: '', act: '', on: true };
  const [base, setBase] = useState(faq ?? blank);
  const [q, setQ] = useState(base.q);
  const [a, setA] = useState(base.a);
  const [sec, setSec] = useState<CpFaqSec>(base.sec);
  const [act, setAct] = useState<CpFaqAct>(base.act);
  const [on, setOn] = useState(base.on);
  const [errors, setErrors] = useState<{ q?: string; a?: string }>({});
  const save = useDialogSave(onClose);
  const dirty =
    q !== base.q || a !== base.a || sec !== base.sec || act !== base.act || on !== base.on;
  const submit = () => {
    const qq = q.trim();
    const aa = cpAnswerLines(a).join('\n');
    const next = {
      q: qq ? undefined : t('cph.adm.err.question'),
      a: aa ? undefined : t('cph.adm.err.answer'),
    };
    setErrors(next);
    if (next.q || next.a) return;
    void save.run(
      () => send({ op: 'faq', ...(faq ? { id: faq.id } : {}), q: qq, a: aa, sec, act, on }),
      t(faq ? 'cph.adm.saved.faq' : 'cph.adm.saved.faq_new'),
      aa,
    );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      dirty={dirty}
      title={t(faq ? 'cph.adm.faq.title' : 'cph.adm.faq.new')}
      sub={faq ? faq.q : t('cph.adm.faq.new_sub')}
      footer={<Footer onClose={onClose} onSave={submit} busy={save.saving || save.changed} />}
    >
      {save.changed ? (
        <Changed
          onReload={async () => {
            const h = await reload();
            const fresh = faq ? h?.faq.find((x) => x.id === faq.id) : null;
            if (!h || fresh === undefined) return;
            if (fresh) {
              setBase(fresh);
              setQ(fresh.q);
              setA(fresh.a);
              setSec(fresh.sec);
              setAct(fresh.act);
              setOn(fresh.on);
            }
            save.setChanged(false);
          }}
        />
      ) : null}
      <FormGrid>
        <Field
          id={`${id}-q`}
          label={t('cph.io.col.q')}
          required
          full
          error={errors.q}
          hint={t('cph.adm.faq.q_hint')}
        >
          {(c) => (
            <input
              {...c}
              data-cph-faq-q=""
              maxLength={CP_HELP_MAX.question}
              className={inputClass()}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
        </Field>
        <Field
          id={`${id}-a`}
          label={t('cph.adm.col.answer')}
          required
          full
          error={errors.a}
          hint={t('cph.adm.faq.a_hint')}
        >
          {(c) => (
            <textarea
              {...c}
              data-cph-faq-a=""
              maxLength={CP_HELP_MAX.answer}
              className={textareaClass('min-h-[110px]')}
              value={a}
              onChange={(e) => setA(e.target.value)}
            />
          )}
        </Field>
        <Field id={`${id}-sec`} label={t('cph.io.col.qsec')} hint={t('cph.adm.faq.sec_hint')}>
          {(c) => (
            <select
              {...c}
              data-cph-faq-sec=""
              className={inputClass()}
              value={sec}
              onChange={(e) => setSec(e.target.value as CpFaqSec)}
            >
              {CP_FAQ_SECS.map((s) => (
                <option key={s} value={s}>
                  {qsecLabel(t, s)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={`${id}-act`} label={t('cph.io.col.act')} hint={t('cph.adm.faq.act_hint')}>
          {(c) => (
            <select
              {...c}
              data-cph-faq-act=""
              className={inputClass()}
              value={act}
              onChange={(e) => setAct(e.target.value as CpFaqAct)}
            >
              {CP_FAQ_ACTS.map((x) => (
                <option key={x} value={x}>
                  {actLabel(t, x)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={`${id}-on`} label={t('cph.io.col.faq_on')}>
          {(c) => <Switch id={c.id} checked={on} onChange={setOn} label={t('cph.adm.faq.on')} />}
        </Field>
      </FormGrid>
    </Modal>
  );
}

/** «Слово «Словарика»» и «Новое слово» (прототип cphGlossDlg). */
function GlossDialog({
  open,
  onClose,
  send,
  reload,
  word,
}: DialogProps & { word: CpGloss | null }) {
  const t = useT();
  const errorText = useErrorText();
  const id = useId();
  const [base, setBase] = useState<CpGloss>(word ?? { w: '', x: '' });
  const [w, setW] = useState(base.w);
  const [x, setX] = useState(base.x);
  const [also, setAlso] = useState(base.also ?? '');
  // «Подчёркивать на странице» (прототип v135): снято — слово остаётся только в «Словарике» «Помощи».
  const [pg, setPg] = useState(base.pg !== false);
  const [errors, setErrors] = useState<{ w?: string; x?: string }>({});
  const save = useDialogSave(onClose);
  const dirty =
    w !== base.w || x !== base.x || also !== (base.also ?? '') || pg !== (base.pg !== false);
  const submit = () => {
    const ww = w.trim();
    const xx = x.trim();
    const aa = also
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');
    const next = {
      w: ww ? undefined : t('cph.adm.err.word'),
      x: xx ? undefined : t('cph.adm.err.gloss_text'),
    };
    setErrors(next);
    if (next.w || next.x) return;
    void save.run(
      () => send({ op: 'gloss', ...(word ? { was: word.w } : {}), w: ww, x: xx, also: aa, pg }),
      t(word ? 'cph.adm.saved.gloss' : 'cph.adm.saved.gloss_new'),
      xx,
      (e) => {
        if (e.code !== 'cph_word_taken') return false;
        setErrors({ w: errorText(e) });
        return true;
      },
    );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      noMax
      dirty={dirty}
      title={t(word ? 'cph.adm.gloss.title' : 'cph.adm.gloss.new')}
      sub={word ? cpHelpCap(word.w) : undefined}
      footer={<Footer onClose={onClose} onSave={submit} busy={save.saving || save.changed} />}
    >
      {save.changed ? (
        <Changed
          onReload={async () => {
            const h = await reload();
            const fresh = word ? h?.gloss.find((g) => g.w === word.w) : null;
            if (!h || fresh === undefined) return;
            if (fresh) {
              setBase(fresh);
              setW(fresh.w);
              setX(fresh.x);
              setAlso(fresh.also ?? '');
              setPg(fresh.pg !== false);
            }
            save.setChanged(false);
          }}
        />
      ) : null}
      <FormGrid>
        <Field
          id={`${id}-w`}
          label={t('cph.io.col.word')}
          required
          full
          error={errors.w}
          hint={t('cph.adm.gloss.w_hint')}
        >
          {(c) => (
            <input
              {...c}
              data-cph-gloss-w=""
              maxLength={CP_HELP_MAX.word}
              className={inputClass()}
              value={w}
              onChange={(e) => {
                setW(e.target.value);
                setErrors({ ...errors, w: undefined });
              }}
            />
          )}
        </Field>
        <Field
          id={`${id}-x`}
          label={t('cph.io.col.gloss_x')}
          required
          full
          error={errors.x}
          hint={t('cph.adm.gloss.x_hint')}
        >
          {(c) => (
            <textarea
              {...c}
              data-cph-gloss-x=""
              maxLength={CP_HELP_MAX.glossText}
              className={textareaClass('min-h-[70px]')}
              value={x}
              onChange={(e) => setX(e.target.value)}
            />
          )}
        </Field>
        <Field
          id={`${id}-also`}
          label={t('cph.io.col.also')}
          full
          hint={t('cph.adm.gloss.also_hint')}
        >
          {(c) => (
            <input
              {...c}
              maxLength={CP_HELP_MAX.also}
              className={inputClass()}
              value={also}
              onChange={(e) => setAlso(e.target.value)}
            />
          )}
        </Field>
        <div className="col-span-full flex flex-col gap-[5px]" data-full="">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              data-cph-gloss-pg=""
              checked={pg}
              onChange={(e) => setPg(e.target.checked)}
            />
            {t('cph.adm.gloss.pg')}
          </label>
          <span className="text-[11.5px] leading-[1.4] text-faint">
            {t('cph.adm.gloss.pg_hint')}
          </span>
        </div>
      </FormGrid>
    </Modal>
  );
}
