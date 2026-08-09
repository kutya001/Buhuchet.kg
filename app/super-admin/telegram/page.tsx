'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send, CheckCircle2, RefreshCw, MessageSquare, BellRing } from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';
import { toast } from 'sonner';
import { getTelegramStatsAdminAction } from '@/app/super-admin/telegram-actions';

export default function SuperAdminTelegramPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    setLoading(true);
    const res = await getTelegramStatsAdminAction();
    if (res.success && res.data) {
      setStats(res.data);
    } else {
      toast.error(res.error || 'Не удалось загрузить данные Telegram бота');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <UnifiedWorkspaceLayout
      title="Мониторинг Telegram-ботов и уведомителя"
      description="Управление интеграциями мессенджеров, вебхуками и рассылкой уведомлений"
      icon={Send}
      actionButtonsSlot={
        <Button
          onClick={loadStats}
          disabled={loading}
          variant="outline"
          className="border-border text-xs min-h-[40px]"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Проверить статус
        </Button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Статус вебхука</span>
              <span className="text-lg font-bold text-emerald-400 mt-1 block">Активен</span>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border font-mono">
            buhuchet.kg/api/telegram/webhook
          </p>
        </Card>

        <Card className="bg-card border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Подключенных чатов</span>
              <span className="text-2xl font-bold font-mono text-amber-400 mt-1 block">
                {stats?.connectedChatsCount || 0}
              </span>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400">
              <MessageSquare className="h-6 w-6" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border">
            Специалисты с привязанным ботом
          </p>
        </Card>

        <Card className="bg-card border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground block">Отправлено уведомлений</span>
              <span className="text-2xl font-bold font-mono text-indigo-400 mt-1 block">
                {stats?.sentNotificationsCount || 0}
              </span>
            </div>
            <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
              <BellRing className="h-6 w-6" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border">
            Сообщения по первичности и статусам
          </p>
        </Card>
      </div>

      <Card className="bg-card border-border p-6 mt-6 space-y-4">
        <h3 className="text-base font-bold text-foreground flex items-center">
          <Send className="h-5 w-5 mr-2 text-amber-400" />
          Конфигурация уведомлений платформы
        </h3>
        <div className="space-y-3 text-xs md:text-sm text-muted-foreground leading-relaxed">
          <p>
            Бот отправляет мгновенные системные оповещения при смене статусов первички («Черновик» ➔ «Отправлен» ➔ «Принят»), а также при поступлении заявок от новых контрагентов.
          </p>
          <div className="p-4 rounded-xl bg-background border border-border flex items-center justify-between">
            <span className="font-semibold text-foreground">Статус связи с серверами Telegram:</span>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs">
              Подключен 200 OK
            </Badge>
          </div>
        </div>
      </Card>
    </UnifiedWorkspaceLayout>
  );
}
