'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Clock, Building2, CheckCircle2, AlertCircle, RefreshCw, LogOut, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { signOutAction } from '@/app/(auth)/actions';

export default function PendingApplicationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [companyName, setCompanyName] = useState<string | null>(null);

  const supabase = createClient();

  const checkStatus = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: prof } = await supabase
        .from('users')
        .select('company_id, role, companies(name)')
        .eq('id', user.id)
        .single();

      if (prof?.role === 'owner' || prof?.role === 'accountant') {
        router.push('/dashboard');
        return;
      }

      if (prof?.companies) {
        setCompanyName((prof.companies as any).name);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleCancelRequest = async () => {
    if (!confirm('Вы действительно хотите отозвать заявку и выбрать другую компанию?')) return;

    startTransition(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        await supabase.from('users').update({ company_id: null, position: null }).eq('id', user.id);
        router.push('/onboarding');
      }
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full bg-card/90 border-border rounded-2xl shadow-2xl p-6 space-y-6">
        <CardHeader className="p-0 space-y-2 text-center">
          <div className="mx-auto p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 w-16 h-16 flex items-center justify-center text-amber-400">
            <Clock className="w-8 h-8 animate-pulse" />
          </div>
          <CardTitle className="text-xl font-extrabold tracking-tight">Заявка на рассмотрении</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Ваш запрос на присоединение к организации находится у Руководителя
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0 space-y-4">
          <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-400 rounded-xl">
            <Building2 className="w-5 h-5 shrink-0" />
            <AlertDescription className="text-xs font-medium leading-normal ml-2">
              Заявка отправлена в компанию <strong>«{companyName || 'Организация'}»</strong>. Ожидайте подтверждения доступа владельцем бизнеса.
            </AlertDescription>
          </Alert>

          <div className="space-y-3 pt-2">
            <Button
              onClick={checkStatus}
              disabled={loading}
              className="w-full h-11 rounded-xl font-bold text-xs gap-2 bg-primary text-primary-foreground"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Проверить статус заявки</span>
            </Button>

            <Button
              variant="outline"
              onClick={handleCancelRequest}
              disabled={isPending}
              className="w-full h-11 rounded-xl font-bold text-xs gap-2 border-border text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Отозвать заявку / Выбрать другую компанию</span>
            </Button>

            <Button
              variant="ghost"
              onClick={() => signOutAction()}
              className="w-full h-10 rounded-xl font-medium text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
            >
              <LogOut className="w-4 h-4 mr-2" />
              <span>Выйти из аккаунта</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
