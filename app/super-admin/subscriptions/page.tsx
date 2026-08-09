'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CreditCard, CheckCircle2, ShieldCheck, Zap } from 'lucide-react';
import { UnifiedWorkspaceLayout } from '@/components/ui/unified/UnifiedWorkspaceLayout';

export default function SuperAdminSubscriptionsPage() {
  return (
    <UnifiedWorkspaceLayout
      title="Управление подписками и лимитами"
      description="Контроль тарифных планов, квот дискового пространства и объемов первички"
      icon={CreditCard}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-card border-border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-foreground text-base">Базовый тариф</h3>
            <Badge variant="outline" className="border-border text-muted-foreground text-xs">Стандарт</Badge>
          </div>
          <p className="text-2xl font-bold font-mono text-amber-400">0 сом <span className="text-xs text-muted-foreground font-normal">/ мес</span></p>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> До 50 документов в месяц</li>
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> 1 ГБ на облачном диске</li>
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> До 3 сотрудников</li>
          </ul>
        </Card>

        <Card className="bg-card border-amber-500/30 p-6 space-y-4 relative overflow-hidden shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-foreground text-base">Бизнес тариф</h3>
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-xs">Популярный</Badge>
          </div>
          <p className="text-2xl font-bold font-mono text-amber-400">1 500 сом <span className="text-xs text-muted-foreground font-normal">/ мес</span></p>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Неограниченно документов</li>
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> 15 ГБ на облачном диске</li>
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> До 15 сотрудников</li>
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Автоматическая выгрузка в 1С</li>
          </ul>
        </Card>

        <Card className="bg-card border-purple-500/30 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-foreground text-base">Корпоративный</h3>
            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-xs">VIP</Badge>
          </div>
          <p className="text-2xl font-bold font-mono text-purple-400">Индивидуальный</p>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Безлимитный облачный диск</li>
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Выделенный сервер 1С</li>
            <li className="flex items-center"><CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Персональный бухгалтер-консультант</li>
          </ul>
        </Card>
      </div>
    </UnifiedWorkspaceLayout>
  );
}
