'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface AccessDeniedCardProps {
  moduleName?: string;
  actionName?: string;
}

export function AccessDeniedCard({ moduleName = 'данному модулю', actionName }: AccessDeniedCardProps) {
  return (
    <div className="flex items-center justify-center p-6 min-h-[60vh]">
      <Card className="max-w-md w-full bg-card/90 border-amber-500/30 text-foreground shadow-xl">
        <CardHeader className="text-center pb-2 pt-6">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mb-3">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <CardTitle className="text-lg font-bold text-foreground">403 — Доступ Запрещен</CardTitle>
          <CardDescription className="text-xs text-slate-400 mt-1">
            У вашей ролевой учетной записи недостаточно прав для доступа к {moduleName}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-2 text-center text-xs">
          <p className="text-slate-300">
            Обратитесь к Администратору вашей организации для изменения ролевой матрицы разрешений во вкладке «Роли и доступы».
          </p>

          <Link href="/uchet" className="inline-block w-full">
            <Button className="w-full bg-muted hover:bg-muted-foreground/20 text-foreground font-bold text-xs min-h-[40px] rounded-xl">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Вернуться на Главную
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
