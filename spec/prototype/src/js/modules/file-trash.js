'use strict';
// Отложенное удаление файлов и итоги сверки хранилища (доработки 20.11.2026, пакет 2, блоки 3 и 5; поток И, этап 0, П7)
/* ═════════════ Отложенное удаление файлов ═════════════
   Сотрудник удалил файл — файл сразу пропадает из списков организации и сразу перестаёт считаться в её память, а из хранилища стирается через один день.
   Этот день файл виден администратору платформы: Админка → «Файлы» → «Хранилище» → «Ждут удаления», с датой стирания и кнопкой «Вернуть».
   Так же через день стираются прежний файл после «Изменить файл» → замена, непринятый файл от контрагента, удалённый через 30 дней,
   и «лишний» файл хранилища, удалённый администратором. Своей «Корзины» у организации нет.
   В прототипе всё это — DB.storage: trash — файлы, которые ждут стирания; check — итог последней сверки базы с хранилищем.
   Запись trash: {id, org, cp, cpName, name, size, src, by, at, erase, why: 'del'|'rep'|'auto'|'extra', loc, links, manual, path, back, gone}.
   loc — где файл лежал (чтобы «Вернуть» положил его на место): {t:'c'|'r'|'t'|'x'|'o'|'s'|'p'|'fp', id, p}; у загруженных вручную — копия записи в manual.
   Демо-записи в demoDB.json заданы сдвигом от текущего часа (agoH), чтобы не устаревали: при первом обращении сдвиг становится датой. */
const STORE=DB.storage;
const FT_HOURS=24;// через сколько часов после удаления файл стирается из хранилища
const FT_WHY={del:'Удалён сотрудником',rep:'Прежняя версия после «Изменить файл»',auto:'Не принят за 30 дней',extra:'Лишний файл хранилища'};
// Отметки времени в прототипе — «ГГГГ-ММ-ДД ЧЧ:ММ» по Бишкеку; арифметика — как с UTC, без пояса
const ftMs=s=>Date.parse(String(s).replace(' ','T')+(String(s).length>10?':00Z':'T00:00:00Z'));
const ftStamp=ms=>new Date(ms).toISOString().slice(0,16).replace('T',' ');
const ftNow=()=>ftMs(nowStamp());
const ftAgo=h=>ftStamp(ftNow()-h*36e5);
// Демо-сдвиги agoH → настоящие даты; у пустой организации раздела нет — он появляется пустым
function ftInit(){if(!STORE.trash)STORE.trash=[];if(!STORE.check)STORE.check={at:null,missing:[],extra:[],stuck:[],failed:[]};
  const fix=x=>{if(x&&x.agoH!=null){x.at=ftAgo(x.agoH);delete x.agoH}if(x&&x.eraseH!=null){x.erase=ftStamp(ftMs(x.at||nowStamp())+x.eraseH*36e5);delete x.eraseH}};
  STORE.trash.forEach(x=>{fix(x);if(!x.erase)x.erase=ftStamp(ftMs(x.at)+FT_HOURS*36e5)});fix(STORE.check);['missing','extra','stuck','failed'].forEach(k=>{STORE.check[k]=STORE.check[k]||[];STORE.check[k].forEach(fix)})}
ftInit();
// Срок прошёл — файл стёрт: строка остаётся в данных с отметкой gone, «Вернуть» у неё нет
function ftPurge(){const now=ftNow();STORE.trash.forEach(x=>{if(!x.back&&!x.gone&&ftMs(x.erase)<=now){x.gone=nowStamp();HIST.push({at:x.erase,who:'system',ent:'pfile',id:x.id,what:`Файл «${x.name}» стёрт из хранилища: прошли сутки после удаления`})}})}
const ftLive=()=>{ftPurge();return STORE.trash.filter(x=>!x.back&&!x.gone)};
const ftCanBack=x=>x.why==='del'||x.why==='extra';
const FT_BACK_WHY={rep:'Это прежняя версия файла после замены: вернуть можно только удалённый файл',auto:'Непринятый файл от контрагента удалён через 30 дней: вернуть его нельзя'};
// Где лежит массив файлов arr: ищем запись, которой он принадлежит (контрагент, отчёт, операция, разовая услуга, проект, оплата за обслуживание)
function ftLocOf(arr){if(!arr)return null;let r;
  if(r=CPS.find(c=>c.files===arr))return {t:'c',id:r.id};
  if(r=REPORTS.find(x=>x.files===arr))return {t:'r',id:r.id};
  if(r=OPS.find(x=>x.files===arr))return {t:r.kind==='in'?'o':'x',id:r.id,fin:r.kind!=='pay'&&r.kind!=='in'};
  if(r=FEEPAYS.find(x=>x.files===arr))return {t:'fp',id:r.id};
  for(const s of SERVICES){if(s.files===arr)return {t:'s',id:s.id};const p=(s.pays||[]).find(x=>x.files===arr);if(p)return {t:'s',id:s.id,p:p.id}}
  for(const pr of PROJECTS){if(pr.files===arr)return {t:'p',id:pr.id};const p=(pr.pays||[]).find(x=>x.files===arr);if(p)return {t:'p',id:pr.id,p:p.id}}
  return null}
// Массив, куда «Вернуть» кладёт файл; у задачи файл — одна строка t.file
function ftLocArr(l){if(!l)return null;const own=(a,id)=>a.find(x=>x.id===id);let r;
  if(l.t==='c')return (r=own(CPS,l.id))?(r.files=r.files||[]):null;
  if(l.t==='r')return (r=own(REPORTS,l.id))?(r.files=r.files||[]):null;
  if(l.t==='x'||l.t==='o')return (r=own(OPS,l.id))?(r.files=r.files||[]):null;
  if(l.t==='fp')return (r=own(FEEPAYS,l.id))?(r.files=r.files||[]):null;
  if(l.t==='s'||l.t==='p'){const x=own(l.t==='s'?SERVICES:PROJECTS,l.id);if(!x)return null;if(!l.p)return x.files=x.files||[];const p=(x.pays||[]).find(y=>y.id===l.p);return p?(p.files=p.files||[]):null}
  return null}
const FT_SRC={c:'Карточка контрагента',r:'Отчёт',t:'Задача',x:'Оплата налога',o:'Поступление',fp:'Оплата за обслуживание',s:'Разовая услуга',p:'Проект',m:'Загружен вручную'};
// Положить удалённый файл демо-организации в «Ждут удаления». o: {name, cp, arr | loc | manual, links, why, size, src}
function ftPush(o){const cp=o.cp||null,c=cp&&CPM[cp];const loc=o.loc||(o.manual?{t:'m'}:ftLocOf(o.arr));
  const size=o.size!=null?o.size:(o.manual&&o.manual.size)!=null?o.manual.size:fmGet(cp,o.name).size??fsize(o.name);
  const x={id:'ft'+Date.now().toString(36)+Math.floor(Math.random()*1e4),org:ORG.id,cp,cpName:c?c.name:'',name:o.name,size,src:o.src||(loc?(loc.fin?'Финансовая операция':FT_SRC[loc.t]):'')||'',by:o.why==='auto'?'system':S.me,at:nowStamp(),
    erase:ftStamp(ftNow()+FT_HOURS*36e5),why:o.why||'del',loc,links:o.links||[],manual:o.manual?structuredClone(o.manual):null};
  STORE.trash.push(x);return x}
// «Вернуть» (пакет 2, блок 5, пункт 4): файл снова там, где был, и снова считается в память организации; пишется в историю файла и записи
function ftRestore(x){if(!x||x.back||x.gone||!ftCanBack(x))return false;const who=S.me;let ok=true;
  if(x.why==='extra'){STORE.check.extra.push({path:x.path,size:x.size,at:x.found||x.at})}
  else if(x.org===ORG.id){
    if(x.loc&&x.loc.t==='m'&&x.manual){FILES.push(structuredClone(x.manual))}
    else if(x.loc&&x.loc.t==='t'){const t=TASKS.find(y=>y.id===x.loc.id);if(t&&!t.file)t.file=x.name;else ok=false}
    else{const a=ftLocArr(x.loc);if(a){if(!a.includes(x.name))a.push(x.name)}else ok=false}
    (x.links||[]).forEach(l=>{const r=fLinkRecs().find(y=>y.ent===l.ent&&String(y.id)===String(l.id)&&String(y.sub??'')===String(l.sub??''));if(r&&!r.lk.includes(x.name))r.lk.push(x.name)});
    if(ok){const ent=x.loc?{c:'cp',r:'r',t:'t',x:'cp',o:'cp',fp:'cp',s:'s',p:'p',m:'cp'}[x.loc.t]:'cp',id=x.loc&&!['c','x','o','fp','m'].includes(x.loc.t)?x.loc.id:x.cp;
      if(id!=null)HIST.push({at:nowStamp(),who,ent,id,cp:x.cp,what:`Файл «${x.name}» возвращён администратором платформы`})}}
  else if(typeof OCD!=='undefined')delete OCD[x.org];// у остальных организаций набор файлов строится заново, с возвращённым
  if(!ok)return false;
  x.back={at:nowStamp(),by:who};HIST.push({at:nowStamp(),who,ent:'pfile',id:x.id,what:`Возвращён удалённый файл «${x.name}»${x.cpName?' · '+x.cpName:''}`});ckSoon();return true}
