'use strict';
// Страница контрагента: оплата, отчёты, код (доработки 14.11.2026, блок 6; этап 3, поток К; прототип v116).
// «Я оплатил» с чеком в «Как оплатить», «Отчёты» → «По месяцам» с «к оплате», «оплачено», «осталось», пометкой оплаты и «Перечислить»,
// «Забыли код? Прислать в Telegram» на экране ввода кода и команда бота «Код от страницы». Код запоминается в браузере на 1 день (PG_KEEP, cp-page.js).
/* ═════════════ Сообщения клиента об оплате ═════════════ */
// Это не онлайн-оплата: клиент переводит деньги в своём банке или кошельке по реквизитам, а бухгалтер подтверждает получение.
// Сообщение — c.claims: {id, src: 'page' | 'tg', k: 'tax' | 'fee', m: 'ГГГГ-ММ' | null, sum, at, file (номер чека в «Отправленных файлах»), st: 'wait' | 'rej'}.
// Со страницы — «Я оплатил» только вместе с чеком; из Telegram — «Оплатил» под «К оплате» и «Оплата за обслуживание до …» и чек к нему (cp-telegram.js)
const pgClaims=c=>c.claims||(c.claims=[]);
function pgClaimAdd(c,o){const x={id:'pc'+Date.now().toString(36)+pgClaims(c).length,st:'wait',at:nowStamp(),file:null,...o};c.claims.push(x);dbSoon();return x}
// Сообщение больше не ждёт: бухгалтер после него принял деньги этого вида (поступление на налоги или оплату за обслуживание) или отклонил чек.
// «Оплачено» считается только по принятым деньгам — сколько, видно по суммам месяца
const pgClaimDone=(c,x)=>x.st!=='wait'||(x.k==='fee'?FEEPAYS.some(f=>f.cp===c.id&&!f.del&&(f._ca||f.date)>=x.at):OPS.some(o=>o.cp===c.id&&o.kind==='in'&&!o.del&&(o._ca||o.date)>=x.at));
const pgClaimWait=(c,k,m)=>(c.claims||[]).filter(x=>x.k===k&&(m===undefined||x.m===m)&&!pgClaimDone(c,x)).pop()||null;
// Отклонённый чек — и сообщение об оплате с ним отклонено: у месяца снова «Не оплачено» или «Частично»
function pgClaimReject(c,fileId){(c.claims||[]).forEach(x=>{if(x.file===fileId&&x.st==='wait')x.st='rej'})}

/* ═════════════ Оплата по месяцам для клиента ═════════════ */
// Месяц — по правилу «к сдаче и к оплате по месяцам» (rmYm). «К оплате» — суммы налогов месяца; «оплачено» — что бухгалтер принял от клиента
// под отчёты месяца (или уже оплатил в бюджет), не больше суммы отчёта; «осталось» — разница. Пометка: «Оплачено», «Ожидает подтверждения»
// (клиент сообщил об оплате этого месяца или налогов без месяца, деньги ещё не приняты), «Частично», «Не оплачено»
const PG_MPAY={'Оплачено':['green','check'],'Ожидает подтверждения':['blue','hourglass'],'Частично':['yellow','half'],'Не оплачено':['gray','circle']};
const pgMonthReps=(c,m)=>REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется'&&rmYm(r)===m);
function pgMonthPay(c,m){let sum=0,got=0;const rows=[];
  pgMonthReps(c,m).map(rmItem).forEach(x=>{if(!x.pay||!(x.sum>0))return;const g=Math.min(x.sum,Math.max(x.r.paid||0,x.r.recv||0));sum+=x.sum;got+=g;if(x.sum-g>0)rows.push({r:x.r,left:Math.round((x.sum-g)*100)/100})});
  sum=Math.round(sum*100)/100;got=Math.round(got*100)/100;const left=Math.round((sum-got)*100)/100;
  const st=sum<=0?'':left<=0?'Оплачено':pgClaimWait(c,'tax',m)||pgClaimWait(c,'tax',null)?'Ожидает подтверждения':got>0?'Частично':'Не оплачено';
  return {m,sum,got,left,st,rows:rows.sort((a,b)=>(a.r.payDue||'')<(b.r.payDue||'')?-1:1)}}
// Месяцы с остатком к оплате — от старых к новым (для «Я оплатил» из «Как оплатить»)
function pgOpenMonths(c){const ms=[...new Set(REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется').map(rmYm))].sort();return ms.map(m=>pgMonthPay(c,m)).filter(p=>p.left>0)}
// Месяцы обслуживания с долгом — от старых к новым
const pgFeeOpen=c=>feeMonths(c).filter(m=>Math.round((feeCharge(c,m)-feeGot(c,m))*100)/100>0);
// «Я оплатил» есть, пока контрагент может отправлять файлы со страницы: чек — обязательная часть сообщения
const pgPaidOn=c=>sntUpOn(c);
// «Оплатить» — у месяца с остатком, когда клиенту показан «Как оплатить» и у контрагента есть реквизиты для налогов
const pgSendOn=c=>feat('taxpay')&&pgSecs(c).includes('pay')&&!!pgTaxAcc(c);

/* ═════════════ «Оплатить» ═════════════ */
// Одно окно оплаты (17.11.2026, «Меньше текста», п. 6; было «Перечислить» только у месяца): сумма с «Скопировать», куда переводить, «Из чего сумма» свёрнуто, «Я оплатил».
// k='tax' без месяца — «Перевести на налоги» из «Что нужно сделать» и «Оплаты»: сумма «Не хватает» (pubTaxDue); с месяцем — «Оплатить» месяца в «Отчёты» → «По месяцам»: остаток месяца;
// k='fee' — долг за услуги бухгалтера. Та же сумма уходит в «Я оплатил»
function pubPayPlan(c,k,m){if(k==='fee'){const ms=pgFeeOpen(c);return {sum:c.feeDebt>0?c.feeDebt:0,title:'Оплатить услуги бухгалтера',m:ms[0]||null,
    rows:ms.map(x=>({l:cphCap(ymLabel(x)),s:Math.round((feeCharge(c,x)-feeGot(c,x))*100)/100,d:`до ${pubDW(pubFeeDue(c,x))}`}))}}
  if(m){const p=pgMonthPay(c,m);return {sum:p.left>0?p.left:0,title:`Оплатить налоги за ${MONTHS[+m.slice(5,7)-1]}${m.slice(0,4)!==TODAY.slice(0,4)?' '+m.slice(0,4):''}`,m,rows:p.rows.map(x=>({l:`${T[x.r.t].name} · ${x.r.plabel}`,s:x.left,d:x.r.payDue?`до ${pubDW(x.r.payDue)}`:''}))}}
  const M=pubMoney(c);return {sum:pubTaxDue(c),title:'Оплатить налоги',m:null,rows:M.need.map(r=>({l:`${T[r.t].name} · ${r.plabel}`,s:Math.round((r.sum-r.paid)*100)/100,d:`до ${pubDW(r.payDue)}`})),
    calc:`Налоги до ${pubDW(lastDay(M.pm))} — ${som(M.needSum)}, ваши деньги у нас — ${som(Math.round((M.needSum+M.diff)*100)/100)}`}}
function pubPayDlg(c,k,m){const a=pubAcc(c,k),pl=pubPayPlan(c,k,m);if(!a){toast('Спросите вашего бухгалтера, куда переводить','info');return}
  const D=new Set();
  openModal({size:'mid',noMax:true,render:()=>({title:esc(pl.title),
    body:`<div class="pub-send">${pl.sum>0?pubSumLine(pl.sum):''}${pubPay(k,a,c)}
      ${pl.rows.length?`<div class="pub-det${D.has('r')?' open':''}"><button type="button" class="pub-dh" data-pd="r" aria-expanded="${D.has('r')}"><span>Из чего сумма</span><span class="grow"></span>${ic('down','sm')}</button><div class="pub-gb"><div class="pub-gi pub-list">${pl.calc?`<span class="hint">${esc(pl.calc)}</span>`:''}${pl.rows.map(x=>`<div class="pub-row"><div class="pub-r1"><span>${esc(x.l)}</span><span class="grow"></span><b class="tnum">${som(x.s)}</b></div>${x.d?`<div class="pub-r2"><span>${esc(x.d)}</span></div>`:''}</div>`).join('')}</div></div></div>`:''}</div>`,
    foot:`<button class="btn ghost" data-close>Закрыть</button>${pgPaidOn(c)?`<button class="btn cta" id="ps-paid">${ic('check','sm')}Я оплатил</button>`:''}`,
    mount(el,mm){$$('[data-pub-copy]',el).forEach(b=>b.onclick=()=>copyText(b.dataset.pubCopy,b.dataset.pubOk||'Скопировано',true));
      $$('[data-pd]',el).forEach(b=>b.onclick=()=>{const on=!D.has(b.dataset.pd);on?D.add(b.dataset.pd):D.delete(b.dataset.pd);b.parentElement.classList.toggle('open',on);b.setAttribute('aria-expanded',on)});
      const pd=$('#ps-paid',el);if(pd)pd.onclick=()=>{mm.close();pubPaidDlg(c,k,pl.m,{sum:pl.sum,fixed:true})}}})})}

/* ═════════════ «Я оплатил» ═════════════ */
// Поля (17.11.2026, «Меньше текста», п. 6): сверху строка «это не оплата», «Сколько перевели, сом», большая кнопка «Приложить чек», «Добавить комментарий» по ссылке; «Отправить чек» — когда чек приложен.
// Сумма — та же, что в «Оплатить»: налоги — «Не хватает» (сообщение без месяца, бухгалтер раскладывает деньги по месяцам при «Принять»), месяц из «По месяцам» — его остаток,
// услуги бухгалтера — долг (месяц — самый старый с долгом). Чек ложится в «Отправленные файлы» со статусом «Новый» и комментарием «Чек: налоги, 5 000 сом»;
// «Принять» у него сразу открывает «Принять деньги» с этой суммой (pgRcptMoney). Ответственному — сообщение в Telegram, в историю — от имени контрагента
function pubPaidDlg(c,k,m0,o={}){if(!pgPaidOn(c)){toast('Ваш бухгалтер сейчас не принимает файлы через страницу','lock',true);return}
  // o.pick — «Я оплатил» из «Помощи», когда есть и налоги, и услуги бухгалтера: сверху выбор; o.fixed — из окна «Оплатить» с его месяцем и суммой
  const st={k,m:m0||null,sum:''},tax=()=>st.k==='tax';
  const what=m=>tax()?(m?`Налоги ${rmTitle(m).toLowerCase()}`:'Налоги'):(m?`Услуги бухгалтера за ${ymLabel(m)}`:'Услуги бухгалтера');
  const reset=first=>{if(!(first&&o.fixed)){st.m=tax()?(m0||null):(pgFeeOpen(c)[0]||null)}const s=first&&o.sum!=null?o.sum:tax()?(st.m?pgMonthPay(c,st.m).left:pubTaxDue(c)):(c.feeDebt>0?c.feeDebt:0);st.sum=s>0?s:''};reset(true);
  openModal({form:true,noMax:true,render:()=>({title:'Я оплатил',
    body:`<div class="form"><div class="note full pub-paidnote" style="grid-column:1/-1">${ic('info')}<span>${esc(cphT('paidNote','Это не оплата. Сначала переведите деньги в своём банке, здесь вы только отправляете чек.'))}</span></div>
      ${o.pick?fld(esc(cphT('paidPick','Что вы оплатили?')),`<div class="chipsel" role="group" id="pp-k">${[['tax','Налоги'],['fee','Услуги бухгалтера']].map(([x,l])=>`<button type="button" data-pp-k="${x}" class="${st.k===x?'on':''}" aria-pressed="${st.k===x}">${l}</button>`).join('')}</div>`,{full:true}):''}
      ${fld('Сколько перевели, сом',inp('pp-sum',st.sum===''?'':pubM(st.sum),'inputmode="decimal" class="inp tnum pub-ppsum" placeholder="5 000"'),{req:true,full:true,id:'pp-sum'})}
      ${fld('Чек',`<label class="btn pub-pfile" for="pp-f">${ic('clip','sm')}<span id="pp-fn">Приложить чек</span></label><input type="file" id="pp-f" class="pub-fin" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*">`,{req:true,full:true,id:'pp-f',hint:esc(cphT('paidFile','Фото или скриншот из банка'))})}
      <button type="button" class="linkbtn full" id="pp-addn" style="grid-column:1/-1;justify-self:start">${ic('plus','sm')}Добавить комментарий</button><div class="full" id="pp-nw" style="grid-column:1/-1" hidden>${fld('Комментарий',`<textarea class="inp" id="pp-note" maxlength="${SNT_NOTE}" placeholder="Например: за какие налоги перевод"></textarea>`,{full:true,id:'pp-note'})}</div></div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="pp-ok" disabled title="Приложите чек">${ic('send','sm')}Отправить чек</button>`,
    mount(el,mm){const f=$('#pp-f',el),ok=$('#pp-ok',el),s=$('#pp-sum',el);
      // Смена «Налоги» / «Услуги бухгалтера» и «Добавить комментарий» не перерисовывают окно: приложенный чек остаётся
      $$('[data-pp-k]',el).forEach(b=>b.onclick=()=>{if(st.k===b.dataset.ppK)return;st.k=b.dataset.ppK;reset(false);$$('[data-pp-k]',el).forEach(y=>{const on=y===b;y.classList.toggle('on',on);y.setAttribute('aria-pressed',on)});s.value=st.sum===''?'':pubM(st.sum);setErr(el,'pp-sum','')});
      $('#pp-addn',el).onclick=()=>{$('#pp-addn',el).hidden=true;$('#pp-nw',el).hidden=false;$('#pp-note',el).focus()};
      f.onchange=()=>{const on=!!f.files.length;ok.disabled=!on;ok.title=on?'':'Приложите чек';$('#pp-fn',el).textContent=on?f.files[0].name:'Приложить чек';$('.pub-pfile',el).classList.toggle('on',on);setErr(el,'pp-f','')};
      s.oninput=()=>{st.sum=s.value;setErr(el,'pp-sum','')};
      ok.onclick=()=>{const x=f.files[0],n=parseNum(s.value),i=x?x.name.lastIndexOf('.'):-1,k=st.k,tx=tax();
        if(!setErr(el,'pp-sum',isNaN(n)||n<=0?'Укажите сумму больше нуля':n>1e9?'Слишком большая сумма':''))return;
        if(!setErr(el,'pp-f',!x?'Приложите чек':i<1||!PG_RCPT_EXT.has(x.name.slice(i+1).toLowerCase())?'Чек — фото или PDF':x.size>FILE_MAX_MB*1048576?`Файл больше ${FILE_MAX_MB} МБ`:sntDayCnt(c)>=SNT_DAY?`За сутки можно отправить не больше ${SNT_DAY} файлов. Попробуйте завтра`:''))return;
        const nt=$('#pp-note',el),sum=Math.round(n*100)/100,cm=(nt?nt.value:'').replace(/\s+/g,' ').trim().slice(0,SNT_NOTE),at=nowStamp(),id='sf'+Date.now().toString(36)+'p',m=st.m;
        SENT.push({id,cp:c.id,name:x.name.slice(0,FNAME_MAX),size:x.size,src:'page',at,note:`Чек: ${tx?'налоги':'услуги бухгалтера'}, ${som(sum)}${cm?'. '+cm:''}`,st:'new',pay:{kind:k,m,sum}});
        pgClaimAdd(c,{src:'page',k,m,sum,at,file:id});
        HIST.push({at,who:'client',ent:'cp',id:c.id,cp:c.id,what:`Контрагент сообщил со страницы об оплате: ${what(m).replace(/^./,ch=>ch.toLowerCase())} — ${som(sum)}, чек «${x.name}»${cm?'. Комментарий: '+cm:''}`});
        bellCp(c,{kind:'money',ev:'cp_paid',open:{k:'cp_sent',id:c.id},text:`Сообщил об оплате: ${what(m).replace(/^./,ch=>ch.toLowerCase())} — ${som(sum)}, чек в «Отправленных файлах»`,key:'cp_paid:'+id});
        const to=pgTgStaff(c);if(to)tgSvc(to,'Контрагент сообщил об оплате');
        // Итог простыми словами: что будет дальше (доработки 15.11.2026, пункт 5.1; короче — 17.11.2026)
        dbSoon();mm.close();pubDraw(true);cphDone('Чек отправлен',cphT('paidDone','Бухгалтер проверит и отметит оплату. Обычно за рабочий день.'))}}})})}

/* ═════════════ Код через Telegram ═════════════ */
// «Забыли код? Прислать в Telegram» на экране ввода кода и команда бота «Код от страницы» (/code). Код приходит только в Telegram, уже подключённый
// к этому контрагенту (подключение подтверждено, раздел «Telegram» страницы действует). Не чаще 3 раз в сутки на страницу — по ссылке и командой вместе;
// закрытая после 5 неверных кодов за сутки страница код не присылает. Каждая отправка — в историю контрагента
const PG_CODE_TG=3;
const pgCodeDay=p=>{const now=Date.now();p.codeTg=(p.codeTg||[]).filter(t=>now-t<PG_DAYMS);return p.codeTg};
const pgCodeTo=c=>pgTgOn(c)?(c.tgs||[]).filter(x=>x.st==='on'):[];
const pgCodeMsg=c=>({t:tplFill('tgCpCode',{контрагент:c.name,код:pgCodeTxt(c.page.code),ссылка:pgUrl(c)}),at:bishkekNow().hm,
  btns:[[{t:tgBtnT('tgBtnCopyCode','Скопировать код'),copy:c.page.code,copied:'Код скопирован'}]]});
// Отправить код в чаты to; via — 'page' или 'cmd'. Возвращает отказ: 'closed', 'limit' или ''
function pgCodeSend(c,to,via){const p=c.page;if(p.closed)return 'closed';if(pgCodeDay(p).length>=PG_CODE_TG)return 'limit';
  p.codeTg.push(Date.now());to.forEach(x=>tgSvc({short:c.name},'Код от страницы',{chat:x.name}));
  HIST.push({at:nowStamp(),who:'client',ent:'cp',id:c.id,cp:c.id,what:`Код страницы контрагента отправлен в Telegram ${to.map(x=>`«${x.name}»`).join(', ')}: ${via==='cmd'?'командой бота «Код от страницы»':'по ссылке «Забыли код?» на странице'}`});dbSoon();return ''}
// Ссылка со страницы: код уходит во все подключённые Telegram контрагента
// Доступ организации закрыт по подписке — код в Telegram не уходит; ответ тот же, что без Telegram: по ответу не видно, что подписка не оплачена
function pubForgot(c){const to=pubOrgClosed()?[]:pgCodeTo(c);if(!to.length)return {t:'Спросите код у вашего бухгалтера'};const no=pgCodeSend(c,to,'page');
  return no==='limit'?{t:`Код уже присылали ${PG_CODE_TG} раза за сутки. Спросите код у вашего бухгалтера`}:no==='closed'?{t:'Страница закрыта. Попросите новый код у вашего бухгалтера'}:{t:'Код отправлен вам в Telegram',ok:true,to}}
// Команда бота: коды всех включённых страниц контрагентов, к которым подключён этот Telegram, — по сообщению на страницу, с названием
function pgCodeCmd(name){const at=bishkekNow().hm,ls=pgTgAllLinks(name).filter(l=>pgTgOn(l.c));if(!ls.length)return [{t:tplFill('tgCpCodeNone',{}),at}];
  return ls.map(({c,x})=>{const no=pgCodeSend(c,[x],'cmd');return no==='closed'?{t:tplFill('tgCpCodeClosed',{контрагент:c.name}),at}:no==='limit'?{t:tplFill('tgCpCodeLimit',{контрагент:c.name,лимит:PG_CODE_TG}),at}:pgCodeMsg(c)})}
// Прототип: как сообщение с кодом выглядит в Telegram клиента
function pgCodeDemo(c,x){const CA={who:`Чат клиента · ${x.name}`,list:[{day:'Сегодня'},pgCodeMsg(c)]};
  openModal({size:'mid',noMax:true,render:m=>({title:'Прототип: код в Telegram клиента',sub:esc(c.name),body:`<div class="tgc-wrap"><div id="pcd-a">${tgcHtml(CA)}</div></div><div class="note">${ic('info')}<span>Тот же код клиент получит командой бота «Код от страницы» (/code в меню бота). Текст — Справочники платформы → «Шаблоны», «Telegram контрагента: код от страницы».</span></div>`,
    foot:'<button class="btn cta" data-close>Готово</button>',mount(el){tgcBind($('#pcd-a',el),CA,()=>m.draw(),{tg:x.name,id:'client'})}})})}
