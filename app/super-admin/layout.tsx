import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Shield, ArrowLeft, LogOut } from 'lucide-react';
import Link from 'next/link';
import { signOutAction } from '../(auth)/actions';
import { Button } from '@/components/ui/button';

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Проверяем флаг is_super_admin в таблице users
  const { data: profile } = await supabase
    .from('users')
    .select('is_super_admin, full_name')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_super_admin) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 max-w-full overflow-x-hidden">
      {/* АДАПТИВНАЯ МОБИЛЬНАЯ ШАПКА СУПЕРАДМИНА */}
      <header className="border-b border-amber-500/20 bg-amber-500/5 px-3 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 backdrop-blur-xl">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex-shrink-0">
            <Shield className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-white tracking-tight text-sm sm:text-base truncate">
                Панель Суперадминистратора
              </span>
              <span className="bg-amber-500/20 text-amber-300 text-[10px] uppercase font-mono px-2 py-0.5 rounded border border-amber-500/30 flex-shrink-0">
                SYSTEM ADMIN
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 truncate">
              Глобальный контроль над всеми 6 модулями системы
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end space-x-2 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-800/60">
          <Link href="/dashboard">
            <Button
              variant="outline"
              size="sm"
              className="border-slate-800 text-slate-300 hover:text-white text-xs min-h-[44px]"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              В Дашборд
            </Button>
          </Link>

          <form action={signOutAction}>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-red-400 text-xs min-h-[44px]"
            >
              <LogOut className="h-4 w-4 mr-1.5" />
              Выход
            </Button>
          </form>
        </div>
      </header>

      {/* РАБОЧАЯ ОБЛАСТЬ СУПЕРАДМИНА — 100% ШИРИНЫ БЕЗ СТАРОГО 240px САЙДБАРА */}
      <main className="flex-1 p-2 sm:p-6 overflow-y-auto max-w-full overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
