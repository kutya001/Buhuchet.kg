'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FolderOpen, FileText, Users, HardDrive, Building2 } from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import type { CompanyProfileStats } from '@/types/company.types';

interface CompanyStatsGridProps {
  stats: CompanyProfileStats | null;
  loading?: boolean;
}

export function CompanyStatsGrid({ stats, loading }: CompanyStatsGridProps) {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-card/60 rounded-2xl border border-border/80" />
        ))}
      </div>
    );
  }

  const statItems = [
    {
      label: 'Файлов в Хранилище',
      value: stats.totalFiles,
      sub: formatBytes(stats.storageUsedBytes),
      icon: FolderOpen,
      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      label: 'B2B Документов',
      value: stats.totalDocuments,
      sub: 'За все время',
      icon: FileText,
      color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    },
    {
      label: 'Партнеров и Контрагентов',
      value: stats.totalCounterparties,
      sub: 'Связей в КР',
      icon: Building2,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    },
    {
      label: 'Штат Сотрудников',
      value: stats.totalEmployees,
      sub: 'Пользователей',
      icon: Users,
      color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {statItems.map((item, idx) => {
        const Icon = item.icon;
        return (
          <Card key={idx} className="bg-card/80 border-border/80 rounded-2xl shadow-sm hover:shadow-md transition-all">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="space-y-1 min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground truncate">{item.label}</p>
                <p className="text-xl sm:text-2xl font-extrabold text-foreground tracking-tight">{item.value}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">{item.sub}</p>
              </div>
              <div className={`p-3 rounded-xl border shrink-0 ${item.color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
