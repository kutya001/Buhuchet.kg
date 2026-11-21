'use client';

import { DM_REASON_MAX } from '@buhuchet/domain';
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
import { useCallback, useId, useState, type ReactNode } from 'react';
import { ApiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { TemplateEditor } from './tpl-editor';
import { tplOffText } from './tpl-admin-model';
import {
  copyTemplate,
  DM_TPL_GRID,
  setTemplateState,
  templateCardOf,
  templateCardQuery,
  templateFormQuery,
} from './tpl-admin-data';

/**
 * Действия списка «Шаблоны» Админки и их окна (прототип v155 `renderDmTplAdm` → `actions`, `dmEdit`,
 * `dmCopy`, `dmStateDlg`): «Открыть» — окно шаблона по свежим данным, «Копировать» — копия черновиком
 * и сразу её окно, «Отключить» и «Включить» — окно с причиной. `node` — в разметку экрана.
 */
export function useTemplateActions(): {
  open: (id: string) => Promise<void>;
  create: () => Promise<void>;
  copy: (id: string) => Promise<void>;
  actions: (row: DmAdminTemplateRow) => ActionEntry[];
  node: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [editor, setEditor] = useState<DialogSlot<DmAdminTemplateCard | null> | null>(null);
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
      if (got) setEditor(openSlot<DmAdminTemplateCard | null>(got.card));
    },
    [load],
  );

  const create = useCallback(async () => {
    const got = await load(null);
    if (got) setEditor(openSlot<DmAdminTemplateCard | null>(null));
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
      if (got) setEditor(openSlot<DmAdminTemplateCard | null>(card.data));
    },
    [busy, fail, refresh, toast, t, client, load],
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
          card={editor.data}
          open={editor.open}
          onClose={() => setEditor((x) => closeSlot(x))}
          onSaved={refresh}
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

  return { open, create, copy, actions, node };
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
