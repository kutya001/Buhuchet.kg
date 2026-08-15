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
  Clock,
  Sparkles,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { getPlatformSummaryStatsAction } from '@/app/super-admin/actions';
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
      title="Панель Управления Платформой"
      description="Сводный мониторинг тенантов, пользователей, облачного хранилища и подписок"
      icon={ShieldCheck}
    >
      <div className="space-y-6">
        {/* Кнопка обновления */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-xs">
              <Sparkles className="h-3 w-3 mr-1" />
              Кэш агрегации: 60 сек (admin-stats)
            </Badge>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={loadStats}
            className="border-border text-foreground hover:bg-accent text-xs h-8"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Обновить сводку
          </Button>
        </div>

        {/* Метрики платформы */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {/* Организации */}
          <Card className="bg-card border-border p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Организации</span>
                <span className="text-2xl font-bold font-mono text-foreground mt-1 block">
                  {stats?.companies?.total || 0}
                </span>
              </div>
              <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
                <Building2 className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] flex items-center justify-between text-muted-foreground">
              <span>Активных: <strong className="text-emerald-400">{stats?.companies?.active || 0}</strong></span>
              {Number(stats?.companies?.pending || 0) > 0 && (
                <span className="text-amber-400 font-bold">На модерации: {stats?.companies?.pending}</span>
              )}
            </div>
          </Card>

          {/* Пользователи */}
          <Card className="bg-card border-border p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Пользователи</span>
                <span className="text-2xl font-bold font-mono text-foreground mt-1 block">
                  {stats?.users?.total || 0}
                </span>
              </div>
              <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
                <Users className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              Все зарегистрированные аккаунты
            </div>
          </Card>

          {/* Документы */}
          <Card className="bg-card border-border p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Документооборот</span>
                <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                  {stats?.documents?.total || 0}
                </span>
              </div>
              <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
                <FileText className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              Все первичные документы
            </div>
          </Card>

          {/* Хранилище R2 */}
          <Card className="bg-card border-border p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Объем R2</span>
                <span className="text-xl font-bold font-mono text-amber-400 mt-1 block truncate">
                  {formatBytes(stats?.files?.total_size_bytes || 0)}
                </span>
              </div>
              <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400">
                <HardDrive className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              Файлов: <strong className="text-foreground">{stats?.files?.total || 0}</strong>
            </div>
          </Card>

          {/* Подписки */}
          <Card className="bg-card border-border p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block">Подписки</span>
                <span className="text-2xl font-bold font-mono text-purple-400 mt-1 block">
                  {stats?.subscriptions?.active || 0}
                </span>
              </div>
              <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/20 text-purple-400">
                <CreditCard className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
              Просрочено: <strong className="text-rose-400">{stats?.subscriptions?.expired || 0}</strong>
            </div>
          </Card>
        </div>

        {/* Секция Быстрого Перехода */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link href="/super-admin/companies" className="group">
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

          <Link href="/super-admin/users" className="group">
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

          <Link href="/super-admin/files" className="group">
            <Card className="bg-card border-border p-5 hover:border-amber-500/50 transition-all duration-200 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-400">
                  <HardDrive className="h-6 w-6" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-amber-400 group-hover:translate-x-1 transition-all" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm group-hover:text-amber-300 transition-colors">
                  Мониторинг Файлов R2
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  CoW дедупликация, очистка физической очереди и владельцы
                </p>
              </div>
            </Card>
          </Link>

          <Link href="/super-admin/subscriptions" className="group">
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

          <Link href="/super-admin/telegram" className="group">
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
                  Вебхук, привязанные боты, логи доставок и пакетная рассылка
                </p>
              </div>
            </Card>
          </Link>

          <Link href="/super-admin/inspector" className="group">
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
