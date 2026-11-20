'use strict';
// Подписки организаций (доработки 20.11.2026, блоки 1–6; пакет 2, блок 6): одна модель на три потока — Т (вкладка «Подписки» Админки, шаблоны),
// И (экран «Подписка» владельца, окно оплаты), К (места в пакете, страница контрагента при закрытом доступе). Расчёты — только здесь.
// Хранение: подписка лежит на организации — DB.organization.sub у своей, platformOrgs[i].sub у остальных:
//   {kind:'m1'|'m3'|…, pack, extraGb, paidTo:'ГГГГ-ММ-ДД' (включительно), addDisc (%), firstPaid, free (бесплатный период), next:{pack, extraGb, from}}
//   нет поля sub — «Нет подписки». Оплаты — DB.subPays; виды — DB.ref.subKinds; цены и реквизиты — DB.ref.subPrices.
// В прототипе суммы — в сомах с копейками, как во всём прототипе; в продукте — целые тыйыны (100 сом = 10 000 тыйынов).
// Демо-версия для сайта (BU_DEMO) подписки не имеет, не закрывается и мест не считает (блок 4, пункт 8).

const SUBS_DEMO=typeof BU_DEMO!=='undefined'&&!!BU_DEMO;
const SUB_KINDS=()=>DB.ref.subKinds||[];
const SUB_P=()=>DB.ref.subPrices||{};
const SUB_PAYS=DB.subPays;
const SUB_ST=['Ждёт подтверждения','Просрочена','Скоро истекает','Нет подписки','Активна'];
// Порядок сортировки списка «Организации» вкладки «Подписки» (блок 6, пункт 2)
const SUB_ST_ORD=Object.fromEntries(SUB_ST.map((s,i)=>[s,i]));
const SUB_WHAT={renew:'Продление',grow:'Расширение пакета',mem:'Память сверх',free:'Бесплатный период',admin:'Изменено администратором'};
const SUB_PAY_ST={wait:'Ждёт подтверждения',ok:'Подтверждена',rej:'Отклонена'};
const subR2=n=>Math.round(n*100)/100;
const subKind=id=>SUB_KINDS().find(k=>k.id===id)||null;
const subOrgObj=id=>id==='o1'||!id?ORG:(DB.platformOrgs||[]).find(o=>o.id===id)||null;
// Подписка организации; в демо-версии для сайта — нет
function subOf(orgId){if(SUBS_DEMO)return null;const o=subOrgObj(orgId);return o&&o.sub||null}
const subPaysOf=orgId=>SUB_PAYS.filter(p=>p.org===(orgId||'o1')).sort((a,b)=>b.at<a.at?-1:b.at>a.at?1:0);
const subWait=orgId=>subPaysOf(orgId).find(p=>p.status==='wait')||null;
// Пакет с учётом «Со следующего месяца» и чека, который ещё проверяют (места доступны сразу после чека, блок 4, пункт 6)
function subPack(orgId){const s=subOf(orgId);if(!s)return 0;let n=s.pack||0;if(s.next&&s.next.from<=TODAY&&s.next.pack)n=s.next.pack;
  const w=subWait(orgId);if(w&&w.open&&(w.what==='grow'||w.what==='renew')&&(w.from||'now')==='now'&&w.pack>n)n=w.pack;return n}
function subExtraGb(orgId){const s=subOf(orgId);if(!s)return 0;let n=s.extraGb||0;if(s.next&&s.next.from<=TODAY&&s.next.extraGb!=null)n=s.next.extraGb;
  const w=subWait(orgId);if(w&&w.open&&(w.what==='mem'||w.what==='renew')&&(w.from||'now')==='now'&&w.extraGb>n)n=w.extraGb;return n}
// Активные контрагенты — все, кроме «В архиве»: «Приостановлен» и разовые место занимают (блок 1, пункт 3)
function subActive(orgId){const o=subOrgObj(orgId);if(!o)return 0;return o===ORG||o.self?CPS.filter(c=>!c.archived).length:o.contractors||0}
// Места в пакете: {pack, used, free}; в демо-версии для сайта — без ограничения
function subSeats(orgId){const used=subActive(orgId);if(SUBS_DEMO)return {pack:Infinity,used,free:Infinity};const pack=subPack(orgId);return {pack,used,free:Math.max(0,pack-used)}}
const subFree=orgId=>subSeats(orgId).free;
// Память, МБ: inc — входит в цену (2 ГБ на организацию + 200 МБ за место пакета), extra — куплено сверх, limit = inc + extra, used — занято
// Занятое — одно число для трёх экранов (пакет 2, блок 5, пункт 2): полный список файлов организации ведёт поток И (fileMemMb), до него — оценка ниже
function subMem(orgId){const p=SUB_P(),pack=subPack(orgId),inc=(p.baseMb||0)+(p.cpMb||0)*pack,extra=subExtraGb(orgId)*1000;
  const used=typeof fileMemMb==='function'?fileMemMb(orgId||'o1'):subMemGuess(orgId);return {used:subR2(used),inc,extra,limit:SUBS_DEMO?Infinity:inc+extra}}
// Оценка занятого: у своей организации — все загруженные файлы (файл с несколькими ссылками — один раз), у остальных — из сводки Админки
function subMemGuess(orgId){const o=subOrgObj(orgId);if(!o)return 0;if(!(o===ORG||o.self))return (o.sum&&o.sum.files&&o.sum.files.mb)||0;
  const seen=new Set(),sz=(cp,n)=>{const k=(cp||'')+'\u0000'+n;if(!n||seen.has(k))return 0;seen.add(k);const m=typeof fmGet==='function'?fmGet(cp,n):{};return m&&m.size!=null?m.size:typeof fsize==='function'?fsize(n):0};
  let b=0;CPS.forEach(c=>(c.files||[]).forEach(n=>b+=sz(c.id,n)));REPORTS.forEach(r=>(r.files||[]).forEach(n=>b+=sz(r.cp,n)));TASKS.forEach(t=>{if(t.file)b+=sz(t.cp,t.file)});
  OPS.forEach(x=>(x.files||[]).forEach(n=>b+=sz(x.cp,n)));(FEEPAYS||[]).forEach(x=>(x.files||[]).forEach(n=>b+=sz(x.cp,n)));
  [...SERVICES,...PROJECTS].forEach(s=>[...(s.files||[]),...(s.pays||[]).flatMap(x=>x.files||[])].forEach(n=>b+=sz(s.cp,n)));
  FILES.forEach(f=>{b+=f.size!=null?f.size:sz(f.cp,f.name)});(SENT||[]).forEach(f=>{if(f.st!=='ok'&&f.st!=='del')b+=f.size||0});return b/1048576}
const subMemPct=orgId=>{const m=subMem(orgId);return m.limit&&isFinite(m.limit)?Math.round(m.used/m.limit*100):0};
// ГБ на экране: «9,4 из 14 ГБ»
const subGb=mb=>(Math.round(mb/100)/10).toLocaleString('ru-RU',{maximumFractionDigits:1});
// Последний день оплаченного срока → сколько дней осталось (0 — сегодня последний день)
const subDaysLeft=orgId=>{const s=subOf(orgId);return s&&s.paidTo?diffDays(s.paidTo,TODAY):null};
// Доступ закрыт (блок 4, пункты 4–6): срок прошёл или подписки нет — и нет чека, который открыл доступ до проверки.
// Новый чек после отклонения доступ заранее не открывает (open:false). Блокировка организации — отдельная, её здесь нет.
function subClosed(orgId){if(SUBS_DEMO)return false;const s=subOf(orgId);if(s&&s.paidTo&&s.paidTo>=TODAY)return false;const w=subWait(orgId);return !(w&&w.open)}
// Статус подписки (блок 4, пункт 2): ставит система по дате и чекам; «Ждёт подтверждения» — поверх остальных
function subStatus(orgId){if(SUBS_DEMO)return '';if(subWait(orgId))return 'Ждёт подтверждения';const s=subOf(orgId);if(!s||!s.paidTo)return 'Нет подписки';
  if(s.paidTo<TODAY)return 'Просрочена';return diffDays(s.paidTo,TODAY)<=(SUB_P().remind||7)?'Скоро истекает':'Активна'}
const SUB_PILL={'Активна':['green','check'],'Скоро истекает':['yellow','clock'],'Ждёт подтверждения':['blue','clock'],'Просрочена':['red','alert'],'Нет подписки':['gray','ban']};
// Чек ждёт проверки дольше срока (3 дня после дня прикрепления, по Бишкеку; блок 4, пункт 6)
const subPayLate=p=>p&&p.status==='wait'&&diffDays(TODAY,p.at.slice(0,10))>(SUB_P().check||3);
// Месяц подписки — от числа начала до того же числа следующего месяца (блок 3, пункт 3): сколько месяцев срока осталось, считая текущий
function subMonthsLeft(orgId){const s=subOf(orgId);if(!s||!s.paidTo||s.paidTo<TODAY)return 0;const end=addDays(s.paidTo,1);let n=0;while(n<120&&subAddM(end,-(n+1))>TODAY)n++;return n+1}
// Дата + n месяцев с тем же числом (31 января + 1 месяц = 28 февраля)
function subAddM(iso,n){const[y,m,d]=iso.split('-').map(Number);const t=new Date(Date.UTC(y,m-1+n,1));const last=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();t.setUTCDate(Math.min(d,last));return toIso(t)}
// «Оплачено до» после продления на n месяцев: до конца срока — со дня после «Оплачено до», после закрытия — со дня чека (блок 4, пункт 1)
function subPaidToAfter(orgId,months,from){const s=subOf(orgId),start=s&&s.paidTo&&s.paidTo>=(from||TODAY)?addDays(s.paidTo,1):(from||TODAY);return addDays(subAddM(start,months),-1)}
// Доп. скидка — только при пакете больше порога (150) и только на контрагентов (блок 1, пункт 6)
const subAddDisc=(orgId,pack)=>{const s=subOf(orgId);return s&&pack>(SUB_P().extraOver||150)?Math.max(0,s.addDisc||0):0};
// Расчёт суммы (блок 1, пункт 8; блок 3, пункт 3). what: renew — продление на срок вида; grow — расширение пакета; mem — память сверх.
// from: now — с доплатой за весь текущий месяц и оставшиеся месяцы срока; next — со следующего месяца подписки (за текущий не доплачивается).
// Возвращает {lines:[{label, sum}], total, months, price, gbPrice}; сервер в продукте считает так же — число из окна на веру не берётся
function subCalc(o){const orgId=o.orgId||'o1',p=SUB_P(),s=subOf(orgId)||{},what=o.what||'renew',kind=subKind(o.kind||s.kind)||SUB_KINDS()[0]||{months:1,disc:0,name:''};
  const pack=o.pack!=null?o.pack:s.pack||0,gb=o.extraGb!=null?o.extraGb:s.extraGb||0,add=subAddDisc(orgId,pack),disc=Math.min(100,(kind.disc||0)+add);
  const base=p.cp||0,price=subR2(base*(100-(kind.disc||0))/100),gbPrice=subR2((p.gb||0)*(100-(kind.disc||0))/100),lines=[];
  const fm=n=>fmtM(n,true);let months=kind.months||1,total=0;
  if(what==='renew'){const cp=subR2(price*pack*months);lines.push({label:`Контрагенты: ${pack} × ${fm(price)} × ${months} мес.`,sum:cp});total+=cp;
    if(gb){const g=subR2(gbPrice*gb*months);lines.push({label:`Память сверх: ${gb} ГБ × ${fm(gbPrice)} × ${months} мес.`,sum:g});total+=g}
    if(add){const a=-subR2(base*add/100*pack*months);lines.push({label:`Дополнительная скидка ${add} %`,sum:a});total+=a}
    if(!s.firstPaid&&p.first){const f=-subR2(subR2(base*(100-disc)/100)*pack*p.first/100);lines.push({label:`Скидка первого месяца ${p.first} %`,sum:f});total+=f}}
  else{const cur=subKind(s.kind)||kind,cprice=subR2(base*(100-(cur.disc||0))/100),cgb=subR2((p.gb||0)*(100-(cur.disc||0))/100),left=subMonthsLeft(orgId);
    months=(o.from||'now')==='next'?Math.max(0,left-1):left;
    if(what==='grow'){const d=Math.max(0,pack-subPack(orgId));const cp=subR2(cprice*d*months);lines.push({label:`Расширение пакета: +${d} × ${fm(cprice)} × ${months} мес.`,sum:cp});total+=cp;
      const a=subAddDisc(orgId,pack);if(a&&d){const x=-subR2(base*a/100*d*months);lines.push({label:`Дополнительная скидка ${a} %`,sum:x});total+=x}}
    else{const d=Math.max(0,gb-subExtraGb(orgId));const g=subR2(cgb*d*months);lines.push({label:`Память сверх: +${d} ГБ × ${fm(cgb)} × ${months} мес.`,sum:g});total+=g}}
  total=subR2(Math.max(0,total));lines.push({label:'Итого к оплате',sum:total,total:true});return {lines,total,months,price,gbPrice,kind:kind.id,pack,extraGb:gb,addDisc:add}}
// Владельцы организации — получатели напоминаний и итогов проверки (блок 4, пункт 3; блок 5, пункт 6)
function subOwners(orgId){const o=subOrgObj(orgId);if(!o)return [];if(o===ORG||o.self)return EMP.filter(e=>e.role==='owner'&&e.active!==false);
  const w=(DB.platformUsers||[]).find(u=>u.login===o.owner);return w&&w.active!==false?[w]:[]}
const subOrgName=orgId=>(subOrgObj(orgId)||{}).name||'';
const subNextId=()=>'sp'+(SUB_PAYS.reduce((a,x)=>Math.max(a,+String(x.id).slice(2)||0),0)+1);
// Текст шаблона с подстановками
const subTpl=(k,v)=>(TPL[k]||'').replace(/\{([^{}]+)\}/g,(m,x)=>v[x]??m);
// Сообщение владельцам организации: Telegram (журнал бота) и колокольчик — у своей организации; open — экран «Подписка» (поток И)
function subTellOwners(orgId,tplKey,kind,vars,key){const txt=subTpl(tplKey,vars),own=subOwners(orgId),name=subOrgName(orgId);
  own.forEach(u=>{if(typeof tgSvc==='function')tgSvc(tgOf(u),kind,{org:name});if(typeof bellPut==='function'&&EMP.includes(u))bellPut(u.id,{kind:'other',ev:'sub',open:{k:'sub',id:orgId},text:txt,key:key||bellOnce('sub:'+orgId)})});return txt}
// Сообщение всем администраторам платформы (новый чек на проверку и повтор каждый день в 09:00, блок 6, пункт 3)
function subTellAdmins(orgId,tplKey,kind,vars,key){const txt=subTpl(tplKey,vars);if(typeof tgSvc==='function')tgSvc({id:'admin',fio:'Администратор платформы',login:'admin',tg:'@buhuchet_admin'},kind,{org:'Платформа'});
  if(typeof bellPut==='function')bellPut('admin',{kind:'other',ev:'subCheck',open:{k:'sub_check',id:orgId},text:txt,key:key||bellOnce('subCheck')});return txt}
// Заявка владельца с чеком (блок 5, пункт 3): вид, пакет, память и сумма уходят из окна оплаты, статус «Ждёт подтверждения».
// Доступ открывается сразу, кроме нового чека после отклонения (блок 4, пункт 6). Одна непроверенная заявка за раз (блок 5, пункт 5).
// x: {what, kind, pack, extraGb, from, file:{name,size,type}}; возвращает оплату или null, если уже есть непроверенная
function subPaySend(orgId,x){orgId=orgId||'o1';if(subWait(orgId))return null;const c=subCalc({orgId,...x}),last=subPaysOf(orgId).find(p=>p.status!=='wait'&&p.what!=='admin'&&p.what!=='free');
  const p={id:subNextId(),org:orgId,at:nowStamp(),by:S.me,what:x.what||'renew',kind:c.kind,months:c.months,pack:c.pack,extraGb:c.extraGb,from:x.from||'now',sum:c.total,
    lines:c.lines.map(l=>({label:l.label,sum:l.sum})),file:x.file||null,status:'wait',open:!(last&&last.status==='rej'),reason:'',chkBy:'',chkAt:'',paidTo:''};
  SUB_PAYS.push(p);const w=SUB_WHAT[p.what].toLowerCase();log('sub',orgId,`Чек отправлен на проверку: ${w}, ${som(p.sum)}${p.file?`, файл «${p.file.name}»`:''}`);
  subTellAdmins(orgId,'tgSubCheckNew','Новый чек на проверку',{организация:subOrgName(orgId),что:w,сумма:som(p.sum)},'subCheck:'+p.id);dbSoon();return p}
// Замена файла чека до проверки (блок 5, пункт 5)
function subPayFile(payId,file){const p=SUB_PAYS.find(x=>x.id===payId);if(!p||p.status!=='wait')return false;const was=p.file&&p.file.name;p.file=file;
  log('sub',p.org,`Файл чека заменён${was?`: было «${was}»`:''}, стало «${file.name}»`);dbSoon();return true}
// Подтверждение оплаты администратором (блок 6, пункт 3): число месяцев и «Оплачено до» можно поправить; подтверждённую назад не вернуть
function subPayOk(payId,o={}){const p=SUB_PAYS.find(x=>x.id===payId);if(!p||p.status!=='wait')return false;const org=subOrgObj(p.org);const s=org.sub||(org.sub={kind:p.kind,pack:0,extraGb:0,paidTo:'',addDisc:0,firstPaid:false});
  const was=subStatus(p.org);p.status='ok';p.chkBy=S.me;p.chkAt=nowStamp();
  if(p.what==='renew'){p.months=o.months||p.months;p.paidTo=o.paidTo||subPaidToAfter(p.org,p.months,p.at.slice(0,10));Object.assign(s,{kind:p.kind,pack:p.pack,extraGb:p.extraGb,paidTo:p.paidTo,firstPaid:true});delete s.free;delete s.next}
  else if(p.from==='next'){s.next={pack:p.what==='grow'?p.pack:(s.next&&s.next.pack)||s.pack,extraGb:p.what==='mem'?p.extraGb:(s.next&&s.next.extraGb)??s.extraGb,from:s.paidTo?subAddM(addDays(s.paidTo,1),-Math.max(0,subMonthsLeft(p.org)-1)):TODAY}}
  else if(p.what==='grow')s.pack=p.pack;else s.extraGb=p.extraGb;
  if(o.paidTo&&p.what!=='renew'){s.paidTo=o.paidTo;p.paidTo=o.paidTo}
  touch(org);const txt=`Оплата подтверждена: ${SUB_WHAT[p.what].toLowerCase()}, ${som(p.sum)}${p.what==='renew'?`, ${p.months} мес., оплачено до ${fmtD(p.paidTo)}`:''} (было: ${was})`;
  log('sub',p.org,txt);log('porg',p.org,txt);subTellOwners(p.org,'tgSubPaid','Оплата подписки подтверждена',{организация:subOrgName(p.org),дата:fmtD(s.paidTo)},'subPaid:'+p.id);dbSoon();return true}
// Отклонение — с обязательной причиной; доступ, открытый по чеку, закрывается, если «Оплачено до» прошло (блок 6, пункт 3)
function subPayRej(payId,reason){const p=SUB_PAYS.find(x=>x.id===payId);reason=String(reason||'').trim();if(!p||p.status!=='wait'||!reason)return false;
  p.status='rej';p.reason=reason;p.chkBy=S.me;p.chkAt=nowStamp();const txt=`Чек отклонён: ${SUB_WHAT[p.what].toLowerCase()}, ${som(p.sum)}. Причина: ${reason}`;
  log('sub',p.org,txt);log('porg',p.org,txt);subTellOwners(p.org,'tgSubRejected','Чек отклонён',{организация:subOrgName(p.org),причина:reason},'subRej:'+p.id);dbSoon();return true}
// «Изменить подписку» администратором (блок 6, пункт 4): поля — вид, пакет, память сверх, «Оплачено до», доп. скидка; причина обязательна.
// free — бесплатный период (блок 4, пункт 5): «Оплачено до» без оплаты, строка в «Истории оплат» без суммы. Пустое x.paidTo без подписки — «Нет подписки».
function subSet(orgId,x,reason){const org=subOrgObj(orgId);reason=String(reason||'').trim();if(!org||!reason)return false;const s0=org.sub?structuredClone(org.sub):null;
  if(!x.paidTo&&!s0)return false;const s=org.sub||(org.sub={kind:x.kind,pack:x.pack,extraGb:0,paidTo:'',addDisc:0,firstPaid:false});
  const kn=id=>(subKind(id)||{}).name||id,F=[['kind','Вид',kn],['pack','Пакет',v=>v],['extraGb','Память сверх',v=>v+' ГБ'],['paidTo','Оплачено до',fmtD],['addDisc','Дополнительная скидка',v=>(v||0)+' %']];
  const ch=[];F.forEach(([k,l,f])=>{if(x[k]===undefined)return;const v=k==='addDisc'&&!(x.pack>(SUB_P().extraOver||150))?0:x[k];if(!s0||s0[k]!==v)ch.push(`${l}: ${s0?f(s0[k]??0):'—'} → ${f(v)}`);s[k]=v});
  if(x.free){s.free=true;SUB_PAYS.push({id:subNextId(),org:orgId,at:nowStamp(),by:S.me,what:'free',kind:s.kind,months:0,pack:s.pack,extraGb:s.extraGb,from:'now',sum:0,lines:[],file:null,status:'ok',open:true,reason,chkBy:S.me,chkAt:nowStamp(),paidTo:s.paidTo})}
  else if(x.paidTo&&s0&&s0.paidTo!==x.paidTo)delete s.free;
  if(!ch.length&&!x.free)return false;touch(org);const txt=`${x.free?`Бесплатный период до ${fmtD(s.paidTo)}`:'Подписка изменена'}${ch.length?': '+ch.join('; '):''}. Причина: ${reason}`;
  log('sub',orgId,txt);log('porg',orgId,txt);dbSoon();return true}
// Напоминание владельцам (задача «Подписки: напоминания об оплате», блок 4, пункт 3): за 7 дней и каждый день, пока не оплачено; после чека — нет
function subRemindText(orgId){const s=subOf(orgId);if(!s||subWait(orgId))return '';const c=subCalc({orgId,what:'renew',kind:s.kind,pack:s.pack,extraGb:s.extraGb}),v={организация:subOrgName(orgId),дата:fmtD(s.paidTo),сумма:som(c.total),дней:Math.max(0,diffDays(s.paidTo,TODAY))};
  return s.paidTo<TODAY?subTpl('tgSubOver',v):diffDays(s.paidTo,TODAY)<=(SUB_P().remind||7)?subTpl('tgSubSoon',v):''}
