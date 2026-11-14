'use strict';
// Общий рабочий чат фирмы (поток Т, задача Т8; пакет заказчика 13.11.2026, идея 11 списка «Идеи для Telegram-бота»).
// Бот входит в рабочую группу фирмы в Telegram и каждый рабочий день в час напоминаний (по умолчанию 09:00) пишет туда короткую сводку — без названий контрагентов: в группе может оказаться посторонний.
// Под сводкой — кнопка «Мои»: нажавший получает свой список скрытым сообщением — его видит только он (скрытые сообщения Telegram, Bot API 10.2).
// Правила:
//   — подключает и отключает группу только владелец организации: «Моя организация» → «Настройки» → «Telegram-уведомления» → «Общий чат фирмы». У организации — одна группа;
//   — подключение — одноразовой ссылкой на 15 минут (t.me/<бот>?startgroup=<ключ>): Telegram предлагает выбрать группу, бот пишет в ней «подключён». Ссылку можно
//     переслать, поэтому она одноразовая и короткоживущая; устаревшая — бот отвечает в группе «ссылка устарела» и в группе не остаётся;
//   — в сводке: строка итогов (сдать сегодня, просрочено, ждут подтверждения) и таблица по сотрудникам (сдать сегодня, просрочено). Только числа и имена сотрудников —
//     ни контрагентов, ни сумм. Нечего сдавать и нет просроченного — сводка не приходит. Выходные и праздники — без сводки;
//   — «Мои»: Telegram нажавшего должен быть привязан к учётной записи этой организации (не заблокированной) с правом «Просматривать отчёты»; иначе — скрытый отказ.
//     Список — отчёты, где нажавший ответственный: просроченные и со сроком сегодня (контрагент, отчёт, срок), до 20 строк, остальное — на сайте;
//     «Мои» ничего не меняет, поэтому работает и при выключенных «Действиях из Telegram»;
//   — скрытое сообщение Telegram доставляет без гарантии и может убрать само (например, после перезапуска приложения). Поэтому над чатом нажавший видит и короткую
//     всплывающую подсказку: список не пришёл — команда «Сегодня» в личном чате с ботом (задача Т5);
//   — бота удалили из группы — сводки прекращаются, в «Настройках» видно «Бот удалён из группы» и «Подключить заново»; группа стала супергруппой — бот продолжает
//     в новой (Telegram сообщает её номер сам);
//   — «Отключить»: бот пишет в группе «отключён» и выходит из неё; подключение, отключение и удаление бота из группы — в истории организации.
// Тексты — шаблоны «Справочников платформы» (tgGrp…, tgBtnGrpMine).
const TG_GRP_LINK_MIN=15,TG_GRP_DEMO='Бухгалтерия — рабочий чат';
const tgGrp=()=>ORG.tgGroup||null;
// Числа сводки по всей организации: сдать сегодня, просрочено (сдача и оплата налога), ждут подтверждения; по сотрудникам — сегодня и просрочено
function tgGrpRows(){const E={},at=id=>E[id||'']||(E[id||'']={id:id||'',today:0,over:0});let today=0,over=0,wait=0;
  REPORTS.forEach(r=>{if(r.superseded||!CPM[r.cp]||CPM[r.cp].archived)return;
    if(tgRepOpen(r)){if(r.due<TODAY){at(r.resp).over++;over++}else if(r.due===TODAY){at(r.resp).today++;today++}}
    if(tgPayOpen(r)&&r.payDue<TODAY){at(r.resp).over++;over++}
    if(repWait(r))wait++});
  const name=x=>x.id?empName(x.id)||'—':'Без ответственного';
  const rows=Object.values(E).filter(x=>x.today||x.over).sort((a,b)=>b.over-a.over||b.today-a.today||name(a).localeCompare(name(b),'ru'));
  return {rows,name,today,over,wait}}
// Сообщение сводки в группу; null — сводку не отправлять
function tgGrpMsg(at){const G=tgGrpRows();if(!G.today&&!G.over)return null;
  return {h:tplFill('tgGrpHead',{день:tgDayWords(TODAY)}),sub:tplFill('tgGrpSub',{сегодня:G.today,просрочено:G.over,ждут:G.wait}),at,
    tables:[Object.assign({head:['Сотрудник','Сегодня','Просроч.'],num:[1,2]},tgRows(G.rows,x=>[G.name(x),String(x.today),String(x.over)]))],
    btns:[[{t:tgBtnT('tgBtnGrpMine','Мои'),act:'grpMine',icon:'user'}]]}}
// «Мои»: свой список скрытым сообщением. В макете нажимает тот, кто вошёл
tgAct('grpMine',{perm:'repView',noLink:'tgGrpNoLink',run:u=>{const L=[];
  REPORTS.forEach(r=>{if(r.superseded||r.resp!==u.id||!CPM[r.cp]||CPM[r.cp].archived)return;
    if(tgRepOpen(r)&&r.due<=TODAY)L.push({r,due:r.due,pay:false});if(tgPayOpen(r)&&r.payDue<TODAY)L.push({r,due:r.payDue,pay:true})});
  L.sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:a.r.id-b.r.id);
  toast(tplFill('tgGrpMineToast',{}),'tg');
  if(!L.length)return {eph:tplFill('tgGrpMineNone',{})};
  const today=L.filter(x=>x.due===TODAY).length;
  return {eph:{h:tplFill('tgGrpMineHead',{сегодня:today,просрочено:L.length-today}),
    tables:[Object.assign({head:['Контрагент','Отчёт','Срок'],num:[2]},tgRows(L,x=>[CPM[x.r.cp].name,tgRepCell(x.r)+(x.pay?' — оплата':''),x.due===TODAY?'сегодня':tgDM(x.due)]))]}}}});
// Окно группы: та же переписка, что чат с ботом, но в группе фирмы
function tgGrpChat(list,sub){const g=tgGrp();tgBotDlg(me(),list,{who:g?g.title:TG_GRP_DEMO,group:true,title:'Прототип: общий чат фирмы',sub:sub||'Так сводка выглядит в группе фирмы в Telegram'})}
function tgGrpSample(){const at=tgnAt(),m=tgGrpMsg(at);tgGrpChat([{day:'Сегодня'},m||{t:'Сегодня сдавать нечего и просроченного нет — в такой день сводка не приходит.',at}],
  'Нажмите «Мои» — список увидите только вы')}
// Строка «Общий чат фирмы» блока «Telegram-уведомления» (пакет 14.11.2026, блок 3; до этого — отдельный блок «Общий чат фирмы в Telegram»).
// Переключатель строки — «Сводка дня в группу»; подключает и отключает группу только владелец, сразу, без «Сохранить»
function tgGrpRow(own){const g=tgGrp(),dis=own?'':'disabled',at=tgnAt();
  const base={id:'group',title:'Общий чат фирмы',to:'group',icon:'chat',days:'По рабочим дням',at:`${at}, в час напоминаний`,often:'Раз в день; нечего сдавать и нет просроченного — сводки нет',
    hint:'Бот пишет в рабочую группу фирмы короткую сводку дня — без названий контрагентов. Кнопка «Мои» под сводкой показывает каждому его список: его видит только нажавший.'};
  if(!g)return tgnRow({...base,set:`<span class="grow hint">${own?'Группа не подключена.':'Группа не подключена. Подключает владелец организации.'}</span><button class="btn sm" id="tgg-link" ${dis}>${ic('tg','sm')}Подключить группу</button>`});
  const head=`${g.gone?pill('Бот удалён из группы',{'Бот удалён из группы':['red','alert']}):pill('Подключена',{Подключена:['green','check']})}<b>${esc(g.title)}</b><span class="hint">${esc(empName(g.by)||'—')}, ${esc(fmtD(g.at.slice(0,10)))}</span>`;
  if(g.gone)return tgnRow({...base,set:`<div class="row grow">${head}</div><div class="note">${ic('info')}<span>Бота удалили из группы — сводки туда не приходят. Подключите группу заново.</span></div><div class="row grow"><div class="grow"></div><button class="btn sm" id="tgg-off" ${dis}>Забыть группу</button><button class="btn sm cta" id="tgg-link" ${dis}>${ic('tg','sm')}Подключить заново</button></div>`});
  return tgnRow({...base,on:g.summary!==false,dis:!own,why:own?'':'Меняет только владелец организации',
    set:`<div class="row grow">${head}</div><div class="row grow"><button class="linkbtn" id="tgg-show">${ic('chat','sm')}Показать пример</button><div class="grow"></div>${own?`<button type="button" class="linkbtn" id="tgg-gone">В макете: бота удалили из группы</button><button class="btn sm danger" id="tgg-off">Отключить группу</button>`:''}</div>`})}
function tgGrpMount(root){const q=s=>root.querySelector(s),own=me().role==='owner',redraw=()=>refreshAll();
  if(q('#tgg-link'))q('#tgg-link').onclick=()=>{if(own)tgGrpLinkDlg(redraw)};
  if(q('#tgg-show'))q('#tgg-show').onclick=tgGrpSample;
  const sw=q('[data-tgn-sw="group"]');if(sw)sw.onchange=e=>{if(!own)return;ORG.tgGroup.summary=e.target.checked;log('org','settings',`Сводка дня в общий чат Telegram: ${e.target.checked?'включена':'выключена'}`);redraw();toast(e.target.checked?'Сводка дня включена':'Сводка дня выключена','tg')};
  if(q('#tgg-gone'))q('#tgg-gone').onclick=()=>{ORG.tgGroup.gone=true;log('org','settings',`Бота удалили из общего чата Telegram «${ORG.tgGroup.title}»`);redraw()};
  if(q('#tgg-off'))q('#tgg-off').onclick=()=>{if(!own)return;const g=tgGrp();confirmDlg({title:'Отключить общий чат?',text:g.gone?'Группа будет забыта: бота в ней уже нет.':`Бот напишет в группе «${g.title}», что отключён, и выйдет из неё. Сводки туда больше не придут.`,ok:'Отключить',danger:true,
    run:()=>{log('org','settings',`Общий чат Telegram «${g.title}» отключён`);ORG.tgGroup=null;redraw();toast('Общий чат отключён','tg')}})}}
// Подключение: одноразовая ссылка на 15 минут
function tgGrpLinkDlg(done){const key=Math.random().toString(36).slice(2,12),url=`https://t.me/buhuchet_bot?startgroup=g_${key}`,until=addMinutes(bishkekNow().hm,TG_GRP_LINK_MIN);
  openModal({size:'mid',render:m=>({title:'Подключить общий чат фирмы',sub:'Бот войдёт в рабочую группу фирмы в Telegram',
    body:`<ol style="margin:0 0 0 18px;padding:0;display:grid;gap:4px"><li>Нажмите «Открыть Telegram» на телефоне или компьютере, где у вас Telegram.</li><li>Telegram предложит выбрать группу — выберите рабочую группу фирмы и добавьте бота.</li><li>Бот напишет в группе, что подключён. Здесь появится название группы.</li></ol>
    <div class="row" style="margin-top:10px"><span class="mono grow" style="word-break:break-all">${esc(url)}</span></div>
    <div class="note">${ic('info')}<span>Ссылка одноразовая и действует до ${esc(until)} (${TG_GRP_LINK_MIN} минут). В группе могут быть посторонние: бот пишет туда только числа и имена сотрудников, без контрагентов и сумм.</span></div>`,
    foot:`<button type="button" class="linkbtn" id="tgg-demo">В макете: группа подключена</button><div class="grow"></div><button class="btn" id="tgg-copy">${ic('copy','sm')}Скопировать ссылку</button><button class="btn cta" id="tgg-open">${ic('tg','sm')}Открыть Telegram</button>`,
    mount(el){el.querySelector('#tgg-copy').onclick=()=>copyText(url,'Ссылка скопирована',true);
      el.querySelector('#tgg-open').onclick=()=>toast('В Telegram откроется выбор группы: '+url,'link');
      el.querySelector('#tgg-demo').onclick=()=>{const prev=tgGrp();ORG.tgGroup={title:prev?prev.title:TG_GRP_DEMO,at:nowStamp(),by:me().id,summary:prev?prev.summary!==false:true};
        log('org','settings',`Подключён общий чат Telegram «${ORG.tgGroup.title}»`);TG_LOG.unshift({id:TG_LOG.length+1,at:nowStamp(),to:'Группа «'+ORG.tgGroup.title+'»',org:ORG.name,kind:'Общий чат подключён',st:'Доставлено',tries:1,err:''});
        m.close();if(done)done();
        tgGrpChat([{day:'Сегодня'},{t:tplFill('tgGrpLinked',{группа:ORG.tgGroup.title,организация:ORG.name}),at:bishkekNow().hm}],'Бот подключился к группе и написал об этом')}}})})}
const addMinutes=(hm,n)=>{const[h,mi]=hm.split(':').map(Number),t=(h*60+mi+n)%1440;return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`};
