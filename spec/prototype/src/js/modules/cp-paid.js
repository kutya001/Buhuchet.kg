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
// (клиент сообщил об оплате, деньги ещё не приняты), «Частично», «Не оплачено»
const PG_MPAY={'Оплачено':['green','check'],'Ожидает подтверждения':['blue','hourglass'],'Частично':['yellow','half'],'Не оплачено':['gray','circle']};
const pgMonthReps=(c,m)=>REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется'&&rmYm(r)===m);
function pgMonthPay(c,m){let sum=0,got=0;const rows=[];
  pgMonthReps(c,m).map(rmItem).forEach(x=>{if(!x.pay||!(x.sum>0))return;const g=Math.min(x.sum,Math.max(x.r.paid||0,x.r.recv||0));sum+=x.sum;got+=g;if(x.sum-g>0)rows.push({r:x.r,left:Math.round((x.sum-g)*100)/100})});
  sum=Math.round(sum*100)/100;got=Math.round(got*100)/100;const left=Math.round((sum-got)*100)/100;
  const st=sum<=0?'':left<=0?'Оплачено':pgClaimWait(c,'tax',m)?'Ожидает подтверждения':got>0?'Частично':'Не оплачено';
  return {m,sum,got,left,st,rows:rows.sort((a,b)=>(a.r.payDue||'')<(b.r.payDue||'')?-1:1)}}
// Месяцы с остатком к оплате — от старых к новым (для «Я оплатил» из «Как оплатить»)
function pgOpenMonths(c){const ms=[...new Set(REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется').map(rmYm))].sort();return ms.map(m=>pgMonthPay(c,m)).filter(p=>p.left>0)}
// Месяцы обслуживания с долгом — от старых к новым
const pgFeeOpen=c=>feeMonths(c).filter(m=>Math.round((feeCharge(c,m)-feeGot(c,m))*100)/100>0);
// «Я оплатил» есть, пока контрагент может отправлять файлы со страницы: чек — обязательная часть сообщения
const pgPaidOn=c=>sntUpOn(c);
// «Перечислить» — у месяца с остатком, когда клиенту показан «Как оплатить» и у контрагента есть реквизиты для налогов
const pgSendOn=c=>feat('taxpay')&&pgSecs(c).includes('pay')&&!!pgTaxAcc(c);

/* ═════════════ «Перечислить» ═════════════ */
function pubSendDlg(c,m){const p=pgMonthPay(c,m),a=pgTaxAcc(c);if(!a||!(p.left>0))return;
  openModal({size:'mid',noMax:true,render:()=>({title:`Перечислить ${esc(rmTitle(m).toLowerCase())}`,sub:esc(c.name),
    body:`<div class="pub-send"><div class="pub-sendsum"><span class="hint">Осталось оплатить</span><b class="tnum">${som(p.left)}</b><button type="button" class="btn sm" id="ps-cp">${ic('copy','sm')}Скопировать сумму</button></div>
      <div class="pub-list">${p.rows.map(x=>`<div class="pub-row"><div class="pub-r1"><b>${esc(T[x.r.t].short)}</b><span class="faint">·</span><span>${esc(x.r.plabel)}</span><span class="grow"></span><b class="tnum">${som(x.left)}</b></div>${x.r.payDue?`<div class="pub-r2"><span class="${x.r.payDue<TODAY?'red strong':''}">оплатить до ${fmtD(x.r.payDue)}</span></div>`:''}</div>`).join('')}</div>
      ${pubPay('tax','Налоги','wallet',a,c.paysTo==='org',c)}
      ${pgPaidOn(c)?`<span class="hint">После перевода нажмите «Я оплатил» и приложите чек: бухгалтер проверит поступление и отметит оплату.</span>`:''}</div>`,
    foot:`<button class="btn ghost" data-close>Закрыть</button>${pgPaidOn(c)?`<button class="btn cta" id="ps-paid">${ic('check','sm')}Я оплатил</button>`:''}`,
    mount(el,mm){$('#ps-cp',el).onclick=()=>copyText(String(p.left).replace('.',','),'Сумма скопирована',true);
      $$('[data-pub-copy]',el).forEach(b=>b.onclick=()=>copyText(b.dataset.pubCopy,b.dataset.pubOk||'Скопировано',true));
      const pd=$('#ps-paid',el);if(pd)pd.onclick=()=>{mm.close();pubPaidDlg(c,'tax',m)}}})})}

/* ═════════════ «Я оплатил» ═════════════ */
// Поля: сумма, что оплачено (по карточке: «Налоги» или «Обслуживание»), чек — фото или PDF, необязательный комментарий. Без чека «Отправить» неактивна.
// Налоги из «Как оплатить»: месяц — самый старый с остатком, при нескольких — выбор «За какой месяц»; из «Перечислить» — его месяц.
// Обслуживание — самый старый месяц с долгом. Чек ложится в «Отправленные файлы» со статусом «Новый» и комментарием «Чек: налоги, 5 000 сом»;
// «Принять» у него сразу открывает «Принять деньги» с этой суммой (pgRcptMoney). Ответственному — сообщение в Telegram, в историю — от имени контрагента
function pubPaidDlg(c,k,m0){if(!pgPaidOn(c)){toast('Ваш бухгалтер сейчас не принимает файлы через страницу','lock',true);return}
  const tax=k==='tax',ms=tax?pgOpenMonths(c):[],st={m:tax?(m0||(ms[0]&&ms[0].m)||null):(pgFeeOpen(c)[0]||null),own:false,sum:''};
  const def=m=>tax?(m?pgMonthPay(c,m).left:0):(c.feeDebt>0?c.feeDebt:(curTariff(c)||{}).amount||0);
  const what=m=>tax?(m?`Налоги ${rmTitle(m).toLowerCase()}`:'Налоги'):(m?`Обслуживание за ${ymLabel(m).toLowerCase()}`:'Обслуживание');
  st.sum=def(st.m)||'';
  openModal({form:true,noMax:true,render:()=>({title:'Я оплатил',sub:esc(c.name),
    body:`<div class="form">${tax&&!m0&&ms.length>1?fld('За какой месяц',sel('pp-m',ms.map(p=>[p.m,`${rmTitle(p.m)} — осталось ${som(p.left)}`]),st.m),{full:true,id:'pp-m'}):''}
      ${fld('Что оплачено',`<div class="inp pp-what" id="pp-what" aria-live="polite">${esc(what(st.m))}</div>`,{full:true})}
      ${fld('Сумма, сом',inp('pp-sum',st.sum===''?'':pubM(st.sum),'inputmode="decimal" class="inp tnum" placeholder="5 000"'),{req:true,full:true,id:'pp-sum',hint:'Сколько вы перевели'})}
      ${fld('Чек',`<input class="inp" type="file" id="pp-f" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*">`,{req:true,full:true,id:'pp-f',hint:`Фото или PDF чека из банка или кошелька, до ${FILE_MAX_MB} МБ`})}
      ${fld('Комментарий',`<textarea class="inp" id="pp-note" maxlength="${SNT_NOTE}" placeholder="Необязательно: например, за какие налоги перевод"></textarea>`,{full:true,id:'pp-note'})}
      <div class="note full" style="grid-column:1/-1">${ic('info')}<span>Это не оплата: деньги вы переводите в своём банке или кошельке по реквизитам из «Как оплатить». Бухгалтер проверит поступление и отметит оплату — до этого у месяца «Ожидает подтверждения».</span></div></div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="pp-ok" disabled title="Приложите чек">${ic('send','sm')}Отправить</button>`,
    mount(el,mm){const f=$('#pp-f',el),ok=$('#pp-ok',el),s=$('#pp-sum',el),sm=$('#pp-m',el);
      f.onchange=()=>{const on=!!f.files.length;ok.disabled=!on;ok.title=on?'':'Приложите чек';setErr(el,'pp-f','')};
      s.oninput=()=>{st.own=true;setErr(el,'pp-sum','')};
      if(sm)sm.onchange=()=>{st.m=sm.value;$('#pp-what',el).textContent=what(st.m);if(!st.own){const d=def(st.m);s.value=d?pubM(d):''}};
      ok.onclick=()=>{const x=f.files[0],n=parseNum(s.value),i=x?x.name.lastIndexOf('.'):-1;
        if(!setErr(el,'pp-sum',isNaN(n)||n<=0?'Укажите сумму больше нуля':n>1e9?'Слишком большая сумма':''))return;
        if(!setErr(el,'pp-f',!x?'Приложите чек':i<1||!PG_RCPT_EXT.has(x.name.slice(i+1).toLowerCase())?'Чек — фото или PDF':x.size>FILE_MAX_MB*1048576?`Файл больше ${FILE_MAX_MB} МБ`:sntDayCnt(c)>=SNT_DAY?`За сутки можно отправить не больше ${SNT_DAY} файлов. Попробуйте завтра`:''))return;
        const sum=Math.round(n*100)/100,cm=val(el,'pp-note').replace(/\s+/g,' ').trim().slice(0,SNT_NOTE),at=nowStamp(),id='sf'+Date.now().toString(36)+'p',m=st.m;
        SENT.push({id,cp:c.id,name:x.name.slice(0,FNAME_MAX),size:x.size,src:'page',at,note:`Чек: ${tax?'налоги':'обслуживание'}, ${som(sum)}${cm?'. '+cm:''}`,st:'new',pay:{kind:k,m,sum}});
        pgClaimAdd(c,{src:'page',k,m,sum,at,file:id});
        HIST.push({at,who:'client',ent:'cp',id:c.id,cp:c.id,what:`Контрагент сообщил со страницы об оплате: ${what(m).replace(/^./,ch=>ch.toLowerCase())} — ${som(sum)}, чек «${x.name}»${cm?'. Комментарий: '+cm:''}`});
        const to=pgTgStaff(c);if(to)tgSvc(to,'Контрагент сообщил об оплате');
        dbSoon();mm.close();pubDraw(true);toast('Сообщение об оплате и чек отправлены бухгалтеру','check')}}})})}

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
function pubForgot(c){const to=pgCodeTo(c);if(!to.length)return {t:'Спросите код у вашего бухгалтера'};const no=pgCodeSend(c,to,'page');
  return no==='limit'?{t:`Код уже присылали ${PG_CODE_TG} раза за сутки. Спросите код у вашего бухгалтера`}:no==='closed'?{t:'Страница закрыта. Попросите новый код у вашего бухгалтера'}:{t:'Код отправлен в Telegram, подключённый к этой странице',ok:true,to}}
// Команда бота: коды всех включённых страниц контрагентов, к которым подключён этот Telegram, — по сообщению на страницу, с названием
function pgCodeCmd(name){const at=bishkekNow().hm,ls=pgTgAllLinks(name).filter(l=>pgTgOn(l.c));if(!ls.length)return [{t:tplFill('tgCpCodeNone',{}),at}];
  return ls.map(({c,x})=>{const no=pgCodeSend(c,[x],'cmd');return no==='closed'?{t:tplFill('tgCpCodeClosed',{контрагент:c.name}),at}:no==='limit'?{t:tplFill('tgCpCodeLimit',{контрагент:c.name,лимит:PG_CODE_TG}),at}:pgCodeMsg(c)})}
// Прототип: как сообщение с кодом выглядит в Telegram клиента
function pgCodeDemo(c,x){const CA={who:`Чат клиента · ${x.name}`,list:[{day:'Сегодня'},pgCodeMsg(c)]};
  openModal({size:'mid',noMax:true,render:m=>({title:'Прототип: код в Telegram клиента',sub:esc(c.name),body:`<div class="tgc-wrap"><div id="pcd-a">${tgcHtml(CA)}</div></div><div class="note">${ic('info')}<span>Тот же код клиент получит командой бота «Код от страницы» (/code в меню бота). Текст — Справочники платформы → «Шаблоны», «Telegram контрагента: код от страницы».</span></div>`,
    foot:'<button class="btn cta" data-close>Готово</button>',mount(el){tgcBind($('#pcd-a',el),CA,()=>m.draw(),{tg:x.name,id:'client'})}})})}
