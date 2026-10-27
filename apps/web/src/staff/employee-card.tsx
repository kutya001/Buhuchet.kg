'use client';

import { formatMomentRu } from '@buhuchet/domain';
import type { Employee } from '@buhuchet/shared';
import {
  ActionMenu,
  Box,
  buttonClass,
  Icon,
  iconButtonClass,
  KeyValues,
  MiniTable,
  Modal,
  Note,
  type ActionEntry,
  type CardTab,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useState, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { EmployeeWalletsBox } from '../money/wallets';
import { useEmployee } from './staff-data';

type CardTabId = 'main' | 'cps';

/**
 * Карточка сотрудника (прототип modules/staff.js, empCard): вкладки «Основное» — кто создал и изменил,
 * логин, телефон со ссылками «Позвонить» и WhatsApp, роль, Telegram, последний вход, статус — и
 * «Контрагенты» — закреплённые за ним контрагенты. Внизу «Изменить» — ФИО и телефон (docs/deviations.md,
 * п. 16; ТЗ: «кнопкой «Изменить» в карточке сотрудника»; у владельца — только в своей карточке),
 * «Действия» (те же пункты, что в меню списка, кроме «Открыть карточку» и «Изменить»; без права
 * «Сотрудники и роли» и у владельца организации кнопки нет) и
 * «Готово». Плашки «Несданных отчётов», «Просрочено», «Открытых задач», вкладку «Счёт», реквизиты и
 * уровень знаний добавят их модули; список контрагентов наполнит модуль «Контрагенты».
 */
export function EmployeeCard({
  id,
  initial,
  open,
  onClose,
  actions,
  onEdit,
}: {
  id: string;
  /** Строка списка — показывается, пока карточка не загрузилась. */
  initial: Employee | null;
  open: boolean;
  onClose: () => void;
  /** Пункты «Действия» для сотрудника; пусто — кнопки нет. */
  actions: (e: Employee) => ActionEntry[];
  /** Кнопка «Изменить» (ФИО и телефон) у этого сотрудника; null — кнопки нет. */
  onEdit: (e: Employee) => (() => void) | null;
}) {
  const t = useT();
  const query = useEmployee(id);
  const employee = query.data ?? initial;
  const [tab, setTab] = useState<CardTabId>('main');
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const items = employee ? actions(employee) : [];
  const edit = employee ? onEdit(employee) : null;
  const tabs: CardTab[] = [
    { id: 'main', label: t('staff.card.tab.main'), icon: 'user' },
    { id: 'cps', label: t('staff.card.tab.cps'), icon: 'building' },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={employee?.fullName ?? ''}
      sub={
        employee
          ? employee.active
            ? employee.role.name
            : t('staff.card.blocked', { role: employee.role.name })
          : undefined
      }
      tabs={{
        items: tabs,
        active: tab,
        onSelect: (next) => setTab(next as CardTabId),
        label: t('staff.card.tabs'),
      }}
      footer={
        <>
          {edit ? (
            <button type="button" className={buttonClass('default')} onClick={edit}>
              <Icon name="edit" size="sm" />
              {t('staff.action.edit')}
            </button>
          ) : null}
          {items.length > 0 ? (
            <button
              type="button"
              className={buttonClass('default')}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              onClick={(e) => setMenu(menu ? null : e.currentTarget)}
            >
              <Icon name="more" size="sm" />
              {t('staff.action.more')}
            </button>
          ) : null}
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <div data-employee-card={id} className="flex flex-col gap-3.5">
        {query.isError && !employee ? <Note tone="bad">{t('staff.card.load_error')}</Note> : null}
        {employee && tab === 'main' ? <MainTab t={t} e={employee} /> : null}
        {employee && tab === 'cps' ? <ContractorsTab t={t} /> : null}
      </div>
      {menu && employee ? (
        <ActionMenu
          items={items}
          place={{ anchor: menu }}
          label={t('staff.action.more')}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </Modal>
  );
}

/** Кто и когда: имя, под ним момент мелким серым (прототип `auditKv`, `.aud`). */
function Audit({ who, at }: { who: string | null; at: string }) {
  return (
    <>
      {who ?? '—'}
      <span className="block text-[11.5px] text-faint">{formatMomentRu(new Date(at))}</span>
    </>
  );
}

/** Телефон: «Позвонить» по ссылке tel: и «Написать в WhatsApp» (прототип `phoneHtml`). */
function PhoneValue({ t, e }: { t: Translate; e: Employee }): ReactNode {
  if (!e.phone) return <span className="text-faint">—</span>;
  const digits = e.phone.replace(/\D/g, '');
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={`tel:+${digits}`} title={t('staff.card.call')} className="font-mono text-inherit">
        {e.phoneText ?? e.phone}
      </a>
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noopener noreferrer"
        title={t('staff.card.whatsapp')}
        aria-label={t('staff.card.whatsapp')}
        className={iconButtonClass('sm')}
      >
        <Icon name="chat" size="sm" />
      </a>
    </span>
  );
}

function MainTab({ t, e }: { t: Translate; e: Employee }) {
  const items: KeyValueItem[] = [
    {
      id: 'created',
      label: t('grid.col.created_by'),
      value: <Audit who={e.audit.createdBy} at={e.audit.createdAt} />,
    },
    {
      id: 'updated',
      label: t('grid.col.updated_by'),
      value: <Audit who={e.audit.updatedBy ?? e.audit.createdBy} at={e.audit.updatedAt} />,
    },
    { id: 'login', label: t('staff.col.login'), value: e.login, mono: true },
    { id: 'phone', label: t('staff.col.phone'), value: <PhoneValue t={t} e={e} /> },
    { id: 'role', label: t('staff.col.role'), value: e.role.name },
    {
      id: 'telegram',
      label: t('staff.col.telegram'),
      value: e.telegram ? (
        e.telegram.name
      ) : (
        <span className="text-caution-label">{t('staff.telegram.none_pill')}</span>
      ),
    },
    {
      id: 'last-login',
      label: t('staff.col.last_login'),
      value: e.lastLoginAt ? formatMomentRu(new Date(e.lastLoginAt)) : t('staff.card.never'),
    },
    {
      id: 'status',
      label: t('staff.col.active'),
      value: t(e.active ? 'staff.active' : 'staff.blocked'),
    },
  ];
  return (
    <>
      <Box>
        <KeyValues items={items} />
      </Box>
      <EmployeeWalletsBox employeeId={e.id} />
    </>
  );
}

/**
 * Закреплённые контрагенты (прототип empCard, вкладка «cps»): контрагент, режим, несданных,
 * просрочено. Пока модуля «Контрагенты» нет, закреплённых нет; «Передать контрагентов» появится с ним.
 */
function ContractorsTab({ t }: { t: Translate }) {
  return (
    <>
      <div className="text-[13px] text-muted">{t('staff.card.cps_count', { n: 0 })}</div>
      <Box>
        <MiniTable
          label={t('staff.card.tab.cps')}
          columns={[
            { key: 'name', label: t('staff.card.cps.name') },
            { key: 'regime', label: t('staff.card.cps.regime') },
            { key: 'open', label: t('staff.card.cps.open'), numeric: true },
            { key: 'overdue', label: t('staff.card.cps.overdue'), numeric: true },
          ]}
          rows={[]}
          empty={t('staff.card.cps.empty')}
        />
      </Box>
    </>
  );
}
