'use client';

import type { KbIoDict } from '@buhuchet/domain';
import { useCallback, useState } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { NewsAdminList } from '../news/news-admin';
import { ExportDialog, ImportDialog, IoBar } from '../platform-dicts/io-dialogs';
import { useKbAdmAdd } from './kbadm-add';

/*
 * Админка → «База знаний (содержимое)» → «Выгрузить» и «Загрузить» (задача 2.39, часть 2; прототип
 * kb-content.js `ioBar('kbsteps')`…, пункты «+ Добавить» `io('kbsteps')`): те же окна, что у
 * справочников платформы; загрузка — в «Загрузки» Справочников платформы, откат — там же; после
 * загрузки и отката вкладки обновляет `usePdictsRefresh`.
 */

type IoAction = 'export' | 'import';

/**
 * Строка «Выгрузка и загрузка через Excel…» под пояснением вкладки и окна выгрузки и загрузки; пункты
 * «+ Добавить» «Выгрузить в Excel» и «Загрузить из Excel» открывают те же окна.
 */
export function useKbAdmIo(dict: KbIoDict) {
  const [io, setIo] = useState<DialogSlot<IoAction> | null>(null);
  const open = useCallback((action: IoAction) => setIo(openSlot<IoAction>(action)), []);
  useKbAdmAdd('io_export', () => open('export'));
  useKbAdmAdd('io_import', () => open('import'));
  const bar = <IoBar onExport={() => open('export')} onImport={() => open('import')} />;
  const dialogs =
    io?.data === 'export' ? (
      <ExportDialog
        key={`io-${io.n}`}
        dict={dict}
        open={io.open}
        onClose={() => setIo(closeSlot)}
      />
    ) : io ? (
      <ImportDialog
        key={`io-${io.n}`}
        dict={dict}
        open={io.open}
        onClose={() => setIo(closeSlot)}
      />
    ) : null;
  return { bar, dialogs };
}

/** Вкладка «Новости»: список новостей (задача 2.32) со строкой выгрузки и загрузки под пояснением. */
export function KbAdmNewsTab() {
  const io = useKbAdmIo('kbnews');
  return (
    <>
      <NewsAdminList ioBar={io.bar} />
      {io.dialogs}
    </>
  );
}
