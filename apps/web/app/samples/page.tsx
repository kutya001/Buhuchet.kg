import { siteInfo } from '@buhuchet/api/web';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { StatusSamples } from '../../src/samples/status-samples';
import { MAX_COOKIE, parseMaxPrefs } from '../../src/shell/prefs';
import { requestNow, requireMe } from '../../src/shell/server';

/** Где страница есть: проверка закрывает её, если среда окажется любой другой. */
const SAMPLE_ENVS: ReadonlySet<string> = new Set(['local', 'test', 'staging']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Образцы общих компонентов на демо-данных (задача #17) — для проверки на стенде и сквозных тестов.
 * Страница есть только на своём компьютере, в тестах и на стенде (на рабочем сайте и в неизвестной
 * среде — 404), и только после входа. Среда — из `siteInfo`: настройки окружения страница сама не читает.
 */
export default async function SamplesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!SAMPLE_ENVS.has(siteInfo().env)) notFound();
  const me = await requireMe();
  const store = await cookies();
  const { cp } = await searchParams;
  return (
    <StatusSamples
      actor={me.employee?.shortName ?? me.user.login}
      canRollback={me.permissions.includes('rollback')}
      showFiles={me.permissions.includes('filesView') && me.features.files === true}
      showPick={me.permissions.includes('cpView')}
      cp={typeof cp === 'string' && UUID.test(cp) ? cp : null}
      canEditCp={me.permissions.includes('createCp')}
      initialMax={parseMaxPrefs(store.get(MAX_COOKIE)?.value)}
      now={requestNow()}
    />
  );
}
