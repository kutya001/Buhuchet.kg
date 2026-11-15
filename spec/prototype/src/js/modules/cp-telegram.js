'use strict';
// Telegram контрагента (пакет заказчика 13.11.2026, поток К, задача К3): клиент сам подключает свой Telegram к боту Buhuchet.kg на странице контрагента,
// подключение подтверждает обслуживающая организация. Подключённый Telegram получает только «К оплате», напоминания о долге и ответы бухгалтера —
// данных других контрагентов, задач и сотрудников бот ему не показывает
/* ═════════════ Telegram контрагента ═════════════ */
// c.tgs — запросы и подключения: {id, name — имя в Telegram, at — когда пришёл запрос, st: wait | on | no | off, by — кто решил (сотрудник или 'client'), doneAt}
// В продукте «Подключить Telegram» выдаёт одноразовую ссылку на бота (действует 24 часа, выдаётся только тому, кто вошёл на страницу по коду);
// чат запоминается по номеру чата Telegram, имя — только для показа сотруднику
const PG_TG_MAX=5,PG_TG_TTL_H=24,PG_TG_KIND='Telegram контрагента';
const PG_TG_ST={wait:'Ждёт подтверждения',on:'Подключён',no:'Отклонён',off:'Отключён'};
const PG_TG_PILL={'Ждёт подтверждения':['yellow','hourglass'],'Подключён':['green','check'],'Отклонён':['gray','ban'],'Отключён':['gray','ban']};
const pgTgs=c=>c.tgs||(c.tgs=[]);
const pgTgN=(c,st)=>(c.tgs||[]).filter(x=>x.st===st).length;
// Занято мест: подключённые и ждущие подтверждения — вместе не больше 5, так страницу нельзя завалить запросами
const pgTgBusy=c=>pgTgN(c,'on')+pgTgN(c,'wait');
// Раздел «Telegram» есть, пока включена страница, раздел включён в учётной политике и не скрыт у контрагента
const pgTgOn=c=>pgOn(c)&&pgSecs(c).includes('tg');
// Кому бот пишет о запросе: ответственному с Telegram, иначе первому владельцу с Telegram (как о закрытой странице)
const pgTgStaff=c=>{const r=EM[c.resp];return r&&r.active!==false&&r.tg?r:EMP.find(e=>e.role==='owner'&&e.active!==false&&e.tg)||null};
const pgTgClientLog=(c,what)=>{HIST.push({at:nowStamp(),who:'client',ent:'cp',id:c.id,cp:c.id,what});dbSoon()};
const pgTgToClient=(c,x)=>tgSvc({short:c.name},PG_TG_KIND,{chat:x.name});

// Запрос из бота: клиент открыл ссылку со страницы и нажал «Старт». Возвращает ответ бота клиенту и сообщение сотруднику
function pgTgRequest(c,name){name=String(name||'').replace(/\s+/g,' ').trim().slice(0,32);const v={контрагент:c.name,телеграм:name};
  if(!pgTgOn(c)||!name)return {bot:tplFill('tgCpLinkBad',v)};
  const was=pgTgs(c).find(x=>x.name===name&&(x.st==='on'||x.st==='wait'));
  if(was)return {bot:tplFill(was.st==='on'?'tgCpAlready':'tgCpAsk',v),x:was};
  if(pgTgBusy(c)>=PG_TG_MAX)return {bot:tplFill('tgCpLimit',v)};
  const x={id:(c.tgs.reduce((a,y)=>Math.max(a,y.id),0)||0)+1,name,at:nowStamp(),st:'wait'};c.tgs.push(x);
  pgTgClientLog(c,`Telegram контрагента: запрос на подключение от «${name}»`);pgTgToClient(c,x);
  const to=pgTgStaff(c);if(to)tgSvc(to,PG_TG_KIND);
  return {bot:tplFill('tgCpAsk',v),x,staff:to,msg:pgTgStaffMsg(c,x)}}
// Сообщение сотруднику о запросе — с кнопками «Подтвердить» и «Отклонить»
const pgTgStaffMsg=(c,x)=>({h:'Telegram контрагента',t:tplFill('tgCpReq',{контрагент:c.name,телеграм:x.name}),at:bishkekNow().hm,
  btns:[[{t:tgBtnT('tgBtnCpOk','Подтвердить'),act:'cptg-ok',arg:{cp:c.id,id:x.id},icon:'check'},{t:tgBtnT('tgBtnCpNo','Отклонить'),act:'cptg-no',arg:{cp:c.id,id:x.id},icon:'x'}]]});
// Что мешает решению сотрудника
function pgTgWhy(c,x,k){if(!can('cpPage'))return 'Нужно право «Управлять страницей контрагента»';
  if(k==='off')return x.st==='on'?'':'Telegram уже не подключён';
  if(x.st!=='wait')return 'Запрос уже рассмотрен';
  if(k==='ok'&&pgTgN(c,'on')>=PG_TG_MAX)return `Уже подключено ${PG_TG_MAX} Telegram: сначала отключите лишний`;
  return ''}
// Решение сотрудника: ok — подтвердить, no — отклонить, off — отключить. via — запись истории «через Telegram»
function pgTgDecide(c,x,k,via){const lg=via?tgLog:log,v={контрагент:c.name,телеграм:x.name};
  x.st={ok:'on',no:'no',off:'off'}[k];x.by=S.me;x.doneAt=nowStamp();
  lg('cp',c.id,`Telegram контрагента «${x.name}»: ${{ok:'подключён',no:'запрос отклонён',off:'отключён'}[k]}`,c.id);pgTgToClient(c,x);
  return tplFill({ok:'tgCpOn',no:'tgCpNo',off:'tgCpOff'}[k],v)}
// Клиент отключается сам командой «Отключить» в боте
function pgTgLeave(c,x){x.st='off';x.by='client';x.doneAt=nowStamp();pgTgClientLog(c,`Telegram контрагента «${x.name}»: отключён контрагентом`);pgTgToClient(c,x);return tplFill('tgCpOff',{контрагент:c.name,телеграм:x.name})}

// Кнопки под сообщением сотруднику: право «Управлять страницей контрагента», контрагент в области «Свои / Все», запрос ещё ждёт
const pgTgArg=a=>{const c=CPM[a&&a.cp],x=c&&(c.tgs||[]).find(y=>y.id===a.id);return {c,x}};
['ok','no'].forEach(k=>tgAct('cptg-'+k,{change:true,perm:'cpPage',scope:(u,a)=>{const{c}=pgTgArg(a);return !!c&&visCps(true).includes(c)},stale:(u,a)=>{const{c,x}=pgTgArg(a);return !x||x.st!=='wait'||!pgOn(c)},
  run:(u,a)=>{const{c,x}=pgTgArg(a),why=pgTgWhy(c,x,k);if(why)return {eph:why};pgTgDecide(c,x,k,true);refreshAll();return {done:k==='ok'?'✓ Подтверждён':'✓ Отклонён',off:['cptg-ok','cptg-no'],eph:k==='ok'?`Telegram «${x.name}» подключён к «${c.name}»`:'Запрос отклонён'}}}));

// Карточка контрагента, блок «Страница контрагента»: список «Telegram контрагента» с кнопками «Подтвердить», «Отклонить», «Отключить»
function pgTgBox(c){const l=(c.tgs||[]).slice().sort((a,b)=>(a.st==='wait'?0:a.st==='on'?1:2)-(b.st==='wait'?0:b.st==='on'?1:2)||(a.at<b.at?1:-1));if(!l.length&&!pgTgOn(c))return '';
  const btn=(x,k,icon,label,cls='')=>{const w=pgTgWhy(c,x,k);return `<button type="button" class="btn sm ${cls} ${w?'dis':''}" data-pg-tg="${k}:${x.id}" ${w?`aria-disabled="true" data-why="${esc(w)}" title="${esc(w)}"`:''}>${ic(icon,'sm')}<span class="bl">${label}</span></button>`};
  const who=x=>x.doneAt?`<div class="hint">${x.by==='client'?'контрагент':esc(whoName(x.by))}, ${fmtDT(x.doneAt)}</div>`:'';
  return `<div class="pg-tg"><h4>${ic('tg','sm')}Telegram контрагента${pgTgN(c,'wait')?` <span class="pill yellow sm">${ic('hourglass')}ждёт подтверждения: ${pgTgN(c,'wait')}</span>`:''}<span class="grow"></span><span class="hint">подключено ${pgTgN(c,'on')} из ${PG_TG_MAX}</span></h4>
    ${l.length?`<div class="tbl-wrap"><table class="mini m-cards pg-tg-tbl"><thead><tr><th>Имя в Telegram</th><th>Запрос</th><th>Статус</th><th></th></tr></thead><tbody>${l.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${fmtDT(x.at)}</td><td>${pill(PG_TG_ST[x.st],PG_TG_PILL,'sm')}${who(x)}${x.st==='on'&&x.noDebt?'<div class="hint">напоминания о долге выключил клиент</div>':''}</td>
      <td class="m-act pg-tg-act">${x.st==='wait'?btn(x,'ok','check','Подтвердить','cta')+btn(x,'no','x','Отклонить'):x.st==='on'?btn(x,'off','ban','Отключить'):''}</td></tr>`).join('')}</tbody></table></div>`
      :`<span class="hint">Контрагент ещё не подключал Telegram. Кнопка «Подключить Telegram» — на его странице, в разделе «Telegram».</span>`}
    ${pgDebtRow(c)}
    <span class="hint">Подключённый Telegram получает суммы налогов к оплате и напоминания о долге — только по этому контрагенту. Подтверждайте запрос, только если знаете, чей это Telegram.</span></div>`}
function pgTgBoxClick(c,x0,redraw){const[k,id]=x0.dataset.pgTg.split(':');
  if(k==='debt'){const w=pgDebtWhy(c);if(w){x0.checked=!x0.checked;toast(w,'lock',true);return}c.tgNoDebt=!x0.checked;log('cp',c.id,`Напоминание о долге в Telegram: ${x0.checked?'включено':'выключено'}`,c.id);toast(`Напоминание о долге: ${x0.checked?'включено':'выключено'}`,'tg');redraw&&redraw();return}
  if(x0.dataset.why){toast(x0.dataset.why,'lock',true);return}
  if(k==='demo'){const to=pgDebtTo(c);if(to.length)pgDebtDlg(c,to[0]);return}
  const x=(c.tgs||[]).find(y=>y.id===+id);if(!x)return;
  const why=pgTgWhy(c,x,k);if(why){toast(why,'lock',true);return}
  const run=()=>{pgTgDecide(c,x,k);redraw&&redraw();refreshAll();toast({ok:`Telegram «${x.name}» подключён`,no:'Запрос отклонён',off:`Telegram «${x.name}» отключён`}[k],'tg')};
  if(k==='ok')confirmDlg({title:'Подтвердить Telegram контрагента?',text:`«${x.name}» будет получать в Telegram суммы налогов к оплате и напоминания по контрагенту «${c.name}». Подтверждайте, только если знаете, что это Telegram вашего клиента.`,ok:'Подтвердить',run});
  else if(k==='off')confirmDlg({title:'Отключить Telegram контрагента?',text:`«${x.name}» перестанет получать сообщения по контрагенту «${c.name}». Подключиться снова клиент сможет на своей странице — с новым подтверждением.`,ok:'Отключить',danger:true,run});
  else run()}

// Страница контрагента, раздел «Telegram»
function pgTgPub(c){const on=pgTgN(c,'on'),wait=pgTgN(c,'wait'),full=pgTgBusy(c)>=PG_TG_MAX;
  return pubSec('tg','tg','Telegram',on?`подключено ${on}`:wait?'ждёт подтверждения':'',
    `${PGT('secs','Telegram')?'':'<p class="pub-tgp">Получайте в Telegram суммы налогов к оплате и напоминания.</p>'}
    ${on||wait?`<div class="pub-tgst">${on?`<span class="pill green sm">${ic('check')}подключено: ${on}</span>`:''}${wait?`<span class="pill yellow sm">${ic('hourglass')}ждёт подтверждения бухгалтера: ${wait}</span>`:''}</div>`:''}
    <div class="row"><button type="button" class="btn cta ${full?'dis':''}" data-pub-tgon ${full?`aria-disabled="true" data-why="Подключено или ждёт подтверждения ${PG_TG_MAX} Telegram — больше нельзя. Попросите вашего бухгалтера отключить лишний"`:''}>${ic('tg','sm')}Подключить Telegram</button></div>
    <span class="hint">Кнопка откроет бота Buhuchet.kg в Telegram — нажмите в нём «Старт». Подключение подтверждает ваш бухгалтер. Ссылка действует ${PG_TG_TTL_H} часа и только один раз. Отключиться можно в любой момент командой «Отключить» в боте.</span>`)}
// Прототип: переписка клиента с ботом и сообщение бухгалтеру. В продукте кнопка открывает Telegram по одноразовой ссылке
function pgTgDlg(c){const A=[{day:'Сегодня'}],B=[{day:'Сегодня'}],to=pgTgStaff(c),CA={who:'Чат клиента',list:A},CB={who:to?`Чат бухгалтера · ${to.short||to.fio}`:'Чат бухгалтера',list:B},told=new Set();let cur=null;
  const n=pgTgs(c).length+1,def=n===1&&c.contact?c.contact.split(' ').slice(0,2).join(' '):'Клиент '+n;
  // Решение бухгалтера в его чате сразу видно клиенту
  const sync=()=>{if(cur&&cur.st!=='wait'&&!told.has(cur)){told.add(cur);A.push({t:tplFill(cur.st==='on'?'tgCpOn':cur.st==='no'?'tgCpNo':'tgCpOff',{контрагент:c.name,телеграм:cur.name}),at:bishkekNow().hm})}};
  openModal({size:'mid',live:true,render:m=>{sync();const st=cur&&cur.st;return {title:'Прототип: подключение Telegram',sub:`Кнопка на странице открыла бота Buhuchet.kg в Telegram клиента — ${esc(c.name)}`,
    body:`<div class="tgc-wrap two"><div id="pt-a">${tgcHtml(CA)}</div><div id="pt-b">${tgcHtml(CB)}</div></div>
      ${!cur?`<div class="row" style="flex-wrap:wrap">${inp('pt-n',def,'maxlength="32" placeholder="Имя в Telegram" aria-label="Имя в Telegram" style="max-width:220px"')}<button class="btn cta" id="pt-go">${ic('send','sm')}Нажать «Старт» в боте</button></div>`
        :st==='on'?`<div class="row"><button class="btn" id="pt-off">${ic('ban','sm')}Отправить боту «Отключить»</button></div>`:''}
      <div class="note">${ic('info')}<span>Так бот переписывается с клиентом и с бухгалтером. В продукте имя берётся из Telegram, а ссылка со страницы действует ${PG_TG_TTL_H} часа и один раз. ${to?'Кнопки в чате бухгалтера работают: то же можно сделать в карточке контрагента, в блоке «Страница контрагента».':'У ответственного и владельцев нет Telegram — запрос виден только в карточке контрагента.'} Сообщения записаны в журнал «Телеграм» с типом «${PG_TG_KIND}». Тексты — Справочники платформы → «Шаблоны».</span></div>`,
    foot:'<button class="btn cta" data-close>Готово</button>',
    mount(el){tgcBind($('#pt-b',el),CB,()=>{m.draw();pubDraw(true)},to||me());
      const g=$('#pt-go',el),k=$('#pt-n',el),off=$('#pt-off',el);
      if(g){const go=()=>{const name=k.value.replace(/\s+/g,' ').trim();if(!name){k.focus();return}A.push({t:'/start',me:true});const r=pgTgRequest(c,name);A.push({t:r.bot,at:bishkekNow().hm});
          if(r.x){cur=r.x;if(r.x.st==='on')told.add(cur);if(r.msg&&r.staff)B.push(r.msg)}m.draw();pubDraw(true);refreshAll()};
        g.onclick=go;k.onkeydown=e=>{if(e.key==='Enter')go()};k.focus()}
      if(off)off.onclick=()=>{A.push({t:'Отключить',me:true});told.add(cur);A.push({t:pgTgLeave(c,cur),at:bishkekNow().hm});cur=null;m.draw();pubDraw(true);refreshAll()}}}}})}

/* ═════════════ «К оплате» клиенту (К4) ═════════════ */
// Что клиенту оплатить за месяц отчёта m (правило rmYm): неоплаченные суммы налогов этого месяца. Один расчёт — для блока «К оплате клиенту» в карточке,
// текста «Скопировать для клиента» и сообщения «К оплате» в Telegram. Суммы «ещё не указана» в расчёт не входят — считаются отдельно (noSum)
const PG_TG_MSG='Сообщение контрагенту';
// Когда сообщения клиенту уходят сами (доработки 14.11.2026, блок 3, пункт 3; этап 2, поток К) — строки «К оплате» и «Оплата за обслуживание» блока «Telegram-уведомления»:
// галочки «за 5» … «за 1 день» до срока и час по Бишкеку, у долга — ещё день недели. Не задано — как до этапа 2: «за 5» в 10:00, долг по понедельникам в 10:00
const PG_DAYS=[5,4,3,2,1],PG_AT='10:00';
const pgDaysOf=v=>{const l=Array.isArray(v)?PG_DAYS.filter(d=>v.includes(d)):[];return l.length?l:[5]};
const pgPayDays=()=>pgDaysOf(ORG.tgCpPayDays),pgFeeDays=()=>pgDaysOf(ORG.tgCpFeeDays);
const pgPayAt=()=>ORG.tgCpPayAt||PG_AT,pgFeeAt=()=>ORG.tgCpFeeAt||PG_AT;
const pgDebtWd=()=>ORG.tgCpDebtWd>=1&&ORG.tgCpDebtWd<=7?ORG.tgCpDebtWd:1;
const pgDaysTxt=ds=>`за ${ds.join(', ')} ${plural(ds[ds.length-1],'день','дня','дней')}`;
const rmMonthTxt=m=>rmTitle(m).slice(3);
// Реквизиты для налогов — те же, что в разделе «Как оплатить» страницы: основной реквизит ответственного или основной счёт организации для налогов.
// Без «Учёта оплаты налогов» — тоже по полю «Деньги на налоги переводит» (как в «Напомнить в WhatsApp»): «К оплате» без реквизитов не уходит (доработки 14.11.2026, блок 4)
const pgTaxAcc=c=>{const h=c.paysTo==='emp'?EM[c.resp]:null,ws=h&&h.wallets||[];return (c.paysTo==='org'?orgMain('tax'):ws.find(w=>w.main)||ws[0])||null};
// Реквизиты для обслуживания — основной счёт организации для обслуживания
const pgFeeAcc=()=>feat('fee')?orgMain('fee'):null;
/* Реквизиты для перевода в тексте сообщения (доработки 14.11.2026, блок 4, пункты 1–2): видны всегда, блоком «Реквизиты для перевода — организации …» или «— сотрудника <ФИО>».
   По номеру телефона — номер, банки и кошельки, получатель; расчётный счёт — банк, счёт, БИК, получатель. Кнопка копирования — по виду реквизита и копирует сразу, как «Скопировать код» */
const pgRqWho=(c,a)=>ORG.accounts.includes(a)?tplFill('tgRqOrg',{организация:ORG.name}):tplFill('tgRqEmp',{сотрудник:(EM[c.resp]||{}).fio||''});
function pgRqLines(a){const L=a.kind==='phone'?[['Перевод по номеру телефона',phLocal(a.phone)],['Банки и кошельки',(a.banks||[]).join(', ')]]:a.bank?[['Банк',a.bank],['Счёт',a.acc],['БИК',a.bik]]:[['Банк или кошелёк',a.prov],['Счёт',a.num]];
  L.push(['Получатель',a.name]);return L.filter(x=>x[1]).map(x=>`${x[0]}: ${x[1]}`)}
const pgRqText=(c,a)=>[tplFill('tgRqHead',{чьи:pgRqWho(c,a)}),...pgRqLines(a)].join('\n');
const pgRqBtn=a=>a.kind==='phone'?{t:tgBtnT('tgBtnCpCopyPhone','Скопировать номер телефона'),copy:phLocal(a.phone).replace(/\s/g,''),copied:'Номер телефона скопирован'}
  :{t:tgBtnT('tgBtnCpCopyReq','Скопировать реквизиты для перевода'),copy:pgRqLines(a).join('\n'),copied:'Реквизиты для перевода скопированы'};
// Реквизиты не заполнены — «К оплате» не уходит: ни вручную, ни само (тогда ответственному — «Не отправлено «К оплате»: у <контрагент> нет реквизитов для перевода»)
const pgNoReqWhy=(c,fee)=>`${tplFill('tgCpNoReq',{контрагент:c.name})} ${fee?'Добавьте основной счёт для обслуживания: «Моя организация» → «Реквизиты».':c.paysTo==='emp'?`Реквизиты добавляет ${empName(c.resp)} в «Мой профиль».`:'Добавьте основной счёт для налогов: «Моя организация» → «Реквизиты».'}`;
function rmToPay(c,m){const tp=feat('taxpay'),g=rmGroup(m,REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется'&&rmYm(r)===m).map(rmItem));
  const rows=g.items.filter(x=>x.pay&&x.sum>0&&(!tp||x.left>0)).map(x=>({r:x.r,name:T[x.r.t].short,left:tp?x.left:x.sum,due:x.r.payDue||x.r.due})).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:a.r.id-b.r.id);
  return {m,rows,total:Math.round(rows.reduce((a,x)=>a+x.left,0)*100)/100,noSum:g.noSum,due:rows.length?rows[0].due:'',acc:pgTaxAcc(c)}}
const rmPayList=p=>p.rows.map(x=>`${x.name} — ${som(x.left)} (до ${fmtD(x.due)})`).join(', ');
const rmPayText=(c,p)=>tplFill('waPayMonth',{контрагент:c.name,месяц:rmMonthTxt(p.m),срок:fmtD(p.due),список:rmPayList(p),сумма:som(p.total),реквизиты:p.acc?rqTxt(p.acc):'—'});
const rmPayTgOn=()=>feat('telegram')&&feat('cppage');
const rmPaySendWhy=c=>!can('cpPage')?'Нужно право «Управлять страницей контрагента»':c.archived?'Контрагент в архиве':!pgTgN(c,'on')?'Контрагент не подключил Telegram: кнопка «Подключить Telegram» — на его странице, в разделе «Telegram»':!pgTaxAcc(c)?pgNoReqWhy(c):'';
// Блок «К оплате клиенту» под таблицей месяца в карточке контрагента
function rmPayHtml(c,g){const p=rmToPay(c,g.m);if(!p.rows.length)return '';const w=rmPayTgOn()?rmPaySendWhy(c):'';
  return `<div class="rm-pay" data-rm-pay="${g.m}"><span class="rm-pay-t">${ic('wallet','sm')}<b>К оплате клиенту</b><b class="tnum">${som(p.total)}</b><span class="hint">до ${fmtD(p.due)}</span></span>
    <span class="hint rm-pay-l">${esc(p.rows.map(x=>`${x.name} ${fmtM(x.left)}`).join(' · '))}${p.noSum?` · без суммы ${p.noSum} — в сообщение не войдут`:''}${p.acc?` · ${esc(rqTxt(p.acc))}`:''}</span>
    <span class="grow"></span>${rmRecvBtn(c,rmRecvMonths(c,g.m),g.m)}<button type="button" class="btn sm" data-rm-pcopy="${g.m}">${ic('copy','sm')}<span class="bl">Скопировать для клиента</span></button>${rmPayTgOn()?`<button type="button" class="btn sm ${w?'dis':''}" data-rm-psend="${g.m}" ${w?`aria-disabled="true" data-why="${esc(w)}" title="${esc(w)}"`:''}>${ic('tg','sm')}<span class="bl">Отправить в Telegram</span></button>`:''}</div>`}
function rmPayMount(el,c){
  $$('[data-rm-pcopy]',el).forEach(b=>b.onclick=()=>{const p=rmToPay(c,b.dataset.rmPcopy);copyText(rmPayText(c,p),'Текст для клиента скопирован',true);log('cp',c.id,`Скопирован текст «К оплате» ${rmTitle(p.m).toLowerCase()}: ${som(p.total)}`,c.id)});
  $$('[data-rm-psend]',el).forEach(b=>b.onclick=()=>{if(b.dataset.why){toast(b.dataset.why,'lock',true);return}const m=b.dataset.rmPsend,p=rmToPay(c,m),n=pgTgN(c,'on');
    confirmDlg({title:'Отправить «К оплате» в Telegram?',text:`Клиент получит в Telegram налоги ${rmTitle(m).toLowerCase()}: ${som(p.total)} до ${fmtD(p.due)}${p.noSum?`. Отчётов без суммы — ${p.noSum}: в сообщение они не войдут`:''}. Получателей: ${n}.`,ok:'Отправить',run:()=>{const r=pgPaySend(c,m);if(r){toast(`«К оплате» отправлено в Telegram: получателей — ${r.to.length}`,'tg');pgPayDlg(c,r.p,r.to[0])}}})})}
// Сообщение «К оплате»: заголовок, контрагент и бухгалтер, таблица налогов, кнопки
function pgPayMsg(c,p,x){const e=EM[c.resp];
  return {h:`Налоги к оплате до ${fmtD(p.due)}`,sub:`${c.name}${e?` · бухгалтер ${e.short||e.fio}`:''}`,t:tplFill('tgCpPay',{контрагент:c.name,месяц:rmMonthTxt(p.m),сумма:som(p.total),срок:fmtD(p.due)})+(p.acc?'\n\n'+pgRqText(c,p.acc):''),
    tables:[{head:['Налог','Сумма, сом','Срок'],rows:p.rows.map(r=>[r.name,fmtM(r.left),fmtD(r.due).slice(0,5)]),foot:['Итого',fmtM(p.total),''],num:[1]}],at:bishkekNow().hm,
    btns:[...(p.acc?[[pgRqBtn(p.acc)]]:[]),
      [{t:tgBtnT('tgBtnCpPaid','Оплатил'),act:'cp-paid',arg:{cp:c.id,tg:x.id,m:p.m,sum:p.total}},{t:tgBtnT('tgBtnCpQ','Вопрос бухгалтеру'),act:'cp-ask',arg:{cp:c.id,tg:x.id},icon:'chat'}]]}}
// Отправка всем подключённым Telegram контрагента; запись в историю контрагента и в журнал «Телеграм»
function pgPaySend(c,m){const p=rmToPay(c,m),to=(c.tgs||[]).filter(x=>x.st==='on');if(!p.rows.length||!to.length||c.archived||!p.acc)return null;
  to.forEach(x=>tgSvc({short:c.name},PG_TG_MSG,{chat:x.name}));
  log('cp',c.id,`«К оплате» ${rmTitle(m).toLowerCase()} отправлено в Telegram: ${som(p.total)}, получателей — ${to.length}`,c.id);return {p,to}}
// Кнопки клиента. Клиент — не сотрудник: прав и области у него нет, поэтому каждое нажатие само проверяет, что этот Telegram подключён к этому контрагенту
const pgTgLinked=a=>{const c=CPM[a&&a.cp],x=c&&(c.tgs||[]).find(y=>y.id===a.tg);return c&&x&&x.st==='on'&&!c.archived?{c,x}:null};
// Куда в макете показать сообщение сотруднику (чат бухгалтера в окне переписки)
let pgTgStaffOut=null,pgTgAskOn=null;
tgAct('cp-paid',{run:(u,a)=>{const l=pgTgLinked(a);if(!l)return {eph:tplFill('tgCpNotLinked',{})};const{c,x}=l,to=pgTgStaff(c);
  pgTgClientLog(c,`Контрагент сообщил в Telegram об оплате налогов ${rmTitle(a.m).toLowerCase()}: ${som(a.sum)} («${x.name}»)`);
  if(to){tgSvc(to,PG_TG_KIND);pgTgStaffOut&&pgTgStaffOut({h:'Контрагент сообщил об оплате',t:tplFill('tgCpPaidStaff',{контрагент:c.name,телеграм:x.name,месяц:rmMonthTxt(a.m),сумма:som(a.sum)}),at:bishkekNow().hm})}
  pgPaidMark(c,'tax',a.m,a.sum);return {done:'✓ Сообщили бухгалтеру',eph:tplFill('tgCpPaidOk',{}),msg:pgRcptOffer(c,{...a,kind:'tax'})}}});
// После «Оплатил» за этот месяц сами сообщения больше не уходят: «К оплате» (налоги) и «Оплата за обслуживание до …» (обслуживание) — как после принятия денег.
// «Оплатил» — сообщение клиента об оплате (c.claims, cp-paid.js): на странице у месяца «Ожидает подтверждения», пока бухгалтер не примет деньги
const pgPaidMark=(c,k,m,sum)=>{pgClaimAdd(c,{src:'tg',k,m:m||null,sum:sum||0});if(!m)return;(c.tgPaid||(c.tgPaid={}))[`${k}:${m}`]=nowStamp();dbSoon()};
/* ═════════════ Файлы и чеки через бота (доработки 14.11.2026, блок 2, пункт 1; блок 4, пункт 4; этап 2, поток К) ═════════════ */
// Бот принимает файл, пока действуют страница и её раздел «Telegram» и контрагент может отправлять файлы (галочка в учётной политике и у контрагента), иначе —
// «Ваш бухгалтер не принимает файлы через бота». Лимит в сутки — общий со страницей; типы и размер — как везде на сайте
const pgFileOn=c=>pgTgOn(c)&&sntUpOn(c);
const pgFileBad=f=>{const i=f.name.lastIndexOf('.');return f.size>FILE_MAX_MB*1048576||i>0&&TG_FILE_NO.has(f.name.slice(i+1).toLowerCase())?tplFill('tgCpFileNo',{мб:FILE_MAX_MB}):''};
// Файлы — в «Отправленные файлы» контрагента со статусом «Новый»: «Откуда» — Telegram, «Кто отправил» — имя в Telegram; запись в историю от имени контрагента,
// ответственному — «Новый файл от контрагента». pay — чек {kind: 'tax' | 'fee', m, sum}: «Принять» у него сразу открывает «Принять деньги» (pgRcptMoney). Возвращает отказ бота или ''
function pgFileIn(c,x,fs,note,pay){if(!pgFileOn(c))return tplFill('tgCpFileOff',{});const bad=fs.map(pgFileBad).find(Boolean);if(bad)return bad;
  if(fs.length>SNT_DAY-sntDayCnt(c))return tplFill('tgCpFileLimit',{лимит:SNT_DAY});
  const at=nowStamp(),n=String(note||'').replace(/\s+/g,' ').trim().slice(0,SNT_NOTE);
  fs.forEach((f,i)=>SENT.push({id:'sf'+Date.now().toString(36)+'t'+i,cp:c.id,name:f.name.slice(0,FNAME_MAX),size:f.size,src:'tg',who:x.name,at,note:n,st:'new',...(pay?{pay:{...pay}}:{})}));
  pgTgClientLog(c,`Контрагент отправил через Telegram («${x.name}») ${pay?'чек':fs.length>1?'файлы':'файл'}: ${fs.map(f=>f.name).join(', ')}${n?'. Комментарий: '+n:''}`);sntNotify(c,fs.length);return ''}
// Файл, присланный боту без просьбы: подпись к нему — комментарий. Telegram подключён к нескольким контрагентам — бот спрашивает «От какой компании?» кнопками с названиями
const pgTgAllLinks=name=>CPS.filter(c=>!c.archived).flatMap(c=>(c.tgs||[]).filter(x=>x.st==='on'&&x.name===name).map(x=>({c,x})));
function pgFileFromTg(c,x,f,cap){const at=bishkekNow().hm,bad=pgFileBad(f);if(bad)return {t:bad,at};const ls=pgTgAllLinks(x.name);
  if(ls.length>1)return {t:tplFill('tgCpFileWhich',{}),at,btns:ls.map(l=>[{t:l.c.name,act:'cp-file-to',arg:{cp:l.c.id,tg:l.x.id,f,cap},icon:'building'}])};
  return {t:pgFileIn(c,x,[f],cap)||tplFill('tgCpFileOk',{}),at}}
tgAct('cp-file-to',{run:(u,a)=>{const l=pgTgLinked(a);if(!l)return {eph:tplFill('tgCpNotLinked',{})};const no=pgFileIn(l.c,l.x,[a.f],a.cap);
  return no?{eph:no}:{done:'✓ '+l.c.name,off:['cp-file-to'],msg:{t:tplFill('tgCpFileOk',{}),at:bishkekNow().hm}}}});
// «Прислать чек» — после «Оплатил» под «К оплате» и прямо под «Оплата за обслуживание до …»; необязателен: «Оплатил» работает и без него.
// Чек — фото или PDF; он относится к контрагенту оплаченного сообщения, без вопроса «От какой компании?», комментарий — «Чек к «К оплате» за <месяц>»
const PG_RCPT_EXT=new Set(['pdf','jpg','jpeg','png','heic','heif','webp']);
const pgRcptBtn=a=>({t:tgBtnT('tgBtnCpReceipt','Прислать чек'),act:'cp-receipt',arg:a,icon:'clip'});
const pgRcptOffer=(c,a)=>pgFileOn(c)?{t:tplFill('tgCpReceiptOffer',{}),at:bishkekNow().hm,btns:[[pgRcptBtn(a)]]}:null;
const pgRcptNote=a=>a.kind==='fee'?`Чек к «Оплата за обслуживание» за ${ymLabel(a.m).toLowerCase()}`:`Чек к «К оплате» за ${rmMonthTxt(a.m)}`;
tgAct('cp-receipt',{run:(u,a)=>{const l=pgTgLinked(a);if(!l)return {eph:tplFill('tgCpNotLinked',{})};if(!pgFileOn(l.c))return {eph:tplFill('tgCpFileOff',{})};
    return {ask:{act:'cp-receipt',arg:a,kind:'file',re:pgRcptNote(a),t:tplFill('tgCpReceiptAsk',{})}}},
  reply:(u,a,p)=>{const l=pgTgLinked(a);if(!l)return {say:tplFill('tgCpNotLinked',{})};if(!p.file)return {again:tplFill('tgAskNeedFile',{})};
    const bad=tgFileWhy(p.file),i=p.file.name.lastIndexOf('.');if(bad)return {again:bad};if(i<1||!PG_RCPT_EXT.has(p.file.name.slice(i+1).toLowerCase()))return {again:tplFill('tgCpReceiptType',{})};
    const no=pgFileIn(l.c,l.x,[p.file],pgRcptNote(a)+(p.cap?'. '+p.cap:''),{kind:a.kind,m:a.m,sum:a.sum});if(no)return {say:no};
    // Чек — к последнему «Оплатил» за этот месяц без чека; такого нет — чек сам становится сообщением об оплате
    const sf=SENT[SENT.length-1],cl=(l.c.claims||[]).filter(y=>y.src==='tg'&&y.k===a.kind&&y.m===(a.m||null)&&y.st==='wait'&&!y.file).pop();
    if(cl)cl.file=sf.id;else pgClaimAdd(l.c,{src:'tg',k:a.kind,m:a.m||null,sum:a.sum||0,file:sf.id});
    return {done:'✓ Чек отправлен',say:tplFill('tgCpReceiptOk',{})}}});
// «Принять» у чека: сразу «Принять деньги» с суммой из оплаченного сообщения — налоги месяца разнесены по отчётам от старых к новым, излишек — аванс;
// за обслуживание — «Принять оплату за обслуживание». Нет права или деньги месяца уже получены — файл просто принят
// Чек со страницы («Я оплатил», cp-paid.js) — так же; у чека налогов без месяца — все месяцы с остатком
function pgRcptMoney(c,p,src,file){const from=src==='page'?'со страницы':'из Telegram';
  if(p.kind==='fee'){if(feeAccOk(c))feePayDlg(c,null,{sum:p.sum,note:`По чеку ${from}${p.m?' за '+ymLabel(p.m).toLowerCase():''}`,file});return}
  if(!rmRecvOn(c))return;const k=p.m||'all',pl=rmRecvPlan(rmRecvMonths(c,k));if(!pl.list.length)return toast(p.m?`Деньги на налоги за ${rmMonthTxt(p.m)} уже получены от контрагента`:'Деньги на налоги уже получены от контрагента','info');
  inDlg(c,null,{list:pl.list,total:p.sum,note:`${p.m?`Деньги за ${rmMonthTxt(p.m)}`:'Деньги на налоги'} — по чеку ${from}`,file})}
// Принятый чек в поле «Файлы» окна денег (v119): строка с именем и «Убрать» — тогда чек не прикрепляется (в файлах контрагента он остаётся)
function rcptFileRow(n,id){return n?`<div class="row" id="${id}" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">${ic('clip','sm')}<b>${esc(n)}</b><span class="faint">— чек контрагента, прикрепится при сохранении</span><span class="grow"></span><button class="btn sm ghost" type="button" id="${id}-x" title="Не прикреплять чек">${ic('x','sm')}Убрать</button></div>`:''}
tgAct('cp-ask',{run:(u,a)=>{const l=pgTgLinked(a);if(!l)return {eph:tplFill('tgCpNotLinked',{})};pgTgAskOn&&pgTgAskOn(l);return {msg:{t:tplFill('tgCpAskHow',{}),at:bishkekNow().hm}}}});
// Вопрос клиента уходит ответственному бухгалтеру с названием контрагента; ответ бухгалтера возвращается клиенту
function pgTgAsk(c,x,q){const to=pgTgStaff(c);pgTgClientLog(c,`Вопрос бухгалтеру из Telegram («${x.name}»): ${q.slice(0,200)}`);if(to)tgSvc(to,PG_TG_KIND);pgTgToClient(c,x);
  return {staff:to?{h:'Вопрос контрагента',t:tplFill('tgCpAskStaff',{контрагент:c.name,телеграм:x.name,вопрос:q}),at:bishkekNow().hm}:null,bot:tplFill('tgCpAskSent',{})}}
function pgTgAnswer(c,x,t,by){const e=by||me();log('cp',c.id,`Ответ контрагенту в Telegram («${x.name}»): ${t.slice(0,200)}`,c.id);tgSvc({short:c.name},PG_TG_MSG,{chat:x.name});return {h:'Ответ бухгалтера',t:tplFill('tgCpAnswer',{бухгалтер:e.short||e.fio||'',ответ:t}),at:bishkekNow().hm}}
// Прототип: переписка клиента и бухгалтера вокруг сообщения — «К оплате» или напоминания о долге
function pgChatDlg(c,x,first,o){const A=[{day:'Сегодня'},first],B=[{day:'Сегодня'}],to=pgTgStaff(c),u={tg:x.name,id:'client'};let ask=false,asked=false;
  const CA={who:`Чат клиента · ${x.name}`,list:A},CB={who:to?`Чат бухгалтера · ${to.short||to.fio}`:'Чат бухгалтера',list:B};
  openModal({size:'mid',live:true,onClose(){pgTgStaffOut=pgTgAskOn=null},render:m=>{pgTgStaffOut=msg=>B.push(msg);pgTgAskOn=()=>{ask=true};return {title:o.title,sub:o.sub,
    body:`<div class="tgc-wrap two"><div id="pc-a">${tgcHtml(CA)}</div><div id="pc-b">${tgcHtml(CB)}</div></div>
      <div class="tgc-menu" role="group" aria-label="Меню бота в чате клиента"><button type="button" class="tgc-k" id="pc-code" title="/code">${esc(tgBtnT('tgCmdCpCode','Код от страницы'))}</button></div>
      ${ask?`<div class="row" style="flex-wrap:wrap">${inp('pc-q','','maxlength="500" placeholder="Вопрос бухгалтеру" aria-label="Вопрос бухгалтеру" style="flex:1;min-width:200px"')}<button class="btn cta" id="pc-qs">${ic('send','sm')}Ответить боту от клиента</button></div>`:''}
      ${asked&&to?`<div class="row" style="flex-wrap:wrap">${inp('pc-r','','maxlength="500" placeholder="Ответ клиенту" aria-label="Ответ клиенту" style="flex:1;min-width:200px"')}<button class="btn" id="pc-rs">${ic('send','sm')}Ответить боту от бухгалтера</button></div>`:''}
      ${tgAskOpen(CA)?'':`<div class="row" style="flex-wrap:wrap"><input type="file" class="inp" id="pc-f" aria-label="Файл боту от клиента" style="flex:1;min-width:180px">${inp('pc-cap','',`maxlength="${SNT_NOTE}" placeholder="Подпись к файлу — станет комментарием" aria-label="Подпись к файлу" style="flex:1;min-width:180px"`)}<button class="btn" id="pc-fs">${ic('clip','sm')}Прислать боту файл от клиента</button><button type="button" class="linkbtn" id="pc-fd">В макете: пример «Выписка за октябрь.pdf»</button></div>`}
      <div class="note">${ic('info')}<span>${o.note} Кнопки в чате клиента работают. Файл, присланный боту, попадает в «Отправленные файлы» на вкладке «Файлы» карточки контрагента. Сообщения записаны в журнал «Телеграм» с типом «${PG_TG_MSG}». Тексты — Справочники платформы → «Шаблоны».</span></div>`,
    foot:'<button class="btn cta" data-close>Готово</button>',
    mount(el){tgcBind($('#pc-a',el),CA,()=>{m.draw();refreshAll()},u);
      // Команда меню бота «Код от страницы» (блок 6, пункт 6, cp-paid.js)
      $('#pc-code',el).onclick=()=>{A.push({me:true,t:tgBtnT('tgCmdCpCode','Код от страницы'),at:bishkekNow().hm});pgCodeCmd(x.name).forEach(mm=>A.push(mm));CA.jump=true;m.draw();refreshAll()};
      const q=$('#pc-q',el),qs=$('#pc-qs',el),r=$('#pc-r',el),rs=$('#pc-rs',el);
      if(qs){const go=()=>{const t=q.value.replace(/\s+/g,' ').trim();if(!t){q.focus();return}A.push({t,me:true});const l=pgTgLinked({cp:c.id,tg:x.id});
          if(!l)A.push({eph:tplFill('tgCpNotLinked',{})});else{const a=pgTgAsk(c,x,t);if(a.staff)B.push(a.staff);A.push({t:a.bot,at:bishkekNow().hm});asked=true}ask=false;m.draw();refreshAll()};
        qs.onclick=go;q.onkeydown=e=>{if(e.key==='Enter')go()};q.focus()}
      if(rs){const go=()=>{const t=r.value.replace(/\s+/g,' ').trim();if(!t){r.focus();return}B.push({t,me:true});A.push(pgTgAnswer(c,x,t,to));asked=false;m.draw();refreshAll()};
        rs.onclick=go;r.onkeydown=e=>{if(e.key==='Enter')go()}}
      // Клиент присылает боту файл без просьбы бота (блок 2, пункт 1)
      const fsend=f=>{const cap=fNoteClean($('#pc-cap',el).value).slice(0,SNT_NOTE),l=pgTgLinked({cp:c.id,tg:x.id});A.push({me:true,file:f,t:cap,at:bishkekNow().hm});
        A.push(l?pgFileFromTg(c,x,f,cap):{eph:tplFill('tgCpNotLinked',{})});CA.jump=true;m.draw();refreshAll()};
      if($('#pc-fs',el)){$('#pc-fs',el).onclick=()=>{const f=$('#pc-f',el).files[0];if(!f)return toast('Выберите файл','alert',true);fsend({name:f.name,size:f.size})};
        $('#pc-fd',el).onclick=()=>fsend({name:'Выписка за октябрь.pdf',size:241664})}}}}})}
const pgPayDlg=(c,p,x)=>pgChatDlg(c,x,pgPayMsg(c,p,x),{title:'Прототип: «К оплате» в Telegram клиента',sub:`${esc(c.name)} · налоги ${esc(rmTitle(p.m).toLowerCase())}`,
  note:`Так сообщение «К оплате» выглядит у клиента. Само оно приходит ${pgDaysTxt(pgPayDays())} до ближайшего срока оплаты месяца в ${pgPayAt()}, пока месяц не оплачен, если организация включила «К оплате» в «Telegram-уведомлениях» и все суммы месяца указаны. После «Оплатил» бот предлагает прислать чек.`});

/* ═════════════ Напоминание клиенту о долге (К5) ═════════════ */
// Раз в неделю, в день и час строки «Оплата за обслуживание» (по умолчанию понедельник, 10:00), подключившим Telegram: недостача денег на налоги этого месяца и долг за обслуживание.
// Включает организация («Напоминать контрагентам о долге»), у отдельного контрагента выключает сотрудник в карточке, у себя — сам клиент кнопкой «Не напоминать»
function pgDebt(c){const fee=feat('fee')&&c.feeDebt>0?c.feeDebt:0,M=feat('taxpay')?pubMoney(c):null,short=M&&M.diff<0?-M.diff:0;return {fee,short,sum:Math.round((fee+short)*100)/100}}
const pgDebtTo=c=>ORG.tgCpDebt&&!c.tgNoDebt&&!c.archived&&pgDebt(c).sum>0?(c.tgs||[]).filter(x=>x.st==='on'&&!x.noDebt):[];
function pgDebtMsg(c,x){const d=pgDebt(c),fa=d.fee?orgMain('fee'):null,ta=d.short?pgTaxAcc(c):null,rows=[];
  if(d.short)rows.push(['Не хватает на налоги этого месяца',fmtM(d.short)]);if(d.fee)rows.push(['Долг за обслуживание',fmtM(d.fee)]);
  return {h:'Напоминание об оплате',sub:c.name,t:tplFill('tgCpDebt',{контрагент:c.name,сумма:som(d.sum)}),tables:[{head:['Что оплатить','Сумма, сом'],rows,num:[1]}],at:pgFeeAt(),
    btns:[...(ta||fa?[[{t:tgBtnT('tgBtnCpShowReq','Показать реквизиты для перевода'),act:'cp-req',arg:{cp:c.id,tg:x.id,tax:!!ta,fee:!!fa},icon:'wallet'}]]:[]),
      [{t:tgBtnT('tgBtnCpNoDebt','Не напоминать'),act:'cp-nodebt',arg:{cp:c.id,tg:x.id},icon:'ban'}]]}}
// «Показать реквизиты для перевода» (доработки 14.11.2026, блок 4, пункт 3): одна кнопка на оба вида; бот присылает реквизиты по каждой сумме долга из напоминания —
// для налогов и для обслуживания — с подписью, чьи они, и кнопкой копирования. Реквизиты берутся на момент нажатия
tgAct('cp-req',{run:(u,a)=>{const l=pgTgLinked(a);if(!l)return {eph:tplFill('tgCpNotLinked',{})};const{c}=l,at=bishkekNow().hm,ms=[];
  const one=(acc,sub)=>{if(acc)ms.push({h:sub,sub:c.name,t:pgRqText(c,acc),at,btns:[[pgRqBtn(acc)]]})};
  if(a.tax)one(pgTaxAcc(c),'Для налогов');if(a.fee)one(pgFeeAcc(),'Для обслуживания');
  return ms.length?{msgs:ms}:{eph:tplFill('tgCpNoReq',{контрагент:c.name})}}});
tgAct('cp-nodebt',{run:(u,a)=>{const l=pgTgLinked(a);if(!l)return {eph:tplFill('tgCpNotLinked',{})};const{c,x}=l;x.noDebt=true;
  pgTgClientLog(c,`Напоминания о долге в Telegram выключены контрагентом («${x.name}»)`);return {done:'✓ Напоминания выключены',eph:tplFill('tgCpNoDebtOk',{})}}});
// Карточка контрагента: «Напоминать о долге в Telegram» у этого контрагента и макет напоминания
const pgDebtWhy=c=>!can('cpPage')?'Нужно право «Управлять страницей контрагента»':!ORG.tgCpDebt?'Напоминания о долге выключены для всей организации: «Моя организация» → «Настройки» → «Telegram-уведомления» → «Оплата за обслуживание»':'';
function pgDebtRow(c){if(!rmPayTgOn()||!(feat('fee')||feat('taxpay')))return '';const w=pgDebtWhy(c),on=!!ORG.tgCpDebt&&!c.tgNoDebt,d=pgDebt(c),to=pgDebtTo(c);
  const dw=to.length?'':!ORG.tgCpDebt?'Напоминания о долге выключены в настройках организации':c.tgNoDebt?'Напоминание о долге у этого контрагента выключено':!d.sum?'У контрагента нет недостачи на налоги и долга за обслуживание':!pgTgN(c,'on')?'Контрагент не подключил Telegram':'Клиент выключил напоминания кнопкой «Не напоминать»';
  return `<div class="row pg-tg-debt"><label class="check-row grow"><input type="checkbox" class="sw" data-pg-tg="debt:0" ${on?'checked':''} ${w?`aria-disabled="true" title="${esc(w)}"`:''}><span class="grow">Напоминать о долге в Telegram<div class="hint">${ORG.tgCpDebt?`Раз в неделю, ${TGN_WD_PL[pgDebtWd()-1]} в ${pgFeeAt()}: недостача на налоги этого месяца и долг за обслуживание${d.sum?` — сейчас ${som(d.sum)}`:' — сейчас долга нет'}.`:'Выключено для всей организации: «Моя организация» → «Настройки» → «Telegram-уведомления» → «Оплата за обслуживание».'}</div></span></label>
    <button type="button" class="btn sm ghost ${dw?'dis':''}" data-pg-tg="demo:0" ${dw?`aria-disabled="true" data-why="${esc(dw)}" title="${esc(dw)}"`:''}>${ic('tg','sm')}<span class="bl">Прототип: показать напоминание</span></button></div>`}
/* ═════════════ «Напомнить в Telegram» об оплате за обслуживание (доработки 14.11.2026, блок 4, пункт 5) ═════════════ */
// Вкладка «Обслуживание» карточки контрагента, рядом с «Напомнить в WhatsApp»: видна при долге за обслуживание, если подключён хотя бы один Telegram; права — те же, что у WhatsApp.
// Получатели — подключённые Telegram, кроме выключивших напоминания кнопкой «Не напоминать»; не чаще раза в сутки на контрагента
const pgFeeTo=c=>(c.tgs||[]).filter(x=>x.st==='on'&&!x.noDebt);
const pgFeeTgShow=c=>rmPayTgOn()&&feat('fee')&&c.feeDebt>0&&pgTgN(c,'on')>0;
const pgFeeTgWhy=c=>c.archived?'Контрагент в архиве':c.tgFeeAt&&c.tgFeeAt.slice(0,10)===TODAY?`Сегодня уже напоминали в ${c.tgFeeAt.slice(11,16)}`
  :!pgFeeAcc()?pgNoReqWhy(c,true):!pgFeeTo(c).length?'Все подключённые Telegram выключили напоминания кнопкой «Не напоминать»':'';
const pgFeeTgBtn=c=>{if(!pgFeeTgShow(c))return '';const w=pgFeeTgWhy(c);
  return `<button class="btn sm ${w?'dis':''}" id="cp-feetg" title="${esc(w||'Напомнить в Telegram')}" aria-label="Напомнить в Telegram" ${w?`aria-disabled="true" data-why="${esc(w)}"`:''}>${ic('tg','sm')}<span class="bl">Напомнить в Telegram</span></button>`};
// Месяцы долга и срок — как в «Напомнить в WhatsApp»: месяцы с прошедшим сроком, срок — день оплаты следующего месяца, не раньше завтрашнего дня
function pgFeeDue(c){const ms=feeMonths(c).filter(m=>feeDue(c,m)<=TODAY&&(feeCharge(c,m)-feeGot(c,m))>0),m=ms[ms.length-1],d=m?mkDate(+m.slice(0,4),+m.slice(5,7)+1,c.feeDay):TODAY;
  return {ms,due:d<=TODAY?addDays(TODAY,1):d}}
// Кнопки под «Оплата за обслуживание до …»: копирование реквизита, «Оплатил» и «Прислать чек» (этап 2 — когда контрагент может отправлять файлы через бота)
function pgFeeBtns(c,x,fa,m,sum){const a={cp:c.id,tg:x.id,m,sum};
  return [...(fa?[[pgRqBtn(fa)]]:[]),[{t:tgBtnT('tgBtnCpPaid','Оплатил'),act:'cp-feepaid',arg:a},...(pgFileOn(c)?[pgRcptBtn({...a,kind:'fee'})]:[])]]}
function pgFeeMsg(c,x,text){const fa=pgFeeAcc(),f=pgFeeDue(c);
  return {h:tplFill('tgCpFeeHead',{срок:fmtD(f.due)}),sub:c.name,t:text+(fa?'\n\n'+pgRqText(c,fa):''),at:bishkekNow().hm,btns:pgFeeBtns(c,x,fa,f.ms[f.ms.length-1]||ym(TODAY),c.feeDebt)}}
// До срока (блок 3, пункт 3): само, в отмеченные дни до дня оплаты обслуживания — ближайшее неоплаченное начисление (этот месяц или следующий) с суммой начисления
function pgFeeSoon(c){if(c.kind==='oneoff'||!feat('fee'))return null;const m0=ym(TODAY);
  for(const m of [m0,addMonths(m0,1)]){if(!inService(c,m))continue;const d=feeDue(c,m),left=Math.round((feeCharge(c,m)-feeGot(c,m))*100)/100;if(d>TODAY&&left>0&&!(c.tgPaid||{})['fee:'+m])return {m,due:d,sum:left}}
  return null}
function pgFeeSoonMsg(c,x,s){const fa=pgFeeAcc();
  return {h:tplFill('tgCpFeeHead',{срок:fmtD(s.due)}),sub:c.name,t:tplFill('tgCpFeeSoon',{контрагент:c.name,месяц:ymLabel(s.m).toLowerCase(),сумма:som(s.sum),срок:fmtD(s.due)})+(fa?'\n\n'+pgRqText(c,fa):''),at:pgFeeAt(),btns:pgFeeBtns(c,x,fa,s.m,s.sum)}}
function pgFeeTgDlg(c){const w=pgFeeTgWhy(c);if(w){toast(w,'lock',true);return}const f=pgFeeDue(c),fa=pgFeeAcc(),to=pgFeeTo(c),off=pgTgN(c,'on')-to.length;
  const txt=tplFill('tgCpFeeRemind',{контрагент:c.name,месяц:f.ms.map(ymLabel).join(', ')||ymLabel(ym(TODAY)),сумма:som(c.feeDebt),срок:fmtD(f.due)});
  openModal({form:true,size:'mid',render:m=>({title:'Напомнить в Telegram',sub:`${esc(c.name)} · долг за обслуживание ${som(c.feeDebt)}`,
    body:`<div class="box flat"><h3>Получатели · ${to.length}</h3><div class="row" style="flex-wrap:wrap;gap:6px">${to.map(x=>`<span class="pill sm blue">${ic('tg')}${esc(x.name)}</span>`).join('')}</div>${off?`<span class="hint">Не получат: ${off} — выключили напоминания кнопкой «Не напоминать».</span>`:''}</div>
      ${fld('Текст сообщения',`<textarea class="inp" id="ft-text" maxlength="1000" style="min-height:110px">${esc(txt)}</textarea>`,{full:true,id:'ft-text',hint:'Шаблон ведёт администратор платформы. Здесь текст можно поправить перед отправкой.'})}
      <div class="box flat"><h3>Реквизиты для перевода — в конце сообщения</h3><div style="white-space:pre-wrap">${esc(pgRqText(c,fa))}</div><span class="hint">Под сообщением — кнопки «${esc(pgRqBtn(fa).t)}» и «${esc(tgBtnT('tgBtnCpPaid','Оплатил'))}».</span></div>
      <div class="note">${ic('info')}<span>Напомнить в Telegram можно не чаще раза в сутки. Отправка записывается в историю контрагента и в журнал «Телеграм» с типом «${PG_TG_MSG}».</span></div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="ft-go">${ic('send','sm')}Отправить</button>`,
    mount(el){$('#ft-go',el).onclick=()=>{const t=$('#ft-text',el).value.trim();if(!setErr(el,'ft-text',t?'':'Введите текст сообщения'))return;const w2=pgFeeTgWhy(c);if(w2){toast(w2,'lock',true);return}
      const r=pgFeeSend(c,t);m.close();refreshAll();toast(`Напоминание отправлено в Telegram: получателей — ${r.to.length}`,'tg');
      pgChatDlg(c,r.to[0],pgFeeMsg(c,r.to[0],t),{title:'Прототип: «Оплата за обслуживание» в Telegram клиента',sub:esc(c.name),note:'Так напоминание об оплате за обслуживание выглядит у клиента.'})}}})})}
function pgFeeSend(c,t){const to=pgFeeTo(c);c.tgFeeAt=nowStamp();to.forEach(x=>tgSvc({short:c.name},PG_TG_MSG,{chat:x.name}));
  log('cp',c.id,`Напоминание об оплате за обслуживание отправлено в Telegram: ${som(c.feeDebt)}, получателей — ${to.length}`,c.id);return {to,t}}
tgAct('cp-feepaid',{run:(u,a)=>{const l=pgTgLinked(a);if(!l)return {eph:tplFill('tgCpNotLinked',{})};const{c,x}=l,to=pgTgStaff(c);
  pgTgClientLog(c,`Контрагент сообщил в Telegram об оплате за обслуживание: ${som(a.sum)} («${x.name}»)`);pgPaidMark(c,'fee',a.m,a.sum);
  if(to){tgSvc(to,PG_TG_KIND);pgTgStaffOut&&pgTgStaffOut({h:'Контрагент сообщил об оплате',t:tplFill('tgCpFeePaidStaff',{контрагент:c.name,телеграм:x.name,сумма:som(a.sum)}),at:bishkekNow().hm})}
  return {done:'✓ Сообщили бухгалтеру',eph:tplFill('tgCpPaidOk',{})}}});
const pgDebtDlg=(c,x)=>pgChatDlg(c,x,pgDebtMsg(c,x),{title:'Прототип: напоминание о долге в Telegram клиента',sub:esc(c.name),
  note:`Так напоминание о долге выглядит у клиента: оно приходит раз в неделю, ${TGN_WD_PL[pgDebtWd()-1]} в ${pgFeeAt()}, пока есть недостача на налоги или долг за обслуживание.`});
// Строки «К оплате» и «Оплата за обслуживание» блока «Telegram-уведомления» (пакет 14.11.2026, блок 3; до этого — блок «Telegram контрагентов»):
// видны при включённых «Напоминаниях в Telegram» и «Странице контрагента»; меняет только владелец, сразу, без «Сохранить», с записью в историю организации.
// Этап 2 (поток К): галочки «за 5» … «за 1 день» до срока (хотя бы одна), час отправки по Бишкеку, у долга — день недели; пустое время не сохраняется — «Укажите время».
// «К оплате» уходит в каждый отмеченный день, пока месяц не оплачен; «Оплата за обслуживание до …» — в отмеченные дни до дня оплаты обслуживания (поле карточки контрагента),
// после срока — напоминание о долге раз в неделю. После «Оплатил» или принятия денег за месяц оставшиеся сообщения этого месяца не уходят
const PG_TG_ROWS=[['cpPay','tgCpPay','«К оплате»','Отправлять «К оплате» контрагентам'],['cpFee','tgCpDebt','Оплата за обслуживание','Напоминать контрагентам о долге']];
const PG_TG_SET={p:['tgCpPayDays','tgCpPayAt','«К оплате»',pgPayDays,pgPayAt],f:['tgCpFeeDays','tgCpFeeAt','Оплата за обслуживание',pgFeeDays,pgFeeAt]};
const pgDaysSet=(k,ds,dis)=>`<div class="fld tgn-dfld" data-f="tgn-${k}d"><label>Дни до срока</label><div class="tgn-days">${PG_DAYS.map(d=>`<label class="tgn-day"><input type="checkbox" data-tgn-day="${k}:${d}" ${ds.includes(d)?'checked':''} ${dis}><span>за ${d}${d===1?' день':''}</span></label>`).join('')}</div><div class="err" hidden></div></div>`;
const pgAtSet=(k,v,dis)=>`<div class="fld" data-f="tgn-${k}t"><label for="tgn-${k}t">Время отправки</label><input class="inp" id="tgn-${k}t" type="time" value="${esc(v)}" ${dis}><div class="err" hidden></div></div>`;
// Прототип: «Оплата за обслуживание до …» у первого контрагента, которому оно ушло бы
const pgFeeDemo=()=>{for(const c of visCps()){if(c.archived)continue;const x=pgFeeTo(c)[0],s=x&&pgFeeSoon(c);if(s)return {c,x,s}}return null};
function pgTgNoticeRows(own){if(!rmPayTgOn())return [];const who=own?'':'Меняет только владелец организации',dis=own?'':'disabled',only=' Получают только контрагенты, которые подключили Telegram на своей странице, и только по своим данным.';
  const pd=pgPayDays(),fd=pgFeeDays(),wd=pgDebtWd(),fee=feat('fee'),dm=fee?pgFeeDemo():null,dw=dm?'':'Нет контрагента, которому оно ушло бы: нужен подключённый Telegram и неоплаченное начисление за обслуживание до срока';
  return [tgnRow({id:'cpPay',title:'«К оплате»',to:'cp',on:!!ORG.tgCpPay,dis:!own,why:who,
      hint:`Сообщение с налогами месяца и реквизитами для перевода, если все суммы месяца указаны. После «Оплатил» в Telegram или принятия денег за месяц следующие не уходят. Вручную его отправляет кнопка «Отправить в Telegram» в карточке контрагента, на вкладке «Отчёты к сдаче».${only}`,
      days:`${pgDaysTxt(pd)} до ближайшего срока оплаты месяца`,at:pgPayAt(),often:'В отмеченные дни, пока месяц не оплачен',
      set:pgDaysSet('p',pd,dis)+pgAtSet('p',pgPayAt(),dis)}),
    tgnRow({id:'cpFee',title:'Оплата за обслуживание',to:'cp',on:!!ORG.tgCpDebt,dis:!own,why:who,
      hint:`${fee?'До срока — «Оплата за обслуживание до &lt;дата&gt;» с суммой начисления за месяц и реквизитами для обслуживания; срок — «День оплаты обслуживания» в карточке контрагента. После срока — ':''}напоминание о долге: недостача денег на налоги этого месяца и долг за обслуживание. У отдельного контрагента напоминание выключается в его карточке; клиент может выключить его сам кнопкой «Не напоминать».${only}`,
      days:fee?`${pgDaysTxt(fd)} до дня оплаты; после срока — ${TGN_WD_PL[wd-1]}`:TGN_WD_PL[wd-1],at:pgFeeAt(),often:fee?'В отмеченные дни до срока; после срока — раз в неделю, пока есть долг':'Раз в неделю, пока есть долг',
      set:(fee?pgDaysSet('f',fd,dis):'')+pgAtSet('f',pgFeeAt(),dis)+fld('День напоминания о долге',sel('tgn-fwd',TGN_WD.map((d,i)=>[i+1,d[0].toUpperCase()+d.slice(1)]),wd,dis),{id:'tgn-fwd'})
        +(fee?`<button type="button" class="btn sm ghost ${dw?'dis':''}" data-tgn-fdemo ${dw?`aria-disabled="true" data-why="${esc(dw)}" title="${esc(dw)}"`:''}>${ic('tg','sm')}<span class="bl">Прототип: показать сообщение до срока</span></button>`:'')})]}
function pgTgNoticeMount(body){const own=tgnOwn(),q=s=>body.querySelector(s);
  const dm=q('[data-tgn-fdemo]');if(dm)dm.onclick=()=>{if(dm.dataset.why){toast(dm.dataset.why,'lock',true);return}const d=pgFeeDemo();if(!d)return;
    pgChatDlg(d.c,d.x,pgFeeSoonMsg(d.c,d.x,d.s),{title:'Прототип: «Оплата за обслуживание до …» в Telegram клиента',sub:esc(d.c.name),
      note:`Так сообщение до срока оплаты обслуживания выглядит у клиента: оно приходит ${pgDaysTxt(pgFeeDays())} до дня оплаты (у этого контрагента — ${d.c.feeDay}-е число) в ${pgFeeAt()}, пока начисление месяца не оплачено.`})};
  if(!own)return;
  PG_TG_ROWS.forEach(([id,k,,t])=>{const x=q(`[data-tgn-sw="${id}"]`);if(!x)return;
    x.onchange=()=>{ORG[k]=x.checked;log('org','settings',`${t}: ${x.checked?'включено':'выключено'}`);renderPage();toast(`${t}: ${x.checked?'включено':'выключено'}`,'tg')}});
  // Галочки дней: хотя бы одна остаётся отмеченной
  $$('[data-tgn-day]',body).forEach(b=>b.onchange=()=>{const[k,d]=b.dataset.tgnDay.split(':'),[dk,,t,get]=PG_TG_SET[k],was=get(),ds=PG_DAYS.filter(x=>x===+d?b.checked:was.includes(x));
    if(!setErr(body,`tgn-${k}d`,ds.length?'':'Отметьте хотя бы один день')){b.checked=true;return}
    ORG[dk]=ds;log('org','settings',`${t}: дни ${pgDaysTxt(was)} → ${pgDaysTxt(ds)} до срока`);renderPage();toast(`${t}: ${pgDaysTxt(ds)} до срока`,'tg')});
  Object.keys(PG_TG_SET).forEach(k=>{const at=q(`#tgn-${k}t`);if(!at)return;const[,tk,t,,get]=PG_TG_SET[k];
    at.onchange=()=>{const v=at.value,w=get();if(!setErr(body,`tgn-${k}t`,/^\d\d:\d\d$/.test(v)?'':'Укажите время')){at.value=w;return}if(v===w)return;
      ORG[tk]=v;log('org','settings',`${t}: время ${w} → ${v}`);renderPage();toast(`${t}: в ${v}`,'tg')}});
  const wd=q('#tgn-fwd');if(wd)wd.onchange=()=>{const n=+wd.value,w=pgDebtWd();if(n===w)return;ORG.tgCpDebtWd=n;
    log('org','settings',`Напоминание о долге: ${TGN_WD[w-1]} → ${TGN_WD[n-1]}`);renderPage();toast(`Напоминание о долге — ${TGN_WD_PL[n-1]}`,'tg')}}
