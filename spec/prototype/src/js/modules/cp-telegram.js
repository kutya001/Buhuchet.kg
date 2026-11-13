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
const PG_TG_MSG='Сообщение контрагенту',PG_PAY_DAYS=5;
const rmMonthTxt=m=>rmTitle(m).slice(3);
// Реквизиты для налогов — те же, что в разделе «Как оплатить» страницы: основной реквизит ответственного или основной счёт организации для налогов
const pgTaxAcc=c=>{if(!feat('taxpay'))return null;const h=c.paysTo==='emp'?EM[c.resp]:null,ws=h&&h.wallets||[];return (c.paysTo==='org'?orgMain('tax'):ws.find(w=>w.main)||ws[0])||null};
function rmToPay(c,m){const tp=feat('taxpay'),g=rmGroup(m,REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется'&&rmYm(r)===m).map(rmItem));
  const rows=g.items.filter(x=>x.pay&&x.sum>0&&(!tp||x.left>0)).map(x=>({r:x.r,name:T[x.r.t].short,left:tp?x.left:x.sum,due:x.r.payDue||x.r.due})).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:a.r.id-b.r.id);
  return {m,rows,total:Math.round(rows.reduce((a,x)=>a+x.left,0)*100)/100,noSum:g.noSum,due:rows.length?rows[0].due:'',acc:pgTaxAcc(c)}}
const rmPayList=p=>p.rows.map(x=>`${x.name} — ${som(x.left)} (до ${fmtD(x.due)})`).join(', ');
const rmPayText=(c,p)=>tplFill('waPayMonth',{контрагент:c.name,месяц:rmMonthTxt(p.m),срок:fmtD(p.due),список:rmPayList(p),сумма:som(p.total),реквизиты:p.acc?rqTxt(p.acc):'—'});
const rmPayTgOn=()=>feat('telegram')&&feat('cppage');
const rmPaySendWhy=c=>!can('cpPage')?'Нужно право «Управлять страницей контрагента»':c.archived?'Контрагент в архиве':!pgTgN(c,'on')?'Контрагент не подключил Telegram: кнопка «Подключить Telegram» — на его странице, в разделе «Telegram»':'';
// Блок «К оплате клиенту» под таблицей месяца в карточке контрагента
function rmPayHtml(c,g){const p=rmToPay(c,g.m);if(!p.rows.length)return '';const w=rmPayTgOn()?rmPaySendWhy(c):'';
  return `<div class="rm-pay" data-rm-pay="${g.m}"><span class="rm-pay-t">${ic('wallet','sm')}<b>К оплате клиенту</b><b class="tnum">${som(p.total)}</b><span class="hint">до ${fmtD(p.due)}</span></span>
    <span class="hint rm-pay-l">${esc(p.rows.map(x=>`${x.name} ${fmtM(x.left)}`).join(' · '))}${p.noSum?` · без суммы ${p.noSum} — в сообщение не войдут`:''}${p.acc?` · ${esc(rqTxt(p.acc))}`:''}</span>
    <span class="grow"></span><button type="button" class="btn sm" data-rm-pcopy="${g.m}">${ic('copy','sm')}<span class="bl">Скопировать для клиента</span></button>${rmPayTgOn()?`<button type="button" class="btn sm ${w?'dis':''}" data-rm-psend="${g.m}" ${w?`aria-disabled="true" data-why="${esc(w)}" title="${esc(w)}"`:''}>${ic('tg','sm')}<span class="bl">Отправить в Telegram</span></button>`:''}</div>`}
function rmPayMount(el,c){
  $$('[data-rm-pcopy]',el).forEach(b=>b.onclick=()=>{const p=rmToPay(c,b.dataset.rmPcopy);copyText(rmPayText(c,p),'Текст для клиента скопирован',true);log('cp',c.id,`Скопирован текст «К оплате» ${rmTitle(p.m).toLowerCase()}: ${som(p.total)}`,c.id)});
  $$('[data-rm-psend]',el).forEach(b=>b.onclick=()=>{if(b.dataset.why){toast(b.dataset.why,'lock',true);return}const m=b.dataset.rmPsend,p=rmToPay(c,m),n=pgTgN(c,'on');
    confirmDlg({title:'Отправить «К оплате» в Telegram?',text:`Клиент получит в Telegram налоги ${rmTitle(m).toLowerCase()}: ${som(p.total)} до ${fmtD(p.due)}${p.noSum?`. Отчётов без суммы — ${p.noSum}: в сообщение они не войдут`:''}. Получателей: ${n}.`,ok:'Отправить',run:()=>{const r=pgPaySend(c,m);if(r){toast(`«К оплате» отправлено в Telegram: получателей — ${r.to.length}`,'tg');pgPayDlg(c,r.p,r.to[0])}}})})}
// Сообщение «К оплате»: заголовок, контрагент и бухгалтер, таблица налогов, кнопки
function pgPayMsg(c,p,x){const e=EM[c.resp];
  return {h:`Налоги к оплате до ${fmtD(p.due)}`,sub:`${c.name}${e?` · бухгалтер ${e.short||e.fio}`:''}`,t:tplFill('tgCpPay',{контрагент:c.name,месяц:rmMonthTxt(p.m),сумма:som(p.total),срок:fmtD(p.due)}),
    tables:[{head:['Налог','Сумма, сом','Срок'],rows:p.rows.map(r=>[r.name,fmtM(r.left),fmtD(r.due).slice(0,5)]),foot:['Итого',fmtM(p.total),''],num:[1]}],at:bishkekNow().hm,
    btns:[...(p.acc?[[{t:tgBtnT('tgBtnCpReq','Скопировать реквизиты'),copy:rqTxt(p.acc),copied:'Реквизиты скопированы'}]]:[]),
      [{t:tgBtnT('tgBtnCpPaid','Оплатил'),act:'cp-paid',arg:{cp:c.id,tg:x.id,m:p.m,sum:p.total}},{t:tgBtnT('tgBtnCpQ','Вопрос бухгалтеру'),act:'cp-ask',arg:{cp:c.id,tg:x.id},icon:'chat'}]]}}
// Отправка всем подключённым Telegram контрагента; запись в историю контрагента и в журнал «Телеграм»
function pgPaySend(c,m){const p=rmToPay(c,m),to=(c.tgs||[]).filter(x=>x.st==='on');if(!p.rows.length||!to.length||c.archived)return null;
  to.forEach(x=>tgSvc({short:c.name},PG_TG_MSG,{chat:x.name}));
  log('cp',c.id,`«К оплате» ${rmTitle(m).toLowerCase()} отправлено в Telegram: ${som(p.total)}, получателей — ${to.length}`,c.id);return {p,to}}
// Кнопки клиента. Клиент — не сотрудник: прав и области у него нет, поэтому каждое нажатие само проверяет, что этот Telegram подключён к этому контрагенту
const pgTgLinked=a=>{const c=CPM[a&&a.cp],x=c&&(c.tgs||[]).find(y=>y.id===a.tg);return c&&x&&x.st==='on'&&!c.archived?{c,x}:null};
// Куда в макете показать сообщение сотруднику (чат бухгалтера в окне переписки)
let pgTgStaffOut=null,pgTgAskOn=null;
tgAct('cp-paid',{run:(u,a)=>{const l=pgTgLinked(a);if(!l)return {eph:tplFill('tgCpNotLinked',{})};const{c,x}=l,to=pgTgStaff(c);
  pgTgClientLog(c,`Контрагент сообщил в Telegram об оплате налогов ${rmTitle(a.m).toLowerCase()}: ${som(a.sum)} («${x.name}»)`);
  if(to){tgSvc(to,PG_TG_KIND);pgTgStaffOut&&pgTgStaffOut({h:'Контрагент сообщил об оплате',t:tplFill('tgCpPaidStaff',{контрагент:c.name,телеграм:x.name,месяц:rmMonthTxt(a.m),сумма:som(a.sum)}),at:bishkekNow().hm})}
  return {done:'✓ Сообщили бухгалтеру',eph:tplFill('tgCpPaidOk',{})}}});
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
      ${ask?`<div class="row" style="flex-wrap:wrap">${inp('pc-q','','maxlength="500" placeholder="Вопрос бухгалтеру" aria-label="Вопрос бухгалтеру" style="flex:1;min-width:200px"')}<button class="btn cta" id="pc-qs">${ic('send','sm')}Ответить боту от клиента</button></div>`:''}
      ${asked&&to?`<div class="row" style="flex-wrap:wrap">${inp('pc-r','','maxlength="500" placeholder="Ответ клиенту" aria-label="Ответ клиенту" style="flex:1;min-width:200px"')}<button class="btn" id="pc-rs">${ic('send','sm')}Ответить боту от бухгалтера</button></div>`:''}
      <div class="note">${ic('info')}<span>${o.note} Кнопки в чате клиента работают. Сообщения записаны в журнал «Телеграм» с типом «${PG_TG_MSG}». Тексты — Справочники платформы → «Шаблоны».</span></div>`,
    foot:'<button class="btn cta" data-close>Готово</button>',
    mount(el){tgcBind($('#pc-a',el),CA,()=>{m.draw();refreshAll()},u);
      const q=$('#pc-q',el),qs=$('#pc-qs',el),r=$('#pc-r',el),rs=$('#pc-rs',el);
      if(qs){const go=()=>{const t=q.value.replace(/\s+/g,' ').trim();if(!t){q.focus();return}A.push({t,me:true});const l=pgTgLinked({cp:c.id,tg:x.id});
          if(!l)A.push({eph:tplFill('tgCpNotLinked',{})});else{const a=pgTgAsk(c,x,t);if(a.staff)B.push(a.staff);A.push({t:a.bot,at:bishkekNow().hm});asked=true}ask=false;m.draw();refreshAll()};
        qs.onclick=go;q.onkeydown=e=>{if(e.key==='Enter')go()};q.focus()}
      if(rs){const go=()=>{const t=r.value.replace(/\s+/g,' ').trim();if(!t){r.focus();return}B.push({t,me:true});A.push(pgTgAnswer(c,x,t,to));asked=false;m.draw();refreshAll()};
        rs.onclick=go;r.onkeydown=e=>{if(e.key==='Enter')go()}}}}}})}
const pgPayDlg=(c,p,x)=>pgChatDlg(c,x,pgPayMsg(c,p,x),{title:'Прототип: «К оплате» в Telegram клиента',sub:`${esc(c.name)} · налоги ${esc(rmTitle(p.m).toLowerCase())}`,
  note:`Так сообщение «К оплате» выглядит у клиента. Само оно приходит за ${PG_PAY_DAYS} дней до ближайшего срока оплаты месяца, если организация включила «Отправлять «К оплате» контрагентам» и все суммы месяца указаны.`});

/* ═════════════ Напоминание клиенту о долге (К5) ═════════════ */
// Раз в неделю, в понедельник в 10:00, подключившим Telegram: недостача денег на налоги этого месяца и долг за обслуживание.
// Включает организация («Напоминать контрагентам о долге»), у отдельного контрагента выключает сотрудник в карточке, у себя — сам клиент кнопкой «Не напоминать»
function pgDebt(c){const fee=feat('fee')&&c.feeDebt>0?c.feeDebt:0,M=feat('taxpay')?pubMoney(c):null,short=M&&M.diff<0?-M.diff:0;return {fee,short,sum:Math.round((fee+short)*100)/100}}
const pgDebtTo=c=>ORG.tgCpDebt&&!c.tgNoDebt&&!c.archived&&pgDebt(c).sum>0?(c.tgs||[]).filter(x=>x.st==='on'&&!x.noDebt):[];
function pgDebtMsg(c,x){const d=pgDebt(c),fa=d.fee?orgMain('fee'):null,ta=d.short?pgTaxAcc(c):null,rows=[];
  if(d.short)rows.push(['Не хватает на налоги этого месяца',fmtM(d.short)]);if(d.fee)rows.push(['Долг за обслуживание',fmtM(d.fee)]);
  return {h:'Напоминание об оплате',sub:c.name,t:tplFill('tgCpDebt',{контрагент:c.name,сумма:som(d.sum)}),tables:[{head:['Что оплатить','Сумма, сом'],rows,num:[1]}],at:'10:00',
    btns:[...(ta?[[{t:tgBtnT('tgBtnCpReqTax','Реквизиты для налогов'),copy:rqTxt(ta),copied:'Реквизиты для налогов скопированы'}]]:[]),...(fa?[[{t:tgBtnT('tgBtnCpReqFee','Реквизиты для обслуживания'),copy:rqTxt(fa),copied:'Реквизиты для обслуживания скопированы'}]]:[]),
      [{t:tgBtnT('tgBtnCpNoDebt','Не напоминать'),act:'cp-nodebt',arg:{cp:c.id,tg:x.id},icon:'ban'}]]}}
tgAct('cp-nodebt',{run:(u,a)=>{const l=pgTgLinked(a);if(!l)return {eph:tplFill('tgCpNotLinked',{})};const{c,x}=l;x.noDebt=true;
  pgTgClientLog(c,`Напоминания о долге в Telegram выключены контрагентом («${x.name}»)`);return {done:'✓ Напоминания выключены',eph:tplFill('tgCpNoDebtOk',{})}}});
// Карточка контрагента: «Напоминать о долге в Telegram» у этого контрагента и макет напоминания
const pgDebtWhy=c=>!can('cpPage')?'Нужно право «Управлять страницей контрагента»':!ORG.tgCpDebt?'Напоминания о долге выключены для всей организации: «Моя организация» → «Настройки» → «Telegram контрагентов»':'';
function pgDebtRow(c){if(!rmPayTgOn()||!(feat('fee')||feat('taxpay')))return '';const w=pgDebtWhy(c),on=!!ORG.tgCpDebt&&!c.tgNoDebt,d=pgDebt(c),to=pgDebtTo(c);
  const dw=to.length?'':!ORG.tgCpDebt?'Напоминания о долге выключены в настройках организации':c.tgNoDebt?'Напоминание о долге у этого контрагента выключено':!d.sum?'У контрагента нет недостачи на налоги и долга за обслуживание':!pgTgN(c,'on')?'Контрагент не подключил Telegram':'Клиент выключил напоминания кнопкой «Не напоминать»';
  return `<div class="row pg-tg-debt"><label class="check-row grow"><input type="checkbox" class="sw" data-pg-tg="debt:0" ${on?'checked':''} ${w?`aria-disabled="true" title="${esc(w)}"`:''}><span class="grow">Напоминать о долге в Telegram<div class="hint">${ORG.tgCpDebt?`Раз в неделю, в понедельник в 10:00: недостача на налоги этого месяца и долг за обслуживание${d.sum?` — сейчас ${som(d.sum)}`:' — сейчас долга нет'}.`:'Выключено для всей организации: «Моя организация» → «Настройки» → «Telegram контрагентов».'}</div></span></label>
    <button type="button" class="btn sm ghost ${dw?'dis':''}" data-pg-tg="demo:0" ${dw?`aria-disabled="true" data-why="${esc(dw)}" title="${esc(dw)}"`:''}>${ic('tg','sm')}<span class="bl">Прототип: показать напоминание</span></button></div>`}
const pgDebtDlg=(c,x)=>pgChatDlg(c,x,pgDebtMsg(c,x),{title:'Прототип: напоминание о долге в Telegram клиента',sub:esc(c.name),
  note:'Так напоминание о долге выглядит у клиента: оно приходит раз в неделю, в понедельник в 10:00, пока есть недостача на налоги или долг за обслуживание.'});
// Настройки организации: «Моя организация» → «Настройки» → «Telegram контрагентов»
function pgTgOrgHtml(ro){if(!rmPayTgOn())return '';const sw=(id,on,t,h)=>`<label class="check-row"><input type="checkbox" class="sw" id="${id}" ${on?'checked':''} ${ro?'disabled':''}><span class="grow">${t}<div class="hint">${h}</div></span></label>`;
  return `<div class="box" id="org-cptg"><h3>Telegram контрагентов</h3>${sw('st-cppay',ORG.tgCpPay,'Отправлять «К оплате» контрагентам',`Сообщение с налогами месяца приходит клиенту за ${PG_PAY_DAYS} дней до ближайшего срока оплаты, если все суммы месяца указаны. Вручную его отправляет кнопка «Отправить в Telegram» в карточке контрагента, на вкладке «Отчёты к сдаче».`)}
    ${sw('st-cpdebt',ORG.tgCpDebt,'Напоминать контрагентам о долге','Раз в неделю, в понедельник в 10:00: недостача денег на налоги этого месяца и долг за обслуживание. У отдельного контрагента напоминание выключается в его карточке; клиент может выключить его сам кнопкой «Не напоминать».')}
    <span class="hint">Сообщения получают только контрагенты, которые подключили Telegram на своей странице, и только по своим данным.</span></div>`}
function pgTgOrgMount(body){[['st-cppay','tgCpPay','Отправлять «К оплате» контрагентам'],['st-cpdebt','tgCpDebt','Напоминать контрагентам о долге']].forEach(([id,k,t])=>{const x=$('#'+id,body);if(!x)return;
  x.onchange=()=>{ORG[k]=x.checked;log('org','settings',`${t}: ${x.checked?'включено':'выключено'}`);toast(`${t}: ${x.checked?'включено':'выключено'}`,'tg')}})}
