'use client';

import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  formatMomentRu,
  formatSom,
  formatSomWithUnit,
  parseSom,
  projectPaymentProblem,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  isRecordChanged,
  ProjectSaved,
  type ProjectCard,
  type ProjectPaymentWindow,
} from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  buttonClass,
  Field,
  FormGrid,
  Icon,
  iconButtonClass,
  inputClass,
  KeyValues,
  linkButtonClass,
  MiniTable,
  miniWide,
  Modal,
  Note,
  Pill,
  RecordChangedNotice,
  Tag,
  Timeline,
  TOUCH_AREA,
  useToast,
  type ActionEntry,
  type IconName,
  type KeyValueItem,
  type TimelineItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { ApiFailure } from '../api-client';
import { openContractorCard } from '../contractors/card-store';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { RecordFiles } from '../files/record-files';
import { reasonNeeded, type ChangedPart } from '../finance/edit-reason';
import { WhyButton } from '../finance/finance-dialogs';
import { useErrorText, useT } from '../l10n/provider';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { pickedMoneyFilesProblem, uploadMoneyFiles } from '../money/tax-data';
import { useShell } from '../shell/context';
import { openProjectCard } from './project-card-store';
import { projectPaymentHistoryText } from './project-history';
import {
  deleteProjectPayment,
  editProjectPayment,
  payProject,
  projectPaymentQuery,
  usePaymentsRefresh,
} from './projects-data';

/*
 * Оплаты по проекту — транши (задача 2.26, часть 2; ТЗ «Оплата по проекту траншами», «Окно оплаты»;
 * прототип modules/projects.js — блок «Оплаты (транши)» в `openProject`, `projPay`; modules/services.js
 * — `tranchDlg`; modules/fin-op.js — `opWin`, `opEditDlg`, `opDelDlg`, `opActs` с `src: 'pt'`). Блок
 * карточки: транши по дате, «изменён», кто записал, файлы, сумма, «Получено»; строка открывает окно
 * транша, «⋯» — его действия. Окно «Оплата по проекту», окно транша, «Изменить» и «Удалить» с причиной.
 * Файлы окно загружает после записи; сервер проверяет права, видимость проекта и суммы ещё раз.
 */

const todayBishkek = () => bishkekDate(new Date());

type Errors = Partial<Record<'date' | 'amount' | 'files' | 'reason', string>>;

/** Окна траншей, которые открывают карточка проекта, её меню и журнал «Финансовых операций». */
export type ProjectPaymentAction =
  | {
      act: 'pay';
      project: { id: string; name: string; contractor: string; left: number | null };
    }
  | { act: 'payment'; id: string }
  | { act: 'payment-edit'; id: string }
  | { act: 'payment-delete'; id: string };

/** «Записать оплату» из карточки или меню проекта: остаток — при заданной стоимости. */
export const payAction = (p: {
  id: string;
  name: string;
  contractor: { name: string };
  money: { plan: number | null; paid: number } | null;
}): ProjectPaymentAction => ({
  act: 'pay',
  project: {
    id: p.id,
    name: p.name,
    contractor: p.contractor.name,
    left: p.money?.plan ? Math.max(0, p.money.plan - p.money.paid) : null,
  },
});

function Footer({
  t,
  label,
  icon,
  busy,
  danger = false,
  onClose,
  onOk,
}: {
  t: Translate;
  label: string;
  icon?: IconName;
  busy: boolean;
  danger?: boolean;
  onClose: () => void;
  onOk: () => void;
}) {
  return (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <button
        type="button"
        data-pt-ok=""
        className={buttonClass(danger ? 'danger' : 'cta')}
        disabled={busy}
        onClick={onOk}
      >
        {icon ? <Icon name={icon} size="sm" /> : null}
        {label}
      </button>
    </>
  );
}

/** Отказ сервера — под полем, если он про поле, иначе — всплывающим сообщением. */
function useFail(setErrors: (e: Errors) => void) {
  const toast = useToast();
  const errorText = useErrorText();
  return (error: ApiErrorLike & { details?: unknown }) => {
    const message = errorText(error);
    const field = (error.details as { field?: string } | undefined)?.field;
    if (field === 'date' || field === 'amount' || field === 'reason')
      return setErrors({ [field]: message });
    toast(message, { bad: true });
  };
}

function FilesInput({ control, onPick }: { control: object; onPick: (files: File[]) => void }) {
  return (
    <input
      {...control}
      type="file"
      multiple
      data-pt-files=""
      className={inputClass({ file: true })}
      onChange={(e) => onPick([...(e.target.files ?? [])])}
    />
  );
}

/** Кто и когда: имя, под ним момент мелким серым (прототип `auditKv`). */
function Audit({ who, at }: { who: string | null; at: string }) {
  return (
    <>
      {who ?? '—'}
      <span className="block text-[11.5px] text-faint">{formatMomentRu(new Date(at))}</span>
    </>
  );
}

/* ───────────── Блок карточки «Оплаты (транши)» ───────────── */

/**
 * «Оплаты (транши) · N» (прототип `openProject`): кнопка «Записать оплату» — с правом, у неотменённого
 * проекта, пока не получена вся стоимость; строки по дате; «Получено» внизу; подсказка про журнал.
 */
export function PaymentsBox({
  t,
  p,
  onAction,
}: {
  t: Translate;
  p: ProjectCard;
  onAction: (a: ProjectPaymentAction) => void;
}) {
  const [menu, setMenu] = useState<{ el: HTMLElement; items: ActionEntry[] } | null>(null);
  const pays = p.payments ?? [];
  const money = p.money!;
  const full = !!money.plan && money.plan - money.paid <= 0;
  const title = t('proj.pays.title', { n: pays.length });

  // Меню «⋯» транша (прототип opMenuBtn → opActs с `pt`): «Открыть», «Изменить», «Открыть источник»
  // («Проект «…»» — эта же карточка), «Удалить».
  const rowMenu = (x: (typeof pays)[number]): ActionEntry[] => [
    {
      id: 'open',
      label: t('fin.op.act_open'),
      icon: 'list',
      run: () => onAction({ act: 'payment', id: x.id }),
    },
    {
      id: 'edit',
      label: t('fin.op.edit'),
      icon: 'edit',
      disabled: !!x.locks.edit,
      reason: x.locks.edit?.text,
      run: () => onAction({ act: 'payment-edit', id: x.id }),
    },
    {
      id: 'source',
      label: t('fin.op.source'),
      icon: 'link',
      sub: t('fin.pt.source', { name: p.name }),
      run: () => openProjectCard(p.id),
    },
    { id: 's1', separator: true },
    {
      id: 'delete',
      label: t('fin.del.ok'),
      icon: 'trash',
      danger: true,
      disabled: !!x.locks.del,
      reason: x.locks.del?.text,
      run: () => onAction({ act: 'payment-delete', id: x.id }),
    },
  ];

  return (
    <Box
      title={title}
      actions={
        p.can.pay && !full ? (
          <button
            type="button"
            data-pj-pay=""
            className={buttonClass('cta', 'sm')}
            onClick={() => onAction(payAction(p))}
          >
            <Icon name="wallet" size="sm" />
            {t('proj.act.pay')}
          </button>
        ) : undefined
      }
    >
      <div data-pj-pays={p.id} className="contents">
        {pays.length ? (
          <MiniTable
            label={title}
            empty=""
            onOpen={(key) => onAction({ act: 'payment', id: key })}
            columns={[
              { key: 'date', label: t('proj.pays.col.date') },
              { key: 'note', label: t('proj.pays.col.note') },
              { key: 'by', label: t('proj.pays.col.by') },
              { key: 'files', label: t('proj.pays.col.files') },
              { key: 'amount', label: t('proj.pays.col.amount'), numeric: true },
              { key: 'menu', label: '', actions: true, width: 36 },
            ]}
            rows={[
              ...pays.map((x) => ({
                key: x.id,
                blank: [...(x.note ? [] : ['note']), ...(x.files.length ? [] : ['files'])],
                wide: miniWide({ note: x.note, files: x.files.join(', ') }),
                cells: {
                  date: (
                    <span className="inline-flex flex-wrap items-center gap-1.5" data-pt-row={x.id}>
                      {formatDateRu(x.date)}
                      {x.edited ? <Tag tone="warn">{t('proj.pays.edited')}</Tag> : null}
                    </span>
                  ),
                  note: x.note,
                  by: x.by ?? '—',
                  files: x.files.length ? (
                    x.files.join(', ')
                  ) : (
                    <span className="text-faint">—</span>
                  ),
                  amount: <span className="tabular-nums">{formatSom(x.amount)}</span>,
                  menu: (
                    <button
                      type="button"
                      data-pt-menu={x.id}
                      aria-label={t('proj.pays.menu')}
                      title={t('grid.actions')}
                      className={`${iconButtonClass('sm')} ${TOUCH_AREA}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu({ el: e.currentTarget, items: rowMenu(x) });
                      }}
                    >
                      <Icon name="more" size="sm" />
                    </button>
                  ),
                },
              })),
              // Итог «Получено» — строкой таблицы, как `tr.m-total` прототипа.
              {
                key: 'total',
                total: true,
                blank: ['note', 'by', 'files', 'menu'],
                cells: {
                  date: t('proj.pays.total'),
                  amount: (
                    <span className="tabular-nums" data-pj-paid="">
                      {formatSom(money.paid)}
                    </span>
                  ),
                },
              },
            ]}
          />
        ) : (
          <span className="text-faint">{t('proj.pays.empty')}</span>
        )}
      </div>
      <span className="block text-[12.5px] text-muted">{t('proj.pays.hint')}</span>
      {menu ? (
        <ActionMenu
          items={menu.items}
          place={{ anchor: menu.el }}
          label={t('grid.actions')}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </Box>
  );
}

/* ───────────── Окна по действию ───────────── */

/**
 * Окно по действию (карточка, меню проекта, журнал): «Записать оплату», окно транша, «Изменить» и
 * «Удалить» — загружают транш; замок, который успел появиться, — уведомлением.
 */
export function ProjectPaymentActionDialog({
  action,
  open,
  onClose,
}: {
  action: ProjectPaymentAction;
  open: boolean;
  onClose: () => void;
}) {
  const refresh = usePaymentsRefresh();
  if (action.act === 'pay')
    return (
      <ProjectPayDialog project={action.project} open={open} onClose={onClose} onDone={refresh} />
    );
  if (action.act === 'payment')
    return <ProjectPaymentWindowDialog id={action.id} open={open} onClose={onClose} />;
  return (
    <PaymentById
      id={action.id}
      act={action.act === 'payment-edit' ? 'edit' : 'delete'}
      open={open}
      onClose={onClose}
    />
  );
}

/** Замок, появившийся после загрузки строки, — уведомлением, окно не открывается. */
function useLockToast(text: string | null, onClose: () => void) {
  const toast = useToast();
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!text) return;
    toast(text, { icon: 'lock', bad: true });
    close();
  }, [text, toast]);
}

function PaymentById({
  id,
  act,
  open,
  onClose,
}: {
  id: string;
  act: 'edit' | 'delete';
  open: boolean;
  onClose: () => void;
}) {
  const refresh = usePaymentsRefresh();
  const query = useQuery(projectPaymentQuery(id));
  const p = query.data;
  const lock = p ? ((act === 'edit' ? p.locks.edit : p.locks.del)?.text ?? null) : null;
  useLockToast(lock, onClose);
  if (!p || lock) return null;
  if (act === 'edit')
    return <ProjectPaymentEditDialog payment={p} open={open} onClose={onClose} onDone={refresh} />;
  return <ProjectPaymentDeleteDialog payment={p} open={open} onClose={onClose} onDone={refresh} />;
}

/* ───────────── «Оплата по проекту» ───────────── */

/**
 * «Оплата по проекту» (прототип `projPay` → `tranchDlg`): сумма (подставлен остаток; при стоимости — не
 * больше его, без неё — любая), дата (не позже сегодняшней), комментарий, файлы «платёжка, чек».
 */
export function ProjectPayDialog({
  project,
  open,
  onClose,
  onDone,
}: {
  project: { id: string; name: string; contractor: string; left: number | null };
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const { access } = useShell();
  const id = useId();
  const canUpload = access.feature('files') && access.can('filesUpload');
  const left = project.left;
  const [amount, setAmount] = useState(left !== null && left > 0 ? formatSom(left, 'auto') : '');
  const [date, setDate] = useState(todayBishkek);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);

  const save = async () => {
    const n = parseSom(amount);
    const problem = projectPaymentProblem(n, left);
    if (problem)
      return setErrors({
        amount: t(`err.${problem.problem}` as UiTextKey, {
          amount: problem.amount !== undefined ? formatSomWithUnit(problem.amount) : '',
        }),
      });
    // Пустая дата — сегодняшняя, как в прототипе (tranchDlg).
    const paidOn = date || todayBishkek();
    if (paidOn > todayBishkek()) return setErrors({ date: t('fin.edit.date_future') });
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    setBusy(true);
    const res = await payProject(project.id, {
      amount: n ?? 0,
      date: paidOn,
      note: note.trim(),
      files: picked.length,
    });
    const saved = res.ok ? ProjectSaved.safeParse(res.data) : null;
    if (res.ok && saved?.success) {
      const failedUpload = picked.length
        ? await uploadMoneyFiles(
            t,
            errorText,
            { kind: 'project_payment', id: saved.data.id },
            picked,
          )
        : null;
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('proj.pay.done'), { icon: 'wallet' });
    }
    setBusy(false);
    if (res.ok) return void toast(t('err.unknown'), { bad: true });
    fail(res.error);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={picked.length > 0 || note !== ''}
      title={t('proj.pay.title')}
      sub={t('proj.pay.sub', { name: project.name, cp: project.contractor })}
      footer={
        <Footer
          t={t}
          label={t('proj.pay.ok')}
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-pj-pay-dlg={project.id}>
        <FormGrid>
          <Field
            id={`${id}-amount`}
            label={t('proj.pay.amount')}
            required
            hint={
              left !== null
                ? t('proj.pay.left', { amount: formatSomWithUnit(left) })
                : t('proj.pay.any')
            }
            error={errors.amount}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-pt-amount=""
                className={`${inputClass()} tabular-nums`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-date`} label={t('proj.pay.date')} required error={errors.date}>
            {(control) => (
              <input
                {...control}
                type="date"
                data-pt-date=""
                max={todayBishkek()}
                className={inputClass()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setErrors((x) => ({ ...x, date: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-note`} label={t('proj.pay.note')} full>
            {(control) => (
              <input
                {...control}
                type="text"
                data-pt-note=""
                maxLength={500}
                placeholder={t('proj.pay.note_ph')}
                className={inputClass()}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          {canUpload ? (
            <Field id={`${id}-files`} label={t('proj.pay.files')} full error={errors.files}>
              {(control) => (
                <FilesInput
                  control={control}
                  onPick={(files) => {
                    setPicked(files);
                    setErrors((x) => ({ ...x, files: undefined }));
                  }}
                />
              )}
            </Field>
          ) : null}
        </FormGrid>
      </div>
    </Modal>
  );
}

/* ───────────── Окно транша ───────────── */

function historyItems(t: Translate, rows: ProjectPaymentWindow['history']): TimelineItem[] {
  return rows.map((h) => {
    const at = new Date(h.at);
    return {
      id: String(h.id),
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: projectPaymentHistoryText(t, h),
      who: h.actor ?? t('status.system'),
    };
  });
}

/**
 * Окно транша (прототип opWin с `pt`): тип, контрагент, дата, сумма, «За что» — проект и комментарий,
 * «Проект: получено X из Y», счёт организации, кто внёс и изменил, отметки, файлы и история;
 * «Удалить», «Изменить» с замком; «Открыть источник» — карточка проекта.
 */
export function ProjectPaymentWindowDialog({
  id,
  open,
  onClose,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const refresh = usePaymentsRefresh();
  const query = useQuery(projectPaymentQuery(id));
  const [del, setDel] = useState<DialogSlot<ProjectPaymentWindow> | null>(null);
  const [edit, setEdit] = useState<DialogSlot<ProjectPaymentWindow> | null>(null);
  const p = query.data;
  const failed =
    query.isError && !p
      ? errorText(
          query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
        )
      : null;
  const lock = p && !p.deleted ? (p.locks.edit ?? p.locks.del) : null;
  const kind = t('fin.pt.kind');

  const items: KeyValueItem[] = [];
  if (p) {
    const what = p.note ? `${p.project.name} · ${p.note}` : p.project.name;
    items.push(
      {
        id: 'kind',
        label: t('fin.op.kind'),
        value: (
          <Pill tone="info" size="sm">
            {kind}
          </Pill>
        ),
      },
      {
        id: 'cp',
        label: t('fin.op.contractor'),
        value: (
          <button
            type="button"
            className={linkButtonClass()}
            onClick={() => {
              onClose();
              openContractorCard({ id: p.contractor.id }, 'money');
            }}
          >
            {p.contractor.name}
          </button>
        ),
      },
      { id: 'date', label: t('fin.op.date'), value: formatDateRu(p.date) },
      {
        id: 'amount',
        label: t('fin.op.amount'),
        value: <b className="tabular-nums">{formatSomWithUnit(p.amount)}</b>,
      },
      { id: 'what', label: t('fin.op.what'), value: what },
      {
        id: 'proj',
        label: t('fin.pt.received'),
        value: (
          <span className="tabular-nums" data-pt-received="">
            {p.project.plan
              ? t('fin.pt.received_of', {
                  paid: formatSomWithUnit(p.project.paid),
                  plan: formatSomWithUnit(p.project.plan),
                })
              : formatSomWithUnit(p.project.paid)}
          </span>
        ),
      },
      {
        id: 'acc',
        label: t('fin.op.account'),
        value: (
          <span className="inline-flex items-center gap-1">
            <Icon name="building" size="sm" />
            {t('fin.op.acc_org')}
          </span>
        ),
      },
    );
    // «Примечание» — комментарий транша (прототип opWin: `v.note !== v.what`).
    if (p.note && p.note !== what)
      items.push({ id: 'note', label: t('fin.op.note'), value: p.note });
    items.push(
      {
        id: 'created',
        label: t('fin.op.created'),
        value: <Audit who={p.created.name} at={p.created.at} />,
      },
      {
        id: 'updated',
        label: t('fin.op.updated'),
        value: <Audit who={p.updated.name} at={p.updated.at} />,
      },
    );
  }

  const footer = (
    <>
      {p && !p.deleted ? (
        <>
          <WhyButton
            icon="trash"
            label={t('fin.op.delete')}
            why={p.locks.del?.text ?? null}
            data="delete"
            onClick={() => setDel(openSlot(p))}
          />
          <WhyButton
            icon="edit"
            label={t('fin.op.edit')}
            why={p.locks.edit?.text ?? null}
            data="edit"
            onClick={() => setEdit(openSlot(p))}
          />
        </>
      ) : null}
      <div className="flex-1" />
      {p ? (
        <button
          type="button"
          className={buttonClass('default')}
          data-fin-source=""
          title={t('fin.pt.source', { name: p.project.name })}
          onClick={() => {
            onClose();
            openProjectCard(p.project.id);
          }}
        >
          <Icon name="link" size="sm" />
          {t('fin.op.source')}
        </button>
      ) : null}
      <button type="button" className={buttonClass('cta')} onClick={onClose}>
        {t('btn.done')}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={p ? t('fin.op.title', { kind, amount: formatSomWithUnit(p.amount) }) : ''}
      label={p ? undefined : t('fin.pt.open')}
      sub={p ? `${p.contractor.name} · ${formatDateRu(p.date)}` : undefined}
      footer={footer}
    >
      <div className="flex flex-col gap-3.5" data-pt-window={id}>
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {p && (p.deleted || p.edited) ? (
          <div className="flex flex-wrap gap-1.5">
            {p.deleted ? (
              <Pill tone="bad" icon="trash">
                {t('fin.op.deleted_pill')}
              </Pill>
            ) : null}
            {p.edited ? (
              <Pill tone="warn" icon="edit">
                {t('fin.op.edited_pill')}
              </Pill>
            ) : null}
          </div>
        ) : null}
        {p?.deleted ? (
          <Note tone="bad" icon="trash">
            <b>{t('fin.op.deleted_pill')}</b>
            {' · '}
            {t('fin.op.deleted', {
              name: p.deleted.name ?? '—',
              at: formatMomentRu(new Date(p.deleted.at)),
              reason: p.deleted.reason,
            })}
          </Note>
        ) : lock ? (
          <Note icon="lock">{lock.text}</Note>
        ) : null}
        {p ? (
          <Box>
            <KeyValues items={items} />
          </Box>
        ) : null}
        {p && p.files !== null ? (
          <RecordFiles source={{ kind: 'project_payment', id: p.id }} />
        ) : null}
        {p ? (
          <Box title={t('fin.op.history')}>
            {p.history.length ? (
              <Timeline items={historyItems(t, p.history)} label={t('fin.op.history')} />
            ) : (
              <span className="text-faint">{t('fin.op.history_empty')}</span>
            )}
          </Box>
        ) : null}
      </div>
      {del ? (
        <ProjectPaymentDeleteDialog
          key={`del-${del.n}`}
          payment={del.data}
          open={del.open}
          onClose={() => setDel(closeSlot)}
          onDone={refresh}
        />
      ) : null}
      {edit ? (
        <ProjectPaymentEditDialog
          key={`edit-${edit.n}`}
          payment={edit.data}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          onDone={refresh}
        />
      ) : null}
    </Modal>
  );
}

/* ───────────── «Изменить» и «Удалить» ───────────── */

/**
 * «Изменить: оплата по проекту» (прототип opEditDlg с `pt`): сумма (при стоимости — не больше неё без
 * остальных траншей), дата, примечание, «Добавить файлы», причина — если меняются сумма или дата.
 */
export function ProjectPaymentEditDialog({
  payment: p,
  open,
  onClose,
  onDone,
}: {
  payment: ProjectPaymentWindow;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const { access } = useShell();
  const id = useId();
  const canUpload = access.feature('files') && access.can('filesUpload');
  const [amount, setAmount] = useState(formatSom(p.amount, 'auto'));
  const [date, setDate] = useState<string>(p.date);
  const [note, setNote] = useState(p.note);
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);
  const kind = t('fin.pt.kind');

  const save = async () => {
    const n = parseSom(amount);
    if (n === null || n <= 0) return setErrors({ amount: t('err.op_amount_required') });
    if (p.max !== null && n > p.max)
      return setErrors({ amount: t('err.op_project_over', { max: formatSomWithUnit(p.max) }) });
    if (!date) return setErrors({ date: t('fin.edit.date_required') });
    if (date > p.today) return setErrors({ date: t('fin.edit.date_future') });
    const parts: ChangedPart[] = [];
    if (n !== p.amount) parts.push('amount');
    if (date !== p.date) parts.push('date');
    const bad = pickedMoneyFilesProblem(t, errorText, picked);
    if (bad) return setErrors({ files: bad });
    // Новые файлы — к траншу после сохранения, каждый — своей строкой истории.
    const upload = async () =>
      picked.length
        ? uploadMoneyFiles(t, errorText, { kind: 'project_payment', id: p.id }, picked)
        : null;
    if (parts.length === 0 && note === p.note) {
      if (picked.length === 0) {
        onClose();
        return void toast(t('fin.edit.same'), { icon: 'info' });
      }
      setBusy(true);
      const failedUpload = await upload();
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('fin.edit.done'), { icon: 'edit' });
    }
    if (parts.length > 0 && !reason.trim())
      return setErrors({ reason: reasonNeeded(t, parts, false) });
    setBusy(true);
    const res = await editProjectPayment(p.id, {
      version: p.version,
      amount: n,
      date,
      note,
      reason: reason.trim(),
    });
    if (res.ok) {
      const failedUpload = await upload();
      setBusy(false);
      onDone();
      onClose();
      if (failedUpload) toast(failedUpload, { bad: true });
      return void toast(t('fin.edit.done'), { icon: 'edit' });
    }
    setBusy(false);
    if (isRecordChanged(res.error)) return setChanged(true);
    fail(res.error);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={reason !== '' || picked.length > 0}
      title={t('fin.edit.title', { kind: kind.toLowerCase() })}
      sub={t('fin.edit.sub', {
        name: p.contractor.name,
        amount: formatSomWithUnit(p.amount),
        date: formatDateRu(p.date),
      })}
      footer={
        <Footer
          t={t}
          label={t('btn.save')}
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3.5" data-pt-edit={p.id}>
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onClose}
            reloading={false}
          />
        ) : null}
        <FormGrid>
          <Field
            id={`${id}-amount`}
            label={t('fin.edit.amount')}
            required
            hint={
              p.max !== null ? t('fin.edit.max', { amount: formatSomWithUnit(p.max) }) : undefined
            }
            error={errors.amount}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                data-pt-amount=""
                className={`${inputClass()} tabular-nums`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrors((x) => ({ ...x, amount: undefined, reason: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-date`} label={t('fin.edit.date')} required error={errors.date}>
            {(control) => (
              <input
                {...control}
                type="date"
                data-pt-date=""
                max={p.today}
                className={inputClass()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setErrors((x) => ({ ...x, date: undefined, reason: undefined }));
                }}
              />
            )}
          </Field>
          <Field id={`${id}-note`} label={t('fin.edit.note')} full>
            {(control) => (
              <input
                {...control}
                type="text"
                data-pt-note=""
                maxLength={500}
                className={inputClass()}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          {p.files !== null && canUpload ? (
            <Field
              id={`${id}-files`}
              label={t('fin.edit.files')}
              full
              hint={p.files > 0 ? t('fin.edit.files_have', { n: p.files }) : undefined}
              error={errors.files}
            >
              {(control) => (
                <FilesInput
                  control={control}
                  onPick={(files) => {
                    setPicked(files);
                    setErrors((x) => ({ ...x, files: undefined }));
                  }}
                />
              )}
            </Field>
          ) : null}
          <Field
            id={`${id}-why`}
            label={t('fin.edit.reason')}
            full
            hint={t('fin.edit.reason_hint')}
            error={errors.reason}
          >
            {(control) => (
              <textarea
                {...control}
                data-pt-reason=""
                maxLength={500}
                placeholder={t('fin.edit.reason_ph')}
                className={`${inputClass()} min-h-14 resize-y leading-normal`}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setErrors((x) => ({ ...x, reason: undefined }));
                }}
              />
            )}
          </Field>
        </FormGrid>
        <Note icon="info">{t('fin.edit.info')}</Note>
      </div>
    </Modal>
  );
}

/**
 * «Удалить» транш (прототип opDelDlg с `pt`): причина обязательна, «Получено» по проекту уменьшится;
 * транш получает отметку «Удалена» и виден с «Показать удалённые».
 */
export function ProjectPaymentDeleteDialog({
  payment: p,
  open,
  onClose,
  onDone,
}: {
  payment: ProjectPaymentWindow;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const id = useId();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const fail = useFail(setErrors);
  const amount = formatSomWithUnit(p.amount);

  const save = async () => {
    if (!reason.trim()) return setErrors({ reason: t('err.op_reason_required') });
    setBusy(true);
    const res = await deleteProjectPayment(p.id, reason.trim());
    setBusy(false);
    if (!res.ok) return fail(res.error);
    onDone();
    onClose();
    toast(t('fin.del.done'), { icon: 'trash' });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      dirty={!!reason}
      title={t('fin.del.title')}
      sub={t('fin.del.sub', {
        kind: t('fin.pt.kind'),
        name: p.contractor.name,
        amount,
        date: formatDateRu(p.date),
      })}
      footer={
        <Footer
          t={t}
          label={t('fin.del.ok')}
          icon="trash"
          danger
          busy={busy}
          onClose={onClose}
          onOk={() => void save()}
        />
      }
    >
      <div className="flex flex-col gap-3" data-pt-delete={p.id}>
        <p className="m-0">{t('fin.del.ask', { amount })}</p>
        <Note icon="history">
          {t('fin.del.cons.pt')} {t('fin.del.keep')}
        </Note>
        <Field id={`${id}-reason`} label={t('fin.del.reason')} required full error={errors.reason}>
          {(control) => (
            <textarea
              {...control}
              data-pt-reason=""
              maxLength={500}
              placeholder={t('fin.del.reason_ph')}
              className={`${inputClass()} min-h-16 resize-y leading-normal`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setErrors({});
              }}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

/** Окно действия транша в слоте (карточка проекта, меню, журнал). */
export function ProjectPaymentSlot({
  slot,
  onClose,
}: {
  slot: DialogSlot<ProjectPaymentAction> | null;
  onClose: () => void;
}) {
  if (!slot) return null;
  return (
    <ProjectPaymentActionDialog
      key={`pt-${slot.n}`}
      action={slot.data}
      open={slot.open}
      onClose={onClose}
    />
  );
}
