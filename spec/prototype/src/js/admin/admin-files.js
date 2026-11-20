'use strict';
// Админка → «Файлы» и вкладка «Файлы» карточки организации (доработки 20.11.2026, пакет 2, блоки 3–5; поток И, этап 0, П7)
/* ═════════════ Модуль «Файлы» Админки ═════════════
   Вкладки: «Хранилище» — общее состояние; «Все файлы» — что лежит, чьё и откуда; «Проверка хранилища» — сверка базы с хранилищем.
   Администратор платформы только смотрит и скачивает файлы организаций (решение заказчика 20.11.2026): не переименовывает и не заменяет;
   удаляет только «лишний» файл хранилища и возвращает удалённый в течение дня. Отдельной записи о просмотре и скачивании нет (решение заказчика 20.11.2026).
   Строка списка: {id, org, orgName, cp, cpName, inn, name, src (источники через « · »), rec (записи), by, at, size, type, st, note, mem (считается в память), cat, path}.
   cat: 'org' — файл организации, 'sent' — от контрагента, не принят, 'lead' — документ заявки, 'rcpt' — чек подписки, 'trash' — удалён, ждёт стирания.
   Память организации — fileMemMb(org): одна функция для экрана «Подписка» владельца, вкладки «Подписки» и модуля «Файлы» (пакет 2, блок 5, пункт 2). */
const AF_ST={Загружен:['green','check'],'Новый от контрагента':['blue','clip'],'Отклонён фирмой':['yellow','ban'],'Удалён, ждёт очистки':['red','trash']};
// Источник файла организации по полю «Откуда» Файлового менеджера и по ссылкам файла (один файл — несколько записей, решение заказчика 16.11.2026)
const AF_KIND={'Отчёт':'Отчёт','Задача':'Задача','Поступление':'Поступление','Оплата налога':'Оплата налога','Разовая услуга':'Разовая услуга','Проект':'Проект','Загружен вручную':'Загружен вручную'};
const afLinkSrc=l=>l.ent==='in'?'Поступление':l.ent==='op'?(l.rec&&l.rec.kind==='pay'?'Оплата налога':'Финансовая операция'):l.ent==='fp'?'Оплата за обслуживание':l.ent==='r'?'Отчёт':l.ent==='s'?'Разовая услуга':l.ent==='p'?'Проект':'Запись';
const afUniq=a=>[...new Set(a.filter(Boolean))];
const afSentBy=x=>x.src==='tg'?'контрагент из Telegram':'контрагент со страницы';
// Кто: сотрудник демо-организации, пользователь другой организации (логин → ФИО), администратор или система
const afWho=id=>{const u=id&&OTHER_USERS.find(x=>x.login===id);return u?(u.short||u.fio):whoName(id)};
const afOrgName=id=>{const o=ORGS.find(x=>x.id===id);return o?o.name:''};
const afGb=mb=>afN1(mb/1000)+' ГБ';// 1 ГБ = 1 000 МБ, как в ценах подписки (baseMb, cpMb)
const afMbOf=b=>b/1048576;
const afN1=v=>(Math.round(v*10)/10).toLocaleString('ru-RU',{maximumFractionDigits:1});
// Все файлы одной организации (у демо — живые данные, у остальных — набор ocData); без удалённых — их строки дают afTrashRows
function afOrgRows(o){const out=[],on=o.name;const base={org:o.id,orgName:on};
  if(o.self){const fs=asOrg(()=>allFiles());
    fs.forEach(f=>{const c=f.cp?CPM[f.cp]:null;let src;
      if(f.kind==='Контрагент'){const fc=c&&(c.fromCp||[]).includes(f.name);src=[fc?'От контрагента':'Карточка контрагента',...(f.links||[]).map(afLinkSrc)]}
      else src=[AF_KIND[f.kind]||f.kind,...(f.links||[]).map(afLinkSrc)];
      const sx=f.kind==='Контрагент'&&c&&(c.fromCp||[]).includes(f.name)?SENT.find(x=>x.cp===c.id&&(x.fname||x.name)===f.name):null;
      out.push(Object.assign({id:'a'+f.id,cp:f.cp||null,cpName:c?c.name:'',inn:c?c.inn:'',name:f.name,src:afUniq(src).join(' · '),rec:f.src||'',by:sx?afSentBy(sx):whoName(f.by),at:String(f.date||'').slice(0,10),size:f.size||0,note:f.note||'',st:'Загружен',mem:true,cat:'org'},base))});
    // Файлы оплат за обслуживание и финансовых операций (пакет 2, блок 5, пункт 1): в Файловом менеджере фирмы их пока нет, в память они входят
    FEEPAYS.forEach(fp=>{if(fp.del)return;(fp.files||[]).forEach((n,i)=>{const c=CPM[fp.cp];out.push(Object.assign({id:`afp${fp.id}:${i}`,cp:fp.cp,cpName:c?c.name:'',inn:c?c.inn:'',name:n,src:'Оплата за обслуживание',rec:`Оплата за обслуживание ${fmtD(fp.date)}, ${som(fp.amount)}`,by:whoName(fp.by||fp._cb),at:fp.date,size:fmGet(fp.cp,n).size??fsize(n),note:fNoteOf(fp.cp,n),st:'Загружен',mem:true,cat:'org'},base))})});
    OPS.forEach(x=>{if(x.kind==='pay'||x.kind==='in'||String(x.kind).endsWith('_x'))return;(x.files||[]).forEach((n,i)=>{const c=CPM[x.cp];out.push(Object.assign({id:`afo${x.id}:${i}`,cp:x.cp||null,cpName:c?c.name:'',inn:c?c.inn:'',name:n,src:'Финансовая операция',rec:`${(OPK[opBase(x.kind)]||['Операция'])[0]} ${fmtD(x.date)}`,by:whoName(x.by||x._cb),at:x.date,size:fmGet(x.cp,n).size??fsize(n),note:'',st:'Загружен',mem:true,cat:'org'},base))})});
    SENT.filter(x=>x.st!=='ok').forEach(x=>{const c=CPM[x.cp];out.push(Object.assign({id:'as'+x.id,cp:x.cp,cpName:c?c.name:'',inn:c?c.inn:'',name:x.name,src:'От контрагента',rec:x.st==='rej'?'Отклонён: '+(x.why||''):'Ждёт решения фирмы',by:afSentBy(x),at:String(x.at).slice(0,10),size:x.size||0,note:x.note||'',st:x.st==='rej'?'Отклонён фирмой':'Новый от контрагента',mem:true,cat:'sent'},base))})}
  else{const d=ocData(o);
    d.files.forEach(f=>{const c=d.cpm[f.cp];out.push(Object.assign({id:'a'+f.id,cp:f.cp||null,cpName:c?c.name:'',inn:c?c.inn:'',name:f.name,src:f.kind==='Контрагент'?'Карточка контрагента':AF_KIND[f.kind]||f.kind,rec:f.src||'',by:d.who(f.by)||afWho(f.by),at:String(f.date||'').slice(0,10),size:f.size||0,note:'',st:'Загружен',mem:true,cat:'org'},base))});
    (d.sent||[]).forEach(x=>{const c=d.cpm[x.cp];out.push(Object.assign({id:'as'+x.id,cp:x.cp,cpName:c?c.name:'',inn:c?c.inn:'',name:x.name,src:'От контрагента',rec:'Ждёт решения фирмы',by:afSentBy(x),at:String(x.at).slice(0,10),size:x.size||0,note:'',st:'Новый от контрагента',mem:true,cat:'sent'},base))})}
  // Документы заявки на подключение: в списке организации с источником «Заявка на подключение», в память не входят
  LEADS.filter(l=>l.org===o.id).forEach(l=>(l.docs||[]).forEach((x,i)=>out.push(Object.assign({id:`al${l.id}:${i}`,cp:null,cpName:'',inn:'',name:x.name,src:LEAD_SRC,rec:`Заявка от ${fmtDT(l.at)} · ${ldDocT(x.kind)}`,by:'заявитель с сайта',at:String(l.at).slice(0,10),size:x.size||0,note:'',st:'Загружен',mem:false,cat:'lead'},base))));
  // Чеки подписок (модель подписок потока Т — subPays): тот же файл, что на вкладке «Подписки», в память не входит
  (DB.subPays||[]).filter(p=>p.org===o.id&&p.file).forEach(p=>out.push(Object.assign({id:'ar'+p.id,cp:null,cpName:'',inn:'',name:p.file.name,src:'Чек подписки',rec:`Оплата подписки ${fmtDT(p.at)}${p.sum!=null?', '+som(p.sum):''}`,by:afWho(p.by)||'Владелец организации',at:String(p.at).slice(0,10),size:p.file.size||0,note:'',st:'Загружен',mem:false,cat:'rcpt',pay:p},base)));
  return out}
// Удалённые файлы, которые ждут стирания: в «Все файлы» — с состоянием «Удалён, ждёт очистки», в память не входят
const afTrashRows=org=>ftLive().filter(x=>x.why!=='extra'&&(org==null||x.org===org)).map(x=>({id:'at'+x.id,org:x.org,orgName:afOrgName(x.org),cp:x.cp,cpName:x.cpName||afCpName(x),inn:'',name:x.name,src:x.src||'',rec:FT_WHY[x.why]||'',by:afWho(x.by),at:String(x.at).slice(0,10),size:x.size||0,note:'',st:'Удалён, ждёт очистки',mem:false,cat:'trash',tr:x}));
function afCpName(x){if(!x.cp)return '';const o=ORGS.find(y=>y.id===x.org);if(!o)return '';const d=ocData(o);const c=d.cpm[x.cp];return c?c.name:''}
// Документы заявок, по которым организация ещё не создана
const afLeadRows=()=>LEADS.filter(l=>!l.org).flatMap(l=>(l.docs||[]).map((x,i)=>({id:`al${l.id}:${i}`,org:null,orgName:`${l.firm||l.name} (заявка)`,cp:null,cpName:'',inn:l.inn||'',name:x.name,src:LEAD_SRC,rec:`Заявка от ${fmtDT(l.at)} · ${ldDocT(x.kind)}`,by:'заявитель с сайта',at:String(l.at).slice(0,10),size:x.size||0,note:'',st:'Загружен',mem:false,cat:'lead',lead:l})));
const afAll=()=>[...ORGS.flatMap(afOrgRows),...afTrashRows(),...afLeadRows()];
// Занятая память организации, МБ: всё, что она загрузила, в том числе файлы оплат и непринятые от контрагентов; без удалённых, чеков подписок и документов заявки
function fileMemMb(orgId){const o=ORGS.find(x=>x.id===orgId);if(!o)return 0;return afMbOf(afOrgRows(o).filter(r=>r.mem).reduce((a,r)=>a+(r.size||0),0))}
// Лимит памяти — из подписки организации (модель потока Т: subMem); до неё лимита нет
function afMem(orgId){const used=fileMemMb(orgId);let lim=null,inc=null,extra=null;
  if(typeof subMem==='function'&&(typeof subOf!=='function'||subOf(orgId))){const m=subMem(orgId)||{};lim=m.limit!=null?m.limit:null;inc=m.inc!=null?m.inc:null;extra=m.extra!=null?m.extra:null}
  return {used,lim,inc,extra,pct:lim?Math.round(used/lim*1000)/10:null}}
// Платформа: видео, обложки, логотипы — в память организаций не входят
function afPlatform(){let n=0,b=0;VIDEOS.forEach(v=>{if(v.del)return;if(v.file&&v.file.size){n++;b+=v.file.size}if(v.cover&&v.cover.size){n++;b+=v.cover.size}});
  ORGS.forEach(o=>{if(o.self?ORG.logo:o.req&&o.req.logo){n++;b+=fsize('logo'+o.id)%400000+60000}});return {n,b}}
const afDiffN=()=>{const c=STORE.check;return c.missing.length+c.extra.length+c.stuck.length+c.failed.length};
const afSum=rs=>rs.reduce((a,r)=>a+(r.size||0),0);
// Столбцы списка файлов: noOrg — в карточке организации столбца «Организация» нет
const afCols=noOrg=>[{key:'name',label:'Файл',type:'text',w:300,val:r=>r.name,html:r=>`${ic('file','sm')} <span class="strong">${esc(r.name)}</span>`},
  ...(noOrg?[]:[{key:'org',label:'Организация',type:'enum',w:220,val:r=>r.orgName}]),
  {key:'cp',label:'Контрагент',type:'enum',inn:true,w:210,val:r=>r.cpName||'',html:r=>r.cpName?esc(r.cpName):'<span class="faint">—</span>'},
  {key:'src',label:'Источник',type:'enum',w:220,val:r=>r.src},{key:'rec',label:'Запись',type:'text',w:260,hide:true,val:r=>r.rec},
  {key:'by',label:'Загрузил',type:'enum',w:170,val:r=>r.by},{key:'at',label:'Дата',type:'date',w:110,val:r=>r.at},
  {key:'size',label:'Размер',type:'int',w:100,num:true,val:r=>r.size,text:r=>fmtSize(r.size||0)},{key:'type',label:'Тип',type:'enum',w:80,val:r=>fext(r.name)},
  {key:'st',label:'Состояние',type:'enum',w:190,val:r=>r.st,html:r=>pill(r.st,AF_ST)},{key:'note',label:'Примечание',type:'text',w:220,hide:true,val:r=>r.note||''}];
// Список файлов (UnifiedDataGrid): страницами по 50, поиск по названию, организации, контрагенту и ИНН, без ключей хранилища
function afGrid(host,id,rows,o={}){return grid(host,{id,rid:r=>r.id,cols:afCols(o.noOrg),rows,title:'name',size:50,noun:['файл','файла','файлов'],sort:{key:'at',dir:-1},audit:false,search:o.search,preset:o.preset,simulateLoad:o.fresh,
  searchText:r=>[r.inn,r.orgName,r.cpName].join(' '),open:r=>afOpen(r,fvGridRows(id)||rows(),o),
  actions:r=>[{label:'Открыть',icon:'eye',run:()=>afOpen(r,fvGridRows(id)||rows(),o)},{label:'Скачать',icon:'download',run:()=>afDl(r)},...(r.org&&!o.inCard?[{label:'Открыть организацию',icon:'building',run:()=>orgCard(r.org,'files')}]:[]),
    ...(r.cat==='rcpt'&&typeof subOrgWin==='function'?[{label:'Открыть подписку',icon:'coins',run:()=>subOrgWin(r.org)}]:[]),...(r.cat==='trash'&&ftCanBack(r.tr)?[{sep:true},{label:'Вернуть',icon:'refresh',run:()=>afBackDlg(r.tr)}]:[])],
  empty:{icon:'folder',title:'Файлов пока нет'}})}
// «Скачать»: непринятый файл от контрагента — сначала предупреждение
function afDl(r){const go=()=>toast('Скачивание: '+r.name,'download');if(r.cat!=='sent')return go();
  confirmDlg({title:'Скачать файл от контрагента?',text:'Файл прислан контрагентом и не проверен фирмой. Открывайте его осторожно.',ok:'Скачать',run:go})}
// Окно файла — то же окно просмотра, что у организаций (ui/file-view.js); справа и ниже — сведения; стрелки листают файлы списка
function afOpen(r,list,o={}){list=list&&list.length?list:[r];const i=Math.max(0,list.findIndex(x=>x.id===r.id));
  fileView(list,i,{sub:f=>`${esc(f.orgName||'')}${f.src?' · '+esc(f.src):''}`,dl:afDl,
    info:f=>`<div class="box"><div class="kv">${acKv('Организация',f.org?`<button type="button" class="linkbtn" data-afo>${esc(f.orgName)}</button>`:esc(f.orgName||'—'))}${acKv('Контрагент',f.cpName?`${esc(f.cpName)}${f.inn?` · <span class="mono">${esc(f.inn)}</span>`:''}`:acDash)}${acKv('Источник',esc(f.src||'—'))}${acKv('Запись',esc(f.rec||'—'))}${acKv('Загрузил',`${esc(f.by||'—')}<div class="aud">${fmtD(f.at)}</div>`)}${acKv('Размер',`${fmtSize(f.size||0)} · ${esc(fext(f.name))}`)}${acKv('Состояние',pill(f.st,AF_ST))}${f.note?acKv('Примечание',esc(f.note),1):''}${f.cat==='trash'?acKv('Сотрётся',fmtDT(f.tr.erase)):''}</div>${f.cat==='sent'?acNote('Файл прислан контрагентом и не проверен фирмой: перед скачиванием будет предупреждение.'):''}${f.mem?'':`<span class="hint">${f.cat==='trash'?'Удалён: в память организации уже не входит.':'В память организации не входит.'}</span>`}</div>`,
    foot:f=>`${f.org&&!o.inCard?`<button class="btn" id="af-org">${ic('building','sm')}Открыть организацию</button>`:''}${f.cat==='rcpt'&&typeof subOrgWin==='function'?`<button class="btn" id="af-sub">${ic('coins','sm')}Открыть подписку</button>`:''}${f.cat==='trash'&&ftCanBack(f.tr)?`<button class="btn" id="af-back">${ic('refresh','sm')}Вернуть</button>`:''}<div class="grow"></div><button class="btn cta" data-close>Закрыть</button>`,
    mount(el,m,f){const og=()=>{m.close();orgCard(f.org,'files')};const b=$('#af-org',el);if(b)b.onclick=og;$$('[data-afo]',el).forEach(x=>x.onclick=o.inCard?()=>m.close():og);
      const s=$('#af-sub',el);if(s)s.onclick=()=>subOrgWin(f.org);const bk=$('#af-back',el);if(bk)bk.onclick=()=>afBackDlg(f.tr,()=>m.close())}})}
// «Вернуть» удалённый файл (пакет 2, блок 5, пункт 4)
function afBackDlg(x,done){if(!ftCanBack(x))return toast(FT_BACK_WHY[x.why]||'Вернуть нельзя','alert',true);
  const extra=x.why==='extra';
  confirmDlg({title:`Вернуть «${esc(x.name)}»?`,text:extra?'Файл снова появится в списке «лишних» на вкладке «Проверка хранилища» и стираться не будет.':`Файл снова появится там, где был${x.src?` (${esc(x.src)})`:''}, и снова будет считаться в память организации «${esc(afOrgName(x.org))}». Возврат запишется в историю файла.`,ok:'Вернуть',
    run:()=>{if(!ftRestore(x))return toast('Запись, к которой был прикреплён файл, удалена — вернуть файл некуда','alert',true);done&&done();refreshAll();const t=MODALS[MODALS.length-1];if(t&&t.draw)t.draw();toast('Файл возвращён','refresh')}})}
// «Ждут удаления»: удалённые файлы с датой стирания; «Вернуть» — в течение суток после удаления
function afTrashDlg(){openModal({size:'wide',render:()=>({title:'Ждут удаления',sub:`Файлы стираются из хранилища через ${FT_HOURS} часа после удаления; до этого их можно вернуть`,
  body:'<div id="af-tr"></div>',foot:'<span class="hint" style="margin:0">У организаций своей «Корзины» нет: удалённый файл сразу пропадает из их списков и из памяти</span><div class="grow"></div><button class="btn cta" data-close>Готово</button>',
  mount(el){grid($('#af-tr',el),{id:'af-trash',rid:x=>x.id,audit:false,search:false,size:50,title:'name',noun:['файл','файла','файлов'],sort:{key:'erase',dir:1},rows:()=>ftLive(),
    cols:[{key:'name',label:'Файл',type:'text',w:260,val:x=>x.name||x.path,html:x=>`${ic('file','sm')} <span class="strong">${esc(x.name||x.path)}</span>`},{key:'org',label:'Организация',type:'enum',w:200,val:x=>x.why==='extra'?'— лишний файл хранилища —':afOrgName(x.org)||'—'},
      {key:'cp',label:'Контрагент',type:'enum',w:190,val:x=>x.cpName||afCpName(x)},{key:'src',label:'Источник',type:'enum',w:180,val:x=>x.src||''},{key:'why',label:'Причина',type:'enum',w:220,val:x=>FT_WHY[x.why]||''},
      {key:'by',label:'Удалил',type:'enum',w:170,val:x=>afWho(x.by)},{key:'at',label:'Удалён',type:'datetime',w:150,val:x=>x.at},{key:'erase',label:'Сотрётся',type:'datetime',w:150,val:x=>x.erase},
      {key:'size',label:'Размер',type:'int',w:100,num:true,val:x=>x.size,text:x=>fmtSize(x.size||0)}],
    open:x=>afBackDlg(x),actions:x=>[{label:'Вернуть',icon:'refresh',disabled:!ftCanBack(x),reason:FT_BACK_WHY[x.why]||'',run:()=>afBackDlg(x)}],
    empty:{icon:'trash',title:'Удалённых файлов нет',text:'Сюда попадают файлы, которые сотрудники удалили за последние сутки'}})}})})}
/* ── вкладки ── */
const afTabs=()=>[{id:'store',label:'Хранилище',icon:'db'},{id:'all',label:'Все файлы',icon:'folder'},{id:'check',label:'Проверка хранилища',icon:'alert',count:afDiffN()||''}];
function renderAFiles(body,tab,fresh){if(tab==='all')return renderAFAll(body,fresh);if(tab==='check')return renderAFCheck(body,fresh);renderAFStore(body,fresh)}
// «Хранилище» — общее состояние (пакет 2, блок 3, пункт 3)
function renderAFStore(body,fresh){const all=afAll(),org=all.filter(r=>r.cat==='org'),sent=all.filter(r=>r.cat==='sent'),lead=all.filter(r=>r.cat==='lead'),rc=all.filter(r=>r.cat==='rcpt'),tr=ftLive(),pf=afPlatform();
  const trB=tr.reduce((a,x)=>a+(x.size||0),0),tot=afSum(all.filter(r=>r.cat!=='trash'))+pf.b+trB,totN=all.filter(r=>r.cat!=='trash').length+pf.n+tr.length,dn=afDiffN();
  const P=(id,icon,color,label,value,sub)=>plate({id,icon,color,label,value,sub});const gbmb=b=>b>=1e9?afGb(afMbOf(b)):fmtSize(b);
  // «Загружено по месяцам» за 12 месяцев — по дате загрузки файлов организаций, от контрагентов и заявок
  const mo=ym(TODAY),bars=[];for(let i=11;i>=0;i--){const m=addMonths(mo,-i);const b=afSum(all.filter(r=>r.cat!=='trash'&&String(r.at).slice(0,7)===m));bars.push({l:MONTHS[+m.slice(5,7)-1].slice(0,3),t:`${fmtMon(m)}: ${fmtSize(b)}`,v:Math.round(afMbOf(b))})}
  body.innerHTML=`<div class="af-pl">${P('tot','db','blue','Занято всего',gbmb(tot),`${fmtM(totN,false)} ${plural(totN,'файл','файла','файлов')}`)}${P('org','folder','green','Файлы организаций',gbmb(afSum(org)),`${fmtM(org.length,false)} ${plural(org.length,'файл','файла','файлов')}`)}${P('sent','clip',sent.length?'blue':'green','От контрагентов, не принятые',sent.length,fmtSize(afSum(sent)))}${P('lead','send','purple','Заявки с сайта',lead.length,fmtSize(afSum(lead)))}${P('pf','film','purple','Платформа',fmtSize(pf.b),'видео, обложки, логотипы')}${P('rcpt','coins','blue','Чеки подписок',rc.length,fmtSize(afSum(rc)))}${P('trash','trash',tr.length?'yellow':'green','Ждут удаления',tr.length,tr.length?'стираются через сутки после удаления':'удалённых файлов нет')}${P('diff','alert',dn?'red':'green','Расхождений',dn,STORE.check.at?'сверка '+fmtDT(STORE.check.at):'сверки ещё не было')}</div>
    <div class="box"><h3>Загружено по месяцам · МБ</h3>${actChart(bars,'Загружено, МБ')}</div>
    <div class="box"><h3>По организациям</h3><div id="af-orgs"></div><span class="hint">Нажмите на строку — откроется «Все файлы» с этой организацией</span></div>`;
  body.querySelector('.af-pl').onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;const p=b.dataset.plate;
    if(p==='trash')return afTrashDlg();if(p==='diff')return go('afiles','check');
    const pre={sent:{st:{type:'enum',vals:['Новый от контрагента','Отклонён фирмой']}},lead:{src:{type:'enum',vals:[LEAD_SRC]}},rcpt:{src:{type:'enum',vals:['Чек подписки']}},org:null,tot:null}[p];if(pre!==undefined)go('afiles','all',pre||undefined)};
  const rows=ORGS.map(o=>{const rs=afOrgRows(o).filter(r=>r.mem),m=afMem(o.id),last=rs.reduce((a,r)=>r.at>a?r.at:a,'');return {id:o.id,name:o.name,n:rs.length,mb:m.used,lim:m.lim,pct:m.pct,last}});
  grid($('#af-orgs',body),{id:'af-orgs',rid:x=>x.id,audit:false,search:false,title:'name',noun:['организация','организации','организаций'],sort:{key:'mb',dir:-1},rows:()=>rows,
    cols:[{key:'name',label:'Организация',type:'text',w:260,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},{key:'n',label:'Файлов',type:'int',w:100,num:true,val:x=>x.n},
      {key:'mb',label:'Объём, МБ',type:'num',w:120,num:true,val:x=>Math.round(x.mb*10)/10,text:x=>afN1(x.mb)},{key:'lim',label:'Лимит памяти',type:'num',w:130,num:true,val:x=>x.lim==null?null:x.lim,text:x=>x.lim==null?'':afGb(x.lim)},
      {key:'pct',label:'Занято, %',type:'num',w:110,num:true,agg:'',val:x=>x.pct,html:x=>x.pct==null?'<span class="faint">—</span>':`<span class="${x.pct>=100?'red strong':x.pct>=80?'yellow strong':''}">${fmtM(x.pct,false)} %</span>`},
      {key:'last',label:'Последняя загрузка',type:'date',w:150,val:x=>x.last||null}],
    open:x=>go('afiles','all',{org:{type:'enum',vals:[x.name]}}),actions:x=>[{label:'Файлы организации',icon:'folder',run:()=>go('afiles','all',{org:{type:'enum',vals:[x.name]}})},{label:'Открыть организацию',icon:'building',run:()=>orgCard(x.id,'files')}]})}
// «Все файлы» — что лежит, чьё и откуда (пакет 2, блок 3, пункт 4)
function renderAFAll(body,fresh){body.innerHTML='<div id="af-all"></div>';afGrid($('#af-all',body),'adm-files',afAll,{preset:S.preset,fresh})}
// «Проверка хранилища» (пакет 2, блок 3, пункт 6): четыре списка расхождений; сама сверка ничего не удаляет
const AF_DAY=24*36e5;
const afAge=x=>ftNow()-ftMs(x.at);
function renderAFCheck(body,fresh){const c=STORE.check;
  body.innerHTML=`<div class="note">${ic('info')}<span>Раз в сутки система сверяет базу с хранилищем — задача «Файлы: сверка хранилища» в <button type="button" class="linkbtn" id="af-runs">«Запусках»</button>. ${c.at?`Последняя сверка — ${fmtDT(c.at)}.`:'Сверки ещё не было.'} Сама сверка ничего не удаляет; файлы, которые ждут стирания, расхождением не считаются.</span></div>
    <div class="af-pl">${plate({id:'missing',icon:'alert',color:c.missing.length?'red':'green',label:'Есть в базе, нет в хранилище',value:c.missing.length})}${plate({id:'extra',icon:'db',color:c.extra.length?'yellow':'green',label:'Лишние в хранилище',value:c.extra.length,sub:'в базе записи нет'})}${plate({id:'stuck',icon:'hourglass',color:c.stuck.length?'yellow':'green',label:'Загрузки не закончены',value:c.stuck.length,sub:'больше суток'})}${plate({id:'failed',icon:'ban',color:c.failed.length?'red':'green',label:'Не удалось стереть',value:c.failed.length})}</div>
    <div class="box" id="afc-missing"><h3>Файл есть в базе, но пропал из хранилища · ${c.missing.length}</h3><div id="afc-m"></div><span class="hint">Только просмотр: такой файл администратор видит, но удалить или вернуть его нельзя</span></div>
    <div class="box" id="afc-extra"><h3>Файл лежит в хранилище, но в базе его нет · ${c.extra.length}</h3><div id="afc-x"></div><span class="hint">«Удалить» — по одному файлу, только старше суток; файл день ждёт стирания в «Ждут удаления»</span></div>
    <div class="box" id="afc-stuck"><h3>Загрузки, не законченные больше суток · ${c.stuck.length}</h3><div id="afc-s"></div><span class="hint">Их убирает задача «Очистка незаконченных загрузок файлов»</span></div>
    <div class="box" id="afc-failed"><h3>Файлы, которые не удалось стереть · ${c.failed.length}</h3><div id="afc-f"></div><span class="hint">Стирание повторяет задача «Повторное удаление файлов из хранилища»</span></div>`;
  $('#af-runs',body).onclick=()=>go('runs','jobs');
  body.querySelector('.af-pl').onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;const x=$('#afc-'+b.dataset.plate,body);if(x)x.scrollIntoView({behavior:'smooth',block:'start'})};
  const G=(sel,id,rows,cols,more)=>grid($(sel,body),Object.assign({id,rid:x=>x.path||x.id||x.name,audit:false,search:false,size:50,title:cols[0].key,noun:['файл','файла','файлов'],rows:()=>rows,cols,empty:{icon:'check',title:'Расхождений нет'}},more||{}));
  const sz={key:'size',label:'Размер',type:'int',w:100,num:true,val:x=>x.size,text:x=>fmtSize(x.size||0)},ogc={key:'org',label:'Организация',type:'enum',w:200,val:x=>afOrgName(x.org)||'—'};
  G('#afc-m','afc-missing',c.missing,[{key:'name',label:'Файл',type:'text',w:260,val:x=>x.name},ogc,{key:'cp',label:'Контрагент',type:'enum',w:180,val:x=>x.cpName||afCpName(x)},{key:'src',label:'Источник',type:'enum',w:170,val:x=>x.src||''},sz,{key:'at',label:'Загружен',type:'datetime',w:150,val:x=>x.at}]);
  G('#afc-x','afc-extra',c.extra,[{key:'path',label:'Путь в хранилище',type:'text',w:340,cls:'mono',val:x=>x.path},sz,{key:'at',label:'Появился',type:'datetime',w:150,val:x=>x.at},{key:'age',label:'Возраст',type:'text',w:130,val:x=>{const h=Math.floor(afAge(x)/36e5);return h<24?`${h} ч`:`${Math.floor(h/24)} ${plural(Math.floor(h/24),'день','дня','дней')}`},sortVal:x=>afAge(x)}],
    {open:x=>afExtraDel(x),actions:x=>[{label:'Удалить',icon:'trash',danger:true,disabled:afAge(x)<AF_DAY,reason:'Удалить можно только файл старше суток: загрузка может идти прямо сейчас',run:()=>afExtraDel(x)}]});
  G('#afc-s','afc-stuck',c.stuck,[{key:'name',label:'Файл',type:'text',w:260,val:x=>x.name},ogc,{key:'by',label:'Кто загружал',type:'enum',w:170,val:x=>x.by||''},sz,{key:'at',label:'Начата',type:'datetime',w:150,val:x=>x.at}]);
  G('#afc-f','afc-failed',c.failed,[{key:'name',label:'Файл',type:'text',w:260,val:x=>x.name||x.path},ogc,sz,{key:'tries',label:'Попыток',type:'int',w:100,num:true,agg:'',val:x=>x.tries},{key:'err',label:'Последняя ошибка',type:'text',w:240,val:x=>x.err||''},{key:'at',label:'Последняя попытка',type:'datetime',w:160,val:x=>x.at}])}
// «Удалить» лишний файл (решение заказчика 20.11.2026, вопрос 7 плана): подтверждение с путём, размером и датой; перед удалением — ещё одна проверка базы
function afExtraDel(x){if(afAge(x)<AF_DAY)return toast('Удалить можно только файл старше суток: загрузка может идти прямо сейчас','alert',true);
  confirmDlg({title:'Удалить лишний файл?',text:`<div class="kv">${acKv('Путь',`<span class="mono">${esc(x.path)}</span>`,1)}${acKv('Размер',fmtSize(x.size||0))}${acKv('Появился',fmtDT(x.at))}</div><p class="muted" style="margin:8px 0 0">Файл сутки ждёт стирания в «Ждут удаления» — до этого его можно вернуть. Кто, когда и какой файл удалил, записывается.</p>`,ok:'Удалить',danger:true,
    run:()=>{const c=STORE.check,i=c.extra.indexOf(x);
      // Повторная проверка: запись о файле появилась в базе (например, загрузка закончилась после сверки) — удалить нельзя
      if(x.rec){if(i>=0)c.extra.splice(i,1);HIST.push({at:nowStamp(),who:S.me,ent:'pfile',id:x.path,what:`Удаление отменено: у файла ${x.path} появилась запись в базе`});ckSoon();renderPage();return toast('Удалить нельзя: у файла появилась запись в базе. Файл убран из списка расхождений','alert',true)}
      if(i>=0)c.extra.splice(i,1);const t={id:'ft'+Date.now().toString(36),org:null,cp:null,cpName:'',name:x.path.split('/').pop(),path:x.path,size:x.size,src:'Лишний файл хранилища',by:S.me,at:nowStamp(),found:x.at,erase:ftStamp(ftNow()+FT_HOURS*36e5),why:'extra',loc:null,links:[]};
      STORE.trash.push(t);HIST.push({at:nowStamp(),who:S.me,ent:'pfile',id:t.id,what:`Удалён лишний файл хранилища ${x.path} (${fmtSize(x.size||0)}): сотрётся ${fmtDT(t.erase)}`});ckSoon();renderPage();toast('Файл удалён: сотрётся через сутки','trash')}})}
/* ── вкладка «Файлы» карточки организации (пакет 2, блок 4) ── */
// Полоса памяти: «Занято 9,4 из 14 ГБ»; до подписки — только объём. Нажатие ведёт на вкладку «Подписка» карточки (пакет 2, блок 6, пункт 4)
function afMemBar(orgId,link){const m=afMem(orgId);const cls=m.pct==null?'':m.pct>=100?'red':m.pct>=80?'yellow':'';
  return `<div class="box af-mem"><div class="row" style="gap:8px;align-items:baseline"><h3 style="margin:0">Память организации</h3><span class="strong">${m.lim==null?`Занято ${afGb(m.used)}`:`Занято ${afGb(m.used)} из ${afGb(m.lim)}`}</span>${m.pct!=null?`<span class="muted">${fmtM(m.pct,false)} %</span>`:''}<div class="grow"></div>${link&&m.lim!=null?`<button type="button" class="linkbtn" data-ocgo="${link}">Подписка ${ic('right','sm')}</button>`:''}</div>
    ${m.lim!=null?`<div class="bar af-bar ${cls}"><i style="width:${Math.min(100,m.pct)}%"></i></div>`:''}<span class="hint">${m.lim==null?'Лимит появится, когда у организации будет подписка':`${m.inc!=null?`В цену входит ${afGb(m.inc)}`:''}${m.extra?` · куплено сверх ${afGb(m.extra)}`:''}. Считается всё, что загрузила организация; удалённые файлы, чеки подписок и документы заявки не считаются`}</span></div>`}
function ocFilesTab(o){const rs=[...afOrgRows(o),...afTrashRows(o.id)];
  return `${afMemBar(o.id,'sub')}<div class="box"><h3>Объём по категориям</h3><div id="oc-fk"></div></div><div class="box"><h3>Файлы организации · ${rs.length}</h3><div id="oc-fl"></div><span class="hint">Только просмотр и скачивание: файлы меняет сама организация</span></div>`}
function ocFilesGrids(el,o){const rows=()=>[...afOrgRows(o),...afTrashRows(o.id)];const fk={};rows().forEach(r=>{const k=r.cat==='trash'?'Ждут удаления':r.src.split(' · ')[0];const x=fk[k]=fk[k]||{kind:k,n:0,size:0};x.n++;x.size+=r.size||0});
  acGrid(el,'#oc-fk',{id:'oc-fk',rid:x=>x.kind,cols:[{key:'kind',label:'Источник',type:'enum',w:240,val:x=>x.kind},{key:'n',label:'Файлов',type:'int',w:110,num:true,val:x=>x.n},{key:'mb',label:'Объём, МБ',type:'num',w:130,num:true,val:x=>Math.round(x.size/1048576*10)/10,text:x=>afN1(x.size/1048576)}],rows:()=>Object.values(fk),title:'kind',sort:{key:'mb',dir:-1},noun:['категория','категории','категорий']});
  const h=$('#oc-fl',el);if(h)afGrid(h,'oc-files',rows,{noOrg:true,inCard:true,search:false})}
