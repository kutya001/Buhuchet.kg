'use client';

import { formatCount } from '@buhuchet/domain';
import { Box, Hint } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../l10n/provider';
import { fileSizeText, fileUsageQuery } from './files-data';

/**
 * «Хранилище файлов» в «Моя организация» → «Настройки» (задача 2.29; ТЗ «в «Моя организация» виден
 * занятый объём»; прототип modules/org.js, `#org-storage`): «Занято 12,4 МБ · файлов: 37» и
 * «Ограничение на один файл — 20 МБ». Блок видят все, кто открывает «Настройки», как в прототипе;
 * считаются файлы в области группы «Файловый менеджер».
 */
export function FilesStorageBox() {
  const t = useT();
  const usage = useQuery(fileUsageQuery);
  if (!usage.data) return null;
  return (
    <div data-org-storage="">
      <Box title={t('files.storage.title')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex-1">
            {t('files.storage.used')} <b>{fileSizeText(t, usage.data.bytes)}</b> ·{' '}
            {t('files.storage.files', { n: formatCount(usage.data.count) })}
          </span>
          <Hint>{t('files.storage.limit')}</Hint>
        </div>
      </Box>
    </div>
  );
}
