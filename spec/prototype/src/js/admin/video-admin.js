'use strict';
// Админка → «База знаний (содержимое)» → «Видео» и «Просмотры видео» (решение заказчика 08.11.2026)
/* ═════════════ Список видео ═════════════ */
const vidStTxt=v=>v.status==='Черновик'?'1/2 Черновик':v.off?'2/2 Опубликовано · снято':'2/2 Опубликовано';
const vidSize=v=>v.src==='file'&&v.file?v.file.size||0:0;
const vidGB=b=>(b/1073741824).toFixed(1).replace('.',',')+' ГБ';
const vidViewers=v=>new Set(VVIEWS.filter(r=>r.v===v.id&&segLen(r.segs)>=1).map(r=>(r.org||'self')+'|'+r.u)).size;
function vidLog(v,to){(v.hist=v.hist||[]).push({at:nowStamp(),to,who:S.me});pdLog(`Видео: «${v.t}» — ${to}`,'video')}
const vidSrcTxt=v=>v.src==='yt'?'YouTube':'Файл';
function renderVidAdm(body,fresh){
  body.innerHTML=`<div class="note">${ic('info')}<span>Видео платформы — для вкладки «Видео» Базы знаний, окна «?» модулей, статей, новостей, шагов уроков и лендинга. Загружает, меняет и удаляет видео только администратор платформы; организации видео не загружают. Файл уходит из браузера прямо в хранилище частями; в прототипе загрузка показывается полосой, а сам файл хранится в памяти браузера до перезагрузки страницы. Ссылка YouTube играет во встроенном плеере YouTube.</span></div><div id="pg"></div>${pdHistHtml('video')}`;
  grid($('#pg',body),{id:'kb-adm-video',cols:[
    {key:'cv',label:'Обложка',type:'enum',w:120,val:v=>v.cover?'Своя':v.frame?'Кадр видео':'Рисованная',html:v=>`<span class="vth">${vidCover(v,{cls:'xs',nod:1,nop:1})}</span>`},
    {key:'t',label:'Название',type:'text',w:300,val:v=>v.t,html:v=>`<span class="strong">${esc(v.t)}</span>${v.ytBad?' <span class="pill sm red">YouTube: видео недоступно</span>':''}`},
    {key:'kind',label:'Вид',type:'enum',w:170,val:v=>VID_K[v.kind],html:vidKindPill},
    {key:'src',label:'Источник',type:'enum',w:110,val:vidSrcTxt},
    {key:'mod',label:'Модуль',type:'enum',w:220,val:vidModT,sortVal:vidModOrd},
    {key:'dur',label:'Длительность',type:'text',w:120,num:true,val:v=>v.dur?vidT(v.dur):'—',sortVal:v=>v.dur||0},
    {key:'size',label:'Размер',type:'int',w:110,num:true,val:vidSize,html:v=>vidSize(v)?fmtSize(vidSize(v)):'—'},
    {key:'status',label:'Статус',type:'enum',w:220,val:vidStTxt,html:v=>`<span class="pill sm ${v.status==='Черновик'?'faint':v.off?'red':'green'}">${esc(vidStTxt(v))}</span>`},
    {key:'land',label:'На лендинге',type:'enum',w:130,val:v=>v.land&&vidLive(v)?'Да · '+(v.landOrd||1):'Нет'},
    {key:'viewers',label:'Зрителей',type:'int',w:110,num:true,val:vidViewers},
    {key:'aud',label:'Для кого',type:'enum',w:170,hide:true,val:v=>v.aud==='adm'?'Только режим Админка':'Все пользователи'},
    {key:'ord',label:'Порядок',type:'int',w:100,hide:true,num:true,val:v=>v.ord||0},
    {key:'id',label:'Код',type:'text',w:110,hide:true,cls:'mono',val:v=>v.id},
    {key:'upd',label:'Обновлено',type:'date',w:140,val:v=>(v._ua||'').slice(0,10),sortVal:v=>v._ua||''}],
    rows:()=>VIDEOS.filter(v=>!v.del),title:'t',noun:['видео','видео','видео'],sort:{key:'upd',dir:-1},ordered:true,
    caption:()=>{const l=VIDEOS.filter(v=>!v.del);return `<span>Видео: <b>${l.length}</b></span><span>Опубликовано: <b>${l.filter(vidLive).length}</b></span><span>Занято: <b>${vidGB(l.reduce((a,v)=>a+vidSize(v),0))}</b></span>`},
    rowClass:v=>v.status==='Черновик'||v.off?'muted':'',open:v=>vidAdmCard(v),actions:vidAdmActs,searchText:v=>v.t+' '+(v.desc||''),preset:S.preset,simulateLoad:fresh})}
function vidPub(v,on){if(on==='pub'){v.status='Опубликовано';v.off=false;touch(v);vidLog(v,'Опубликовано');refreshAll();toast('Видео опубликовано: оно появилось во вкладке «Видео» Базы знаний'+(v.kind==='instr'&&v.mod?' и в окне «?» модуля':''),'film');return}
  if(on==='off')return confirmDlg({title:`Снять «${esc(v.t)}» с публикации?`,text:'Видео пропадёт у пользователей и с лендинга; по старым ссылкам будет «Видео снято с публикации». Набранные просмотры сохранятся. Вернуть его можно в любой момент.',ok:'Снять с публикации',danger:true,run:()=>{v.off=true;touch(v);vidLog(v,'Снято с публикации');refreshAll();toast('Видео снято с публикации')}});
  v.off=false;touch(v);vidLog(v,'Возвращено в публикацию');refreshAll();toast('Видео снова опубликовано','film')}
function vidDel(v){confirmDlg({title:`Удалить видео «${esc(v.t)}»?`,text:'Видео удалится из хранилища, ссылки на него в статьях и новостях перестанут работать. Статистика просмотров останется с названием и пометкой «удалено».',ok:'Удалить',danger:true,
  run:()=>{v.del=true;v.land=false;touch(v);vidLog(v,'Удалено');if(VID_BLOB[v.id]){URL.revokeObjectURL(VID_BLOB[v.id]);delete VID_BLOB[v.id]}MODALS.filter(m=>m.vid===v.id||m.vadm===v.id).forEach(m=>m.close());refreshAll();toast('Видео удалено')}})}
const vidWho=v=>{MODALS.slice().forEach(m=>m.close());VID.pf={vt:{type:'enum',vals:[v.t+(v.del?' (удалено)':'')]}};go('kbadm','vviews')};
function vidAdmActs(v){return [{label:'Открыть',icon:'film',run:()=>vidAdmCard(v)},{label:'Изменить',icon:'edit',run:()=>vidEditDlg(v)},{label:v.src==='yt'?'Заменить ссылку':'Заменить файл',icon:'refresh',sub:'Ссылки в статьях, новостях и уроках и набранные просмотры сохранятся',run:()=>vidEditDlg(v,{replace:1})},{sep:true},
  v.status==='Черновик'?{label:'Опубликовать',icon:'send',run:()=>vidPub(v,'pub')}:v.off?{label:'Вернуть в публикацию',icon:'refresh',run:()=>vidPub(v,'on')}:{label:'Снять с публикации',icon:'ban',sub:'Пропадёт у пользователей и с лендинга, останется здесь',run:()=>vidPub(v,'off')},
  {label:'Скопировать ссылку',icon:'link',run:()=>vidCopy(v)},{label:'Кто смотрел',icon:'eye',run:()=>vidWho(v)},{sep:true},
  {label:'Удалить',icon:'trash',danger:true,disabled:!(v.status==='Черновик'||v.off),reason:'Удалить можно черновик или снятое с публикации видео',run:()=>vidDel(v)}]}
// Карточка видео: плеер для проверки, поля, история, «Скопировать ссылку», «Кто смотрел»
function vidAdmCard(v){let ctl=null;const who=id=>id==='admin'?'Администратор платформы':(EM[id]||{}).fio||id;
  const row=(k,x)=>`<dt>${k}</dt><dd>${x}</dd>`;const art=v.art&&KB_ARTS.find(a=>a.id===v.art);
  const m=openModal({size:'wide',sticky:true,noMax:true,swipeHead:true,render:()=>({title:esc(v.t),sub:`${VID_K[v.kind]} · <span class="pill sm ${v.status==='Черновик'?'faint':v.off?'red':'green'}">${esc(vidStTxt(v))}</span>${v.ytBad?' <span class="pill sm red">YouTube: видео недоступно</span>':''}`,
    body:`<div class="vid-w"><div class="vid-p"></div></div><div class="box"><dl class="vd-dl">${row('Источник',v.src==='yt'?`YouTube · <span class="mono">${esc(v.yt||'')}</span>`:`Файл · ${esc((v.file||{}).name||'')}${vidSize(v)?' · '+fmtSize(vidSize(v)):''}${VID_BLOB[v.id]?'':' <span class="faint">(в прототипе — имитация плеера)</span>'}`)}${row('Длительность',v.dur?vidT(v.dur):'узнается при первом просмотре')}${row('Модуль',esc(vidModT(v)))}${row('Связанная статья',art?esc(art.t):'—')}${row('Порядок',v.ord||0)}${row('Для кого',v.aud==='adm'?'Только режим Админка':'Все пользователи')}${row('На лендинге',v.land&&vidLive(v)?'Да, порядок '+(v.landOrd||1):'Нет')}${row('Зрителей',vidViewers(v)+(VGUEST[v.id]?` · гости лендинга: ${VGUEST[v.id].n} ${plural(VGUEST[v.id].n,'запуск','запуска','запусков')}`:''))}${v.desc?row('Описание',esc(v.desc)):''}</dl></div>
      <div class="box"><h3>История</h3><ul class="tl">${(v.hist||[]).slice().reverse().map(h=>`<li><b>${esc(h.to)}</b> <span class="muted">${fmtDT(h.at)} · ${esc(who(h.who))}</span></li>`).join('')||'<li class="muted">Пусто</li>'}</ul></div>`,
    foot:`<button class="btn ghost" id="va-link">${ic('link','sm')}Скопировать ссылку</button><button class="btn ghost" id="va-who">${ic('eye','sm')}Кто смотрел</button><div class="grow"></div><button class="btn" id="va-rep">${ic('refresh','sm')}${v.src==='yt'?'Заменить ссылку':'Заменить файл'}</button><button class="btn" id="va-ed">${ic('edit','sm')}Изменить</button><button class="btn cta" data-close>Закрыть</button>`,
    mount(el,mm){if(ctl)ctl.destroy();ctl=vidPlayer($('.vid-p',el),v,{track:null,auto:false});$('#va-link',el).onclick=()=>vidCopy(v);$('#va-who',el).onclick=()=>vidWho(v);$('#va-ed',el).onclick=()=>{mm.close();vidEditDlg(v)};$('#va-rep',el).onclick=()=>{mm.close();vidEditDlg(v,{replace:1})}}}),onClose:()=>{if(ctl)ctl.destroy()}});
  m.vadm=v.id;m.el.classList.add('vid-m')}

/* ═════════════ Форма видео ═════════════ */
const VID_MAX=500*1024*1024;
// Обложка хранится копией: картинка уменьшается до 960 px по ширине (JPEG)
function vidShrink(src,w,cb){const im=new Image();im.onload=()=>{const k=Math.min(1,w/im.naturalWidth);const c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*k);c.height=Math.round(im.naturalHeight*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);try{cb(c.toDataURL('image/jpeg',.82))}catch(e){cb(null)}};im.onerror=()=>cb(null);im.src=src}
function vidEditDlg(v0,o={}){const isNew=!v0;const v=v0||{t:'',kind:'instr',src:'file',yt:'',dur:0,desc:'',mod:'',art:'',ord:(VIDEOS.reduce((a,x)=>Math.max(a,x.ord||0),0)+1),aud:'all',status:'Черновик',off:false,land:false,landOrd:(vidLand().length+1)};
  const U={ph:v.src==='file'&&v.file?'done':'idle',file:v.file?{...v.file}:null,blob:null,dur:v.dur||0,frame:v.frame||null,pct:0,tm:0,changed:false,yt:v.yt||'',ytDur:0,cover:v.cover||null,cvTouched:false};
  const pubd=v.status==='Опубликовано'&&!v.off;const modL=[['','Общее'],...BIZ.filter(m=>m.id!=='kb').map(m=>[m.id,m.title]),...ADM.filter(m=>m.id!=='kb').map(m=>[m.id,'Админка · '+m.title]),['kb','База знаний']];
  let ytCtl=null;
  const m=openModal({form:true,size:'mid',render:()=>({title:isNew?'Новое видео':o.replace?(v.src==='yt'?'Заменить ссылку':'Заменить файл'):'Видео',sub:isNew?'Сначала сохраняется черновиком':esc(v.t)+' · '+esc(vidStTxt(v)),body:`<div class="form">
    ${fld('Название',inp('vf-t',v.t,'maxlength="120"'),{req:true,full:true,id:'vf-t',hint:'До 120 знаков'})}
    ${fld('Вид',sel('vf-k',[['instr','Видеоинструкция'],['pres','Презентация']],v.kind),{req:true,id:'vf-k',hint:'Видеоинструкция — просмотры сотрудников учитываются по людям; презентация — знакомство с платформой для лендинга, новостей и вкладки «Видео»'})}
    ${fld('Источник',`<div class="seg" role="group" aria-label="Источник"><button type="button" data-vsrc="file" class="${v.src!=='yt'?'on':''}">${ic('upload','sm')}Загрузить файл</button><button type="button" data-vsrc="yt" class="${v.src==='yt'?'on':''}">${ic('link','sm')}Ссылка YouTube</button></div>`,{req:true,id:'vf-src'})}
    <div class="fld full" data-f="vf-file" ${v.src==='yt'?'hidden':''}><label class="req" for="vf-file">Файл видео</label><label class="vf-drop" id="vf-drop" tabindex="0"><input type="file" id="vf-file" accept="video/mp4,video/webm,.mp4,.webm" hidden>${ic('upload')}<span class="vf-fn" id="vf-fn"></span></label><div class="vf-up" id="vf-up" hidden><span class="bar" aria-hidden="true"><i></i></span><span class="vf-up-t"></span><button type="button" class="btn sm" id="vf-upx">Отменить</button></div><div class="hint">MP4 (H.264) или WebM до 500 МБ, перетаскиванием или выбором; файл уходит прямо в хранилище частями</div><div class="err" hidden></div></div>
    <div class="fld full" data-f="vf-yt" ${v.src==='yt'?'':'hidden'}><label class="req" for="vf-yt">Ссылка YouTube</label><input class="inp" id="vf-yt" value="${esc(v.yt?'https://youtu.be/'+v.yt:'')}" placeholder="https://youtu.be/…" inputmode="url"><div class="hint">youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/… или youtube.com/embed/…; видео должно быть открытым или с доступом по ссылке</div><div class="err" hidden></div><div class="vf-ytp" id="vf-ytp"></div></div>
    <div class="fld full" data-f="vf-cv"><label for="vf-cv">Обложка</label><div class="row vf-cvr"><span class="vf-cvi" id="vf-cvi"></span><label class="btn sm" style="cursor:pointer">${ic('image','sm')}Выбрать картинку<input type="file" id="vf-cv" accept="image/png,image/jpeg" hidden></label><button type="button" class="btn sm ghost" id="vf-cvx">Убрать</button></div><div class="hint">Необязательно: PNG или JPG до 2 МБ. Без неё у файла берётся кадр с первой секунды, у YouTube — обложка YouTube</div><div class="err" hidden></div></div>
    ${fld('Описание',`<textarea class="inp" id="vf-d" maxlength="1000" rows="3">${esc(v.desc||'')}</textarea>`,{full:true,id:'vf-d',hint:'Необязательно, до 1 000 знаков, простой текст'})}
    ${fld('Модуль',sel('vf-m',modL,v.mod||''),{id:'vf-m',hint:'У видеоинструкции обязательно; у модуля может быть несколько видео'})}${fld('Связанная статья',sel('vf-a',[['','— нет'],...KB_ARTS.filter(a=>a.active!==false).map(a=>[a.id,a.sec+' · '+a.t])],v.art||''),{id:'vf-a'})}
    ${fld('Порядок',inp('vf-o',v.ord||0,'type="number" min="0" step="1"'),{id:'vf-o',hint:'Место в группе модуля'})}${fld('Для кого',sel('vf-aud',[['all','Все пользователи'],['adm','Только режим Админка']],v.aud||'all'),{id:'vf-aud'})}
    ${fld('Показывать на лендинге',`<label class="row" style="gap:8px"><input type="checkbox" class="sw" id="vf-land" ${v.land?'checked':''} ${pubd?'':'disabled'}>в блоке «Видео о Buhuchet.kg»</label>`,{id:'vf-land',hint:pubd?'':'Только у опубликованного видео'})}${fld('Порядок на лендинге',inp('vf-lo',v.landOrd||1,`type="number" min="1" step="1" ${pubd?'':'disabled'}`),{id:'vf-lo',hint:'Первое — крупно, с кнопкой «▶»'})}</div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><div class="grow"></div>${v.status==='Черновик'?`<button class="btn" id="vf-save">Сохранить черновик</button><button class="btn cta" id="vf-pub">${ic('send','sm')}Опубликовать</button>`:`<button class="btn cta" id="vf-save">Сохранить</button>`}`,
    mount(el,mm){let src=v.src||'file';
      // Закрытие формы во время загрузки спрашивает «Остановить загрузку?»
      const c0=mm.close;mm.close=()=>{if(U.ph==='up'||U.ph==='check'||U.ph==='paused')return confirmDlg({title:'Остановить загрузку?',text:'Файл ещё не загрузился. Если закрыть форму, загрузка прервётся и файл не сохранится.',ok:'Остановить',danger:true,run:()=>{stopUp();c0()}});if(ytCtl)ytCtl.destroy();c0()};
      $('[data-x]',el).onclick=()=>mm.close();$$('[data-close]',el).forEach(b=>b.onclick=()=>mm.close());
      $$('[data-vsrc]',el).forEach(b=>b.onclick=()=>{src=b.dataset.vsrc;$$('[data-vsrc]',el).forEach(x=>x.classList.toggle('on',x===b));$('[data-f="vf-file"]',el).hidden=src!=='file';$('[data-f="vf-yt"]',el).hidden=src!=='yt';cvDraw()});
      if(o.replace){const f=v.src==='yt'?$('#vf-yt',el):$('#vf-drop',el);setTimeout(()=>f.focus(),60)}
      const fn=()=>{const n=$('#vf-fn',el);n.innerHTML=U.file&&U.ph==='done'?`<b>${esc(U.file.name)}</b><span class="muted">${fmtSize(U.file.size)}${U.dur?' · '+vidT(U.dur):''}</span><span class="linkbtn">Заменить файл</span>`:'<b>Перетащите файл сюда или нажмите, чтобы выбрать</b>'};fn();
      const cvDraw=()=>{const im=U.cover||(src==='file'?U.frame:null)||(src==='yt'&&ytId($('#vf-yt',el).value)?`https://i.ytimg.com/vi/${ytId($('#vf-yt',el).value)}/hqdefault.jpg`:null);$('#vf-cvi',el).innerHTML=im?`<img src="${esc(im)}" alt="">`:`<span class="faint">${U.cover===null&&src==='file'?'кадр с первой секунды':'—'}</span>`;$('#vf-cvx',el).hidden=!U.cover};cvDraw();
      const up=$('#vf-up',el),bar=$('.bar i',up),upt=$('.vf-up-t',up),upx=$('#vf-upx',el);
      const stopUp=()=>{clearInterval(U.tm);U.tm=0;if(U.ph!=='done'){U.ph=U.file&&v.file&&!U.blob?'done':'idle';if(U.blob&&U.ph!=='done'){URL.revokeObjectURL(U.blob);U.blob=null}}up.hidden=true;fn()};
      const bad=msg=>{setErr(el,'vf-file',msg);$('#vf-drop',el).classList.toggle('bad',!!msg)};
      // Загрузка частями по подписанным ссылкам: полоса с процентами и «Отменить»; обрыв связи — «Загрузка прервалась» и «Продолжить»
      const tickUp=()=>{if(navigator.onLine===false){U.ph='paused';clearInterval(U.tm);U.tm=0;upt.innerHTML=`<span class="red">Загрузка прервалась</span> · ${Math.floor(U.pct)} %`;upx.textContent='Продолжить';return}
        U.pct=Math.min(100,U.pct+U.step);bar.style.width=U.pct+'%';upt.textContent=`Загружаем «${U.file.name}» · ${Math.floor(U.pct)} %`;if(U.pct<100)return;clearInterval(U.tm);U.tm=0;U.ph='check';upt.textContent='Проверяем файл…';upx.hidden=true;check()};
      const startUp=()=>{U.ph='up';up.hidden=false;upx.hidden=false;upx.textContent='Отменить';clearInterval(U.tm);U.tm=setInterval(tickUp,120)};
      upx.onclick=()=>{if(U.ph==='paused'){startUp();return}stopUp();toast('Загрузка отменена','x')};
      // Сервер проверяет, что файл действительно видео MP4 или WebM, и узнаёт длительность; кадр с первой секунды — обложка по умолчанию
      const check=()=>{const e=document.createElement('video');e.muted=true;e.preload='auto';let fin=false;const to=setTimeout(()=>no(),9000);
        const no=()=>{if(fin)return;fin=true;clearTimeout(to);U.ph='idle';up.hidden=true;URL.revokeObjectURL(U.blob);U.blob=null;U.file=v.file?{...v.file}:null;if(U.file)U.ph='done';bad('Файл не похож на видео MP4 или WebM');fn()};
        e.onerror=no;e.onloadedmetadata=()=>{if(!(e.duration>0)||!isFinite(e.duration)||!e.videoWidth){no();return}U.dur=Math.round(e.duration);e.currentTime=Math.min(1,e.duration/2)};
        e.onseeked=()=>{if(fin)return;fin=true;clearTimeout(to);try{const k=Math.min(1,640/e.videoWidth),c=document.createElement('canvas');c.width=Math.round(e.videoWidth*k);c.height=Math.round(e.videoHeight*k);c.getContext('2d').drawImage(e,0,0,c.width,c.height);U.frame=c.toDataURL('image/jpeg',.8)}catch(z){U.frame=null}
          U.ph='done';U.changed=true;up.hidden=true;bad('');fn();cvDraw();toast('Файл загружен и проверен: '+vidT(U.dur),'film')};e.src=U.blob};
      const pick=f=>{if(!f)return;bad('');const ok=/^video\/(mp4|webm)$/.test(f.type)||/\.(mp4|webm)$/i.test(f.name);if(!ok||f.size>VID_MAX||!f.size){bad('Загрузите видео MP4 или WebM до 500 МБ');return}
        if(U.blob)URL.revokeObjectURL(U.blob);U.blob=URL.createObjectURL(f);U.file={name:f.name,size:f.size,type:f.type||(/\.webm$/i.test(f.name)?'video/webm':'video/mp4')};U.pct=0;U.step=Math.max(2,Math.min(9,100/(Math.max(1.5,Math.min(6,f.size/52428800))*8.3)));bar.style.width='0%';startUp()};
      $('#vf-file',el).onchange=e=>pick(e.target.files[0]);const dz=$('#vf-drop',el);dz.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#vf-file',el).click()}};
      dz.ondragover=e=>{e.preventDefault();dz.classList.add('over')};dz.ondragleave=()=>dz.classList.remove('over');dz.ondrop=e=>{e.preventDefault();dz.classList.remove('over');pick(e.dataTransfer.files[0])};
      // Ссылка YouTube: проверка вида ссылки и предпросмотр
      const yi=$('#vf-yt',el),yp=$('#vf-ytp',el);const ytDraw=()=>{const id=ytId(yi.value);if(ytCtl){ytCtl.destroy();ytCtl=null}
        yp.innerHTML=id?`<button type="button" class="vf-ytb" id="vf-ytb"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt=""><span class="vcv-p">${ic('pl')}</span><span class="vf-ytc">Предпросмотр · ${esc(id)}</span></button>`:'';const b=$('#vf-ytb',el);if(b)b.onclick=()=>{yp.innerHTML='<div class="vf-ytpl"></div>';ytCtl=vidPlayer($('.vf-ytpl',yp),{id:'yt-prev',t:val(el,'vf-t')||'Предпросмотр',src:'yt',yt:id,dur:0},{track:null,onDur:d=>{U.ytDur=d}})};cvDraw()};
      yi.oninput=()=>{setErr(el,'vf-yt','');ytDraw()};yi.onblur=()=>{if(yi.value.trim()&&!ytId(yi.value))setErr(el,'vf-yt','Вставьте ссылку на видео YouTube, например https://youtu.be/…')};if(ytId(yi.value))ytDraw();
      // Обложка — PNG или JPG до 2 МБ
      $('#vf-cv',el).onchange=e=>{const f=e.target.files[0];if(!f)return;setErr(el,'vf-cv','');if(!/^image\/(png|jpeg)$/.test(f.type)||f.size>2*1024*1024){setErr(el,'vf-cv','Загрузите картинку PNG или JPG до 2 МБ');return}
        const rd=new FileReader();rd.onload=()=>vidShrink(rd.result,960,d=>{if(!d){setErr(el,'vf-cv','Не удалось прочитать картинку');return}U.cover=d;U.cvTouched=true;cvDraw()});rd.readAsDataURL(f)};
      $('#vf-cvx',el).onclick=()=>{U.cover=null;U.cvTouched=true;cvDraw()};
      $('#vf-k',el).onchange=()=>setErr(el,'vf-m','');
      const save=pub=>{const t=val(el,'vf-t').trim(),k=val(el,'vf-k'),md=val(el,'vf-m'),yid=ytId(yi.value);
        const ok=[setErr(el,'vf-t',t?'':'Введите название'),setErr(el,'vf-m',k==='instr'&&!md?'Выберите модуль: видеоинструкция относится к модулю':''),
          src==='yt'?setErr(el,'vf-yt',yid?'':'Вставьте ссылку на видео YouTube, например https://youtu.be/…'):(U.ph==='up'||U.ph==='check'||U.ph==='paused'?(bad('Дождитесь окончания загрузки'),false):U.ph==='done'&&U.file?(bad(''),true):(bad('Загрузите видео MP4 или WebM до 500 МБ'),false))].every(Boolean);if(!ok)return;
        const repl=!isNew&&(src!==v.src||(src==='yt'&&yid!==v.yt)||(src==='file'&&U.changed));
        const nv={t,kind:k,src,mod:md,art:val(el,'vf-a'),ord:+val(el,'vf-o')||0,aud:val(el,'vf-aud'),desc:val(el,'vf-d').trim().slice(0,1000)};
        if(src==='yt'){nv.yt=yid;nv.file=null;nv.frame=null;if(repl||isNew)nv.dur=U.ytDur||0}else{nv.yt='';nv.file=U.file;nv.dur=U.dur||v.dur||0;nv.frame=U.frame||null}
        if(U.cvTouched)nv.cover=U.cover||null;if(pubd){nv.land=$('#vf-land',el).checked;nv.landOrd=Math.max(1,+val(el,'vf-lo')||1)}
        let o2=v;if(isNew){o2=born(Object.assign({id:'vd'+Date.now().toString(36),status:'Черновик',off:false,land:false,landOrd:1,hist:[],del:false},nv));VIDEOS.push(o2);vidLog(o2,src==='yt'?'Добавлена ссылка YouTube':'Загружено')}
        else{Object.assign(v,nv);touch(v);vidLog(v,repl?'Видео заменено':'Изменено');if(repl)v.ytBad=false}
        if(src==='file'&&U.blob){if(VID_BLOB[o2.id]&&VID_BLOB[o2.id]!==U.blob)URL.revokeObjectURL(VID_BLOB[o2.id]);VID_BLOB[o2.id]=U.blob;U.blob=null}
        if(pub&&o2.status==='Черновик'){o2.status='Опубликовано';vidLog(o2,'Опубликовано')}
        U.ph='done';if(ytCtl)ytCtl.destroy();c0();refreshAll();toast(o2.status==='Черновик'?'Черновик видео сохранён: его видит только администратор платформы':repl?'Видео заменено: ссылки и просмотры сохранились':isNew?'Видео опубликовано':'Видео сохранено','film')};
      $('#vf-save',el).onclick=()=>save(false);const p=$('#vf-pub',el);if(p)p.onclick=()=>save(true)}})})}

/* ═════════════ Просмотры видео: сводка администратора платформы ═════════════ */
// По каждому видео: сколько организаций и сотрудников смотрели, сколько получили «Просмотрено», средний процент; гости лендинга — только числа
function vidAdmSum(){const L=VIDEOS.filter(v=>VVIEWS.some(r=>r.v===v.id&&segLen(r.segs)>=1)||VGUEST[v.id]);if(!L.length)return '';
  const rows=L.map(v=>{const rs=VVIEWS.filter(r=>r.v===v.id&&segLen(r.segs)>=1);const orgs=new Set(rs.map(r=>r.org||'self')).size;const dn=rs.filter(r=>r.done).length;const av=rs.length?Math.round(rs.reduce((a,r)=>a+vidPct(v,r),0)/rs.length):0;return {v,n:rs.length,orgs,dn,av}});
  const G=VIDEOS.filter(v=>VGUEST[v.id]&&VGUEST[v.id].n);
  return `<div class="box"><h3>Сводка по видео</h3><div class="tbl-x"><table class="mini"><thead><tr><th>Видео</th><th>Вид</th><th class="num">Организаций</th><th class="num">Сотрудников смотрели</th><th class="num">«Просмотрено»</th><th class="num">Средний процент</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.v.t)}${x.v.del?' <span class="faint">(удалено)</span>':''}</td><td>${VID_K[x.v.kind]}</td><td class="num">${x.orgs}</td><td class="num">${x.n}</td><td class="num">${x.dn}</td><td class="num">${x.av} %</td></tr>`).join('')}</tbody></table></div><span class="hint">Считаются сотрудники, у которых проигралась хотя бы одна секунда. Просмотры администратора платформы не учитываются.</span></div>
    ${G.length?`<div class="box"><h3>Гости лендинга</h3><div class="tbl-x"><table class="mini"><thead><tr><th>Видео</th><th class="num">Запусков</th><th class="num">Средний процент просмотра</th></tr></thead><tbody>${G.map(v=>{const g=VGUEST[v.id];return `<tr><td>${esc(v.t)}</td><td class="num">${g.n}</td><td class="num">${g.n?Math.round(g.p/g.n):0} %</td></tr>`}).join('')}</tbody></table></div><span class="hint">Без имён, адресов и сторонних счётчиков — только сколько раз запустили и средний процент.</span></div>`:''}`}
// Кнопка «Видео» в редакторах новостей и статей: выбор из списка видео платформы
function vidPickMenu(b,run){const l=VIDEOS.filter(v=>!v.del).sort(vidSortF);if(!l.length)return toast('Видео пока нет: добавьте его во вкладке «Видео»','film');
  menu(b,l.map(v=>({label:v.t,icon:'film',sub:`${VID_K[v.kind]} · ${vidModT(v)}${v.dur?' · '+vidT(v.dur):''}${vidLive(v)?'':' · не опубликовано'}`,run:()=>run(v)})))}
