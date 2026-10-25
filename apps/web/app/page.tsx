import Link from 'next/link';

// TODO(l10n): временные тексты до модуля «Локализация» (этап 1).
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">Buhuchet.kg</h1>
      <p className="text-slate-600 dark:text-slate-400">
        Идёт разработка. Вход в программу появится в этапе 1.
      </p>
      <Link href="/health" className="text-sky-700 underline dark:text-sky-400">
        Проверка работы системы
      </Link>
    </main>
  );
}
