'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileText, Lock, Mail, Loader2, AlertCircle } from 'lucide-react';
import { loginAction } from '../actions';

export default function LoginPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await loginAction(formData);
      if (!result.success) {
        setErrorMsg(result.error || 'Ошибка входа');
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    });
  };

  return (
    <Card className="w-full border-slate-800 shadow-2xl backdrop-blur-xl">
      <CardHeader className="space-y-3 text-center pb-6 border-b border-slate-800/60">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
          <FileText className="h-6 w-6" />
        </div>
        <div>
          <CardTitle className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            Buhuchet.kg
          </CardTitle>
          <CardDescription className="text-slate-400 mt-1">
            Система автоматизации первичной документации
          </CardDescription>
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4 pt-6">
          {errorMsg && (
            <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Электронная почта</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="accountant@company.kg"
                required
                className="pl-9 bg-slate-900/60 border-slate-800 focus:border-blue-500 text-slate-100 placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Пароль</Label>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                className="pl-9 bg-slate-900/60 border-slate-800 focus:border-blue-500 text-slate-100 placeholder:text-slate-500"
              />
            </div>
          </div>
        </CardContent>

        <CardFooter className="pt-2 pb-6 flex flex-col space-y-4">
          <Button
            type="submit"
            disabled={isPending}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/25 transition-all duration-200"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Выполняется вход...
              </>
            ) : (
              'Войти в систему'
            )}
          </Button>

          <p className="text-center text-xs text-slate-500">
            Мультиарендная платформа учета документов КР
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
