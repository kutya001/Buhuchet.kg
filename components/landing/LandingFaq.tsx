'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const FAQ_ITEMS = [
  {
    question: 'Подходит ли платформа для малого бизнеса и ИП в Кыргызстане?',
    answer:
      'Да, платформа полностью адаптирована под законодательство и форматы первичного учета Кыргызской Республики (14-значный ИНН, НДС 12%, накладные, акты). Гибкие тарифы позволяют начать с минимальными затратами и масштабироваться по мере роста документооборота.',
  },
  {
    question: 'Как обеспечивается безопасность и конфиденциальность данных?',
    answer:
      'Все файлы шифруются и хранятся на распределенном облачном диске Cloudflare R2. База данных PostgreSQL защищена политиками Row Level Security (RLS) и аппаратными триггерами, исключающими несанкционированный доступ между компаниями-тенантами.',
  },
  {
    question: 'Можно ли экспортировать документы и синхронизировать с 1С?',
    answer:
      'Да, реестры первичных документов поддерживают мгновенный экспорт в Excel/XLSX и подготовлены для быстрой пакетной загрузки в учетные конфигурации 1С:Бухгалтерия для Кыргызстана.',
  },
  {
    question: 'Есть ли бесплатный пробный период?',
    answer:
      'Да, при регистрации любой тарифный план активируется в бесплатном тестовом режиме на 14 дней с полным доступом ко всем возможностям документооборота, облачного диска и Telegram-бота.',
  },
  {
    question: 'Как стать экспертом или подключить свою аутсорсинговую компанию?',
    answer:
      'После создания аккаунта вы можете зарегистрировать организацию как бухгалтерскую фирму, пригласить сотрудников с ролями Главного бухгалтера или Бухгалтера и вести неограниченное число клиентских компаний в едином окне.',
  },
];

export function LandingFaq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleItem = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section id="faq" className="py-24 bg-card/40 relative border-t border-border/40">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Часто задаваемые вопросы
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground">
            Ответы на популярные вопросы о возможностях, безопасности и внедрении платформы
          </p>
        </div>

        <div className="space-y-4">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm transition-all"
              >
                <button
                  onClick={() => toggleItem(idx)}
                  className="w-full text-left p-5 sm:p-6 flex items-center justify-between gap-4 font-semibold text-foreground hover:text-blue-500 transition-colors focus:outline-none"
                >
                  <span className="text-base sm:text-lg">{item.question}</span>
                  <div
                    className={`w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 transition-transform duration-300 ${
                      isOpen ? 'rotate-180 bg-blue-500/10 text-blue-500' : 'text-muted-foreground'
                    }`}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </button>

                {isOpen && (
                  <div className="px-5 pb-6 sm:px-6 sm:pb-6 text-sm text-muted-foreground leading-relaxed border-t border-border/40 pt-4 animate-in fade-in-50 duration-200">
                    <p>{item.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
