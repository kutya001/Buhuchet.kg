'use strict';
// Заявка с лендинга в Telegram — с кнопками (поток Т, задача Т6; пакет заказчика 13.11.2026, идея 14 списка «Идеи для Telegram-бота»).
// Раньше заявка приходила администратору платформы одной строкой со ссылкой, а статус менялся только в Админке.
// Теперь сообщение — заголовок, таблица «Фирма / Контрагентов / Контакт» и кнопки «Взять в работу», «Отклонить», «Открыть в Админке».
// Правила:
//   — кнопки работают только у активного администратора платформы и только в привязанном чате; остальным — «Нет права»;
//   — «Взять в работу» — только из «Новая»; «Отклонить» — пока заявка не «Подключена» и не «Отказ»; иначе «Кнопка устарела»
//     (заявку уже взял другой администратор, её изменили на сайте или удалили);
//   — причина отказа обязательна, как на сайте: бот просит её ответом на своё сообщение и ждёт до конца дня; без причины заявка не меняется;
//   — статус меняется так же, как в «Заявках»: та же запись «Статус: A → B (причина)» в истории заявки, с пометкой «через Telegram»;
//     снять «Отказ», «Подключена» и «Создать организацию» — только на сайте;
//   — в сообщении те же данные, что и раньше: фирма, имя, телефон, сколько клиентов; комментарий гостя и его Telegram — только в Админке;
//   — простой текст — прежние шаблоны «новая заявка с сайта» и «повторная заявка с сайта» со ссылкой; кнопки остаются в обоих видах.
const LEAD_WHY_MAX=300,LEAD_FIRM_MAX=60;
const leadById=id=>LEADS.find(x=>x.id===id);
const leadFirm=o=>tgClip(String(o.firm||''),LEAD_FIRM_MAX);
const leadAdm=u=>!!u&&u.id==='admin';
// Кнопки — по статусу заявки на момент отправки: у повторной заявки, которую уже взяли в работу, «Взять в работу» нет
function leadMsg(o,rep,at){const b=[];
  if(o.status==='Новая')b.push({t:tgBtnT('tgBtnLeadWork','Взять в работу'),act:'leadWork',arg:o.id,icon:'hourglass'});
  if(o.status!=='Отказ'&&o.status!=='Подключена')b.push({t:tgBtnT('tgBtnLeadNo','Отклонить'),act:'leadNo',arg:o.id,icon:'ban'});
  return {h:(LAND.test?'🧪 Тестовый стенд · ':'')+tplFill(rep?'tgLeadRepHead':'tgLeadHead',{}),plain:leadTgText(o,rep),at,
    tables:[{rows:[['Фирма',o.firm],['Контрагентов',o.size||'—'],['Контакт',`${o.name}, ${fmtPhone(o.phone)}`]].concat(rep?[['Статус',o.status]]:[])}],
    btns:[b,[{t:tgBtnT('tgBtnLeadOpen','Открыть в Админке'),url:leadLink(),go:()=>leadTgGo(o)}]].filter(r=>r.length)}}
function leadTgGo(o){MODALS.slice().forEach(m=>m.close());landToAdmin();if(LEADS.includes(o))openLead(o)}
// Та же смена статуса, что на сайте (leadSet), от имени нажавшего администратора и с пометкой «через Telegram»
function leadTgSet(o,to,suf,u){leadSet(o,to,suf,u.id);o.hist[o.hist.length-1].via='tg';dbSoon()}
const leadNoStale=(u,id)=>{const o=leadById(id);return !o||o.status==='Отказ'||o.status==='Подключена'};
tgAct('leadWork',{scope:leadAdm,stale:(u,id)=>{const o=leadById(id);return !o||o.status!=='Новая'},
  run:(u,id)=>{const o=leadById(id);leadTgSet(o,'В работе','',u);return {done:'✓ В работе',eph:tplFill('tgActLeadWork',{фирма:leadFirm(o)})}}});
tgAct('leadNo',{scope:leadAdm,stale:leadNoStale,
  run:(u,id)=>{const o=leadById(id);return {ask:{act:'leadNoWhy',arg:id,kind:'text',ph:'Например: нужна программа с проводками',re:leadFirm(o),t:tplFill('tgLeadAskWhy',{фирма:leadFirm(o)})}}}});
// Причина — текст до 300 знаков, скобки убираются (в истории причина стоит в скобках). Ответ проходит те же проверки, что и нажатие
tgAct('leadNoWhy',{scope:leadAdm,stale:leadNoStale,
  reply:(u,id,p)=>{const o=leadById(id),why=String(p.text||'').replace(/[()]/g,'').replace(/\s+/g,' ').trim().slice(0,LEAD_WHY_MAX);if(!why)return {again:tplFill('tgAskNeedText',{})};
    leadTgSet(o,'Отказ',` (${why})`,u);return {done:'✓ Отказ',off:['leadWork'],say:tplFill('tgLeadRefused',{фирма:leadFirm(o),причина:why})}}});

// Окно «Сообщение администратору в Telegram»: после заявки на лендинге и из меню строки «Заявок» (live — список под окном перерисовывается после нажатия)
function leadTgDlg(o,rep,live){const to=leadAdmins(),sub=LAND.test?'Тестовый стенд: от бота стенда администраторам стенда, в Telegram рабочего сайта не уходит':'Администраторам платформы с привязанным Telegram';
  if(!to.length)return openModal({render:()=>({title:'Прототип: сообщение в Telegram',sub,
    body:`<div class="note warn">${ic('alert')}<span>Сообщение некому отправить: ни у одного администратора платформы не привязан Telegram. Над вкладкой «Заявки» — предупреждение.</span></div>`,
    foot:'<button class="btn ghost" data-close>Закрыть</button><button class="btn cta" id="lp-adm">Открыть «Заявки» в Админке</button>',mount(el,m){$('#lp-adm',el).onclick=()=>{m.close();landToAdmin()}}})});
  tgBotDlg(to[0],[{day:'Сегодня'},tgIn('lead',leadMsg(o,rep,bishkekNow().hm))],{live:!!live,who:LAND.test?'Бот тестового стенда':'Buhuchet.kg',title:'Прототип: сообщение в Telegram',sub:`${sub} · ${to.map(u=>u.tg).join(', ')}`,
    note:`Нажмите «Взять в работу» или «Отклонить»: статус заявки меняется так же, как в «Заявках», запись в её истории — с пометкой «через Telegram». Кнопки работают только у администратора платформы. Заголовок, подписи кнопок и ответы бота — шаблоны «Telegram: заявка с сайта — …» (Справочники платформы → «Шаблоны»); простой текст — шаблон «${rep?'Telegram: повторная заявка с сайта':'Telegram: новая заявка с сайта'}». Отправка записана в журнал «Телеграм» с типом «Заявка с сайта».`})}
