'use client';

import React, { useState } from 'react';
import { signUpAction } from '../actions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Building2,
  UserCheck,
  ArrowRight,
  AlertCircle,
  LogIn,
  UserPlus,
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';

export default function RegisterPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [accountType, setAccountType] = useState<'owner' | 'employee'>('owner');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (password !== confirmPassword) {
      e.preventDefault();
      setClientError('Пароли не совпадают. Проверьте правильность ввода.');
      return;
    }
    if (password.length < 6) {
      e.preventDefault();
      setClientError('Длина пароля должна быть не менее 6 символов.');
      return;
    }
    setClientError(null);
  };

  return (
    <div className="w-full flex flex-col items-center justify-center bg-transparent relative">
      {/* Dynamic Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Back to Home Link */}
      <div className="w-full max-w-xl mb-4 relative z-10">
        <Link
          href="/"
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Вернуться на главную (Лендинг)
        </Link>
      </div>

      <Card className="w-full max-w-xl bg-card border-border backdrop-blur-xl shadow-2xl relative z-10">
        {/* ===================== ШАГ 1: ВЫБОР ТИПА АККАУНТА ===================== */}
        {step === 1 && (
          <div className="p-6 sm:p-8 space-y-6">
            <CardHeader className="text-center space-y-2 p-0 pb-4 border-b border-border">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto border border-primary/20">
                <UserPlus className="h-6 w-6" />
              </div>
              <CardTitle className="text-2xl font-bold text-foreground tracking-tight">
                Создание Учетной Записи
              </CardTitle>
              <CardDescription className="text-muted-foreground text-sm">
                Выберите цель регистрации в платформе электронного документооборота Buhuchet.kg
              </CardDescription>
            </CardHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {/* Карточка 1: Владелец */}
              <button
                type="button"
                onClick={() => {
                  setAccountType('owner');
                  setStep(2);
                }}
                className="p-5 rounded-2xl bg-background/80 border border-border hover:border-amber-500/50 hover:bg-muted/60 text-left transition-all group flex flex-col justify-between space-y-4 cursor-pointer shadow-sm hover:shadow-md"
              >
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500 w-fit border border-amber-500/20 group-hover:scale-105 transition-transform">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-foreground group-hover:text-amber-500 transition-colors">
                    Я Владелец / Руководитель
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Хочу зарегистрировать компанию (ОсОО, ИП, ЗАО), вести учет и приглашать сотрудников.
                  </p>
                </div>

                <div className="flex items-center text-xs font-bold text-amber-500 pt-2">
                  <span>Создать компанию</span>
                  <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              {/* Карточка 2: Сотрудник */}
              <button
                type="button"
                onClick={() => {
                  setAccountType('employee');
                  setStep(2);
                }}
                className="p-5 rounded-2xl bg-background/80 border border-border hover:border-sky-500/50 hover:bg-muted/60 text-left transition-all group flex flex-col justify-between space-y-4 cursor-pointer shadow-sm hover:shadow-md"
              >
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-sky-500/10 text-sky-400 w-fit border border-sky-500/20 group-hover:scale-105 transition-transform">
                    <UserCheck className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-foreground group-hover:text-sky-400 transition-colors">
                    Я Сотрудник компании
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Хочу подключиться к существующей организации по заявке или приглашению.
                  </p>
                </div>

                <div className="flex items-center text-xs font-bold text-sky-400 pt-2">
                  <span>Присоединиться по заявке</span>
                  <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            </div>

            <div className="text-center pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">Уже есть аккаунт? </span>
              <Link href="/login" className="text-xs font-bold text-primary hover:underline ml-1">
                Войти в систему
              </Link>
            </div>
          </div>
        )}

        {/* ===================== ШАГ 2: ВВОД ДАННЫХ ===================== */}
        {step === 2 && (
          <div>
            <CardHeader className="text-center space-y-2 pb-6 border-b border-border relative">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="absolute left-6 top-6 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Назад к выбору</span>
              </button>

              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto border border-primary/20">
                {accountType === 'owner' ? <Building2 className="h-6 w-6" /> : <UserCheck className="h-6 w-6" />}
              </div>
              <div className="flex items-center justify-center space-x-2">
                <CardTitle className="text-2xl font-bold text-foreground tracking-tight">
                  {accountType === 'owner' ? 'Регистрация Владельца' : 'Регистрация Сотрудника'}
                </CardTitle>
              </div>

              <div className="flex justify-center pt-1">
                <Badge
                  className={
                    accountType === 'owner'
                      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs'
                      : 'bg-sky-500/15 text-sky-400 border-sky-500/30 text-xs'
                  }
                >
                  {accountType === 'owner'
                    ? '🏢 Регистрация с созданием организации'
                    : '👤 Учетная запись сотрудника (без создания юрлица)'}
                </Badge>
              </div>

              <CardDescription className="text-muted-foreground text-xs pt-1">
                {accountType === 'owner'
                  ? 'После регистрации вы перейдете к вводу реквизитов организации (онбордингу)'
                  : 'После регистрации вы сможете найти компанию по ИНН и подать заявку на вступление'}
              </CardDescription>
            </CardHeader>

            <form action={signUpAction} onSubmit={handleFormSubmit}>
              <input type="hidden" name="accountType" value={accountType} />

              <CardContent className="space-y-4 pt-6">
                {clientError && (
                  <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{clientError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="fullName" className="text-foreground">
                    {accountType === 'owner' ? 'ФИО Руководителя / Бухгалтера *' : 'Ваше полное ФИО *'}
                  </Label>
                  <Input
                    id="fullName"
                    name="fullName"
                    placeholder="Асанов Асан Асанович"
                    required
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-foreground">
                    {accountType === 'owner' ? 'Официальный Рабочий E-mail *' : 'Личный или рабочий E-mail *'}
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="user@example.kg"
                    required
                    className="bg-background border-border text-foreground placeholder:text-muted-foreground min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-foreground">Пароль *</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="bg-background border-border text-foreground placeholder:text-muted-foreground font-mono min-h-[44px]"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-foreground">Подтверждение пароля *</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="bg-background border-border text-foreground placeholder:text-muted-foreground font-mono min-h-[44px]"
                    />
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col space-y-4 pt-2 pb-6 border-t border-border mt-4">
                <Button
                  type="submit"
                  className={`w-full text-white font-bold shadow-md min-h-[44px] ${
                    accountType === 'owner'
                      ? 'bg-amber-600 hover:bg-amber-500'
                      : 'bg-sky-600 hover:bg-sky-500'
                  }`}
                >
                  {accountType === 'owner' ? 'Продолжить к онбордингу компании' : 'Завершить регистрацию сотрудника'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>

                <div className="text-center pt-2 border-t border-border w-full">
                  <span className="text-xs text-muted-foreground">Уже есть аккаунт? </span>
                  <Link href="/login" className="text-xs font-bold text-primary hover:underline ml-1">
                    Войти в систему
                  </Link>
                </div>
              </CardFooter>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}
