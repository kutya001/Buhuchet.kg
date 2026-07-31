import React from 'react';
import { signInAction } from '../actions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileText, ArrowRight, AlertCircle, Shield, UserPlus, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="w-full flex flex-col items-center justify-center bg-transparent relative">
      {/* Dynamic Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Back to Home Link */}
      <div className="w-full max-w-md mb-4 relative z-10">
        <Link
          href="/"
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Вернуться на главную (Лендинг)
        </Link>
      </div>

      <Card className="w-full max-w-md bg-card border-border backdrop-blur-xl shadow-2xl relative z-10">
        <CardHeader className="text-center space-y-2 pb-6 border-b border-border">
          <Link href="/" className="inline-block">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 mx-auto border border-blue-500/30 hover:scale-105 transition-transform">
              <FileText className="h-6 w-6" />
            </div>
          </Link>
          <CardTitle className="text-2xl font-bold text-foreground tracking-tight">
            Вход в B2B Сеть Buhuchet.kg
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Платформа обмена первичными документами и сканами КР
          </CardDescription>
        </CardHeader>

        <form action={signInAction}>
          <CardContent className="space-y-4 pt-6">
            {error && (
              <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground">Рабочий E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="owner@buhuchet.kg"
                required
                className="bg-background border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-foreground">Пароль</Label>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                className="bg-background border-border text-foreground placeholder:text-muted-foreground font-mono"
              />
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-4 pt-2 pb-6 border-t border-border mt-4">
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-600/20 min-h-[44px]"
            >
              Войти в личный кабинет
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            <div className="text-center pt-2 border-t border-border w-full">
              <span className="text-xs text-muted-foreground">Ещё нет аккаунта организации? </span>
              <Link href="/register" className="text-xs font-bold text-blue-400 hover:underline inline-flex items-center ml-1">
                <UserPlus className="h-3.5 w-3.5 mr-1" />
                Зарегистрироваться
              </Link>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
