'use strict';
// Регистрационные данные контрагента и создание контрагента «Из свидетельства и выписки» (Бета)
/* ═════════════ Регистрационные данные: поля формы и блок карточки ═════════════ */
/* c.reg = {full, regNo, okpo, addr, email, regDate, reRegDate, founders, foreign:'yes'|'no'|''} */
const REG_F=[['full','rfull','Полное официальное наименование',1],['regNo','rno','Регистрационный номер'],['okpo','okpo','Код ОКПО'],['addr','addr','Юридический адрес',1],['email','mail','Электронная почта'],
  ['regDate','rdate','Дата первичной регистрации'],['reRegDate','rre','Дата последней перерегистрации'],['founders','fnd','Количество учредителей'],['foreign','frn','Иностранное участие']];
const regEmpty=r=>!r||REG_F.every(([k])=>r[k]==null||r[k]==='');
function regFields(p,r){r=r||{};return REG_F.map(([k,id,l,full])=>{const fid=`${p}-${id}`;
  const inner=k==='foreign'?sel(fid,[['','— не указано —'],['no','Нет'],['yes','Есть']],r[k]||''):k==='regDate'||k==='reRegDate'?inp(fid,r[k]||'','type="date"'):
    k==='founders'?inp(fid,r[k]??'','type="number" min="0" class="inp tnum"'):k==='okpo'?inp(fid,r[k]||'','inputmode="numeric" maxlength="8" class="inp mono" placeholder="8 цифр"'):
    k==='regNo'?inp(fid,r[k]||'','class="inp mono" placeholder="Например: 328256-3301-ООО"'):k==='email'?inp(fid,r[k]||'','type="email" placeholder="info@company.kg"'):inp(fid,r[k]||'');
  return fld(l,inner,{full:!!full,id:fid})}).join('')}
function regRead(el,p){const r={};REG_F.forEach(([k,id])=>{const v=val(el,`${p}-${id}`);r[k]=k==='founders'?(v===''?'':Math.max(0,parseInt(v,10)||0)):v});return r}
function regCheck(el,p){const r=regRead(el,p);return [setErr(el,`${p}-okpo`,r.okpo&&!/^\d{8}$/.test(r.okpo)?'Код ОКПО — 8 цифр':''),setErr(el,`${p}-mail`,r.email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)?'Проверьте адрес почты':'')].every(Boolean)}
function regKvBox(c){const r=c.reg||{};const v=(k,x)=>x==null||x===''?'<span class="faint">—</span>':k==='regDate'||k==='reRegDate'?fmtD(x):k==='foreign'?(x==='yes'?'Есть':'Нет'):esc(String(x));
  return `<div class="box"><h3>Регистрационные данные${(c.regFiles||[]).length?` <span class="faint" style="font-weight:500;font-size:12px">из свидетельства и выписки</span>`:''}</h3>${regEmpty(r)?`<span class="faint">Не заполнены. Их можно указать в «Изменить» или при создании «Из свидетельства и выписки».</span>`:
    `<div class="kv">${REG_F.map(([k,,l])=>`<div${k==='full'||k==='addr'?' style="grid-column:1/-1"':''}><span class="k">${l}</span><span class="v ${k==='regNo'||k==='okpo'?'mono':''}">${v(k,r[k])}</span></div>`).join('')}</div>`}</div>`}

/* ═════════════ Окно загрузки документов ═════════════ */
const RD_MAX=10*1048576;
const RD_BETA=`<div class="note beta">${ic('alert')}<span><b>Бета-версия.</b> Распознавание свидетельства и выписки может работать неточно: формы документов меняются. Проверьте все поля перед сохранением.</span></div>`;
const rdBadge='<span class="pill yellow sm beta-p">Бета</span>';
function regDocsDlg(){const st={files:[],err:'',busy:false};
  const isPdf=f=>/\.pdf$/i.test(f.name)||f.type==='application/pdf';
  const addFiles=(list,m)=>{[...list].forEach(f=>{if(st.files.some(x=>x.file.name===f.name&&x.file.size===f.size))return;
    st.files.push({file:f,state:!isPdf(f)||f.size>RD_MAX?'bad':'new',msg:!isPdf(f)||f.size>RD_MAX?'Загрузите PDF до 10 МБ':''})});st.err='';m.draw()};
  const row=(x,i)=>{const k=x.doc&&x.doc.kind;const lbl=x.state==='ok'?`<span class="pill green sm">${ic('check','sm')}${RD_DOC[k]}${x.doc.issued?' от '+fmtD(x.doc.issued):''}</span>`:x.state==='bad'?`<span class="pill red sm">${ic('alert','sm')}Не распознан</span>`:x.state==='busy'?'<span class="pill faint sm">Читается…</span>':'<span class="pill faint sm">Ещё не распознан</span>';
    return `<div class="li" style="cursor:default">${ic('file')}<div class="grow"><div class="t1">${esc(x.file.name)}</div><div class="t2">${fmtSize(x.file.size)}${x.msg?` · <span style="color:var(--red)">${esc(x.msg)}</span>`:''}</div></div>${lbl}<button type="button" class="icon-btn sm" data-rdel="${i}" aria-label="Убрать ${esc(x.file.name)}" title="Убрать файл">${ic('trash','sm')}</button></div>`};
  openModal({form:true,size:'mid',render:m=>({title:`Новый контрагент из свидетельства и выписки ${rdBadge}`,sub:'Загрузите один или оба документа юрлица из Минюста КР — в любом порядке',
    body:`${RD_BETA}
    <label class="drop" id="rd-drop" tabindex="0">${ic('upload')}<span><b>Перетащите PDF сюда</b> или нажмите, чтобы выбрать файл</span><span class="hint">Свидетельство (справка) о государственной регистрации и выписка из Единого государственного реестра юридических лиц · PDF до 10 МБ · вид документа определяется по содержимому</span><input type="file" id="rd-f" accept="application/pdf,.pdf" multiple hidden></label>
    ${st.files.length?`<div class="list" style="margin-top:10px">${st.files.map(row).join('')}</div>`:''}
    ${st.err?`<div class="note bad" style="margin-top:10px">${ic('alert')}<span>${st.err}</span></div>`:''}
    <div class="hint" style="margin-top:10px">Распознаётся текст внутри PDF, скачанного с сайта Минюста. Скан или фото документа в прототипе не читается. Файлы обрабатываются в браузере и никуда не отправляются. ИП и филиалы пока не поддерживаются.</div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="rd-man">Заполнить вручную</button><button class="btn cta" id="rd-go" ${st.busy||!st.files.some(x=>x.state!=='bad')?'disabled':''}>${st.busy?'Распознаётся…':'Распознать'}</button>`,
    mount(el){const dz=$('#rd-drop',el),fi=$('#rd-f',el);fi.onchange=e=>addFiles(e.target.files,m);
      dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over')});dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
      dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('over');addFiles(e.dataTransfer.files,m)});
      dz.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fi.click()}});
      $$('[data-rdel]',el).forEach(b=>b.onclick=e=>{e.preventDefault();st.files.splice(+b.dataset.rdel,1);st.err='';m.draw()});
      $('#rd-man',el).onclick=()=>{const names=st.files.filter(x=>x.state!=='bad'||x.msg!=='Загрузите PDF до 10 МБ').map(x=>x.file.name);m.close();addCpDlg('regular',{manual:true,files:names})};
      $('#rd-go',el).onclick=()=>rdRun(st,m)}})});
}
async function rdRun(st,m){if(st.busy)return;st.busy=true;st.err='';const todo=st.files.filter(x=>x.state!=='bad'||x.msg!=='Загрузите PDF до 10 МБ');todo.forEach(x=>x.state='busy');m.draw();
  for(const x of todo){const r=await pdfRead(x.file);x.doc=null;
    if(r.err==='lib'){x.state='bad';x.msg='Не загрузилась библиотека чтения PDF. Проверьте интернет и попробуйте ещё раз';continue}
    if(r.err){x.state='bad';x.msg=r.err==='password'?'Файл защищён паролем':'Не удалось прочитать документ. Заполните форму вручную';continue}
    const chars=r.pages.reduce((a,p)=>a+p.items.reduce((b,i)=>b+i.str.trim().length,0),0);
    if(chars<40){x.state='bad';x.msg='В PDF нет текста (скан или фото). Не удалось прочитать документ. Заполните форму вручную';continue}
    const d=rdExtract(r);const o=d.kind?rdCpFields(d):{};
    if(!d.kind){x.state='bad';x.msg='Документ не распознан как свидетельство или выписка';continue}
    if(o.ip||o.branch){x.state='bad';x.msg='Документ не распознан: для ИП и филиалов создание по документам пока не поддерживается, заполните форму вручную';continue}
    x.doc=d;x.state='ok';x.msg=''}
  st.busy=false;
  const ok=st.files.filter(x=>x.state==='ok');const kinds=ok.map(x=>x.doc.kind);
  if(kinds.length>1&&kinds[0]===kinds[1]){st.err=`Загружены два документа одного вида (${RD_DOC[kinds[0]].toLowerCase()}): уберите лишний файл.`;m.draw();return}
  if(!ok.length){st.err=st.files.length?'Ни один документ не распознан. Можно заполнить форму вручную — загруженные файлы прикрепятся к контрагенту.':'';m.draw();return}
  const res=rdToCp(ok.map(x=>x.doc));
  if(res.err==='diff'){st.err='Документы относятся к разным организациям: ИНН не совпадает. Уберите лишний файл.';m.draw();return}
  m.draw();
  const inn=res.v.inn;const dup=inn&&CPS.find(c=>c.inn===inn);
  const go=()=>{m.close();addCpDlg('regular',{res,files:st.files.filter(x=>x.state==='ok').map(x=>x.file.name),docs:ok.map(x=>x.doc)})};
  if(dup){openModal({noMax:true,render:d=>({title:'Контрагент с таким ИНН уже есть',body:`<p style="margin:0;color:var(--muted);line-height:1.55">ИНН ${esc(inn)} уже у контрагента «${esc(dup.name)}»${dup.archived?' (в архиве)':''}. Второй раз его создать нельзя.</p>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="rd-open">Открыть</button>`,mount(el){$('#rd-open',el).onclick=()=>{d.close();m.close();openCp(dup)}}})});return}
  go()}

/* ═════════════ Форма добавления, заполненная из документов ═════════════ */
/* Поле формы ↔ реквизит: подпись источника видна, пока значение в поле равно значению из документа */
const RD_MAP={name:'nc-name',inn:'nc-inn',phone:'nc-ph',head:'nc-head',form:'nc-form',ugns:'nc-ugns',full:'nc-rfull',regNo:'nc-rno',okpo:'nc-okpo',addr:'nc-addr',email:'nc-mail',regDate:'nc-rdate',reRegDate:'nc-rre',founders:'nc-fnd',foreign:'nc-frn'};
const RD_TXT={name:'Название',full:'Полное наименование',inn:'ИНН',regNo:'Регистрационный номер',okpo:'Код ОКПО',form:'Форма собственности',phone:'Телефон',email:'Электронная почта',head:'Руководитель',regDate:'Дата первичной регистрации',reRegDate:'Дата перерегистрации',founders:'Количество учредителей',foreign:'Иностранное участие'};
// Начальное состояние формы addCpDlg из итога распознавания
function rdPrefill(st,pre){const v=pre.res.v;st.form=v.form||'';st.gked=pre.res.gk&&pre.res.gk.code||'';st.gked2=(pre.res.gk&&pre.res.gk.more)||[];
  st.d={name:v.name||'',inn:v.inn||'',ph:v.phone||null,head:v.head||'',ugns:pre.res.ugns||'',start:TODAY};
  st.reg={full:v.full||'',regNo:v.regNo||'',okpo:v.okpo||'',addr:v.addr||'',email:v.email||'',regDate:v.regDate||'',reRegDate:v.reRegDate||'',founders:v.founders??'',foreign:v.foreign||''};
  st.rd={v:Object.assign({},v,{ugns:pre.res.ugns||'',gked:st.gked}),src:Object.assign({},pre.res.src,pre.res.ugns?{ugns:'addr'}:{},st.gked?{gked:pre.res.gk.src}:{}),alt:pre.res.alt,startSet:false}}
const rdFmt=(k,x)=>k==='phone'?fmtPhone(x):k==='regDate'||k==='reRegDate'?fmtD(x):k==='foreign'?(x==='yes'?'есть':'нет'):String(x);
// Сводка над формой, расхождения и подсказки ГКЭД
function rdHead(st,pre){const r=pre.res;const docs=pre.docs.map(d=>`${RD_DOC[d.kind]}${d.issued?' от '+fmtD(d.issued):''}`).join(' и ');
  const filled=Object.keys(RD_MAP).filter(k=>st.rd.v[k]!=null&&st.rd.v[k]!=='').length+(st.rd.v.gked?1:0);
  const check=Object.keys(r.alt).length+(r.ugns?1:0)+(r.gk&&!r.gk.code?1:0);
  const miss=['name','inn','phone','form'].filter(k=>!st.rd.v[k]).map(k=>RD_TXT[k]);if(!st.rd.v.gked)miss.push('Основной вид деятельности (ГКЭД)');
  const warn=[...Object.keys(r.alt).map(k=>`документы расходятся: ${RD_TXT[k].toLowerCase()}`),...(r.phoneBad?[`телефон в документе неполный (${r.phoneBad})`]:[])];
  return `${RD_BETA}
  ${r.stopped?`<div class="note bad">${ic('alert')}<span><b>Юрлицо прекращено (ликвидировано) по данным документа${r.status?` — статус «${esc(r.status)}»`:''}.</b> Сохранить можно после подтверждения.</span></div>`:''}
  <div class="note">${ic('file')}<span>Распознано: ${esc(docs)}. Заполнено из документов: <b>${filled}</b>${check?` · требуют проверки: <b>${check}</b>`:''}. ${miss.length?`Не найдено в документах: ${esc(miss.join(', '))}. `:''}Виды отчётов, стоимость обслуживания, ответственного и дату начала заполните вручную.${warn.length?`<br>Предупреждения: ${esc(warn.join('; '))}.`:''}</span></div>`}
function rdGkBox(st,pre){const g=pre.res.gk;if(!g)return '';
  const src=g.raw?`В документе: <b class="mono">${esc(g.raw)}</b>${g.text?' — '+esc(g.text):''}`:g.text?`В документе: ${esc(g.text)}`:'';
  const pick=g.choose.length&&!st.gked?`<div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap"><span class="hint">Код ${esc(g.raw)} — не нижний уровень, выберите подкласс:</span>${g.choose.map(c=>`<button type="button" class="btn xs" data-rdgk="${esc(c)}" title="${esc(gkName(c))}">${esc(c)}</button>`).join('')}</div>`:'';
  const like=!g.code&&!g.choose.length&&g.like.length&&!st.gked?`<div style="margin-top:6px"><span class="hint">Кода нет в документе или справочнике. Похожие виды деятельности — выберите подходящий:</span><div class="list" style="margin-top:4px">${g.like.map(c=>`<button type="button" class="li" data-rdgk="${esc(c)}" style="width:100%;text-align:left"><span class="mono strong">${esc(c)}</span><span class="grow">${esc(gkName(c))}</span></button>`).join('')}</div></div>`:'';
  return `<div class="fld full rd-gk"><div class="hint">${src}${st.gked&&g.code&&st.gked===g.code?' · код найден в справочнике ГКЭД':''}</div>${pick}${like}</div>`}
// Подписи источника, «Заполните вручную» и расхождения — после каждой отрисовки и при вводе
function rdMarks(el,st){const cur={name:()=>val(el,'nc-name'),inn:()=>val(el,'nc-inn'),phone:()=>{const p=readPhone(el,'nc-ph');return p.empty?null:p.ph},head:()=>val(el,'nc-head'),form:()=>st.form,ugns:()=>val(el,'nc-ugns'),gked:()=>st.gked,
    founders:()=>{const v=val(el,'nc-fnd');return v===''?'':+v},...Object.fromEntries(['full','regNo','okpo','addr','email','regDate','reRegDate','foreign'].map(k=>[k,()=>val(el,RD_MAP[k])]))};
  const same=(a,b)=>JSON.stringify(a??'')===JSON.stringify(b??'')||(a&&b&&a.digits&&a.digits===b.digits);
  const put=(fid,cls,html)=>{const f=el.querySelector(`[data-f="${fid}"]`);if(!f)return;let x=f.querySelector('.'+cls);if(!html){if(x)x.remove();f.classList.toggle(cls.replace('-l',''),false);return}
    if(!x){x=document.createElement('div');x.className=cls;const e=f.querySelector('.hint,.err');f.insertBefore(x,e)}x.innerHTML=html;if(cls==='need-l')f.classList.add('need')};
  Object.keys(cur).forEach(k=>{const fid=k==='gked'?'nc-gk':RD_MAP[k];const s=st.rd.src[k];const on=s&&st.rd.v[k]!=null&&st.rd.v[k]!==''&&same(cur[k](),st.rd.v[k]);
    put(fid,'src-l',on?`${ic('file','sm')}${s==='addr'?'Предложено по адресу, проверьте':RD_FROM[s]}`:'')});
  const need={'nc-name':!val(el,'nc-name'),'nc-inn':!val(el,'nc-inn'),'nc-ph':readPhone(el,'nc-ph').empty,'nc-gk':!st.gked,'nc-form':!st.form,'nc-types':$('#nc-types',el)&&!st.sel.size,'nc-resp':!val(el,'nc-resp'),'nc-fee':$('#nc-fee',el)&&!val(el,'nc-fee'),'nc-start':!st.rd.startSet};
  Object.entries(need).forEach(([fid,on])=>put(fid,'need-l',on?`${ic('alert','sm')}Заполните вручную`:''));
  Object.entries(st.rd.alt||{}).forEach(([k,a])=>{const fid=RD_MAP[k];if(!fid)return;
    put(fid,'alt-l',`${ic('alert','sm')}<span>Документы расходятся, по умолчанию взято значение из более позднего документа: ${a.map((x,i)=>`${{svid:'в свидетельстве',vyp:'в выписке'}[x.src]}${x.date?' от '+fmtD(x.date):''} — «${esc(rdFmt(k,x.v))}»${i?` <button type="button" class="linkbtn" data-rdalt="${k}:${i}">взять это</button>`:' (в форме)'}`).join('; ')}</span>`)})}
