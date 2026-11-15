'use strict';
// Регистрация организации по выписке и свидетельству (Доработки 14.11.2026, блок 1; этап 2, поток И)
// Форма «Оставить заявку»: «ОсОО» или «ИП» — первым полем, обязательные документы только в PDF до 20 МБ (ИП — «Свидетельство ГНС»;
// ОсОО — «Выписка» и «Свидетельство Минюста»); при смене формы выбранные файлы сбрасываются. Документы разбираются тем же разбором,
// что «Из свидетельства и выписки» у контрагента (core/regdocs.js), найденное — сразу в полях: название, ИНН, ОКПО, адрес, руководитель;
// заявитель проверяет и правит до отправки, ничего не нашлось (скан без текста) — заполняет сам.
// В Админке: столбцы «Форма», «Документы» и «Telegram» в «Заявках», данные и файлы в заявке, «Одобрить» — организация и владелец из заявки,
// «Отклонить» — с причиной; файлы отклонённой заявки удаляются через 7 дней после отказа, неразобранной — через 30 дней после отправки.
// Telegram заявителя, сообщения бота и «Задать пароль» — поток Т (modules/tg-lead.js): leadTgLink, leadTgOn, leadTgOpen, tgLeadOwnerSetup, tgLeadRefused;
// пока их нет — «Telegram не подключён», а кнопка «Подключить Telegram» только сообщает об этом.
const LEAD_FORMS={osoo:'ОсОО',ip:'ИП'};
const LEAD_DOCS={ip:['gns'],osoo:['vyp','mj']};
const LEAD_DOC_MAX=20*1048576,LEAD_KEEP=30,LEAD_KEEP_REJ=7,LEAD_SRC='Заявка на подключение',LEAD_ADM_HINT='Изменить может администратор платформы';
const leadHasDocs=o=>!!(o&&o.form);
const leadTgIs=o=>typeof leadTgOn==='function'&&!!leadTgOn(o);
const ldDocT=k=>LT('land.f.doc.'+k);
const ldFormT=f=>LEAD_FORMS[f]||'—';

/* ═════════════ Форма на лендинге ═════════════ */
// Состояние формы: выбранная форма, файлы по видам документов, значения, которые подставил разбор (их можно перезаписать новым разбором)
const LD={form:'',files:{},auto:{},busy:0,run:0,found:''};
const LD_REG=[['firm'],['inn','land.f.inn','class="inp mono" inputmode="numeric" maxlength="14" autocomplete="off"'],['okpo','land.f.okpo','class="inp mono" inputmode="numeric" maxlength="8" autocomplete="off"'],['head','land.f.head','maxlength="200" autocomplete="off"'],['addr','land.f.addr','maxlength="300" autocomplete="off"']];
function ldReset(){LD.form='';LD.files={};LD.auto={};LD.busy=0;LD.run++;LD.found=''}
const ldMark=k=>`<span class="pill sm blue lf-mark" data-lf-mark="${k}" hidden>${LE('land.f.fromdocs')}</span>`;
// Верх формы: выбор формы и поля документов; поля данных из документов — после «Названия фирмы»
const ldTopHtml=()=>`${fld(LE('land.f.form'),`<div class="seg lf-form-seg" role="radiogroup" aria-label="${LE('land.f.form')}" id="lf-form">${Object.entries(LEAD_FORMS).map(([k])=>`<button type="button" role="radio" aria-checked="${LD.form===k}" class="${LD.form===k?'on':''}" data-lf-form="${k}">${LE('land.f.form.'+k)}</button>`).join('')}</div>`,{req:true,full:true,id:'lf-form'})}<div class="lf-docs full" id="lf-docs">${ldDocsHtml()}</div>`;
const ldDocsHtml=()=>LD.form?`<div class="lf-docs-in">${LEAD_DOCS[LD.form].map(k=>fld(LE('land.f.doc.'+k),`<input class="inp" type="file" id="lf-doc-${k}" accept="application/pdf,.pdf" data-lf-doc="${k}">`,{req:true,id:'lf-doc-'+k,hint:LE('land.f.doc.hint')})).join('')}</div><div class="note lf-found" id="lf-found" hidden></div>`:'';
const ldRegHtml=()=>LD_REG.slice(1).map(([k,l,a])=>fld(`${LE(l)} ${ldMark(k)}`,inp('lf-'+k,'',a),{req:k==='inn',full:k==='addr',id:'lf-'+k})).join('');
const ldFirmMark=()=>ldMark('firm');
function ldFoundSync(f){const n=$('#lf-found',f);if(!n)return;const t=LD.busy?'reading':LD.found;n.hidden=!t;
  n.className='note lf-found'+(t==='none'||t==='diff'?' warn':'');n.innerHTML=!t?'':`${ic(t==='reading'?'hourglass':t==='found'?'check':'alert')}<span>${LE('land.f.docs.'+t)}</span>`}
function ldMarkSync(f,k){const m=f.querySelector(`[data-lf-mark="${k}"]`),i=$('#lf-'+k,f);if(m&&i)m.hidden=!(LD.auto[k]&&i.value.trim()===LD.auto[k])}
function ldBind(f){
  $('#lf-form',f).onclick=e=>{const b=e.target.closest('[data-lf-form]');if(!b)return;const k=b.dataset.lfForm;if(k===LD.form)return;
    // Смена формы сбрасывает файлы и то, что из них подставлено (поправленное заявителем остаётся)
    LD_REG.forEach(([x])=>{const i=$('#lf-'+x,f);if(i&&LD.auto[x]&&i.value.trim()===LD.auto[x])i.value=''});
    LD.form=k;LD.files={};LD.auto={};LD.found='';LD.run++;LD.busy=0;LD_REG.forEach(([x])=>ldMarkSync(f,x));$$('[data-lf-form]',f).forEach(x=>{const on=x.dataset.lfForm===k;x.classList.toggle('on',on);x.setAttribute('aria-checked',on)});setErr(f,'lf-form','');
    $('#lf-docs',f).innerHTML=ldDocsHtml();ldDocsBind(f)};
  LD_REG.forEach(([k])=>{const i=$('#lf-'+k,f);if(i)i.addEventListener('input',()=>{setErr(f,'lf-'+k,'');ldMarkSync(f,k)})})}
function ldDocsBind(f){$$('[data-lf-doc]',f).forEach(i=>i.onchange=async()=>{const k=i.dataset.lfDoc,x=i.files[0];delete LD.files[k];setErr(f,'lf-doc-'+k,'');
  if(x){const e=await ldDocErr(x);if(e){setErr(f,'lf-doc-'+k,LT(e));i.value=''}else LD.files[k]=x}
  ldParse(f)})}
// Только PDF, до 20 МБ; PDF — по содержимому (начало файла «%PDF-»), а не по расширению
async function ldDocErr(x){if(!/\.pdf$/i.test(x.name)&&x.type!=='application/pdf')return 'land.e.pdf';if(x.size>LEAD_DOC_MAX)return 'land.e.big';
  try{const h=new Uint8Array(await x.slice(0,5).arrayBuffer());if(String.fromCharCode(...h)!=='%PDF-')return 'land.e.pdf'}catch(e){return 'land.e.pdf'}return ''}
// Разбор всех выбранных документов формы; более поздний разбор отменяет прежний (смена формы или файла)
async function ldParse(f){const run=++LD.run,ks=Object.keys(LD.files);if(!ks.length){LD.busy=0;LD.found='';ldFoundSync(f);return}
  LD.busy=1;ldFoundSync(f);const docs=[];
  for(const k of ks){const r=await pdfRead(LD.files[k]);if(run!==LD.run)return;if(r.err||!r.pages)continue;
    const chars=r.pages.reduce((a,p)=>a+p.items.reduce((b,i)=>b+i.str.trim().length,0),0);if(chars<40)continue;const d=rdExtract(r);if(d.kind)docs.push(d)}
  LD.busy=0;const res=docs.length?rdToCp(docs):{err:'none'};const v=res.err?{}:res.v;
  const got={firm:v.name||'',inn:v.inn||'',okpo:v.okpo||'',head:v.head||'',addr:v.addr||''};let any=false;
  LD_REG.forEach(([k])=>{const i=$('#lf-'+k,f);if(!i||!got[k])return;any=true;const cur=i.value.trim();if(!cur||cur===LD.auto[k]){i.value=got[k];LD.auto[k]=got[k];setErr(f,'lf-'+k,'')}ldMarkSync(f,k)});
  LD.found=res.err==='diff'?'diff':any?'found':'none';ldFoundSync(f)}
// Проверка при отправке: форма, каждый документ формы, ИНН — 14 цифр, ОКПО — 8 цифр, если указан
function ldCheck(f){const v={form:LD.form,inn:val(f,'lf-inn').replace(/\s+/g,''),okpo:val(f,'lf-okpo').replace(/\s+/g,''),head:val(f,'lf-head'),addr:val(f,'lf-addr')};
  const ok=[setErr(f,'lf-form',LD.form?'':LT('land.e.form'))];
  if(LD.form)LEAD_DOCS[LD.form].forEach(k=>ok.push(LD.files[k]||f.querySelector(`[data-f="lf-doc-${k}"].bad`)?true:setErr(f,'lf-doc-'+k,LT('land.e.doc.'+k))));
  ok.push(!!LD.form&&LEAD_DOCS[LD.form].every(k=>LD.files[k]));
  ok.push(setErr(f,'lf-inn',/^\d{14}$/.test(v.inn)?'':LT('land.e.inn')),setErr(f,'lf-okpo',!v.okpo||/^\d{8}$/.test(v.okpo)?'':LT('land.e.okpo')));
  v.docs=LD.form?LEAD_DOCS[LD.form].filter(k=>LD.files[k]).map(k=>({kind:k,name:LD.files[k].name,size:LD.files[k].size})):[];
  return {ok:ok.every(Boolean),v}}
// Экран после отправки: вместо «Спасибо!» — «Заявка отправлена. Подключите Telegram…» и кнопка «Подключить Telegram» (ссылка на бота на 24 часа — поток Т)
function ldOkHtml(o){const lk=typeof leadTgLink==='function'?leadTgLink(o):undefined,on=leadTgIs(o);
  return `<div class="lp-ok lp-ok-tg" role="status"><svg class="lp-stamp" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="29"/><circle class="i" cx="32" cy="32" r="23"/><path class="k" d="M21 33l7 7 15-16"/></svg><div class="lp-ok-b"><span>${LE(on?'land.ok.tgon':'land.ok.docs')}</span>${on?'':`<button type="button" class="btn cta lp-lg" data-lp-tg="${esc(o.id)}">${ic('tg','sm')}${LE('land.btn.tg')}</button>${lk&&lk.till?`<span class="hint">${LE('land.ok.till',{до:ldTill2(lk.till)})}</span>`:''}`}</div></div>`}
// Срок ссылки на бота: момент в мс (поток Т) → «15.11.2026 09:20» по Бишкеку
const ldTill2=ms=>{const d=new Date(+ms+6*36e5).toISOString();return `${fmtD(d.slice(0,10))} ${d.slice(11,16)}`};
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-lp-tg]');if(!b)return;e.preventDefault();const o=LEADS.find(x=>x.id===b.dataset.lpTg);if(!o)return;
  // Уже подключил (в окне переписки нажал «Старт») — экран обновляется вместо нового окна
  const box=$('#lp-fbox');if(leadTgIs(o)){if(box&&LAND.sentLead===o.id)box.innerHTML=ldOkHtml(o);return}
  if(typeof leadTgOpen==='function')return leadTgOpen(o);
  toast('Прототип: подключение Telegram заявителя появится с версией потока Т','tg')});

/* ═════════════ Заявка: документы, срок хранения ═════════════ */
// Когда удалятся файлы: отклонённой — через 7 дней после отказа, остальных неодобренных — через 30 дней после отправки; одобренной — переданы организации
const ldTill=o=>!leadHasDocs(o)||o.docsTo||o.docsGone?null:o.status==='Отказ'&&o.refusedAt?addDays(String(o.refusedAt).slice(0,10),LEAD_KEEP_REJ):addDays(String(o.at).slice(0,10),LEAD_KEEP);
function ldPurge(){LEADS.forEach(o=>{const t=ldTill(o);if(!t||t>TODAY||!(o.docs||[]).length)return;o.docsN=o.docs.length;o.docs=[];o.docsGone=TODAY;
  leadLog(o,o.status==='Отказ'?`Файлы заявки удалены: прошло ${LEAD_KEEP_REJ} дней после отказа`:`Файлы заявки удалены: прошло ${LEAD_KEEP} дней после отправки`,'system')})}
const ldDocsN=o=>!leadHasDocs(o)?'':o.docsGone?'удалены':String((o.docs||[]).length);
const ldTgPill=(o,full)=>leadTgIs(o)?`<span class="pill green sm">${ic('tg','sm')}подключён${full&&o.tgName?' · '+esc(o.tgName):''}</span>`:`<span class="pill yellow sm">${ic('tg','sm')}не подключён</span>`;
// Блок заявки с документами: данные из документов (их проверил заявитель) и файлы — видит только администратор платформы
function ldCardBox(o){if(!leadHasDocs(o))return '';const t=ldTill(o),kv=(k,v)=>`<div><span class="k">${k}</span><span class="v">${v||'<span class="faint">—</span>'}</span></div>`;
  const files=(o.docs||[]).map((d,i)=>`<div class="li" data-ld-doc="${i}">${ic('file')}<div class="grow"><div class="t1">${esc(d.name)}</div><div class="t2">${esc(ldDocT(d.kind))} · ${fmtSize(d.size)}</div></div><button type="button" class="btn sm" data-ld-view="${i}">${ic('eye','sm')}<span class="bl">Открыть</span></button></div>`).join('');
  const org=o.docsTo&&ORGS.find(x=>x.id===o.docsTo);
  return `<div class="box"><h3>Данные из документов</h3><div class="kv">${kv('Форма',esc(ldFormT(o.form)))}${kv('Название',esc(o.firm))}${kv('ИНН',o.inn?`<span class="mono">${esc(o.inn)}</span>`:'')}${kv('ОКПО',o.okpo?`<span class="mono">${esc(o.okpo)}</span>`:'')}${kv('Юридический адрес',esc(o.addr||''))}${kv('Руководитель',esc(o.head||''))}${kv('Telegram заявителя',ldTgPill(o,true))}</div>
    <h4 style="margin:12px 0 4px">Документы</h4>${files?`<div class="list">${files}</div>`:''}
    <div class="hint">${o.docsGone?`Файлы заявки удалены ${fmtD(o.docsGone)}: срок хранения истёк.`:org?`Файлы переданы в «Файловый менеджер» организации «${esc(org.name)}» с источником «${LEAD_SRC}».`:t?`Файлы видит только администратор платформы. Удалятся ${fmtD(t)}${o.status==='Отказ'?` — через ${LEAD_KEEP_REJ} дней после отказа`:`, если заявку не одобрить`}.`:''}</div></div>`}
function ldCardMount(el,o){$$('[data-ld-view]',el).forEach(b=>b.onclick=e=>{e.stopPropagation();const d=(o.docs||[])[+b.dataset.ldView];if(d)toast(`Прототип: «${d.name}» — в макете файлы заявки не хранятся, в продукте открывается просмотр PDF`,'eye')})}

/* ═════════════ «Одобрить»: организация и владелец из заявки ═════════════ */
// Неактивна с причиной: нет Telegram заявителя, файлы удалены, уже есть организация с этим ИНН
function ldApproveWhy(o){if(o.org)return 'По заявке уже создана организация';if(o.status==='Отказ')return 'Заявка отклонена: сначала снимите «Отказ»';
  if(!leadTgIs(o))return 'Заявитель ещё не подключил Telegram';if(o.docsGone)return 'Файлы заявки удалены: срок хранения истёк';
  const x=ORGS.find(y=>(y.self?ORG.inn:y.inn)===o.inn);if(x)return `Организация с ИНН ${o.inn} уже есть на платформе: «${x.self?ORG.name:x.name}»`;return ''}
const ldLoginOf=o=>{const b=(slugOf(o.name||o.firm||'owner')||'owner').replace(/-+/g,'.').replace(/^\.+|\.+$/g,'').slice(0,24)||'owner';let l=b,n=1;while(allUsers().some(u=>u.login===l))l=`${b}${++n}`;return l};
function ldApproveDlg(o){const w=ldApproveWhy(o);if(w)return toast(w,'lock',true);const kv=(k,v)=>`<div><span class="k">${k}</span><span class="v">${v||'<span class="faint">—</span>'}</span></div>`;
  openModal({form:true,size:'mid',render:()=>({title:'Одобрить заявку',sub:esc(`${o.firm} · ${o.name}`),
    body:`<div class="note">${ic('building')}<span>Будут созданы организация и учётная запись владельца из данных заявки. Telegram владельца уже привязан: бот пришлёт ему «Организация создана» и ссылку, по которой он задаст пароль; ссылка действует 7 дней.</span></div>
      <div class="box"><div class="kv">${kv('Форма',esc(ldFormT(o.form)))}${kv('Название',esc(o.firm))}${kv('ИНН',`<span class="mono">${esc(o.inn)}</span>`)}${kv('ОКПО',o.okpo?`<span class="mono">${esc(o.okpo)}</span>`:'')}${kv('Юридический адрес',esc(o.addr||''))}${kv('Руководитель',esc(o.head||''))}${kv('Владелец',esc(o.name))}${kv('Телефон',esc(fmtPhone(o.phone)))}</div></div>
      <div class="form">${fld('Логин владельца',inp('la-login',ldLoginOf(o),'class="inp mono" autocapitalize="off" spellcheck="false"'),{req:true,id:'la-login',hint:'Уникален на всей платформе. Владелец поправит название, адрес и руководителя в «Моя организация»; ИНН и форму меняет только администратор платформы'})}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="la-ok">Одобрить</button>',
    mount(el,m){$('#la-ok',el).onclick=()=>{const w2=ldApproveWhy(o);if(w2){m.close();return toast(w2,'lock',true)}const lg=val(el,'la-login').toLowerCase();
      if(!setErr(el,'la-login',!/^[a-z0-9._-]{3,}$/.test(lg)?'Латиница, цифры, точка, дефис; от 3 символов':allUsers().some(u=>u.login===lg)?'Такой логин уже занят на платформе':''))return;
      const id='o'+(ORGS.length+1),at=nowStamp();
      ORGS.push(orgBind({_cb:S.me,_ca:at,_ub:S.me,_ua:at,id,name:o.firm,inn:o.inn,form:o.form,slug:slugFree(slugOf(o.firm),ORGS.map(x=>x.self?ORG.slug:x.slug).filter(Boolean)),owner:lg,created:TODAY,active:true,contractors:0,employees:1,
        req:{full:'',addr:o.addr||'',head:o.head||'',okpo:o.okpo||'',phone:null},leadFiles:(o.docs||[]).map(d=>Object.assign({at,src:'lead'},d))}));
      // Временного пароля нет: пароль владелец задаёт по ссылке из Telegram (Telegram и отметка «Пароль не задан» — tgLeadOwnerSetup потока Т)
      OTHER_USERS.push({_cb:S.me,_ca:at,_ub:S.me,_ua:at,login:lg,fio:o.name,org:id,role:'Владелец организации',lastIn:'ещё не входил',active:true,phone:o.phone||null});
      o.org=id;o.docsTo=id;log('porg',id,`Организация создана по заявке с сайта: владелец ${lg}, файлы заявки — в «Файловом менеджере» (${LEAD_SRC})`);
      if(o.status==='Подключена')leadLog(o,`Одобрена: создана организация «${o.firm}»`);else leadSet(o,'Подключена',`, одобрена: создана организация «${o.firm}»`);
      if(typeof tgLeadOwnerSetup==='function')tgLeadOwnerSetup(o,id,lg);
      m.close();refreshAll();toast('Организация и владелец созданы, владельцу ушла ссылка для пароля','building')}}})})}

/* ═════════════ ИНН и форма организации — только администратор платформы ═════════════ */
function ldInnFormDlg(o,after){const self=!!o.self,inn0=self?ORG.inn:o.inn,f0=(self?ORG.form:o.form)||'';
  openModal({form:true,render:()=>({title:'ИНН и форма организации',sub:esc(self?ORG.name:o.name),
    body:`<div class="form">${fld('Форма',sel('lif-form',[['','— не указана —'],...Object.entries(LEAD_FORMS)],f0),{req:true,id:'lif-form'})}${fld('ИНН',inp('lif-inn',inn0,'class="inp mono" maxlength="14" inputmode="numeric"'),{req:true,id:'lif-inn'})}</div><div class="hint">Владелец организации эти поля не меняет. Изменение пишется в историю организации.</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="lif-ok">Сохранить</button>',
    mount(el,m){$('#lif-ok',el).onclick=()=>{const inn=val(el,'lif-inn'),fm=val(el,'lif-form');
      const ok=[setErr(el,'lif-form',fm?'':'Выберите форму'),setErr(el,'lif-inn',!/^\d{14}$/.test(inn)?'ИНН — 14 цифр':ORGS.some(x=>x!==o&&(x.self?ORG.inn:x.inn)===inn)?'Организация с таким ИНН уже есть':'')].every(Boolean);if(!ok)return;
      const ch=[];if(inn!==inn0)ch.push(`ИНН: ${inn0} → ${inn}`);if(fm!==f0)ch.push(`Форма: ${ldFormT(f0)} → ${ldFormT(fm)}`);if(!ch.length){m.close();return toast('Изменений нет')}
      o.inn=inn;o.form=fm;touch(o);if(self){ORG.inn=inn;ORG.form=fm;log('org','main',ch.join('; ')+' (администратор платформы)')}log('porg',o.id,ch.join('; '));
      m.close();refreshAll();if(after)after();toast('Сохранено')}}})})}
