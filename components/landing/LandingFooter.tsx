'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldCheck, Mail, MapPin, Send } from 'lucide-react';

export function LandingFooter() {
  return (
    <footer className="bg-card border-t border-border pt-16 pb-12 text-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          {/* О ПРОЕКТЕ */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span className="text-lg font-extrabold tracking-tight text-foreground">
                BuhUchet<span className="text-blue-500">.kg</span>
              </span>
            </Link>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Единая цифровая B2B-платформа и Telegram-экосистема первичного учёта для предприятий и бухгалтеров Кыргызской Республики.
            </p>
          </div>

          {/* НАВИГАЦИЯ */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground font-mono">
              Платформа
            </h4>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li>
                <a href="#features" className="hover:text-foreground transition-colors">
                  Возможности
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="hover:text-foreground transition-colors">
                  Как это работает
                </a>
              </li>
              <li>
                <a href="#audience" className="hover:text-foreground transition-colors">
                  Для бизнеса и бухгалтеров
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-foreground transition-colors">
                  Тарифные планы
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-foreground transition-colors">
                  Вопросы и ответы (FAQ)
                </a>
              </li>
            </ul>
          </div>

          {/* ДОСТУП И СЕРВИСЫ */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground font-mono">
              Личный кабинет
            </h4>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li>
                <Link href="/login" className="hover:text-foreground transition-colors">
                  Вход в систему
                </Link>
              </li>
              <li>
                <Link href="/register" className="hover:text-foreground transition-colors">
                  Регистрация компании
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-foreground transition-colors">
                  Рабочий дашборд
                </Link>
              </li>
              <li>
                <a href="https://t.me/BuhUchetKgBot" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-blue-400" />
                  <span>Telegram-бот @BuhUchetKgBot</span>
                </a>
              </li>
            </ul>
          </div>

          {/* КОНТАКТЫ И ЛОКАЦИЯ */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground font-mono">
              Контакты
            </h4>
            <ul className="space-y-2.5 text-xs text-muted-foreground">
              <li className="flex items-center space-x-2">
                <Mail className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span>support@buhuchet.kg</span>
              </li>
              <li className="flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span>г. Бишкек, Кыргызская Республика</span>
              </li>
              <li className="pt-1">
                <span className="text-[11px] text-muted-foreground/80">
                  Соответствует стандартам НК КР (НДС 12%, 14-значные ИНН)
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* НИЖНЯЯ СТРОКА */}
        <div className="pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© 2026 BuhUchet.kg. Все права защищены.</p>
          <div className="flex items-center space-x-6">
            <span>Электронный документооборот КР</span>
            <span>Безопасный облачный диск</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
