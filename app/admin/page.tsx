'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Building2,
  Users,
  FileText,
  HardDrive,
  CreditCard,
  Send,
  Database,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { getPlatformSummaryStatsAction } from '@/app/admin/actions';
import { formatBytes } from '@/lib/utils';
import { toast } from 'sonner';

export default function SuperAdminDashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    setLoading(true);
    const res = await getPlatformSummaryStatsAction();
    if (res.success && res.data) {
      setStats(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить сводную статистику платформы');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <UnifiedWorkspaceLayout
      title="Панель суперадминистратора"
      description="Централизованный мониторинг тенантов, пользователей, файлов и Telegram-уведомлений"
      icon={ShieldCheck}
      actionButtonsSlot={
        <Button
          onClick={loadStats}
          disabled={loading}
          variant="outline"
          className="border-border text-xs min-h-[40px]"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Обновить метрики
        </Button>
      }
    >
      <div className="w-full space-y-6">
        {/* Метрики Платформы */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {/* 1. Организации */}
          <Card className="bg-card border-border p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Организации</span>
                <span className="text-2xl font-bold font-mono text-indigo-400 mt-1 block">
                  {stats?.companies?.total || 0}
                </span>
              </div>
              <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
                <Building2 className="h-6 w-6" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              На модерации: <strong className="text-amber-400">{stats?.companies?.pending || 0}</strong>
            </div>
          </Card>

          {/* 2. Пользователи */}
          <Card className="bg-card border-border p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Пользователи</span>
                <span className="text-2xl font-bold font-mono text-blue-400 mt-1 block">
                  {stats?.users?.total || 0}
                </span>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400">
                <Users className="h-6 w-6" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              Активных: <strong className="text-emerald-400">{stats?.users?.active || 0}</strong>
            </div>
          </Card>

          {/* 3. Документы ЭДО */}
          <Card className="bg-card border-border p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Документы</span>
                <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                  {stats?.documents?.total || 0}
                </span>
              </div>
              <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">
                <FileText className="h-6 w-6" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              Закрыто периодов: <strong className="text-foreground">{stats?.documents?.closedPeriods || 0}</strong>
            </div>
          </Card>

          {/* 4. Физические Файлы */}
          <Card className="bg-card border-border p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Файлы на диске</span>
                <span className="text-2xl font-bold font-mono text-amber-400 mt-1 block">
                  {stats?.files?.totalCount || 0}
                </span>
              </div>
              <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400">
                <HardDrive className="h-6 w-6" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              Объем: <strong className="text-foreground">{formatBytes(stats?.files?.totalBytes || 0)}</strong>
            </div>
          </Card>

          {/* 5. Telegram */}
          <Card className="bg-card border-border p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Telegram связи</span>
                <span className="text-2xl font-bold font-mono text-sky-400 mt-1 block">
                  {stats?.telegram?.connectionsCount || 0}
                </span>
              </div>
              <div className="p-3 bg-sky-500/10 rounded-xl text-sky-400">
                <Send className="h-6 w-6" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              Оповещений: <strong className="text-foreground">{stats?.telegram?.logsCount || 0}</strong>
            </div>
          </Card>

          {/* 6. Подписки */}
          <Card className="bg-card border-border p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Подписки</span>
                <span className="text-2xl font-bold font-mono text-purple-400 mt-1 block">
                  {stats?.subscriptions?.active || 0}
                </span>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400">
                <CreditCard className="h-6 w-6" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              Просрочено: <strong className="text-rose-400">{stats?.subscriptions?.expired || 0}</strong>
            </div>
          </Card>
        </div>

        {/* Секция Быстрого Перехода */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link href="/admin/companies" className="group">
            <Card className="bg-card border-border p-5 hover:border-indigo-500/50 transition-all duration-200 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-2.5 bg-indigo-500/10 rounded-xl text-indigo-400">
                  <Building2 className="h-6 w-6" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm group-hover:text-indigo-300 transition-colors">
                  Реестр Организаций
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Модерация, активация, блокировка и детальный профиль тенантов
                </p>
              </div>
            </Card>
          </Link>

          <Link href="/admin/users" className="group">
            <Card className="bg-card border-border p-5 hover:border-blue-500/50 transition-all duration-200 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400">
                  <Users className="h-6 w-6" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm group-hover:text-blue-300 transition-colors">
                  Реестр Пользователей
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Управление ролями, сброс паролей и аудит авторизаций
                </p>
              </div>
            </Card>
          </Link>

          <Link href="/admin/files" className="group">
            <Card className="bg-card border-border p-5 hover:border-amber-500/50 transition-all duration-200 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-400">
                  <HardDrive className="h-6 w-6" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-amber-400 group-hover:translate-x-1 transition-all" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm group-hover:text-amber-300 transition-colors">
                  Облачный диск и файлы
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Служебный реестр файлов, совладельцы и очистка очереди
                </p>
              </div>
            </Card>
          </Link>

          <Link href="/admin/subscriptions" className="group">
            <Card className="bg-card border-border p-5 hover:border-purple-500/50 transition-all duration-200 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400">
                  <CreditCard className="h-6 w-6" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-purple-400 group-hover:translate-x-1 transition-all" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm group-hover:text-purple-300 transition-colors">
                  Тарифы и Подписки
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Контроль срока действия, квот и проверка просроченных тарифов
                </p>
              </div>
            </Card>
          </Link>

          <Link href="/admin/telegram" className="group">
            <Card className="bg-card border-border p-5 hover:border-sky-500/50 transition-all duration-200 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-2.5 bg-sky-500/10 rounded-xl text-sky-400">
                  <Send className="h-6 w-6" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-sky-400 group-hover:translate-x-1 transition-all" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm group-hover:text-sky-300 transition-colors">
                  Центр Telegram
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Вебхук, привязанные боты, логи доставок и журнал оповещений
                </p>
              </div>
            </Card>
          </Link>

          <Link href="/admin/inspector" className="group">
            <Card className="bg-card border-border p-5 hover:border-emerald-500/50 transition-all duration-200 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400">
                  <Database className="h-6 w-6" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm group-hover:text-emerald-300 transition-colors">
                  Инспектор Базы Данных
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Прямой просмотр и валидация таблиц PostgreSQL
                </p>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </UnifiedWorkspaceLayout>
  );
}
