'use client';

import {
  DM_COLUMN_TYPES,
  DM_DESCRIPTION_MAX,
  DM_LABEL_MAX,
  DM_MODULES,
  DM_NAME_MAX,
  DM_PARAM_DEFAULTS,
  DM_PARAM_TYPES,
  DM_QUERY_MAX,
} from '@buhuchet/domain';
import type { DmAdminTemplateCard, DmTemplateCheckResult } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CHECKBOX_CLASS,
  CheckRow,
  ConfirmDialog,
  Field,
  FormGrid,
  Icon,
  inputClass,
  MiniTable,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  RecordChangedNotice,
  Timeline,
  useToast,
  useWindow,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { tabHref } from '../shell/modules';
import { checkConsole, consoleSchemaQuery } from './console-data';
import { SqlEditor } from './sql-editor';
import {
  checkResultOf,
  checkTemplate,
  createTemplate,
  saveTemplate,
  templateCardOf,
  templateCardQuery,
  templateFormQuery,
} from './tpl-admin-data';
import {
  TPL_PARAM_TYPE_KEY,
  TPL_PILL,
  tplAfterCheck,
  tplBody,
  tplCheckedQuery,
  tplCheckTable,
  tplCheckText,
  tplDirty,
  tplDraftOf,
  tplErrorField,
  tplFieldProblems,
  tplHint,
  tplHistoryItems,
  tplLocked,
  tplOrgsMissing,
  tplQueryChecked,
  tplSaveWarnText,
  type TplDraft,
  type TplField,
} from './tpl-admin-model';

type CheckOk = Extract<DmTemplateCheckResult, { ok: true }>;
type Errors = Partial<Record<TplField, string>>;

/** Порядок полей окна — для фокуса на первой ошибке. */
const FIELD_ORDER: readonly TplField[] = ['name', 'code', 'audience', 'module', 'query'];

/** Ячейки таблиц «Параметры» и «Столбцы» (прототип `.dm-pt`). */
const TH = 'border-b border-line px-1.5 py-1.5 text-left text-[11.5px] font-[650] text-faint';
const TD = 'border-b border-line px-1.5 py-1 align-middle';
const CELL_INPUT = `${inputClass()} !min-h-[30px] !px-2 !py-1 !text-[12.5px]`;
const CELL_SELECT = `${CELL_INPUT} min-w-[108px]`;

/**
 * Окно шаблона Админки (доработки 20.11.2026: Витрина данных, блок 2, пункты 2–7; блок 3, пункт 1;
 * общий план 20.11, этап 2, П7; прототип v155 `dmEdit`): слева поля, запрос и «Проверить» на
 * организации (первые 100 строк, время, число строк; ошибка — текстом базы под запросом), справа
 * параметры и столбцы из запроса, таблицы и поля базы, история. «Опубликовать» — только после
 * «Проверить» именно этого текста; сервер проверяет запрос сам. Готовый шаблон только смотрят и
 * проверяют — изменить копией. У опубликованного код и вид не меняются, столбцы только добавляются.
 */
export function TemplateEditor({
  card: first,
  open,
  onClose,
  onSaved,
  onCopy,
  prefill,
  onConsole,
}: {
  card: DmAdminTemplateCard | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCopy: (id: string) => void;
  /** «Сохранить в шаблон» из консоли: запрос, параметры и столбцы уже в окне (окно — с изменениями). */
  prefill?: Partial<TplDraft>;
  /** «Открыть в консоли» (блок 4, пункт 3): запрос и параметры окна — во вкладку консоли. */
  onConsole?: (card: DmAdminTemplateCard, draft: TplDraft) => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const form = useQuery(templateFormQuery);
  const orgs = useMemo(() => form.data?.orgs ?? [], [form.data]);

  const [card, setCard] = useState(first);
  const [initial, setInitial] = useState(() => tplDraftOf(t, first));
  const [draft, setDraft] = useState(() => (prefill ? { ...initial, ...prefill } : initial));
  const schema = useQuery(consoleSchemaQuery);
  const [checked, setChecked] = useState(() => tplCheckedQuery(first));
  const [checkOrg, setCheckOrg] = useState<string | null>(null);
  const [result, setResult] = useState<CheckOk | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<'check' | 'save' | null>(null);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [warn, setWarn] = useState<boolean | null>(null);

  const builtin = !!card?.builtin;
  const locked = tplLocked(card);
  const org = draft.audience === 'org';
  // Шаблон «Для организаций»: запрещённое — словами шаблона (прототип `dmcIssues` с `org`).
  const checkOrgSql = useCallback(
    async (query: string) =>
      (await checkConsole(query)).map((p) =>
        p.code === 'dm_console_forbidden'
          ? { ...p, message: t('err.dm_sql_forbidden', { word: query.slice(p.from, p.to) }) }
          : p,
      ),
    [t],
  );
  const orgId = checkOrg ?? orgs[0]?.id ?? null;
  const canPublish = tplQueryChecked(checked, draft.query);
  const fid = (f: string) => `${id}-${f}`;

  const patch = (p: Partial<TplDraft>, field?: TplField) => {
    setDraft((d) => ({ ...d, ...p }));
    if (field) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const showErrors = (next: Errors) => {
    setErrors(next);
    const firstField = FIELD_ORDER.find((f) => next[f]);
    if (firstField) document.getElementById(fid(firstField))?.focus();
  };

  /** Отказ сервера: под своим полем, «запись изменена» — над окном, остальное — уведомлением. */
  const refusal = (error: { code: string; message: string; details?: unknown }) => {
    if (error.code === 'record_changed') return setChanged(true);
    const field = tplErrorField(error.code);
    if (field) return showErrors({ [field]: errorText(error) });
    toast(errorText(error), { bad: true, icon: 'alert' });
  };

  const check = async () => {
    if (busy) return;
    const query = draft.query;
    setErrors((e) => ({ ...e, query: undefined }));
    setBusy('check');
    const res = await checkTemplate({
      templateId: card?.id ?? null,
      audience: draft.audience,
      query,
      params: draft.params,
      columns: draft.columns,
      checkOrgId: org ? orgId : null,
    });
    setBusy(null);
    if (!res.ok) return refusal(res.error);
    const parsed = checkResultOf(res.data);
    if (!parsed.success) return toast(t('err.unknown'), { bad: true, icon: 'alert' });
    const r = parsed.data;
    setDraft((d) => tplAfterCheck(d, r));
    if (r.ok) {
      setChecked(query);
      setResult(r);
    } else {
      setResult(null);
      showErrors({ query: r.message });
    }
  };

  const send = async (publish: boolean) => {
    setBusy('save');
    const body = tplBody(draft, { publish, checkOrgId: orgId });
    const res = card
      ? await saveTemplate(card.id, { ...body, version: card.version })
      : await createTemplate(body);
    setBusy(null);
    if (!res.ok) return refusal(res.error);
    const saved = templateCardOf(res.data);
    onSaved();
    onClose();
    if (!saved.success) return;
    client.setQueryData(templateCardQuery(saved.data.id).queryKey, saved.data);
    const nowPublished = saved.data.state === 'published' && card?.state !== 'published';
    toast(t(nowPublished ? 'dm.ed.published' : 'dm.ed.saved'), {
      icon: saved.data.state === 'published' ? 'check' : 'edit',
    });
  };

  /** «Сохранить» и «Опубликовать» (прототип `save`). */
  const save = (publish: boolean) => {
    if (busy) return;
    const problems = tplFieldProblems(draft);
    const next: Errors = {};
    for (const f of FIELD_ORDER) {
      const key = problems[f];
      if (key) next[f] = t(key);
    }
    if (Object.keys(next).length) return showErrors(next);
    if (tplOrgsMissing(draft)) {
      return toast(t('err.dm_orgs_required'), { bad: true, icon: 'alert' });
    }
    const queryChanged = !card || card.query !== draft.query;
    if ((publish || (locked && queryChanged)) && !canPublish) {
      return showErrors({ query: t('err.dm_check_required') });
    }
    // Опубликованный с действующими токенами: их программы сразу получат новый результат.
    if (card && card.state === 'published' && card.toks > 0) return setWarn(publish);
    void send(publish);
  };

  const reload = async () => {
    if (!card) return;
    setReloading(true);
    try {
      const fresh = await client.fetchQuery(templateCardQuery(card.id));
      const next = tplDraftOf(t, fresh);
      setCard(fresh);
      setInitial(next);
      setDraft(next);
      setChecked(tplCheckedQuery(fresh));
      setResult(null);
      setErrors({});
      setChanged(false);
    } catch {
      toast(t('err.unknown'), { bad: true, icon: 'alert' });
    } finally {
      setReloading(false);
    }
  };

  const sub = card ? (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Pill tone={TPL_PILL[card.state].tone} icon={TPL_PILL[card.state].icon}>
        {t(`dm.tpl.state.${card.state}`)}
      </Pill>
      <span className={MONO_CLASS}>{card.code}</span>
      {builtin ? <span>{`· ${t('dm.ed.builtin_sub')}`}</span> : null}
      {card.toks ? <span>{`· ${t('dm.ed.toks_sub', { n: card.toks })}`}</span> : null}
      {/* Окно открыто из консоли с другим запросом (доработки 27.11.2026: консоль запросов, блок 4,
          пункт 5; прототип v166 `dmEdit` — только при `sqlEd`). */}
      {!builtin && prefill && card.query !== draft.query ? (
        <span data-dm-ed-changed="">
          <Pill tone="warn">{t('dm.ed.sql_changed')}</Pill>
        </span>
      ) : null}
    </span>
  ) : prefill ? (
    t('dm.ed.new_sub_con')
  ) : (
    t('dm.ed.new_sub')
  );

  const footer = builtin ? (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.close')}
      </button>
      {card && onConsole ? (
        <ConsoleButton label={t('dm.tpl.act.console')} onGo={() => onConsole(card, draft)} />
      ) : null}
      <button
        type="button"
        className={buttonClass('default')}
        data-dm-ed-copy=""
        onClick={() => card && onCopy(card.id)}
      >
        <Icon name="copy" size="sm" />
        {t('dm.tpl.act.copy')}
      </button>
    </>
  ) : (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      {card && onConsole ? (
        <ConsoleButton label={t('dm.tpl.act.console')} onGo={() => onConsole(card, draft)} />
      ) : null}
      <button
        type="button"
        className={buttonClass('default')}
        disabled={busy !== null}
        data-dm-ed-save=""
        onClick={() => save(false)}
      >
        {t(locked ? 'btn.save' : 'dm.ed.save_draft')}
      </button>
      {card?.state === 'published' ? null : (
        <button
          type="button"
          className={buttonClass('cta')}
          disabled={busy !== null || !canPublish}
          title={canPublish ? undefined : t('dm.ed.publish_wait')}
          data-dm-ed-publish=""
          onClick={() => save(true)}
        >
          <Icon name="check" size="sm" />
          {t('dm.ed.publish')}
        </button>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind={builtin ? 'card' : 'form'}
      size="wide"
      title={card ? card.name : t('dm.ed.new')}
      sub={sub}
      dirty={!builtin && tplDirty(draft, initial)}
      footer={footer}
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <div
        className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-4 max-md:grid-cols-1"
        data-dm-editor={card?.code ?? ''}
      >
        <div className="flex min-w-0 flex-col gap-2.5">
          <FormGrid>
            <Field
              id={fid('name')}
              label={t('dm.ed.name')}
              required
              hint={t('dm.ed.name_hint')}
              error={errors.name}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  className={inputClass()}
                  value={draft.name}
                  maxLength={DM_NAME_MAX}
                  readOnly={builtin}
                  onChange={(e) => patch({ name: e.target.value }, 'name')}
                />
              )}
            </Field>
            <Field
              id={fid('code')}
              label={t('dm.ed.code')}
              required
              hint={t(locked ? 'dm.ed.code_hint_pub' : 'dm.ed.code_hint')}
              error={errors.code}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  className={inputClass({ mono: true })}
                  value={draft.code}
                  maxLength={60}
                  readOnly={builtin || locked}
                  spellCheck={false}
                  onChange={(e) => patch({ code: e.target.value }, 'code')}
                />
              )}
            </Field>
            <Field id={fid('desc')} label={t('dm.ed.desc')} full>
              {(control) => (
                <textarea
                  {...control}
                  className={`${inputClass({ multiline: true })} !min-h-[56px]`}
                  value={draft.description}
                  maxLength={DM_DESCRIPTION_MAX}
                  readOnly={builtin}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              )}
            </Field>
            <Field id={fid('audience')} label={t('dm.ed.kind')} error={errors.audience}>
              {(control) => (
                <select
                  {...control}
                  className={inputClass()}
                  value={draft.audience}
                  disabled={builtin || locked}
                  onChange={(e) =>
                    patch({ audience: e.target.value as TplDraft['audience'] }, 'audience')
                  }
                >
                  <option value="org">{t('dm.tpl.kind.org')}</option>
                  <option value="admin">{t('dm.tpl.kind.admin')}</option>
                </select>
              )}
            </Field>
            {org ? (
              <>
                <Field
                  id={fid('module')}
                  label={t('dm.ed.module')}
                  hint={t('dm.ed.module_hint')}
                  error={errors.module}
                >
                  {(control) => (
                    <select
                      {...control}
                      className={inputClass()}
                      value={draft.module}
                      disabled={builtin}
                      onChange={(e) =>
                        patch({ module: e.target.value as TplDraft['module'] }, 'module')
                      }
                    >
                      {DM_MODULES.map((m) => (
                        <option key={m} value={m}>
                          {t(`dm.mod.${m}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id={fid('perm')} label={t('dm.ed.perm')}>
                  {(control) => (
                    <select
                      {...control}
                      className={inputClass()}
                      value={draft.needPermission ?? ''}
                      disabled={builtin}
                      onChange={(e) => patch({ needPermission: e.target.value ? 'fee' : null })}
                    >
                      <option value="">{t('dm.ed.perm_none')}</option>
                      <option value="fee">{t('dm.ed.perm_fee')}</option>
                    </select>
                  )}
                </Field>
                <Field id={fid('access')} label={t('dm.ed.access')}>
                  {(control) => (
                    <select
                      {...control}
                      className={inputClass()}
                      value={draft.access}
                      disabled={builtin}
                      onChange={(e) => patch({ access: e.target.value as TplDraft['access'] })}
                    >
                      <option value="all">{t('dm.ed.access_all')}</option>
                      <option value="selected">{t('dm.ed.access_sel')}</option>
                    </select>
                  )}
                </Field>
                {draft.access === 'selected' ? (
                  <div className="col-span-full flex flex-col gap-0.5" data-dm-ed-orgs="">
                    {orgs.map((o) => (
                      <CheckRow
                        key={o.id}
                        kind="check"
                        plain
                        compact
                        checked={draft.orgIds.includes(o.id)}
                        disabled={builtin}
                        label={o.demo ? t('dm.ed.demo', { name: o.name }) : o.name}
                        data-dm-ed-org={o.id}
                        onChange={(on) =>
                          patch({
                            orgIds: on
                              ? [...draft.orgIds, o.id]
                              : draft.orgIds.filter((x) => x !== o.id),
                          })
                        }
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </FormGrid>
          <FormGrid>
            <Field
              id={fid('query')}
              label={t('dm.ed.query')}
              required
              full
              hint={t('dm.ed.query_hint')}
              error={errors.query}
            >
              {(control) => (
                <SqlEditor
                  control={control}
                  value={draft.query}
                  maxLength={DM_QUERY_MAX}
                  readOnly={builtin}
                  schema={builtin ? null : (schema.data ?? null)}
                  org={org}
                  check={builtin ? undefined : org ? checkOrgSql : checkConsole}
                  label={t('dm.ed.query')}
                  onChange={(query) => patch({ query }, 'query')}
                />
              )}
            </Field>
          </FormGrid>
          {card?.state === 'broken' && card.checkError && !result ? (
            // Почему сломан (ночная проверка или проверка после выпуска): текст базы — только Админке.
            <Note tone="bad" icon="alert">
              <span data-dm-ed-broken="">
                {t('err.dm_check_failed', { error: card.checkError })}
              </span>
            </Note>
          ) : null}
          <div className="flex flex-wrap items-end gap-2.5">
            {org ? (
              <div className="min-w-0 flex-[1_1_220px]">
                <Field id={fid('org')} label={t('dm.ed.check_org')}>
                  {(control) => (
                    <select
                      {...control}
                      className={inputClass()}
                      value={orgId ?? ''}
                      data-dm-ed-check-org=""
                      onChange={(e) => setCheckOrg(e.target.value)}
                    >
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.demo ? t('dm.ed.demo', { name: o.name }) : o.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            ) : null}
            <button
              type="button"
              className={buttonClass('default')}
              disabled={busy !== null || (org && !orgId)}
              data-dm-ed-check=""
              onClick={() => void check()}
            >
              <Icon name="play" size="sm" />
              {t('dm.ed.check')}
            </button>
          </div>
          {result ? <CheckResult t={t} result={result} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2.5">
          <ParamsBox t={t} draft={draft} disabled={builtin} onChange={patch} />
          <ColumnsBox t={t} draft={draft} disabled={builtin} locked={locked} onChange={patch} />
          <TablesHint t={t} audience={draft.audience} />
          {card && card.history.length ? (
            <Box title={t('dm.ed.history', { n: card.history.length })}>
              <div data-dm-ed-history="">
                <Timeline items={tplHistoryItems(card)} label={t('dm.ed.history', { n: '' })} />
              </div>
            </Box>
          ) : null}
        </div>
      </div>
      {card && warn !== null ? (
        <ConfirmDialog
          open
          title={t('dm.ed.warn_title')}
          text={tplSaveWarnText(t, card.toks, card.tokOrgs)}
          ok={t('btn.save')}
          onClose={() => setWarn(null)}
          onConfirm={() => {
            const publish = warn;
            setWarn(null);
            void send(publish);
          }}
        />
      ) : null}
    </Modal>
  );
}

/** Итог «Проверить» (прототип `.note.ok` и `.dm-prev`): строк, время и первые 100 строк. */
function CheckResult({ t, result }: { t: Translate; result: CheckOk }) {
  const table = tplCheckTable(result, { yes: t('dm.out.yes'), no: t('dm.out.no') });
  return (
    <div className="flex flex-col gap-2" data-dm-ed-result="">
      <Note tone="ok">{tplCheckText(t, result)}</Note>
      {result.rows.length ? (
        <div className="max-h-[320px] overflow-auto rounded-lg border border-line [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <MiniTable
            columns={table.columns}
            rows={table.rows}
            empty=""
            label={t('dm.ed.check')}
            phoneCards={false}
          />
        </div>
      ) : null}
    </div>
  );
}

/** «Параметры · N» (прототип таблица `.dm-pt`): название, тип, обязательный, значение по умолчанию. */
function ParamsBox({
  t,
  draft,
  disabled,
  onChange,
}: {
  t: Translate;
  draft: TplDraft;
  disabled: boolean;
  onChange: (p: Partial<TplDraft>) => void;
}) {
  const set = (i: number, p: Partial<TplDraft['params'][number]>) =>
    onChange({ params: draft.params.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  return (
    <Box title={t('dm.ed.params', { n: draft.params.length })}>
      {draft.params.length ? (
        <div className="overflow-x-auto" data-dm-ed-params="">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={TH}>{t('dm.ed.p.code')}</th>
                <th className={TH}>{t('dm.ed.p.name')}</th>
                <th className={TH}>{t('dm.ed.p.type')}</th>
                <th className={TH}>{t('dm.ed.p.req')}</th>
                <th className={TH}>{t('dm.ed.p.def')}</th>
              </tr>
            </thead>
            <tbody>
              {draft.params.map((p, i) => (
                <tr key={p.code} data-dm-ed-param={p.code}>
                  <td className={`${TD} ${MONO_CLASS} text-[12px] whitespace-nowrap`}>
                    {`:${p.code}`}
                  </td>
                  <td className={TD}>
                    <input
                      type="text"
                      className={CELL_INPUT}
                      value={p.name}
                      maxLength={DM_LABEL_MAX}
                      readOnly={disabled}
                      aria-label={t('dm.ed.p.name')}
                      onChange={(e) => set(i, { name: e.target.value })}
                    />
                  </td>
                  <td className={TD}>
                    <select
                      className={CELL_SELECT}
                      value={p.type}
                      disabled={disabled}
                      aria-label={t('dm.ed.p.type')}
                      onChange={(e) => set(i, { type: e.target.value as typeof p.type })}
                    >
                      {DM_PARAM_TYPES.map((x) => (
                        <option key={x} value={x}>
                          {t(TPL_PARAM_TYPE_KEY[x])}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={TD}>
                    <input
                      type="checkbox"
                      className={CHECKBOX_CLASS}
                      checked={p.required}
                      disabled={disabled}
                      aria-label={t('dm.ed.p.req_full')}
                      onChange={(e) => set(i, { required: e.target.checked })}
                    />
                  </td>
                  <td className={TD}>
                    <select
                      className={CELL_SELECT}
                      value={p.default ?? ''}
                      disabled={disabled}
                      aria-label={t('dm.ed.p.def')}
                      onChange={(e) =>
                        set(i, { default: (e.target.value || null) as typeof p.default })
                      }
                    >
                      <option value="">{t('dm.pdef.none')}</option>
                      {DM_PARAM_DEFAULTS.map((x) => (
                        <option key={x} value={x}>
                          {t(`dm.pdef.${x}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <span className="text-faint">{t('dm.ed.params_none')}</span>
      )}
      <span className="text-[12px] leading-[1.4] text-muted">{t('dm.ed.params_hint')}</span>
    </Box>
  );
}

/** «Столбцы · N» (прототип таблица `.dm-pt`): код из запроса, название, тип, итог. */
function ColumnsBox({
  t,
  draft,
  disabled,
  locked,
  onChange,
}: {
  t: Translate;
  draft: TplDraft;
  disabled: boolean;
  locked: boolean;
  onChange: (p: Partial<TplDraft>) => void;
}) {
  const set = (i: number, p: Partial<TplDraft['columns'][number]>) =>
    onChange({ columns: draft.columns.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  return (
    <Box title={t('dm.ed.cols', { n: draft.columns.length })}>
      <div className="overflow-x-auto" data-dm-ed-cols="">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={TH}>{t('dm.ed.c.code')}</th>
              <th className={TH}>{t('dm.ed.p.name')}</th>
              <th className={TH}>{t('dm.ed.p.type')}</th>
              <th className={TH}>{t('dm.ed.c.total')}</th>
            </tr>
          </thead>
          <tbody>
            {draft.columns.map((c, i) => (
              <tr key={c.code} data-dm-ed-col={c.code}>
                <td className={`${TD} ${MONO_CLASS} text-[12px] whitespace-nowrap`}>{c.code}</td>
                <td className={TD}>
                  <input
                    type="text"
                    className={CELL_INPUT}
                    value={c.name}
                    maxLength={DM_LABEL_MAX}
                    readOnly={disabled}
                    aria-label={t('dm.ed.p.name')}
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                </td>
                <td className={TD}>
                  <select
                    className={CELL_SELECT}
                    value={c.type}
                    disabled={disabled}
                    aria-label={t('dm.ed.p.type')}
                    onChange={(e) => set(i, { type: e.target.value as typeof c.type })}
                  >
                    {DM_COLUMN_TYPES.map((x) => (
                      <option key={x} value={x}>
                        {t(`dm.ctype.${x}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={TD}>
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={c.total}
                    disabled={disabled}
                    aria-label={t('dm.ed.c.total_full')}
                    onChange={(e) => set(i, { total: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="text-[12px] leading-[1.4] text-muted">
        {t('dm.ed.cols_hint')}
        {locked ? ` ${t('dm.ed.cols_hint_pub')}` : ''}
      </span>
    </Box>
  );
}

/** «Таблицы и поля базы» (прототип `DM_HINT`) и переход в «Техническую документацию». */
function TablesHint({ t, audience }: { t: Translate; audience: TplDraft['audience'] }) {
  return (
    <details
      className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-raised px-4 py-3.5"
      data-dm-ed-tables=""
    >
      <summary className="cursor-pointer text-[13.5px] font-semibold text-ink">
        {t('dm.ed.tables')}
      </summary>
      <ul className="my-1.5 list-disc pl-[18px] text-[13px] leading-[1.6]">
        {tplHint(audience).map(([name, fields]) => (
          <li key={name}>
            <b className={MONO_CLASS}>{name}</b>{' '}
            <span className={`${MONO_CLASS} text-faint`}>{fields}</span>
          </li>
        ))}
      </ul>
      <TdocsLink label={t('dm.ed.tdocs')} />
    </details>
  );
}

/** «Открыть в консоли» окна: уход из окна без возврата истории — переход вызывающего не отменится. */
function ConsoleButton({ label, onGo }: { label: string; onGo: () => void }) {
  const { leave } = useWindow();
  return (
    <button
      type="button"
      className={buttonClass('default')}
      data-dm-ed-console=""
      onClick={() => {
        leave();
        onGo();
      }}
    >
      <Icon name="code" size="sm" />
      {label}
    </button>
  );
}

/** Переход из открытого окна — с заменой записи истории: «Назад» не вернёт к окну. */
function TdocsLink({ label }: { label: ReactNode }) {
  const router = useRouter();
  const { leave } = useWindow();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 self-start text-[13px] text-accent underline-offset-2 hover:underline"
      data-dm-ed-tdocs=""
      onClick={() => {
        leave();
        router.replace(tabHref('tdocs', 'db'));
      }}
    >
      <Icon name="db" size="sm" />
      {label}
    </button>
  );
}
