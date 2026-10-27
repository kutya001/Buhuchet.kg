import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { StatusSamples } from '../../src/samples/status-samples';
import { localApi } from '../../src/server-api';
import { MAX_COOKIE, parseMaxPrefs } from '../../src/shell/prefs';
import { requestNow, requireMe } from '../../src/shell/server';

/**
 * Образцы общих компонентов на демо-данных (задача #17) — для проверки на стенде и сквозных тестов.
 * На рабочем сайте страницы нет (404); на остальных — только после входа. Окружение сайта — из ответа
 * «здоровья» API в том же процессе: настройки окружения страница сама не читает.
 */
export default async function SamplesPage() {
  const health = await (await localApi.api.health.$get()).json();
  if (health.environment === 'production') notFound();
  const me = await requireMe();
  const store = await cookies();
  return (
    <StatusSamples
      actor={me.employee?.shortName ?? me.user.login}
      canRollback={me.permissions.includes('rollback')}
      showFiles={me.permissions.includes('filesView') && me.features.files === true}
      initialMax={parseMaxPrefs(store.get(MAX_COOKIE)?.value)}
      now={requestNow()}
    />
  );
}
