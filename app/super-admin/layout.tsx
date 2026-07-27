import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Shield, Building2, ArrowLeft, LogOut } from 'lucide-react';
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
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Super-Admin Banner / Navbar */}
      <header className="h-16 border-b border-amber-500/20 bg-amber-500/5 px-6 flex items-center justify-between backdrop-blur-xl">
        <div className="flex items-center space-x-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-white tracking-tight">Панель Суперадминистратора</span>
              <span className="bg-amber-500/20 text-amber-300 text-[10px] uppercase font-mono px-2 py-0.5 rounded border border-amber-500/30">
                System Admin
              </span>
            </div>
            <p className="text-xs text-slate-400">Глобальное управление организациями и подписками клиентов</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <Link href="/dashboard">
            <Button variant="outline" size="sm" className="border-slate-800 text-slate-300 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Вернуться в Дашборд
            </Button>
          </Link>

          <form action={signOutAction}>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-red-400">
              <LogOut className="h-4 w-4 mr-1.5" />
              Выход
            </Button>
          </form>
        </div>
      </header>

      {/* Main Administrative Workspace */}
      <div className="flex-1 flex min-w-0">
        {/* Navigation Sidebar */}
        <aside className="w-60 border-r border-slate-800 bg-slate-900/30 p-4 space-y-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">
            Разделы управления
          </div>
          <nav className="space-y-1">
            <Link
              href="/super-admin"
              className="flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 transition-all"
            >
              <Building2 className="h-4 w-4" />
              <span>Реестр организаций</span>
            </Link>
          </nav>
        </aside>

        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
