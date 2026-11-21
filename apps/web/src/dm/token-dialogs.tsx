'use client';

import { bishkekDate, DM_TOKEN_NAME_MAX, formatDateRu, formatMomentRu } from '@buhuchet/domain';
import type {
  DmTokenCard,
  DmTokenForm,
  DmTokenIssued,
  DmTokenRow,
  DmTokenTemplateOption,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  ConfirmDialog,
  Field,
  Hint,
  Icon,
  inputClass,
  KeyValues,
  MiniTable,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  Segments,
  useToast,
  type ActionEntry,
  type KeyValueItem,
  type MiniRow,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useState } from 'react';
import { ApiFailure, type ApiResult } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useCopyText } from '../kb/video/video-copy';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { HowBox } from './how-box';
import {
  DM_TOKEN_GRID,
  issuedOf,
  issueToken,
  reissueToken,
  revokeToken,
  tokenCardQuery,
  tokenFormQuery,
  type DmSide,
} from './tokens-data';
import { TOKEN_PILL, tokenTermText } from './tokens-model';

const NUM = 'tabular-nums';
const DASH = <span className="text-faint">—</span>;
const moment = (iso: string) => formatMomentRu(new Date(iso));

/** «Действует» и пояснение под ним (прототип `pill(s, DM_TST)` и `dmTokSt`). */
export function TokenStatePill({ t, state }: { t: Translate; state: DmTokenRow['state'] }) {
  return (
    <Pill tone={TOKEN_PILL[state].tone} icon={TOKEN_PILL[state].icon}>
      {t(`dm.tok.state.${state}`)}
    </Pill>
  );
}

/** Группы поля «Шаблон» (прототип `dmOptHtml`): у Админки — «Для администратора», у организации — модуль. */
function templateGroups(t: Translate, side: DmSide, list: readonly DmTokenTemplateOption[]) {
  const groups: { label: string; items: DmTokenTemplateOption[] }[] = [];
  for (const tpl of list) {
    const label =
      side === 'admin' || tpl.module === null
        ? t(side === 'admin' ? 'dm.group.admin' : 'dm.mod.other')
        : t(`dm.mod.${tpl.module}`);
    let group = groups.find((g) => g.label === label);
    if (!group) groups.push((group = { label, items: [] }));
    group.items.push(tpl);
  }
  return groups;
}

/**
 * «Новый API-токен» (прототип `dmNewDlg`): шаблон, название и срок. Название проверяется сразу на
 * пустоту, остальное — сервером: ошибка поля встаёт под поле, другая — уведомлением.
 */
function NewTokenDialog({
  side,
  form,
  initialTemplateId,
  open,
  onClose,
  onIssued,
}: {
  side: DmSide;
  form: DmTokenForm;
  /** Шаблон, выбранный сразу (из каталога шаблонов, прототип `dmNewTok(tplId)`); нет в списке — первый. */
  initialTemplateId?: string;
  open: boolean;
  onClose: () => void;
  onIssued: (issued: DmTokenIssued) => void;
}) {
  const t = useT();
  const id = useId();
  const toast = useToast();
  const errorText = useErrorText();
  const [templateId, setTemplateId] = useState(
    form.templates.some((x) => x.id === initialTemplateId)
      ? initialTemplateId!
      : (form.templates[0]?.id ?? ''),
  );
  const [name, setName] = useState('');
  const [term, setTerm] = useState(form.defaultTerm);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; template?: string }>({});
  const groups = templateGroups(t, side, form.templates);

  const submit = async () => {
    const text = name.trim();
    if (!text) return setErrors({ name: t('err.dm_token_name_required') });
    setBusy(true);
    const res = await issueToken(side, { templateId, name: text, term });
    setBusy(false);
    if (!res.ok) {
      const code = res.error.code;
      if (code.startsWith('dm_token_name')) return setErrors({ name: errorText(res.error) });
      if (code === 'dm_token_template') return setErrors({ template: errorText(res.error) });
      return toast(errorText(res.error), { bad: true });
    }
    const issued = issuedOf(res.data);
    if (!issued.success) return toast(t('err.unknown'), { bad: true });
    onIssued(issued.data);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('dm.tok.new.title')}
      sub={t(side === 'admin' ? 'dm.tok.new.sub_admin' : 'dm.tok.new.sub_org')}
      dirty={name.trim() !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void submit()}
            data-dm-new-ok=""
          >
            {t('dm.tok.new.ok')}
          </button>
        </>
      }
    >
      <div data-dm-new="" className="flex flex-col gap-3">
        <Field
          id={`${id}-tpl`}
          label={t('dm.tok.new.tpl')}
          required
          full
          hint={t('dm.tok.new.tpl_hint')}
          error={errors.template}
        >
          {(control) => (
            <select
              {...control}
              className={inputClass()}
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setErrors((x) => ({ ...x, template: undefined }));
              }}
            >
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
        <Field
          id={`${id}-name`}
          label={t('dm.tok.new.name')}
          required
          full
          hint={t('dm.tok.new.name_hint')}
          error={errors.name}
        >
          {(control) => (
            <input
              {...control}
              className={inputClass()}
              value={name}
              maxLength={DM_TOKEN_NAME_MAX}
              placeholder={t('dm.tok.new.name_ph')}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((x) => ({ ...x, name: undefined }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          )}
        </Field>
        <Field id={`${id}-term`} label={t('dm.tok.new.term')} full hint={t('dm.tok.new.term_hint')}>
          <Segments<string>
            label={t('dm.tok.new.term')}
            options={form.terms.map((d) => ({ value: `${d}`, label: tokenTermText(t, d) }))}
            value={`${term}`}
            onChange={(d) => setTerm(Number(d))}
          />
        </Field>
      </div>
    </Modal>
  );
}

/** «Скопируйте токен. Больше он не покажется» (прототип `dmShowTok`): токен целиком — только здесь. */
function TokenShownDialog({
  issued,
  open,
  onClose,
}: {
  issued: DmTokenIssued;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const copier = useCopyText();
  const k = issued.item;
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        kind="message"
        size="wide"
        sticky
        noMax
        title={t('dm.tok.show.title')}
        sub={t('dm.tok.show.sub', {
          name: k.name,
          tpl: k.tplName,
          till: formatDateRu(bishkekDate(new Date(k.till))),
        })}
        footer={
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('dm.tok.show.done')}
          </button>
        }
      >
        <div
          data-dm-token=""
          className="flex flex-wrap items-center gap-2.5 rounded-xl border border-dashed border-line bg-pane-alt p-3"
        >
          <code
            data-dm-token-value=""
            className={`${MONO_CLASS} min-w-0 flex-[1_1_280px] text-[13px] [overflow-wrap:anywhere]`}
          >
            {issued.token}
          </code>
          <button
            type="button"
            className={buttonClass('cta')}
            data-dm-token-copy=""
            onClick={() => void copier.copy(issued.token, t('dm.tok.show.copied'))}
          >
            <Icon name="copy" size="sm" />
            {t('dm.tok.show.copy')}
          </button>
        </div>
        <Hint>{t('dm.tok.show.hint', { prefix: k.prefix })}</Hint>
        {k.how ? <HowBox how={k.how} token={issued.token} /> : null}
      </Modal>
      {copier.node}
    </>
  );
}

function journalRows(t: Translate, card: DmTokenCard): MiniRow[] {
  return card.log.items.map((x, i) => ({
    key: `${x.at}-${i}`,
    cells: {
      at: <span className={NUM}>{moment(x.at)}</span>,
      params: <span className={MONO_CLASS}>{x.params || '—'}</span>,
      rows: x.rows ?? '—',
      ms: x.ms ?? '—',
      res: (
        <>
          <Pill tone={x.ok ? 'ok' : 'bad'} icon={x.ok ? 'check' : 'alert'}>
            {t(x.ok ? 'dm.res.ok' : 'dm.res.error')}
          </Pill>
          {x.error ? <div className="text-[12px] text-faint">{x.error}</div> : null}
        </>
      ),
      ip: <span className={MONO_CLASS}>{x.ip ?? '—'}</span>,
    },
    wide: ['params'],
  }));
}

/** Окно токена (прототип `dmTokDlg`): сведения, «Как подключить» у своего действующего, журнал (последние 50), действия. */
function TokenCardDialog({
  side,
  id,
  open,
  onClose,
  onReissue,
  onRevoke,
}: {
  side: DmSide;
  id: string;
  open: boolean;
  onClose: () => void;
  onReissue: (row: DmTokenRow) => void;
  onRevoke: (row: DmTokenRow) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const query = useQuery(tokenCardQuery(side, id));
  const k = query.data;
  const info: KeyValueItem[] = k
    ? [
        {
          id: 'st',
          label: t('dm.tok.col.st'),
          value: (
            <>
              <TokenStatePill t={t} state={k.state} />
              {k.note ? <span className="text-faint"> {k.note}</span> : null}
            </>
          ),
        },
        {
          id: 'token',
          label: t('dm.tok.col.token'),
          value: <span className={MONO_CLASS}>{`${k.prefix}…`}</span>,
        },
        { id: 'tpl', label: t('dm.tok.col.tpl'), value: k.tplName },
        ...(side === 'admin' ? [{ id: 'org', label: t('dm.tok.col.org'), value: k.orgName }] : []),
        { id: 'by', label: t('dm.tok.col.by'), value: k.byName || DASH },
        {
          id: 'at',
          label: t('dm.tok.col.at'),
          value: <span className={NUM}>{moment(k.createdAt)}</span>,
        },
        {
          id: 'till',
          label: t('dm.tok.col.till'),
          value: <span className={NUM}>{moment(k.till)}</span>,
        },
        {
          id: 'last',
          label: t('dm.tok.col.last'),
          value: k.lastAt ? (
            <>
              <span className={NUM}>{moment(k.lastAt)}</span>
              {k.lastIp ? (
                <>
                  {' · '}
                  <span className={MONO_CLASS}>{k.lastIp}</span>
                </>
              ) : null}
            </>
          ) : (
            DASH
          ),
        },
        { id: 'n30', label: t('dm.tok.col.n30'), value: String(k.n30) },
        ...(k.prevPrefix
          ? [
              {
                id: 'prev',
                label: t('dm.tok.col.prev'),
                value: <span className={MONO_CLASS}>{`${k.prevPrefix}…`}</span>,
              },
            ]
          : []),
      ]
    : [];
  const sub = k ? (side === 'admin' ? `${k.tplName} · ${k.orgName}` : k.tplName) : undefined;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={k?.name ?? t('dm.tok.act.open')}
      sub={sub}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.close')}
          </button>
          {k?.canReissue ? (
            <button
              type="button"
              className={buttonClass()}
              data-dm-card-reissue=""
              onClick={() => onReissue(k)}
            >
              <Icon name="refresh" size="sm" />
              {t('dm.tok.act.reissue')}
            </button>
          ) : null}
          {k?.canRevoke ? (
            <button
              type="button"
              className={buttonClass('danger')}
              data-dm-card-revoke=""
              onClick={() => onRevoke(k)}
            >
              <Icon name="ban" size="sm" />
              {t('dm.tok.act.revoke')}
            </button>
          ) : null}
        </>
      }
    >
      <div data-dm-card={id} className="flex min-w-0 flex-col gap-2.5">
        {query.isError ? (
          <Note tone="bad">
            {query.error instanceof ApiFailure ? errorText(query.error.error) : t('err.unknown')}
          </Note>
        ) : null}
        {k ? (
          <>
            <Box>
              <KeyValues items={info} />
            </Box>
            {k.how ? <HowBox how={k.how} token={`${k.prefix}…`} /> : null}
            <Box title={t('dm.tok.log.title', { n: k.log.total })}>
              <MiniTable
                label={t('dm.tok.log.title', { n: k.log.total })}
                empty={t('dm.tok.log.empty')}
                columns={[
                  { key: 'at', label: t('dm.tok.log.at'), width: 140 },
                  { key: 'params', label: t('dm.tok.log.params') },
                  { key: 'rows', label: t('dm.tok.log.rows'), numeric: true, width: 80 },
                  { key: 'ms', label: t('dm.tok.log.ms'), numeric: true, width: 90 },
                  { key: 'res', label: t('dm.tok.log.res'), width: 130 },
                  { key: 'ip', label: t('dm.tok.log.ip'), width: 130 },
                ]}
                rows={journalRows(t, k)}
              />
              <Hint>{t('dm.tok.log.keep')}</Hint>
            </Box>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Действия «API Токенов» для экрана (прототип `renderDmTok` → `actions`, `dmNewDlg`, `dmRevoke`,
 * `dmReissue`): меню строки, «+ Токен», окно токена и подтверждения. `node` ставится в разметку экрана.
 * Что можно, решает сервер (`canReissue`, `canRevoke`, `refusal` окна) — кнопки только по нему.
 */
/** Через столько после «Готово» показанный токен забывается (окно к этому времени закрылось). */
const SHOWN_FORGET_MS = 1000;

export function useTokenActions(side: DmSide) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [form, setForm] = useState<DialogSlot<{
    form: DmTokenForm;
    templateId: string | undefined;
  }> | null>(null);
  const [shown, setShown] = useState<DialogSlot<DmTokenIssued> | null>(null);
  const [card, setCard] = useState<DialogSlot<string> | null>(null);
  const [askRevoke, setAskRevoke] = useState<DmTokenRow | null>(null);
  const [askReissue, setAskReissue] = useState<DmTokenRow | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['list', DM_TOKEN_GRID[side]] });
    void client.invalidateQueries({ queryKey: ['dm', side] });
  }, [client, side]);

  const open = useCallback((id: string) => setCard(openSlot(id)), []);

  /** «+ Токен» (`templateId` — выбрать шаблон сразу, как «Выпустить токен» в каталоге шаблонов). */
  const issue = useCallback(
    async (templateId?: string) => {
      let data: DmTokenForm;
      try {
        data = await client.fetchQuery({ ...tokenFormQuery(side), staleTime: 0 });
      } catch (err) {
        return toast(err instanceof ApiFailure ? errorText(err.error) : t('err.unknown'), {
          bad: true,
        });
      }
      if (data.refusal) {
        return toast(errorText({ code: data.refusal, message: '', details: { max: data.max } }), {
          icon: data.refusal === 'dm_token_limit' ? 'alert' : 'lock',
          bad: true,
        });
      }
      // «Выпустить токен» у шаблона, к которому вошедшему токен не выпустить (область «Свои»):
      // не подставлять молча другой шаблон, а сказать почему.
      // ОТКЛОНЕНИЕ: docs/deviations.md#Т-26
      if (templateId && !data.templates.some((x) => x.id === templateId)) {
        return toast(errorText({ code: 'dm_token_template', message: '' }), {
          icon: 'lock',
          bad: true,
        });
      }
      setForm(openSlot({ form: data, templateId }));
    },
    [client, side, toast, errorText, t],
  );

  const issued = useCallback(
    (x: DmTokenIssued) => {
      setForm(closeSlot);
      setCard(closeSlot);
      refresh();
      setShown(openSlot(x));
    },
    [refresh],
  );

  const run = async (fetch: () => Promise<ApiResult<unknown>>) => {
    if (busy) return null;
    setBusy(true);
    try {
      return await fetch();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: DmTokenRow) => {
    const res = await run(() => revokeToken(side, row.id));
    if (!res) return;
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t('dm.tok.revoke.done'), { icon: 'ban' });
  };

  const reissue = async (row: DmTokenRow) => {
    const res = await run(() => reissueToken(side, row.id));
    if (!res) return;
    if (!res.ok) {
      refresh();
      return toast(errorText(res.error), { bad: true });
    }
    const x = issuedOf(res.data);
    if (!x.success) return toast(t('err.unknown'), { bad: true });
    issued(x.data);
  };

  const actions = (row: DmTokenRow): ActionEntry[] => [
    { id: 'open', label: t('dm.tok.act.open'), icon: 'eye', run: () => open(row.id) },
    ...(row.canReissue
      ? [
          {
            id: 'reissue',
            label: t('dm.tok.act.reissue'),
            icon: 'refresh' as const,
            run: () => setAskReissue(row),
          },
        ]
      : []),
    ...(row.canRevoke
      ? [
          {
            id: 'revoke',
            label: t('dm.tok.act.revoke'),
            icon: 'ban' as const,
            run: () => setAskRevoke(row),
          },
        ]
      : []),
  ];

  const node = (
    <>
      {form ? (
        <NewTokenDialog
          key={`dm-new-${form.n}`}
          side={side}
          form={form.data.form}
          initialTemplateId={form.data.templateId}
          open={form.open}
          onClose={() => setForm(closeSlot)}
          onIssued={issued}
        />
      ) : null}
      {shown ? (
        <TokenShownDialog
          key={`dm-shown-${shown.n}`}
          issued={shown.data}
          open={shown.open}
          onClose={() => {
            setShown(closeSlot);
            // Токен целиком не держим в памяти страницы дольше, чем закрывается окно.
            const n = shown.n;
            setTimeout(
              () => setShown((s) => (s && s.n === n && !s.open ? null : s)),
              SHOWN_FORGET_MS,
            );
          }}
        />
      ) : null}
      {card ? (
        <TokenCardDialog
          key={`dm-card-${card.n}`}
          side={side}
          id={card.data}
          open={card.open}
          onClose={() => setCard(closeSlot)}
          onReissue={(row) => {
            // Как в прототипе: окно токена закрывается, остаётся вопрос.
            setCard(closeSlot);
            setAskReissue(row);
          }}
          onRevoke={(row) => {
            setCard(closeSlot);
            setAskRevoke(row);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={askRevoke !== null}
        onClose={() => setAskRevoke(null)}
        title={t('dm.tok.revoke.title')}
        text={
          askRevoke && !askRevoke.mine
            ? t('dm.tok.revoke.text_other', { name: askRevoke.name, org: askRevoke.orgName })
            : t('dm.tok.revoke.text', { name: askRevoke?.name ?? '' })
        }
        ok={t('dm.tok.revoke.ok')}
        danger
        onConfirm={() => askRevoke && void revoke(askRevoke)}
      />
      <ConfirmDialog
        open={askReissue !== null}
        onClose={() => setAskReissue(null)}
        title={t('dm.tok.reissue.title')}
        text={t('dm.tok.reissue.text', { prefix: askReissue?.prefix ?? '' })}
        ok={t('dm.tok.reissue.ok')}
        onConfirm={() => askReissue && void reissue(askReissue)}
      />
    </>
  );

  return { open, issue, actions, node };
}
