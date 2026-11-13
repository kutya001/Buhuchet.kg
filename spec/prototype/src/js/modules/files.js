'use strict';
// Модуль «Файловый менеджер»
/* ═════════════ Файловый менеджер ═════════════ */
function fsize(n){let h=7;for(const ch of n)h=(h*31+ch.charCodeAt(0))>>>0;return 38000+h%2400000}
function fmtSize(b){return b<1048576?Math.round(b/1024)+' КБ':(b/1048576).toFixed(1).replace('.',',')+' МБ'}
const fext=n=>{const i=n.lastIndexOf('.');return i>0?n.slice(i+1).toUpperCase():'ФАЙЛ'};
const FKIND={'Контрагент':'building','Отчёт':'file','Задача':'task','Поступление':'wallet','Оплата налога':'send','Разовая услуга':'coins','Проект':'briefcase','Загружен вручную':'upload'};
// Показ файла на странице контрагента (решение заказчика 06.11.2026): все файлы контрагента, кроме файлов задач, видны ему в разделе «Файлы»;
// скрытые хранятся у контрагента по названию файла (c.pgHide); скрыть и показать — право «Управлять страницей контрагента», запись в историю записи файла
const PGF_WHY='Нужно право «Управлять страницей контрагента»';
const pgFileOk=f=>feat('cppage')&&!!f.cp&&f.kind!=='Задача';
const pgFileHid=(cp,n)=>{const c=CPM[cp];return !!(c&&(c.pgHide||[]).includes(n))};
const pgFileTxt=f=>!pgFileOk(f)?'—':pgFileHid(f.cp,f.name)?'Скрыт':'Да';
function pgFileSet(cp,n,hide,ent,id){const c=CPM[cp];if(!c)return;const h=new Set(c.pgHide||[]);if(hide===h.has(n))return;hide?h.add(n):h.delete(n);c.pgHide=[...h];
  log(ent||'cp',id??cp,`Файл «${n}» ${hide?'скрыт со страницы контрагента':'снова показывается на странице контрагента'}`,cp);toast(hide?'Файл скрыт со страницы контрагента':'Файл показывается на странице контрагента',hide?'eyeoff':'eye')}
const pgFileAct=f=>{if(!pgFileOk(f))return [];const hd=pgFileHid(f.cp,f.name);return [{label:hd?'Показать на странице контрагента':'Скрыть со страницы контрагента',icon:hd?'eye':'eyeoff',disabled:!can('cpPage'),reason:PGF_WHY,run:()=>{pgFileSet(f.cp,f.name,!hd,f.h&&f.h[0],f.h&&f.h[1]);refreshAll()}}]};
// Кнопка «глаз» в блоке «Файлы» записи: открытый — файл виден контрагенту, перечёркнутый — скрыт
function pgFileBtn(cp,n,ent,id){if(!feat('cppage')||!cp||!can('cpPage'))return '';const hd=pgFileHid(cp,n),t=hd?'Скрыт со страницы контрагента. Показать':'Виден на странице контрагента. Скрыть';
  return `<button class="icon-btn sm${hd?' pgf-off':''}" data-pgf="${esc(JSON.stringify([cp,n,ent||'cp',id??cp]))}" title="${t}" aria-label="${t}: ${esc(n)}">${ic(hd?'eyeoff':'eye','sm')}</button>`}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-pgf]');if(!b)return;e.stopPropagation();e.preventDefault();let a;try{a=JSON.parse(b.dataset.pgf)}catch(_){return}
  pgFileSet(a[0],a[1],!pgFileHid(a[0],a[1]),a[2],a[3]);const m=MODALS[MODALS.length-1];if(m&&m.draw)m.draw();refreshAll()},true);
/* Примечание к прикреплённому файлу и правка прикреплённых файлов (просьба заказчика 13.11.2026, v95).
   Примечание необязательно, до 300 знаков: его видят сотрудники в записи, в карточке контрагента и в Файловом менеджере; контрагенту на его странице оно не показывается.
   В прототипе примечание, размер заменённого файла и отметка замены хранятся у контрагента по названию файла (c.fmeta) — как и «скрыт со страницы» (c.pgHide);
   у файлов без контрагента — у организации (ORG.fmeta); у загруженных вручную — в самой записи файла. */
const FNOTE_MAX=300,FNAME_MAX=180,FILE_MAX_MB=20;
const fmOwner=cp=>cp&&CPM[cp]?CPM[cp]:ORG;
const fmGet=(cp,n)=>{const o=fmOwner(cp);return (o.fmeta&&o.fmeta[n])||{}};
function fmSet(cp,n,patch){const o=fmOwner(cp);const s=o.fmeta||(o.fmeta={});const m=Object.assign({},s[n],patch);Object.keys(m).forEach(k=>{if(m[k]==null||m[k]==='')delete m[k]});if(Object.keys(m).length)s[n]=m;else delete s[n]}
const fNoteOf=(cp,n)=>fmGet(cp,n).note||'';
const fNoteClean=s=>String(s||'').replace(/\s+/g,' ').trim().slice(0,FNOTE_MAX);
// Только что прикреплённые файлы (fs — выбранные в поле): размер и примечание — одно на все выбранные
function fNoteAdd(cp,fs,note){note=fNoteClean(note);fs.forEach(x=>fmSet(cp,x.name,{size:x.size,note}))}
const fNoteLog=note=>note?'. Примечание: '+note:'';
const fNoteHtml=(cp,n)=>{const t=fNoteOf(cp,n);return t?`<div class="f-note" title="Примечание к файлу">${esc(t)}</div>`:''};
// Переименование: название меняется в списке файлов записи и везде, где прототип помнит файл по названию
function fRenIn(arr,n,n2){if(!arr)return;const i=arr.indexOf(n);if(i>=0)arr[i]=n2}
function fRenMeta(cp,n,n2){const o=fmOwner(cp);if(o.fmeta&&o.fmeta[n]){o.fmeta[n2]=o.fmeta[n];delete o.fmeta[n]}if(cp&&CPM[cp]){const c=CPM[cp];if((c.pgHide||[]).includes(n))c.pgHide=c.pgHide.map(x=>x===n?n2:x);fRenIn(c.regFiles,n,n2)}if(FUP.has(n))FUP.add(n2)}
// Окно «Прикрепить файлы»: после выбора файлов — их список и необязательное примечание. files — выбранные в поле файлы, run(примечание) — прикрепить
function attachDlg(files,run,sub){if(!files.length)return;const big=files.filter(x=>x.size>FILE_MAX_MB*1048576);
  openModal({form:true,noMax:true,render:()=>({title:files.length>1?`Прикрепить файлы: ${files.length}`:'Прикрепить файл',sub:sub?esc(sub):'',
    body:`<div class="list at-l">${files.map(x=>`<div class="li" style="cursor:default">${ic('file')}<div class="grow"><div class="t1">${esc(x.name)}</div><div class="t2">${fext(x.name)} · ${fmtSize(x.size)}</div></div></div>`).join('')}</div>${big.length?`<div class="note bad">${ic('alert')}<span>Файл больше ${FILE_MAX_MB} МБ: ${esc(big.map(x=>x.name).join(', '))}. Выберите файлы заново.</span></div>`:''}
    <div class="form">${fld('Примечание',`<textarea class="inp f-note-i" id="at-note" maxlength="${FNOTE_MAX}" placeholder="Необязательно: что это за документ"></textarea>`,{full:true,id:'at-note',hint:`${files.length>1?'Одно на все выбранные файлы. ':''}Видно сотрудникам в записи и в Файловом менеджере; контрагенту на его странице не показывается`})}</div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="at-ok" ${big.length?'disabled':''}>Прикрепить</button>`,
    mount(el,m){$('#at-ok',el).onclick=()=>{const note=fNoteClean(val(el,'at-note'));m.close();run(note)}}})})}
// Заменить файл может тот, кто может его удалить: прежний файл при замене пропадает
const fRepOk=f=>f.manual?can('filesDelete')||f.manual.by===S.me&&diffDays(TODAY,(f.manual.at||'').slice(0,10))<=1:fileDelOk(f.name);
const fEditOk=f=>feat('files')&&can('filesUpload')&&!!f.ren;
const FEDIT_WHY='Нужно право «Загружать файлы»';
const fEditAct=f=>f.ren?[{label:'Изменить',icon:'edit',disabled:!fEditOk(f),reason:FEDIT_WHY,run:()=>fileEditDlg(f)}]:[];
// Окно «Изменить файл»: название (расширение не меняется), примечание, замена файла. f — строка allFiles(); done(новое название) — после сохранения
function fileEditDlg(f,done){const cut=n=>{const i=n.lastIndexOf('.');return i>0?[n.slice(0,i),n.slice(i)]:[n,'']};const [base0,ext0]=cut(f.name);const repOk=fRepOk(f);
  openModal({form:true,render:()=>({title:'Изменить файл',sub:`${esc(f.kind)} · ${esc(f.src)}`,body:`<div class="form">
    ${fld('Название',`<div class="fe-n">${inp('fe-name',base0,`maxlength="${FNAME_MAX}" autocomplete="off"`)}<span class="mono muted" id="fe-ext">${esc(ext0)}</span></div>`,{req:true,full:true,id:'fe-name',hint:'Расширение остаётся прежним; при замене файла — берётся от нового'})}
    ${fld('Примечание',`<textarea class="inp f-note-i" id="fe-note" maxlength="${FNOTE_MAX}" placeholder="Необязательно: что это за документ">${esc(f.note||'')}</textarea>`,{full:true,id:'fe-note',hint:'Видно сотрудникам; контрагенту на его странице не показывается'})}
    ${fld('Заменить файл',repOk?`<input class="inp" type="file" id="fe-f">`:`<span class="faint">Замена недоступна</span>`,{full:true,id:'fe-f',hint:repOk?`Необязательно. Сейчас: ${fext(f.name)} · ${fmtSize(f.size)}. Новый файл встанет на место прежнего везде, где он виден; прежний удаляется без возможности вернуть`:'Заменить файл может тот, у кого есть право «Удалять файлы»; свой файл — в течение суток после загрузки'})}
    </div>`,foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="fe-ok">Сохранить</button>',
    mount(el,m){const fi=$('#fe-f',el);if(fi)fi.onchange=()=>{const x=fi.files[0];$('#fe-ext',el).textContent=x?cut(x.name)[1]:ext0};
      $('#fe-ok',el).onclick=()=>{const nf=fi&&fi.files[0]||null;const base=val(el,'fe-name').replace(/\s+/g,' ');const ext=nf?cut(nf.name)[1]:ext0;const n2=base+ext;const note=fNoteClean(val(el,'fe-note'));
        let e=!base?'Укажите название файла':/[\\/:*?"<>|]/.test(base)?'В названии нельзя использовать знаки \\ / : * ? " < > |':n2.length>FNAME_MAX?`Название длиннее ${FNAME_MAX} знаков`:'';
        if(!e&&n2!==f.name&&allFiles().some(x=>x.id!==f.id&&(x.cp||null)===(f.cp||null)&&x.name===n2))e=f.cp?'У этого контрагента уже есть файл с таким названием':'Среди общих файлов организации уже есть файл с таким названием';
        const ok1=setErr(el,'fe-name',e),ok2=setErr(el,'fe-f',nf&&nf.size>FILE_MAX_MB*1048576?`Файл больше ${FILE_MAX_MB} МБ`:'');if(!ok1||!ok2)return;
        const cp=f.cp||null,h=f.h&&f.h[1]!=null?f.h:null,lg=t=>{if(h)log(h[0],h[1],t,cp)};const did=[];
        if(n2!==f.name){f.ren(n2);if(!f.manual){fRenMeta(cp,f.name,n2);if(fmGet(cp,n2).size==null)fmSet(cp,n2,{size:f.size})}lg(`Файл «${f.name}» переименован в «${n2}»`);did.push('ren')}
        if(note!==(f.note||'')){if(f.manual)f.manual.note=note;else fmSet(cp,n2,{note});lg(note?`Примечание к файлу «${n2}»: ${note}`:`Примечание к файлу «${n2}» убрано`);did.push('note')}
        if(nf){const rp={at:nowStamp(),by:S.me};if(f.manual){f.manual.size=nf.size;f.manual.rep=rp}else fmSet(cp,n2,{size:nf.size,rep:rp});FUP.add(n2);lg(`Файл «${n2}» заменён: было ${fmtSize(f.size)}, стало ${fmtSize(nf.size)}`);did.push('rep')}
        if(f.manual&&did.length)touch(f.manual);
        m.close();if(!did.length)return;refreshAll();const top=MODALS[MODALS.length-1];if(top&&top.draw)top.draw();toast(did.includes('rep')?'Файл заменён':'Файл изменён','edit');done&&done(n2)}}})})}
function allFiles(){const out=[];const vc=new Set(visCps(true,'files').map(c=>c.id));const add=(o)=>{const fm=o.manual||fmGet(o.cp,o.name);o.size=fm.size!=null?fm.size:fsize(o.name);o.note=fm.note||'';o.rep=fm.rep||null;out.push(o)};
  CPS.forEach(c=>{if(!vc.has(c.id))return;(c.files||[]).forEach((n,i)=>add({id:`c${c.id}:${i}`,name:n,cp:c.id,kind:'Контрагент',src:(c.regFiles||[]).includes(n)?'Из свидетельства и выписки':'Карточка контрагента',date:(c._ua||c.start).slice(0,10),by:c._ub||c.resp,h:['cp',c.id],open:()=>openCp(c,'files'),rm:()=>fRm(c.files,n,'cp',c.id,c.id),ren:n2=>fRenIn(c.files,n,n2)}))});
  REPORTS.forEach(r=>{if(!vc.has(r.cp)||!r.files.length)return;r.files.forEach((n,i)=>add({id:`r${r.id}:${i}`,name:n,cp:r.cp,kind:'Отчёт',src:`${T[r.t].short} · ${r.plabel}`,date:r.subDate||TODAY,by:r.resp,h:['r',r.id],open:()=>openReport(r),rm:()=>fRm(r.files,n,'r',r.id,r.cp),ren:n2=>fRenIn(r.files,n,n2)}))});
  if(feat('tasks'))TASKS.forEach(t=>{if(!t.file||(t.cp&&!vc.has(t.cp)))return;add({id:`t${t.id}`,name:t.file,cp:t.cp,kind:'Задача',src:t.title,date:t.doneAt||t.created,by:t.exec,h:['t',t.id],open:()=>openTask(t),rm:()=>{const n=t.file;t.file='';log('t',t.id,'Удалён файл: '+n,t.cp)},ren:n2=>{t.file=n2}})});
  if(taxVis())OPS.forEach(o=>{if(o.kind!=='pay'||!vc.has(o.cp))return;const r=REPORTS.find(y=>y.id===o.report);(o.files||[]).forEach((n,i)=>add({id:`x${o.id}:${i}`,name:n,cp:o.cp,kind:'Оплата налога',src:`Оплата ${r?T[r.t].short+' '+r.plabel:''} — ${som(o.amount)} от ${fmtD(o.date)}`,date:o.date,by:o.by,h:r?['r',r.id]:['cp',o.cp],open:r?()=>openReport(r):null,rm:()=>fRm(o.files,n,r?'r':'cp',r?r.id:o.cp,o.cp),ren:n2=>fRenIn(o.files,n,n2)}))});
  if(taxVis())OPS.forEach(o=>{if(o.kind!=='in'||!vc.has(o.cp))return;(o.files||[]).forEach((n,i)=>add({id:`o${o.id}:${i}`,name:n,cp:o.cp,kind:'Поступление',src:`Поступление ${som(o.total??o.amount)} от ${fmtD(o.date)}`,date:o.date,by:o.by,h:['cp',o.cp],open:()=>inCard(o),rm:()=>fRm(o.files,n,'cp',o.cp,o.cp),ren:n2=>fRenIn(o.files,n,n2)}))});
  SERVICES.forEach(s=>{if(!vc.has(s.cp))return;[...s.files,...s.pays.flatMap(p=>p.files||[])].forEach((n,i)=>add({id:`s${s.id}:${i}`,name:n,cp:s.cp,kind:'Разовая услуга',src:s.name,date:s.date,by:s.resp,h:['s',s.id],open:()=>serviceCard(s),rm:()=>fRm(s.files.includes(n)?s.files:(s.pays.find(x=>(x.files||[]).includes(n))||{}).files,n,'s',s.id,s.cp),ren:n2=>fRenIn(s.files.includes(n)?s.files:(s.pays.find(x=>(x.files||[]).includes(n))||{}).files,n,n2)}))});
  PROJECTS.forEach(p=>{if(!vc.has(p.cp)||!projVisible(p))return;[...p.files,...p.pays.flatMap(x=>x.files||[])].forEach((n,i)=>add({id:`p${p.id}:${i}`,name:n,cp:p.cp,kind:'Проект',src:p.name,date:p.from,by:p.lead||p.resps[0],h:['p',p.id],open:()=>openProject(p),rm:()=>fRm(p.files.includes(n)?p.files:(p.pays.find(x=>(x.files||[]).includes(n))||{}).files,n,'p',p.id,p.cp),ren:n2=>fRenIn(p.files.includes(n)?p.files:(p.pays.find(x=>(x.files||[]).includes(n))||{}).files,n,n2)}))});
  FILES.forEach(f=>{if(f.cp&&!vc.has(f.cp))return;add({id:f.id,name:f.name,cp:f.cp,kind:'Загружен вручную',src:'Загружен вручную',date:f.at,by:f.by,manual:f,h:['cp',f.cp],open:null,ren:n2=>{f.name=n2}})});
  return out}
// Удаление прикреплённого файла из списка модуля: файл пропадает из записи, удаление пишется в её историю
function fRm(arr,n,ent,id,cp){if(!arr)return;const i=arr.indexOf(n);if(i>=0)arr.splice(i,1);log(ent,id,'Удалён файл: '+n,cp)}
const FKIND_L={'Загружен вручную':'Загружено вручную','Контрагент':'Карточки контрагентов','Отчёт':'К отчётам','Задача':'К задачам','Поступление':'К поступлениям','Оплата налога':'К оплатам налогов','Разовая услуга':'К разовым услугам','Проект':'К проектам'};
function filesAdd(){return can('filesUpload')?[{label:'Загрузить файл',icon:'upload',run:()=>uploadDlg()}]:[]}
function renderFiles(body,tab,fresh){const all=allFiles();
  body.innerHTML=`<div class="plates">${Object.keys(FKIND).filter(k=>k==='Загружен вручную'||all.some(f=>f.kind===k)).map(k=>plate({id:k,icon:FKIND[k],color:k==='Загружен вручную'?'purple':'blue',label:FKIND_L[k]||k,value:all.filter(f=>f.kind===k).length})).join('')}</div><div id="flg"></div>`;
  body.querySelector('.plates').onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;const g=GS.files;if(!g)return;g.filters={kind:{type:'enum',vals:[b.dataset.plate]}};g.page=0;renderPage()};
  grid($('#flg',body),{id:'files',audit:x=>x.manual||{_ca:x.date+' 09:00',_cb:x.by},cols:[
    {key:'name',label:'Файл',type:'text',w:320,val:f=>f.name,html:f=>`${ic('file','sm')} <span class="strong">${esc(f.name)}</span>`},
    {key:'ext',label:'Тип',type:'enum',w:80,val:f=>fext(f.name),hide:true},
    {key:'kind',label:'Откуда',type:'enum',w:170,hide:true,val:f=>f.kind,html:f=>`<span class="tag">${ic(FKIND[f.kind],'sm')} ${esc(f.kind)}</span>`},
    {key:'src',label:'Источник',type:'text',w:280,val:f=>f.src},
    {key:'cp',label:'Контрагент',type:'enum',inn:true,w:210,val:f=>f.cp?CPM[f.cp].name:'',html:f=>f.cp?esc(CPM[f.cp].name):'<span class="faint">общий файл</span>'},
    {key:'date',label:'Дата',type:'date',w:110,val:f=>f.date},
    {key:'size',label:'Размер',type:'int',w:100,num:true,val:f=>f.size,html:f=>fmtSize(f.size),hide:true},
    {key:'by',label:'Загрузил',type:'enum',w:130,val:f=>whoName(f.by)},
    {key:'desc',label:'Примечание',type:'text',w:220,val:f=>f.note||''},
    ...(feat('cppage')?[{key:'pg',label:'На странице контрагента',type:'enum',w:190,hide:true,val:pgFileTxt,html:f=>{const t=pgFileTxt(f);return t==='—'?'<span class="faint">—</span>':t==='Скрыт'?`<span class="muted">${ic('eyeoff','sm')} Скрыт</span>`:`${ic('eye','sm')} Да`}}]:[])],
    rows:allFiles,title:'name',noun:['файл','файла','файлов'],sort:{key:'date',dir:-1},preset:S.preset,simulateLoad:fresh,open:openFile,
    actions:f=>[{label:'Открыть',icon:'eye',run:()=>openFile(f)},{label:'Скачать',icon:'download',run:()=>toast('Скачивание: '+f.name,'download')},...(f.open?[{label:'Перейти к источнику',icon:FKIND[f.kind],run:f.open}]:[]),...fEditAct(f),...pgFileAct(f),...(f.manual?[{sep:true},{label:'Удалить',icon:'trash',danger:true,disabled:!(can('filesDelete')||f.manual.by===S.me&&diffDays(TODAY,(f.manual.at||'').slice(0,10))<=1),reason:'Нужно право «Удалять файлы»: свой файл можно удалить без права в течение суток',run:()=>confirmDlg({title:`Удалить «${esc(f.name)}»?`,text:'Файл загружен вручную и нигде больше не прикреплён.',ok:'Удалить',danger:true,run:()=>{FILES.splice(FILES.indexOf(f.manual),1);refreshAll();toast('Файл удалён')}})}]:f.rm?[{sep:true},{label:'Удалить',icon:'trash',danger:true,disabled:!fileDelOk(f.name),reason:'Нужно право «Удалять файлы»: свой файл можно удалить без права в течение суток',run:()=>confirmDlg({title:`Удалить «${esc(f.name)}»?`,text:`Файл пропадёт из записи «${esc(f.src)}» и из файлового менеджера. Удаление записывается в историю записи.`,ok:'Удалить',danger:true,run:()=>{f.rm();refreshAll();toast('Файл удалён','trash')}})}]:[])],
    empty:{icon:'folder',title:'Файлов пока нет',add:()=>uploadDlg()}});
}
function openFile(f){if(!f)return;openModal({size:'mid',render:()=>({title:esc(f.name),sub:`${esc(f.kind)} · ${esc(f.src)}`,body:`<div class="box" style="align-items:center;justify-content:center;min-height:180px;text-align:center"><span style="transform:scale(2.2);display:inline-block;color:var(--muted)">${ic('file')}</span><b style="margin-top:12px">${fext(f.name)} · ${fmtSize(f.size)}</b><span class="hint">Предпросмотр PDF и картинок появится в рабочей версии</span></div>
  <div class="box"><div class="kv"><div><span class="k">Откуда</span><span class="v">${esc(f.kind)}</span></div><div><span class="k">Источник</span><span class="v">${esc(f.src)}</span></div><div><span class="k">Контрагент</span><span class="v">${f.cp?esc(CPM[f.cp].name):'общий файл организации'}</span></div><div><span class="k">Загрузил</span><span class="v">${esc(whoName(f.by)||'—')}, ${fmtD(f.date)}</span></div>${f.rep?`<div><span class="k">Заменён</span><span class="v">${esc(whoName(f.rep.by)||'—')}, ${fmtDT(f.rep.at)}</span></div>`:''}<div style="grid-column:1/-1"><span class="k">Примечание</span><span class="v">${f.note?esc(f.note):'<span class="faint">нет</span>'}</span></div></div></div>`,
  foot:`<button class="btn" id="fo-dl">${ic('download','sm')}Скачать</button>${f.ren?`<button class="btn" id="fo-ed" ${fEditOk(f)?'':`disabled title="${FEDIT_WHY}"`}>${ic('edit','sm')}Изменить</button>`:''}<div class="grow"></div>${f.open?`<button class="btn cta" id="fo-src">${ic(FKIND[f.kind],'sm')}Перейти к источнику</button>`:'<button class="btn cta" data-close>Готово</button>'}`,
  mount(el,m){$('#fo-dl',el).onclick=()=>toast('Скачивание: '+f.name,'download');if($('#fo-ed',el))$('#fo-ed',el).onclick=()=>fileEditDlg(f,()=>{m.close();const nf=allFiles().find(x=>x.id===f.id);if(nf)openFile(nf)});if($('#fo-src',el))$('#fo-src',el).onclick=()=>{m.close();f.open()}}})})}
function uploadDlg(c0){openModal({form:true,render:()=>({title:'Загрузить файл',sub:'Файл появится в файловом менеджере с источником «Загружен вручную»',body:`<div class="form">${fld('Файлы',`<input class="inp" type="file" id="up-f" multiple>`,{req:true,full:true,id:'up-f'})}${fld('Контрагент',cpSel('up-cp',visCps(false,'files'),c0?c0.id:'',{empty:'— общий файл организации —'}),{id:'up-cp',hint:'Файл контрагента виден и в его карточке'})}${fld('Примечание',`<textarea class="inp f-note-i" id="up-note" maxlength="${FNOTE_MAX}" placeholder="Необязательно: что это за документ"></textarea>`,{full:true,id:'up-note',hint:'Видно сотрудникам; контрагенту на его странице не показывается'})}${feat('cppage')?`<label class="check-row" id="up-pgr" style="grid-column:1/-1;border-bottom:0"><input type="checkbox" id="up-pg" checked><span class="grow">Показывать контрагенту на его странице<div class="hint">В разделе «Файлы» страницы контрагента по ссылке. Для общего файла организации не действует</div></span></label>`:''}</div>`,
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="up-ok">Загрузить</button>',
  mount(el,m){$('#up-ok',el).onclick=()=>{const fs=[...$('#up-f',el).files];if(!setErr(el,'up-f',fs.length?'':'Выберите хотя бы один файл'))return;const big=fs.filter(x=>x.size>20*1048576);if(!setErr(el,'up-f',big.length?`Файл больше 20 МБ: ${big.map(x=>x.name).join(', ')}`:''))return;const cp=+val(el,'up-cp')||null;fs.forEach(x=>FILES.push(born({id:'m'+(FILES.length+1)+'u'+Date.now()%10000,name:x.name,size:x.size,cp,by:S.me,at:TODAY,note:fNoteClean(val(el,'up-note'))})));if(cp)log('cp',cp,'Загружены файлы: '+fs.map(x=>x.name).join(', '),cp);
    const pg=$('#up-pg',el);if(cp&&pg&&!pg.checked)fs.forEach(x=>pgFileSet(cp,x.name,true,'cp',cp));m.close();refreshAll();toast(`Загружено: ${fs.length}`,'upload')}}})})}

