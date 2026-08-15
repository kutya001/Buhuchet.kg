import React from 'react';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Building2,
  CheckCircle2,
  Clock,
  FolderOpen,
  Inbox,
  Send,
  Users,
  TrendingUp,
  XCircle,
  AlertCircle,
  ArrowRight,
  Plus,
} from 'lucide-react';
import Link from 'next/link';

import { hasPermission } from '@/lib/auth/permissions';

export default async function DashboardPage() {
  const supabase = await createClient();
  const adminSupabase = await createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // 1. Получаем профиль пользователя вместе с компанией и ролями за 1 запрос
  const { data: profile } = await adminSupabase
    .from('users')
    .select('*, company_roles(*), company:companies!company_id(*)')
    .eq('id', user.id)
    .single();

  const company = (profile as any)?.company || null;
  const companyId = company?.id || profile?.company_id;

  const canCreateDoc = hasPermission(profile, 'documents', 'create');
  const canViewDocs = hasPermission(profile, 'documents', 'view');
  const canViewCounterparties = hasPermission(profile, 'counterparties', 'view');
  const canViewFiles = hasPermission(profile, 'files', 'view');

  // 2. Параллельная выборка всех метрик организации через Promise.all() (устранение Waterfall)
  let incomingCount = 0;
  let outgoingCount = 0;
  let sentCount = 0;
  let acceptedCount = 0;
  let processedCount = 0;
  let draftsCount = 0;
  let cancelledCount = 0;
  let totalDocs = 0;
  let counterpartiesCount = 0;
  let filesCount = 0;

  if (companyId) {
    const [docsRes, counterpartiesRes, filesRes] = await Promise.all([
      adminSupabase
        .from('documents')
        .select('id, sender_company_id, receiver_company_id, status, company_id')
        .or(`sender_company_id.eq.${companyId},receiver_company_id.eq.${companyId}`),
      adminSupabase
        .from('counterparties')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
      adminSupabase
        .from('files')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
    ]);

    const allDocs = docsRes.data;
    if (allDocs) {
      totalDocs = allDocs.length;
      allDocs.forEach((d) => {
        if (d.receiver_company_id === companyId && d.status !== 'draft') {
          incomingCount++;
        }
        if (d.sender_company_id === companyId) {
          outgoingCount++;
        }
        if (d.status === 'sent') sentCount++;
        if (d.status === 'accepted') acceptedCount++;
        if (d.status === 'processed') processedCount++;
        if (d.status === 'draft') draftsCount++;
        if (d.status === 'cancelled') cancelledCount++;
      });
    }

    counterpartiesCount = counterpartiesRes.count || 0;
    filesCount = filesRes.count || 0;
  }

  // Расчет процента успешных документов
  const successRate = totalDocs > 0 ? Math.round(((acceptedCount + processedCount) / totalDocs) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Приветственный заголовок */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
            Добро пожаловать, {profile?.full_name || user?.email}!
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {company?.name
              ? `Сводный аналитический отчет организации: ${company.name} (ИНН: ${company.inn})`
              : 'У вас пока нет привязанной организации'}
          </p>
        </div>

        {canCreateDoc && (
          <Link href="/dashboard/documents/new" prefetch={true}>
            <button className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs sm:text-sm transition-all shadow-md flex items-center justify-center min-h-[48px]">
              <Plus className="h-4 w-4 mr-1.5" />
              Создать документ
            </button>
          </Link>
        )}
      </div>

      {/* Баннер при отсутствии компании */}
      {!companyId && !profile?.is_super_admin && (
        <Card className="bg-gradient-to-r from-blue-950/60 via-slate-900/80 to-blue-900/40 border-blue-500/40 p-6 rounded-2xl shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center space-x-2 text-blue-400 font-bold text-base">
                <Building2 className="w-5 h-5 shrink-0" />
                <span>Организация не привязана</span>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
                Для доступа к функциям ЭДО, отправке первичных документов и работе с контрагентами необходимо зарегистрировать вашу компанию или отправить заявку на присоединение.
              </p>
            </div>
            <Link href="/onboarding" prefetch={true} className="w-full md:w-auto shrink-0">
              <button className="w-full md:w-auto px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm transition-all shadow-lg flex items-center justify-center space-x-2 min-h-[48px]">
                <span>Пройти Онбординг</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
          </div>
        </Card>
      )}

      {/* Баннер модерации (pending_approval) */}
      {company?.status === 'pending_approval' && !profile?.is_super_admin && (
        <div className="flex items-center space-x-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
          <Clock className="h-5 w-5 shrink-0 animate-pulse" />
          <p className="text-xs sm:text-sm font-medium">
            Ваша организация <strong>«{company.name}»</strong> находится на модерации Суперадминистратором. Обмен документами будет доступен сразу после подтверждения.
          </p>
        </div>
      )}

      {/* 1. ГЛАВНЫЕ ПОКАЗАТЕЛИ ДЕЯТЕЛЬНОСТИ (СТАТИСТИКА ДОКУМЕНТОВ) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border backdrop-blur-xl hover:border-sky-500/40 transition-colors shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
              Входящие Документы
            </CardTitle>
            <Inbox className="h-5 w-5 text-sky-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-foreground">{incomingCount}</div>
            <p className="text-xs text-muted-foreground mt-1">От партнеров и контрагентов</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border backdrop-blur-xl hover:border-purple-500/40 transition-colors shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
              Исходящие Документы
            </CardTitle>
            <Send className="h-5 w-5 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-foreground">{outgoingCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Отправлено контрагентам КР</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border backdrop-blur-xl hover:border-emerald-500/40 transition-colors shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
              Прикрепленные Файлы
            </CardTitle>
            <FolderOpen className="h-5 w-5 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-emerald-400">{filesCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Первичка и уставы компаний</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border backdrop-blur-xl hover:border-amber-500/40 transition-colors shadow-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono">
              Реестр Контрагентов
            </CardTitle>
            <Users className="h-5 w-5 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-amber-400">{counterpartiesCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Активных бизнес-партнеров</p>
          </CardContent>
        </Card>
      </div>

      {/* 2. ПОДРОБНЫЙ АНАЛИТИЧЕСКИЙ СТАТУС-ОТЧЕТ И ДИНАМИКА */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Статусы документов */}
        <Card className="lg:col-span-8 bg-card border-border backdrop-blur-xl p-6 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-foreground text-base md:text-lg flex items-center">
                <TrendingUp className="h-5 w-5 mr-2 text-blue-400" />
                Распределение по Статусам Документации
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Аналитика движений всех первичных актов и накладных компании
              </p>
            </div>
            <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
              Успешность {successRate}%
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3.5 rounded-2xl bg-muted/60 border border-border space-y-1">
              <span className="text-[10px] font-mono uppercase text-blue-400 font-semibold">На рассмотрении</span>
              <p className="text-xl font-bold text-foreground">{sentCount}</p>
              <p className="text-[10px] text-muted-foreground">Ожидают принятия</p>
            </div>

            <div className="p-3.5 rounded-2xl bg-muted/60 border border-border space-y-1">
              <span className="text-[10px] font-mono uppercase text-emerald-400 font-semibold">Принято</span>
              <p className="text-xl font-bold text-emerald-400">{acceptedCount}</p>
              <p className="text-[10px] text-muted-foreground">Подтверждены партнером</p>
            </div>

            <div className="p-3.5 rounded-2xl bg-muted/60 border border-border space-y-1">
              <span className="text-[10px] font-mono uppercase text-purple-400 font-semibold">Обработано (1С)</span>
              <p className="text-xl font-bold text-purple-400">{processedCount}</p>
              <p className="text-[10px] text-muted-foreground">Проведены в учете</p>
            </div>

            <div className="p-3.5 rounded-2xl bg-muted/60 border border-border space-y-1">
              <span className="text-[10px] font-mono uppercase text-muted-foreground font-semibold">Черновики</span>
              <p className="text-xl font-bold text-foreground">{draftsCount}</p>
              <p className="text-[10px] text-muted-foreground">На подготовке</p>
            </div>
          </div>

          {/* Индикатор прогресса обработки */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex justify-between text-xs font-mono text-muted-foreground">
              <span>Доля обработанной первички</span>
              <span className="text-emerald-400 font-bold">{successRate}%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden border border-border">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${successRate}%` }}
              />
            </div>
          </div>
        </Card>

        {/* Быстрая навигация */}
        <Card className="lg:col-span-4 bg-card border-border backdrop-blur-xl p-6 space-y-4 shadow-2xl flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="font-bold text-foreground text-base">Быстрый Переход</h3>
            <p className="text-xs text-muted-foreground">
              Оперативный доступ к реестру первичных документов, файлам и контрагентам
            </p>
          </div>

          <div className="space-y-2.5">
            {canViewDocs && (
              <Link href="/dashboard/documents" prefetch={true} className="block">
                <div className="p-3 rounded-xl bg-muted/60 border border-border hover:border-blue-500/50 flex items-center justify-between transition-all">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-foreground">
                    <FileText className="h-4 w-4 text-blue-400" />
                    <span>Реестр документов</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            )}

            {canViewCounterparties && (
              <Link href="/dashboard/counterparties" prefetch={true} className="block">
                <div className="p-3 rounded-xl bg-muted/60 border border-border hover:border-amber-500/50 flex items-center justify-between transition-all">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-foreground">
                    <Users className="h-4 w-4 text-amber-400" />
                    <span>Контрагенты</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            )}

            {canViewFiles && (
              <Link href="/dashboard/files" prefetch={true} className="block">
                <div className="p-3 rounded-xl bg-muted/60 border border-border hover:border-emerald-500/50 flex items-center justify-between transition-all">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-foreground">
                    <FolderOpen className="h-4 w-4 text-emerald-400" />
                    <span>Облачный диск</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
