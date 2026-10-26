import Link from 'next/link';
import { getT } from '../src/l10n/server';

export default async function HomePage() {
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">Buhuchet.kg</h1>
      <p className="text-slate-600 dark:text-slate-400">{t('home.in_progress')}</p>
      <Link href="/health" className="text-sky-700 underline dark:text-sky-400">
        {t('health.title')}
      </Link>
    </main>
  );
}
