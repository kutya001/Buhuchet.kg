'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { Star, Quote } from 'lucide-react';

const TESTIMONIALS = [
  {
    text: 'BuhUchet.kg полностью изменил наш подход к первичке. Теперь сотрудники фотографируют накладные на складе, а бухгалтер мгновенно видит их в системе. Время на сверки сократилось в 4 раза!',
    author: 'Айбек Касымов',
    position: 'Владелец торговой сети, Бишкек',
    initials: 'АК',
    gradient: 'from-blue-600 to-indigo-600',
  },
  {
    text: 'Как главный бухгалтер на аутсорсе, я веду 12 компаний. Благодаря платформе все документы систематизированы по закрытым периодам, а Telegram-бот снял с меня 80% рутинных звонков.',
    author: 'Нуржан Абдиева',
    position: 'Сертифицированный бухгалтер-практик (CAP/CIPA)',
    initials: 'НА',
    gradient: 'from-purple-600 to-pink-600',
  },
  {
    text: 'Telegram-оповещения — это очень удобно! Я всегда в курсе, какие акты согласованы поставщиками и когда закрыт месяц. Очень прозрачный и понятный сервис для предпринимателей.',
    author: 'Максат Султанов',
    position: 'Управляющий партнер HoReCa, Ош',
    initials: 'МС',
    gradient: 'from-emerald-600 to-teal-600',
  },
];

export function LandingTestimonials() {
  return (
    <section className="py-24 bg-background relative border-t border-border/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
            Отзывы наших клиентов
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground">
            Что говорят предприниматели и профессиональные бухгалтеры Кыргызстана
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {TESTIMONIALS.map((item, idx) => (
            <div
              key={idx}
              className="bg-card/70 backdrop-blur-md border border-border rounded-3xl p-8 flex flex-col justify-between shadow-lg relative hover:shadow-xl transition-all"
            >
              <div className="space-y-4">
                <div className="flex items-center space-x-1 text-amber-400">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-current" />
                  ))}
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed italic font-normal">
                  «{item.text}»
                </p>
              </div>

              <div className="flex items-center space-x-3.5 pt-6 mt-6 border-t border-border">
                <div
                  className={`w-11 h-11 rounded-full bg-gradient-to-tr ${item.gradient} text-white flex items-center justify-center font-bold text-sm shadow-md flex-shrink-0`}
                >
                  {item.initials}
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-foreground truncate">{item.author}</h4>
                  <p className="text-xs text-muted-foreground truncate">{item.position}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
