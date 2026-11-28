'use client';

import { bishkekDate, DM_REASON_MAX, dmConsoleAutoCp, dmParamDefault } from '@buhuchet/domain';
import type { DmAdminTemplateCard, DmAdminTemplateRow } from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  inputClass,
  Modal,
  useToast,
  type ActionEntry,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState, type ReactNode } from 'react';
import { ApiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { consoleSchemaQuery } from './console-data';
import { consoleTemplatePrefill } from './console-model';
import { consoleOpen, consoleStore } from './console-store';
import type { ConsoleToTemplate } from './console-tab';
import { TemplateEditor } from './tpl-editor';
import { tplOffText, type TplDraft } from './tpl-admin-model';
import {
  copyTemplate,
  DM_TPL_GRID,
  setTemplateState,
  templateCardOf,
  templateCardQuery,
  templateFormQuery,
} from './tpl-admin-data';

/** Окно шаблона: шаблон (нет — новый) и, из консоли, уже вписанные запрос, параметры и столбцы. */
interface EditorData {
  card: DmAdminTemplateCard | null;
  prefill?: Partial<TplDraft>;
}

/** Значения параметров шаблона для консоли (прототип `dmTplToCon`: значение по умолчанию на сегодня). */
function consoleParams(params: TplDraft['params']): Record<string, string> {
  const today = bishkekDate(new Date());
  return Object.fromEntries(params.map((p) => [p.code, dmParamDefault(p.default, today) ?? '']));
}

/**
 * Действия списка «Шаблоны» Админки и их окна (прототип v155 `renderDmTplAdm` → `actions`, `dmEdit`,
 * `dmCopy`, `dmStateDlg`; v166 `dmTplToCon`, `dmcToTpl`): «Открыть» — окно шаблона по свежим данным,
 * «Открыть в консоли» — запрос и параметры во вкладке консоли с именем шаблона, «Копировать» — копия
 * черновиком и сразу её окно, «Отключить» и «Включить» — окно с причиной. `fromConsole` — «Сохранить в
 * шаблон» консоли: обычное окно шаблона, в нём уже запрос, параметры и столбцы последнего запуска; у
 * запроса шаблона — этот шаблон, готовый шаблон платформы — сначала копией. `node` — в разметку экрана.
 */
export function useTemplateActions(): {
  open: (id: string) => Promise<void>;
  create: () => Promise<void>;
  copy: (id: string) => Promise<void>;
  fromConsole: ConsoleToTemplate;
  /** «Открыть в консоли» шаблона по номеру (меню строки, «Заготовки» консоли). */
  toConsole: (id: string) => Promise<void>;
  actions: (row: DmAdminTemplateRow) => ActionEntry[];
  node: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const router = useRouter();
  const { userId } = useShell();
  const [editor, setEditor] = useState<DialogSlot<EditorData> | null>(null);
  const [state, setState] = useState<DialogSlot<{
    card: DmAdminTemplateCard;
    to: 'off' | 'published';
  }> | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) =>
      toast(err instanceof ApiFailure ? errorText(err.error) : t('err.unknown'), {
        bad: true,
        icon: 'alert',
      }),
    [toast, errorText, t],
  );

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['list', DM_TPL_GRID] });
    // Каталог «Вывода» Админки: опубликованный и отключённый шаблон меняет список «Шаблон».
    void client.invalidateQueries({ queryKey: ['dm', 'admin'] });
  }, [client]);

  /** Окно открывается, когда данные загружены (организации и шаблон): фокус сразу в первом поле. */
  const load = useCallback(
    async (id: string | null) => {
      try {
        const [card] = await Promise.all([
          id ? client.fetchQuery(templateCardQuery(id)) : Promise.resolve(null),
          client.fetchQuery(templateFormQuery),
        ]);
        return { card };
      } catch (err) {
        fail(err);
        return null;
      }
    },
    [client, fail],
  );

  const open = useCallback(
    async (id: string) => {
      const got = await load(id);
      if (got) setEditor(openSlot<EditorData>({ card: got.card }));
    },
    [load],
  );

  const create = useCallback(async () => {
    const got = await load(null);
    if (got) setEditor(openSlot<EditorData>({ card: null }));
  }, [load]);

  const copy = useCallback(
    async (id: string) => {
      if (busy) return;
      setBusy(true);
      const res = await copyTemplate(id);
      setBusy(false);
      if (!res.ok) return fail(new ApiFailure(res.status, res.error));
      const card = templateCardOf(res.data);
      refresh();
      if (!card.success) return fail(null);
      toast(t('dm.tpl.copied'), { icon: 'copy' });
      client.setQueryData(templateCardQuery(card.data.id).queryKey, card.data);
      const got = await load(null);
      if (got) setEditor(openSlot<EditorData>({ card: card.data }));
    },
    [busy, fail, refresh, toast, t, client, load],
  );

  /** Запрос шаблона → вкладка консоли этого шаблона; из окна — переход с заменой записи истории. */
  const toConsole = useCallback(
    (card: DmAdminTemplateCard, query: string, params: TplDraft['params'], replace: boolean) => {
      consoleOpen(userId ?? '', {
        sql: query,
        params: consoleParams(params),
        types: Object.fromEntries(params.map((p) => [p.code, p.type])),
        name: card.name,
        tpl: { id: card.id, name: card.name, builtin: card.builtin },
      });
      const href = tabHref('dm', 'con');
      if (replace) router.replace(href);
      else router.push(href);
    },
    [userId, router],
  );

  const openInConsole = useCallback(
    async (id: string) => {
      try {
        const card = await client.fetchQuery(templateCardQuery(id));
        toConsole(card, card.query, card.params, false);
      } catch (err) {
        fail(err);
      }
    },
    [client, toConsole, fail],
  );

  const fromConsole: ConsoleToTemplate = useCallback(
    ({ tab, last }) => {
      void (async () => {
        const got = await load(tab.tpl?.id ?? null);
        if (!got) return;
        const had = got.card;
        // Автостолбец «Контрагент» (этап 2, П7; прототип `dmcToTpl` → `dmcAutoCp`): новый шаблон или
        // шаблон «Для организаций» — в запрос основного SELECT добавляется contractor_id, если его нет.
        const index =
          !had || had.audience === 'org'
            ? await client.fetchQuery(consoleSchemaQuery).catch(() => null)
            : null;
        const auto = index ? dmConsoleAutoCp(tab.sql, index.tables) : null;
        const sql = auto?.added ? auto.sql : tab.sql;
        if (auto?.added) {
          consoleStore.patch(tab.id, { sql });
          toast(
            had
              ? t('dm.con.cp_auto')
              : t('dm.con.cp_auto_mod', { module: t(`dm.mod.${auto.module}`) }),
            { icon: 'layers' },
          );
        }
        const cpName = t('dm.ed.cp_col');
        const prefillOf = (h: Parameters<typeof consoleTemplatePrefill>[2]) => {
          const pre = consoleTemplatePrefill(sql, last, h);
          // contractor_id — вид «Контрагент», название «Контрагент (для области …)»; добавленный — первым.
          const own = new Set(h?.columns.map((c) => c.code));
          const cols = pre.columns.map((c) =>
            c.code === 'contractor_id' && !own.has(c.code)
              ? { ...c, name: cpName, type: 'cp' as const, total: false }
              : c,
          );
          const columns = auto?.added
            ? [
                ...cols.filter((c) => c.code === 'contractor_id'),
                ...cols.filter((c) => c.code !== 'contractor_id'),
              ]
            : cols;
          return { ...pre, columns };
        };
        if (had?.builtin) {
          // Готовый шаблон платформы — только копией (прототип `dmcToTpl`): копия и её окно с запросом.
          const res = await copyTemplate(had.id);
          if (!res.ok) return fail(new ApiFailure(res.status, res.error));
          const copied = templateCardOf(res.data);
          refresh();
          if (!copied.success) return fail(null);
          client.setQueryData(templateCardQuery(copied.data.id).queryKey, copied.data);
          consoleStore.patch(tab.id, {
            tpl: { id: copied.data.id, name: copied.data.name, builtin: false },
          });
          toast(t('dm.con.tpl_copy'), { icon: 'copy' });
          const pre = prefillOf(copied.data);
          return setEditor(
            openSlot<EditorData>({
              card: copied.data,
              prefill: { query: pre.query, params: pre.params },
            }),
          );
        }
        const pre = prefillOf(had);
        const prefill: Partial<TplDraft> = had
          ? {
              query: pre.query,
              params: pre.params,
              ...(had.state === 'draft' && pre.columns.length ? { columns: pre.columns } : {}),
            }
          : {
              query: pre.query,
              params: pre.params,
              ...(pre.columns.length ? { columns: pre.columns } : {}),
              ...(tab.notes ? { name: tab.name } : {}),
              ...(auto ? { module: auto.module, needPermission: auto.fee ? 'fee' : null } : {}),
            };
        setEditor(openSlot<EditorData>({ card: had, prefill }));
      })();
    },
    [load, fail, refresh, client, toast, t],
  );

  /** «Отключить» и «Включить» — по свежему шаблону: версия записи и токены по организациям. */
  const askState = useCallback(
    async (id: string, to: 'off' | 'published') => {
      try {
        const card = await client.fetchQuery(templateCardQuery(id));
        setState(openSlot({ card, to }));
      } catch (err) {
        fail(err);
      }
    },
    [client, fail],
  );

  const actions = (row: DmAdminTemplateRow): ActionEntry[] => [
    { id: 'open', label: t('dm.tpl.act.open'), icon: 'edit', run: () => void open(row.id) },
    {
      id: 'console',
      label: t('dm.tpl.act.console'),
      icon: 'code',
      run: () => void openInConsole(row.id),
    },
    { id: 'copy', label: t('dm.tpl.act.copy'), icon: 'copy', run: () => void copy(row.id) },
    ...(row.canOn
      ? [
          {
            id: 'on',
            label: t('dm.tpl.act.on'),
            icon: 'check' as const,
            run: () => void askState(row.id, 'published'),
          },
        ]
      : row.canOff
        ? [
            {
              id: 'off',
              label: t('dm.tpl.act.off'),
              icon: 'ban' as const,
              run: () => void askState(row.id, 'off'),
            },
          ]
        : []),
  ];

  const node = (
    <>
      {editor ? (
        <TemplateEditor
          key={`dm-tpl-${editor.n}`}
          card={editor.data.card}
          prefill={editor.data.prefill}
          open={editor.open}
          onClose={() => setEditor((x) => closeSlot(x))}
          onSaved={refresh}
          onConsole={(card, draft) => {
            setEditor((x) => closeSlot(x));
            toConsole(card, draft.query, draft.params, true);
          }}
          onCopy={(id) => {
            setEditor((x) => closeSlot(x));
            void copy(id);
          }}
        />
      ) : null}
      {state ? (
        <StateDialog
          key={`dm-tpl-state-${state.n}`}
          card={state.data.card}
          to={state.data.to}
          open={state.open}
          onClose={() => setState((x) => closeSlot(x))}
          onDone={() => {
            setState((x) => closeSlot(x));
            refresh();
          }}
        />
      ) : null}
    </>
  );

  return { open, create, copy, fromConsole, toConsole: openInConsole, actions, node };
}

/** «Отключить шаблон?» и «Включить шаблон?» с причиной (прототип `dmStateDlg`). */
function StateDialog({
  card,
  to,
  open,
  onClose,
  onDone,
}: {
  card: DmAdminTemplateCard;
  to: 'off' | 'published';
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const off = to === 'off';

  const send = async () => {
    const value = reason.trim();
    if (!value) {
      setError(t('err.dm_reason_required'));
      return document.getElementById(`${id}-reason`)?.focus();
    }
    setBusy(true);
    const res = await setTemplateState(card.id, { to, reason: value, version: card.version });
    setBusy(false);
    if (!res.ok) {
      if (res.error.code === 'dm_reason_required') return setError(errorText(res.error));
      onDone();
      return toast(errorText(res.error), { bad: true, icon: 'alert' });
    }
    onDone();
    toast(t(off ? 'dm.tpl.off.done' : 'dm.tpl.on.done'), { icon: off ? 'ban' : 'check' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t(off ? 'dm.tpl.off.title' : 'dm.tpl.on.title')}
      sub={card.name}
      dirty={reason.trim() !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass(off ? 'danger' : 'cta')}
            disabled={busy}
            data-dm-tpl-state-ok=""
            onClick={() => void send()}
          >
            {t(off ? 'dm.tpl.act.off' : 'dm.tpl.act.on')}
          </button>
        </>
      }
    >
      <div data-dm-tpl-state={to} className="flex flex-col gap-2.5">
        <p className="m-0 text-muted">
          {off ? tplOffText(t, card.toks, card.tokOrgs) : t('dm.tpl.on.text')}
        </p>
        <FormGrid>
          <Field id={`${id}-reason`} label={t('dm.tpl.reason')} required error={error} full>
            {(control) => (
              <textarea
                {...control}
                className={`${inputClass({ multiline: true })} min-h-[60px]`}
                value={reason}
                maxLength={DM_REASON_MAX}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(undefined);
                }}
              />
            )}
          </Field>
        </FormGrid>
      </div>
    </Modal>
  );
}
