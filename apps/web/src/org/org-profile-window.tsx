'use client';

import { buttonClass, Icon, Modal, Note, useWindow } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useT } from '../l10n/provider';
import { phoneCodesQuery } from '../staff/staff-data';
import { orgProfileQuery, policyQuery } from './org-data';
import { OrgMainView } from './org-main';

/** Адрес вкладки «Основное» «Моей организации». */
const ORG_MAIN_HREF = '/app/org/main';

/**
 * Профиль организации по нажатию на организацию в левой панели и в панели «Меню» телефона (прототип
 * modules/profile.js, orgProfileDlg): сведения «Основного» только для просмотра; с правом «Настройки и
 * учётная политика» — «Редактировать», которая ведёт на «Основное».
 */
export function OrgProfileWindow({
  open,
  onClose,
  name,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  /** Название организации, пока сведения загружаются. */
  name: string;
  canEdit: boolean;
}) {
  const t = useT();
  const profile = useQuery({ ...orgProfileQuery, enabled: open });
  const policy = useQuery({ ...policyQuery, enabled: open });
  const codes = useQuery({ ...phoneCodesQuery, enabled: open });
  const failed = profile.isError || policy.isError || codes.isError;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={profile.data?.name ?? name}
      sub={t('org.profile.sub')}
      footer={<ProfileFooter canEdit={canEdit} />}
    >
      {failed ? <Note tone="bad">{t('org.load_error')}</Note> : null}
      {profile.data && policy.data && codes.data ? (
        <OrgMainView
          profile={profile.data}
          cppage={policy.data.features.cppage}
          codes={codes.data}
        />
      ) : null}
    </Modal>
  );
}

function ProfileFooter({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const { close, leave } = useWindow();
  return (
    <>
      <div className="flex-1" />
      {canEdit ? (
        <button
          type="button"
          className={buttonClass('default')}
          onClick={() => {
            leave();
            router.replace(ORG_MAIN_HREF);
          }}
        >
          <Icon name="edit" size="sm" />
          {t('org.profile.edit')}
        </button>
      ) : null}
      <button type="button" className={buttonClass('cta')} onClick={close}>
        {t('btn.close')}
      </button>
    </>
  );
}
