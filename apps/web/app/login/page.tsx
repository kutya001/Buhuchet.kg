import { BrandMark } from '@buhuchet/ui';
import { redirect } from 'next/navigation';
import { getT } from '../../src/l10n/server';
import { canEnter } from '../../src/shell/modules';
import { loadMe } from '../../src/shell/server';

/** Страница входа. Пока экрана входа нет (задача #13) — пояснение; вошедшего ведёт в программу. */
export default async function LoginPage() {
  if (canEnter(await loadMe())) redirect('/app');
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <div className="flex items-center gap-3">
        <BrandMark />
        <h1 className="m-0 text-2xl font-bold">Buhuchet.kg</h1>
      </div>
      <p className="m-0 text-muted">{t('home.in_progress')}</p>
    </main>
  );
}
