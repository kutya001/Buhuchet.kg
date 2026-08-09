'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Database, RefreshCw, HardDrive, Building2, Users, FileText, ShieldAlert } from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { formatBytes } from '@/lib/utils';
import { toast } from 'sonner';
import { getInspectorStatsAdminAction } from '@/app/super-admin/actions';

export default function SuperAdminInspectorPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    setLoading(true);
    const res = await getInspectorStatsAdminAction({});
    if (res.success && res.data) {
      setStats(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить данные инспектора БД');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <UnifiedWorkspaceLayout
      title="Инспектор базы данных и ресурсов"
      description="Мониторинг таблиц PostgreSQL, объема хранилища и физических показателей"
      icon={Database}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Таблица «companies»</span>
              <span className="text-2xl font-bold font-mono text-amber-400 mt-1 block">
                {stats?.totalCompanies || 0}
              </span>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400">
              <Building2 className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            Записи юридических лиц и ИП
          </div>
        </Card>

        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Таблица «users»</span>
              <span className="text-2xl font-bold font-mono text-indigo-400 mt-1 block">
                {stats?.totalUsers || 0}
              </span>
            </div>
            <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
              <Users className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            Профили и связи ролей
          </div>
        </Card>

        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Таблица «documents»</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
                {stats?.totalDocuments || 0}
              </span>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">
              <FileText className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            Первичные документы ЭДО
          </div>
        </Card>

        <Card className="bg-card border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Облачный диск</span>
              <span className="text-2xl font-bold font-mono text-purple-400 mt-1 block">
                {formatBytes(stats?.totalFilesSize || 0)}
              </span>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400">
              <HardDrive className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            {stats?.totalFiles || 0} файлов в архиве
          </div>
        </Card>
      </div>

      <Card className="bg-card border-border p-6 mt-6 space-y-4">
        <h3 className="text-base font-bold text-foreground flex items-center">
          <ShieldAlert className="h-5 w-5 mr-2 text-purple-400" />
          Состояние безопасности и целостности
        </h3>
        <div className="space-y-3 text-xs md:text-sm text-muted-foreground leading-relaxed">
          <p>
            Все таблицы системы изолированы политиками доступа и автоматическими триггерами блокировки закрытых отчетных периодов.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-background border border-border flex items-center justify-between">
              <span>Изоляция организаций:</span>
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs">Активна</Badge>
            </div>
            <div className="p-3 rounded-xl bg-background border border-border flex items-center justify-between">
              <span>Защита закрытых периодов:</span>
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs">Включена</Badge>
            </div>
          </div>
        </div>
      </Card>
    </UnifiedWorkspaceLayout>
  );
}
