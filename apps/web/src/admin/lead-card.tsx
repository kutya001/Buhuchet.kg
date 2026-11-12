'use client';

import {
  formatMomentRu,
  formatPhone,
  LEAD_ADMIN_NOTE_MAX,
  leadBack,
  leadMainAction,
  scaleNext,
  type LeadStatus,
} from '@buhuchet/domain';
import { AdminLeadCard } from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  buttonClass,
  Field,
  Icon,
  inputClass,
  KeyValues,
  linkButtonClass,
  Modal,
  Note,
  StatusHistory,
  StatusNone,
  StatusScale,
  StatusScales,
  Timeline,
  useToast,
  type ActionEntry,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { ApiFailure } from '../api-client';
import { PhoneLinks } from '../contractors/contractor-columns';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { tabHref } from '../shell/modules';
import { phoneCodesQuery } from '../staff/staff-data';
import {
  historyLabels,
  historyView,
  scaleView,
  statusEvents,
  statusName,
} from '../status/status-view';
import { leadHistoryItems } from './lead-history';
import { leadCardQuery, leadState, saveLeadNote, useLeadsRefresh } from './leads-data';
import { requestOrgCard } from './org-card-store';

/*
 * Окно заявки (задача #165; ТЗ «Админка» → «Вкладка «Заявки»»; прототип admin/leads.js — `openLead`):
 * шкала «Заявка» (шаг вперёд и откат нажатием; «Отказ» — «шкала не ведётся» и «Снять «Отказ»»),
 * данные заявки, «Заметка администратора» с «Сохранить заметку», «История статусов», «История». Внизу —
 * «Ещё действия» (меню без «Открыть заявку») и главная кнопка: «В работу» у новой, иначе «Создать
 * организацию», пока её не создали (у «Отказа» — нет). Ссылка на организацию закрывает окно и ведёт в
 * список организаций с карточкой этой организации (прототип v83).
 */

const faint = <span className="text-faint">—</span>;

export function LeadCardDialog({
  id,
  open,
  onClose,
  menu,
  onStep,
  onBack,
  onOrg,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  /** Пункты «Ещё действия» (прототип `leadActions` без «Открыть заявку»). */
  menu: (l: AdminLeadCard) => ActionEntry[];
  /** Шаг вперёд — со шкалы и главной кнопкой «В работу». */
  onStep: (l: AdminLeadCard, to: LeadStatus) => void;
  /** Откат на шаг и «Снять «Отказ»» — окно с причиной. */
  onBack: (l: AdminLeadCard, to: LeadStatus) => void;
  /** «Создать организацию». */
  onOrg: (l: AdminLeadCard) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const query = useQuery(leadCardQuery(id));
  const [more, setMore] = useState<HTMLElement | null>(null);
  const l = query.data;
  const gone =
    query.isError &&
    query.error instanceof ApiFailure &&
    query.error.error.code === 'lead_not_found';
  const failed =
    query.isError && !l && !gone
      ? errorText(
          query.error instanceof ApiFailure ? query.error.error : { code: 'unknown', message: '' },
        )
      : null;
  const main = l ? leadMainAction(leadState(l)) : null;

  if (gone)
    return (
      <Modal
        open={open}
        onClose={onClose}
        kind="card"
        size="mid"
        title={t('leads.card.gone')}
        footer={
          <>
            <div className="flex-1" />
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('leads.card.close')}
            </button>
          </>
        }
      >
        <div data-lead-card={id} />
      </Modal>
    );

  const footer = l ? (
    <>
      <button
        type="button"
        data-lead-more=""
        className={buttonClass('default')}
        onClick={(e) => setMore(e.currentTarget)}
      >
        <Icon name="more" size="sm" />
        {t('leads.card.more')}
      </button>
      <div className="flex-1" />
      {main ? (
        <button
          type="button"
          data-lead-main={main}
          className={buttonClass('cta')}
          onClick={() => (main === 'start' ? onStep(l, 'in_progress') : onOrg(l))}
        >
          <Icon name={main === 'start' ? 'hourglass' : 'building'} size="sm" />
          {t(main === 'start' ? 'leads.act.start' : 'leads.act.org')}
        </button>
      ) : null}
    </>
  ) : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={l ? l.firm : ''}
      label={l ? undefined : t('leads.act.open')}
      sub={
        l ? t('leads.card.sub', { name: l.name, at: formatMomentRu(new Date(l.at)) }) : undefined
      }
      footer={footer}
    >
      <div className="flex flex-col gap-3.5" data-lead-card={id}>
        {failed ? <Note tone="bad">{failed}</Note> : null}
        {l ? (
          <CardBody
            t={t}
            l={l}
            onStep={(to) => onStep(l, to)}
            onBack={(to) => onBack(l, to)}
            onOrgLink={onClose}
          />
        ) : null}
      </div>
      {more && l ? (
        <ActionMenu
          items={menu(l)}
          place={{ anchor: more }}
          label={t('leads.card.more')}
          onClose={() => setMore(null)}
        />
      ) : null}
    </Modal>
  );
}

function CardBody({
  t,
  l,
  onStep,
  onBack,
  onOrgLink,
}: {
  t: Translate;
  l: AdminLeadCard;
  onStep: (to: LeadStatus) => void;
  onBack: (to: LeadStatus) => void;
  onOrgLink: () => void;
}) {
  const router = useRouter();
  const codes = useQuery(phoneCodesQuery);
  const events = statusEvents(l.statusHistory);
  const bk = leadBack(leadState(l));
  const backTo = bk && 'to' in bk ? bk.to : null;
  const view = scaleView(t, {
    scale: 'lead',
    status: l.status,
    history: events,
    // Прототип `scNext('lead')`: «Новая» → «В работе» → «Подключена».
    next: scaleNext('lead', l.status),
    back: backTo,
    hints: bk && 'locked' in bk ? [t('leads.back_locked')] : [],
  });
  const history = historyView(t, 'lead', events, new Date());
  const phone = formatPhone(l.phone, codes.data ?? []);

  const items: KeyValueItem[] = [
    { id: 'at', label: t('leads.card.at'), value: formatMomentRu(new Date(l.at)) },
    {
      id: 'name',
      label: t('leads.card.name'),
      value: <span className="font-semibold">{l.name}</span>,
    },
    { id: 'firm', label: t('leads.card.firm'), value: l.firm },
    {
      id: 'phone',
      label: t('leads.card.phone'),
      value: <PhoneLinks t={t} phone={l.phone} text={phone} />,
    },
    { id: 'size', label: t('leads.card.size'), value: l.size || '—' },
    { id: 'telegram', label: t('leads.card.telegram'), value: l.telegram || faint },
    {
      id: 'note',
      label: t('leads.card.note'),
      value: l.note ? (
        <span className="[overflow-wrap:anywhere] whitespace-pre-wrap">{l.note}</span>
      ) : (
        faint
      ),
    },
    {
      id: 'org',
      label: t('leads.card.org'),
      value: l.org ? (
        <button
          type="button"
          data-lead-org=""
          className={linkButtonClass()}
          onClick={() => {
            onOrgLink();
            if (l.org) requestOrgCard(l.org.id);
            router.push(tabHref('orgs', 'list'));
          }}
        >
          {l.org.name}
        </button>
      ) : (
        faint
      ),
    },
  ];

  return (
    <>
      <Box>
        <StatusScales>
          {view.kind === 'scale' ? (
            <StatusScale
              {...view.props}
              onStep={(to) => onStep(to as LeadStatus)}
              onBack={(to) => onBack(to as LeadStatus)}
            />
          ) : view.kind === 'none' ? (
            <StatusNone
              title={view.title}
              text={view.text}
              since={view.since}
              undo={
                backTo
                  ? {
                      label: t('status.undo_none', { name: statusName(t, 'lead', l.status) }),
                      onClick: () => onBack(backTo),
                    }
                  : null
              }
            />
          ) : null}
        </StatusScales>
      </Box>
      <Box>
        <KeyValues items={items} />
      </Box>
      <AdminNoteBox key={`${l.id}-${l.version}`} t={t} l={l} />
      <Box title={t('leads.card.status_hist')}>
        <StatusHistory rows={history.rows} totals={history.totals} labels={historyLabels(t)} />
      </Box>
      <Box title={t('leads.card.hist')}>
        <Timeline items={leadHistoryItems(t, l)} label={t('leads.card.hist')} />
      </Box>
    </>
  );
}

/**
 * «Заметка администратора» (прототип openLead, `#ld-note`): видит только администратор платформы;
 * без изменений — «Изменений нет» без записи, иначе — запись в «Историю» и «Заметка сохранена».
 */
function AdminNoteBox({ t, l }: { t: Translate; l: AdminLeadCard }) {
  const id = useId();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useLeadsRefresh();
  const [note, setNote] = useState(l.adminNote);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const text = note.trim();
    if (text === l.adminNote) return toast(t('leads.toast.note_same'));
    setBusy(true);
    const res = await saveLeadNote(l.id, { note: text, version: l.version });
    setBusy(false);
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const next = AdminLeadCard.safeParse(res.data);
    if (next.success) client.setQueryData(leadCardQuery(l.id).queryKey, next.data);
    toast(t('leads.toast.note_saved'));
  };

  return (
    <Box>
      <Field
        id={`${id}-note`}
        label={t('leads.card.admin_note')}
        hint={t('leads.card.admin_note_hint')}
        full
      >
        {(control) => (
          <textarea
            {...control}
            data-lead-note=""
            className={inputClass({ multiline: true })}
            value={note}
            maxLength={LEAD_ADMIN_NOTE_MAX}
            placeholder={t('leads.card.admin_note_placeholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <button
          type="button"
          data-lead-note-save=""
          className={buttonClass('default', 'sm')}
          disabled={busy}
          onClick={() => void save()}
        >
          {t('leads.card.admin_note_save')}
        </button>
      </div>
    </Box>
  );
}
