'use strict';
// «Файлы от контрагентов» (доработки 14.11.2026, блок 2; прототип v112). Контрагент отправляет файлы со своей страницы (из Telegram — этап 2, поток К);
// у контрагента — раздел «Отправленные файлы» на вкладке «Файлы» карточки, в «Файловом менеджере» — вкладка «Файлы от контрагентов».
// Статусы: «Новый» → «Принят» или «Отклонён» (с обязательной причиной); принятый становится обычным файлом контрагента с источником «От контрагента».
// Непринятые («Новый» и «Отклонён») через 30 дней после отправки удаляются полностью, вместе с файлом в хранилище, без напоминания (решение заказчика 14.11.2026).
/* ═════════════ Файлы от контрагентов ═════════════ */
const SNT_KEEP=30,SNT_PER=10,SNT_DAY=20,SNT_NOTE=300;
const SNT_ST={new:'Новый',ok:'Принят',rej:'Отклонён'};
const SNT_PILL={Новый:['blue','clip'],Принят:['green','check'],Отклонён:['red','ban']};
const sntSrc=x=>x.src==='tg'?'Telegram':'Страница';
const sntWho=x=>x.src==='tg'?(x.who||'Telegram'):'Контрагент';
// Сколько дней осталось до удаления непринятого файла; у принятого — null
const sntLeft=x=>x.st==='ok'?null:Math.max(0,SNT_KEEP-diffDays(TODAY,String(x.at).slice(0,10)));
const sntLeftTxt=x=>{const n=sntLeft(x);return n==null?'':n?`Удалится через ${n} ${plural(n,'день','дня','дней')}`:'Удалится сегодня'};
// Удаление через 30 дней: строка и сам файл пропадают; запись в историю контрагента — от имени системы
function sntPurge(){for(let i=SENT.length-1;i>=0;i--){const x=SENT[i];if(x.st==='ok'||diffDays(TODAY,String(x.at).slice(0,10))<SNT_KEEP)continue;SENT.splice(i,1);
  log('cp',x.cp,`Удалён непринятый файл от контрагента «${x.name}»: прошло ${SNT_KEEP} дней после отправки`,x.cp,{who:'system'})}}
// Видны файлы тех контрагентов, которых сотрудник видит сейчас (область права «Просматривать файлы»)
function sntRows(cp){sntPurge();if(!feat('files')||!can('filesView'))return [];const vc=new Set(visCps(true,'files').map(c=>c.id));return SENT.filter(x=>vc.has(x.cp)&&(cp==null||x.cp===cp))}
const sntNew=()=>feat('cppage')?sntRows().filter(x=>x.st==='new').length:0;
// Принять и отклонить — у того, кто видит контрагента и может загружать файлы
const SNT_WHY='Нужно право «Загружать файлы»';
const sntCan=()=>can('filesUpload');
// Может ли контрагент отправлять файлы: страница включена, раздел «Файлы» показан, галочка в учётной политике и у контрагента
const sntUpOn=c=>pgOn(c)&&pgSecs(c).includes('files')&&ORG.cpUpload!==false&&!(c.page&&c.page.noUp);
// Кому сообщить о новом файле: ответственному, без него (или он заблокирован, без Telegram) — первому владельцу с Telegram
function sntNotify(c,n){const to=pgTgStaff(c);if(to)tgSvc(to,n>1?`Новые файлы от контрагента: ${n}`:'Новый файл от контрагента')}
function sntAccept(x){const c=CPM[x.cp];if(!c||x.st!=='new')return;let n=x.name;if((c.files||[]).includes(n)){const i=n.lastIndexOf('.'),b=i>0?n.slice(0,i):n,e=i>0?n.slice(i):'';let k=2;while(c.files.includes(`${b} (${k})${e}`))k++;n=`${b} (${k})${e}`}
  Object.assign(x,{st:'ok',dBy:S.me,dAt:nowStamp(),fname:n});c.files=c.files||[];c.files.push(n);c.fromCp=[...(c.fromCp||[]),n];fmSet(c.id,n,{size:x.size,note:x.note||''});FUP.add(n);
  log('cp',c.id,`Принят файл от контрагента «${x.name}»${n!==x.name?` (сохранён как «${n}»)`:''}`,c.id);refreshAll();toast('Файл принят: он среди файлов контрагента','check')}
function sntRejectDlg(x,done){openModal({form:true,noMax:true,render:()=>({title:'Отклонить файл',sub:esc(x.name),body:`<div class="form">${fld('Причина',`<textarea class="inp" id="snt-why" maxlength="${SNT_NOTE}" placeholder="Например: не тот месяц, пришлите выписку за октябрь"></textarea>`,{req:true,full:true,id:'snt-why',hint:'Контрагент увидит причину на своей странице. Отклонённый файл удалится через '+SNT_KEEP+' дней после отправки'})}</div>`,
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn danger" id="snt-ok">Отклонить</button>',
  mount(el,m){$('#snt-ok',el).onclick=()=>{const why=val(el,'snt-why').replace(/\s+/g,' ').trim();if(!setErr(el,'snt-why',why?'':'Укажите причину'))return;
    Object.assign(x,{st:'rej',why,dBy:S.me,dAt:nowStamp()});log('cp',x.cp,`Отклонён файл от контрагента «${x.name}»: ${why}`,x.cp);m.close();refreshAll();done&&done();toast('Файл отклонён, контрагент увидит причину','ban')}}})})}
function sntActs(x){const ok=x.st==='new',c=CPM[x.cp];return [{label:'Открыть',icon:'eye',run:()=>sntOpen(x)},{label:'Скачать',icon:'download',run:()=>toast('Скачивание: '+x.name,'download')},
  ...(ok?[{label:'Принять',icon:'check',disabled:!sntCan(),reason:SNT_WHY,run:()=>sntAccept(x)},{label:'Отклонить',icon:'ban',danger:true,disabled:!sntCan(),reason:SNT_WHY,run:()=>sntRejectDlg(x)}]:[]),
  ...(c?[{sep:true},{label:'Открыть контрагента',icon:'building',run:()=>openCp(c,'files')}]:[])]}
function sntOpen(x){const c=CPM[x.cp];openModal({size:'mid',render:()=>({title:esc(x.name),sub:`От контрагента · ${sntSrc(x)}`,body:`<div class="box" style="align-items:center;justify-content:center;min-height:160px;text-align:center"><span style="transform:scale(2.2);display:inline-block;color:var(--muted)">${ic('file')}</span><b style="margin-top:12px">${fext(x.name)} · ${fmtSize(x.size)}</b><span class="hint">Предпросмотр PDF и картинок появится в рабочей версии</span></div>
  <div class="box"><div class="kv"><div><span class="k">Контрагент</span><span class="v">${c?esc(c.name):'—'}</span></div><div><span class="k">Откуда</span><span class="v">${sntSrc(x)}</span></div><div><span class="k">Кто отправил</span><span class="v">${esc(sntWho(x))}</span></div><div><span class="k">Когда</span><span class="v">${fmtDT(x.at)}</span></div>${x.note?`<div><span class="k">Комментарий</span><span class="v">${esc(x.note)}</span></div>`:''}<div><span class="k">Статус</span><span class="v">${pill(SNT_ST[x.st],SNT_PILL)}${x.st==='rej'?` <span class="hint">${esc(x.why||'')}</span>`:''}${x.dBy?` <span class="hint">· ${esc(whoName(x.dBy))}, ${fmtDT(x.dAt)}</span>`:''}</span></div>${x.st!=='ok'?`<div><span class="k">Удаление</span><span class="v">${sntLeftTxt(x)}</span></div>`:''}</div></div>`,
  foot:`<button class="btn" id="snto-dl">${ic('download','sm')}Скачать</button><div class="grow"></div>${x.st==='new'?`<button class="btn danger" id="snto-rej" ${sntCan()?'':`disabled title="${SNT_WHY}"`}>${ic('ban','sm')}Отклонить</button><button class="btn cta" id="snto-ok" ${sntCan()?'':`disabled title="${SNT_WHY}"`}>${ic('check','sm')}Принять</button>`:'<button class="btn cta" data-close>Готово</button>'}`,
  mount(el,m){$('#snto-dl',el).onclick=()=>toast('Скачивание: '+x.name,'download');if($('#snto-ok',el))$('#snto-ok',el).onclick=()=>{m.close();sntAccept(x)};if($('#snto-rej',el))$('#snto-rej',el).onclick=()=>{m.close();sntRejectDlg(x)}}})})}
// Раздел «Отправленные файлы» на вкладке «Файлы» карточки контрагента — над документами, если в нём есть строки
function sntBox(c){const l=sntRows(c.id).slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)));if(!l.length)return '';const nw=l.filter(x=>x.st==='new').length;
  return `<div class="box snt-box"><h3>${ic('upload','sm')} Отправленные файлы${nw?` <span class="badge" title="Новых">${nw}</span>`:''}</h3><div class="tbl-wrap"><table class="mini m-cards"><thead><tr><th>Файл</th><th>Откуда</th><th>Кто отправил</th><th>Когда</th><th>Комментарий</th><th>Статус</th><th>Удалится</th><th></th></tr></thead><tbody>${l.map(x=>`<tr class="clk" data-snt="${esc(x.id)}">
    <td class="wrap">${ic('file','sm')} ${esc(x.name)}<div class="hint">${fext(x.name)} · ${fmtSize(x.size)}</div></td><td class="muted">${sntSrc(x)}</td><td class="muted">${esc(sntWho(x))}</td><td class="muted" style="white-space:nowrap">${fmtDT(x.at)}</td><td class="wrap muted">${esc(x.note||'')}</td>
    <td>${pill(SNT_ST[x.st],SNT_PILL)}${x.st==='rej'&&x.why?`<div class="hint">${esc(x.why)}</div>`:''}</td><td class="muted" style="white-space:nowrap">${x.st==='ok'?'<span class="faint">—</span>':sntLeftTxt(x).replace('Удалится ','')}</td>
    <td class="num">${x.st==='new'?`<div class="snt-acts"><button class="btn sm" data-sntok="${esc(x.id)}" ${sntCan()?'':`disabled title="${SNT_WHY}"`}>${ic('check','sm')}Принять</button> <button class="btn sm ghost" data-sntrej="${esc(x.id)}" ${sntCan()?'':`disabled title="${SNT_WHY}"`}>${ic('ban','sm')}Отклонить</button></div>`:''}</td></tr>`).join('')}</tbody></table></div>
    <span class="hint">Файлы, которые контрагент прислал со своей страницы или через Telegram. Принятый файл становится обычным файлом контрагента с источником «От контрагента» и виден на его странице в разделе «Файлы»; непринятые («Новый» и «Отклонён») удаляются через ${SNT_KEEP} дней после отправки.</span></div>`}
function sntMount(el,redraw){$$('[data-snt]',el).forEach(r=>r.onclick=e=>{if(e.target.closest('button'))return;const x=SENT.find(y=>y.id===r.dataset.snt);if(x)sntOpen(x)});
  $$('[data-sntok]',el).forEach(b=>b.onclick=e=>{e.stopPropagation();const x=SENT.find(y=>y.id===b.dataset.sntok);if(x){sntAccept(x);redraw&&redraw()}});
  $$('[data-sntrej]',el).forEach(b=>b.onclick=e=>{e.stopPropagation();const x=SENT.find(y=>y.id===b.dataset.sntrej);if(x)sntRejectDlg(x,redraw)})}
// Вкладка «Файлы от контрагентов» Файлового менеджера: по всем контрагентам; сначала «Новый», внутри — от новых к старым
function renderSent(body,fresh){body.innerHTML='<div id="sntg"></div>';
  grid($('#sntg',body),{id:'files-sent',audit:false,cols:[
    {key:'name',label:'Файл',type:'text',w:280,val:x=>x.name,html:x=>`${ic('file','sm')} <span class="strong">${esc(x.name)}</span>`},
    {key:'cp',label:'Контрагент',type:'enum',inn:true,w:210,val:x=>CPM[x.cp]?CPM[x.cp].name:''},
    {key:'st',label:'Статус',type:'enum',w:130,val:x=>SNT_ST[x.st],html:x=>pill(SNT_ST[x.st],SNT_PILL)+(x.st==='rej'&&x.why?`<div class="hint">${esc(x.why)}</div>`:'')},
    {key:'src',label:'Откуда',type:'enum',w:110,val:sntSrc},
    {key:'who',label:'Кто отправил',type:'text',w:170,val:sntWho},
    {key:'at',label:'Когда',type:'date',w:110,val:x=>String(x.at).slice(0,10)},
    {key:'note',label:'Комментарий',type:'text',w:220,val:x=>x.note||''},
    {key:'resp',label:'Ответственный',type:'enum',w:150,val:x=>CPM[x.cp]?whoName(CPM[x.cp].resp):''},
    {key:'left',label:'Удалится через, дн.',type:'int',w:150,num:true,val:x=>sntLeft(x)??'',html:x=>x.st==='ok'?'<span class="faint">—</span>':String(sntLeft(x))},
    {key:'ord',label:'Порядок: новые сначала',type:'text',w:120,hide:true,val:x=>(x.st==='new'?'2':'1')+String(x.at)}],
    rows:()=>sntRows(),title:'name',noun:['файл','файла','файлов'],sort:{key:'ord',dir:-1},preset:S.preset,simulateLoad:fresh,open:sntOpen,actions:sntActs,
    empty:{icon:'upload',title:'Контрагенты пока ничего не присылали',text:'Файлы со страницы контрагента и из Telegram появятся здесь со статусом «Новый»'}})}
function filesTabs(){if(!feat('cppage'))return [];const n=sntNew();return [{id:'all',label:'Все файлы',icon:'folder'},{id:'sent',label:'Файлы от контрагентов',icon:'upload',count:n||null}]}

/* Страница контрагента: «Отправить файл» и список отправленного со статусом, причиной отказа и «Удалится через N дн.» */
const sntDayCnt=c=>SENT.filter(x=>x.cp===c.id&&x.src==='page'&&Date.now()-new Date(String(x.at).replace(' ','T')+':00+06:00').getTime()<864e5).length;
function pubSentHtml(c){const up=sntUpOn(c),l=SENT.filter(x=>x.cp===c.id).sort((a,b)=>String(b.at).localeCompare(String(a.at)));if(!up&&!l.length)return '';
  return `<div class="pub-sent">${up?`<div class="row"><button type="button" class="btn sm cta" data-pub-up>${ic('upload','sm')}Отправить файл</button><span class="hint">Документы для бухгалтера: до ${SNT_PER} файлов за раз, до ${FILE_MAX_MB} МБ каждый</span></div>`:''}
    ${l.length?`<b class="pub-sl-h">Отправленные вами</b><div class="pub-list pub-sl">${l.map(x=>`<div class="pub-frow pub-srow">${ic(pubFIc(x.name))}<span class="pub-fm"><b>${esc(x.name)}</b><span class="hint">${fmtDT(x.at)}${x.note?' · '+esc(x.note):''}</span>${x.st==='rej'&&x.why?`<span class="hint bad">Причина: ${esc(x.why)}</span>`:''}</span><span class="pub-fs">${pill(SNT_ST[x.st],SNT_PILL)}${x.st!=='ok'?`<span class="hint">${sntLeftTxt(x)}</span>`:''}</span></div>`).join('')}${pubMore(l.length)}</div>`:''}</div>`}
function pubUpDlg(c){if(!sntUpOn(c)){toast('Ваш бухгалтер сейчас не принимает файлы через страницу','lock',true);return}
  openModal({form:true,noMax:true,render:()=>({title:'Отправить файл',sub:'Файлы получит ваш бухгалтер',body:`<div class="form">${fld('Файлы',`<input class="inp" type="file" id="pu-f" multiple>`,{req:true,full:true,id:'pu-f',hint:`До ${SNT_PER} файлов за раз, до ${FILE_MAX_MB} МБ каждый. Программы, сценарии и веб-страницы не принимаются`})}
    ${fld('Комментарий',`<textarea class="inp" id="pu-note" maxlength="${SNT_NOTE}" placeholder="Необязательно: что это за документы"></textarea>`,{full:true,id:'pu-note'})}</div>`,
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="pu-ok">Отправить</button>',
  mount(el,m){$('#pu-ok',el).onclick=()=>{const fs=[...$('#pu-f',el).files],left=SNT_DAY-sntDayCnt(c);
    const big=fs.filter(x=>x.size>FILE_MAX_MB*1048576),bad=fs.filter(x=>{const i=x.name.lastIndexOf('.');return i>0&&TG_FILE_NO.has(x.name.slice(i+1).toLowerCase())});
    const e=!fs.length?'Выберите хотя бы один файл':fs.length>SNT_PER?`За раз можно отправить не больше ${SNT_PER} файлов`:big.length?`Файл больше ${FILE_MAX_MB} МБ: ${big.map(x=>x.name).join(', ')}`:bad.length?`Такие файлы не принимаются: ${bad.map(x=>x.name).join(', ')}`:fs.length>left?(left>0?`За сутки можно отправить не больше ${SNT_DAY} файлов. Сегодня осталось: ${left}`:`За сутки можно отправить не больше ${SNT_DAY} файлов. Попробуйте завтра`):'';
    if(!setErr(el,'pu-f',e))return;const note=val(el,'pu-note').replace(/\s+/g,' ').trim().slice(0,SNT_NOTE),at=nowStamp();
    fs.forEach((x,i)=>SENT.push({id:'sf'+Date.now().toString(36)+i,cp:c.id,name:x.name.slice(0,FNAME_MAX),size:x.size,src:'page',at,note,st:'new'}));
    HIST.push({at,who:'client',ent:'cp',id:c.id,cp:c.id,what:`Контрагент отправил со страницы ${fs.length>1?'файлы':'файл'}: ${fs.map(x=>x.name).join(', ')}${note?'. Комментарий: '+note:''}`});
    sntNotify(c,fs.length);dbSoon();m.close();pubDraw(true);toast(fs.length>1?`Файлы отправлены бухгалтеру: ${fs.length}`:'Файл отправлен бухгалтеру','upload')}}})})}
