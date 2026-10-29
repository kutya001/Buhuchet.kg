'use client';

import type { Feature } from '@buhuchet/domain';
import { buttonClass, Icon, Modal } from '@buhuchet/ui';
import { useFeatureLesson } from '../kb/kb-provider';
import { useT } from '../l10n/provider';

/**
 * Окно после включения функций (прототип modules/onboard.js, featOnDlg): что даёт каждая и «Пройти
 * урок», когда урок есть в «Базе знаний». Открывают переключатель учётной политики (одна функция) и
 * «Пройти опросник заново» (несколько — «Включено функций: N»).
 */
export function FeatureOnDialog({
  features,
  open,
  onClose,
}: {
  features: readonly Feature[];
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const learn = useFeatureLesson(features);
  const name = (f: Feature) => t(`org.feature.${f}`);
  const one = features.length === 1;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="message"
      size="mid"
      title={
        one
          ? t('org.feature.on_title', { name: name(features[0]!) })
          : t('onboarding.feat_on.title_many', { n: features.length })
      }
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('org.feature.later')}
          </button>
          {learn ? (
            <button
              type="button"
              className={buttonClass('cta')}
              onClick={() => {
                onClose();
                learn();
              }}
            >
              <Icon name="play" size="sm" />
              {t('kb.feat_on.learn')}
            </button>
          ) : null}
        </>
      }
    >
      {features.map((f) => (
        <div
          key={f}
          data-feature-on={f}
          className="flex items-start gap-2.5 rounded-xl border border-line px-3 py-2"
        >
          <span className="inline-grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] bg-info-bg text-info">
            <Icon name="ok" />
          </span>
          <div className="min-w-0 grow">
            <b>{name(f)}</b>
            <p className="mt-[3px] mb-0 text-[13px] leading-[1.45] text-muted">
              {t(`org.feature.${f}.benefit`)}
            </p>
          </div>
        </div>
      ))}
      {learn ? (
        <p className="m-0 text-muted">
          {t(one ? 'kb.feat_on.text' : 'onboarding.feat_on.text_many')}
        </p>
      ) : null}
    </Modal>
  );
}
