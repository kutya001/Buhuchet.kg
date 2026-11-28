'use strict';
// Запросы пользователей администратору платформы (доработки 28.11.2026): вопрос, ошибка, опечатка, добавить в справочник —
// с номером, перепиской, статусами и уведомлениями. Данные — DB.dictRequests (REQUESTS, dicts.js); прежние запросы «Попросить добавить»
// переводятся в новый вид при загрузке (reqNormAll из derive). В продукте снимки экрана хранятся на стороне платформы; в прототипе картинка
// живёт до перезагрузки страницы, в TemDB попадают только имя и размер.
/* ═════════════ Запросы администратору ═════════════ */
const REQ_KINDS={q:'Вопрос',bug:'Ошибка',typo:'Опечатка',dict:'Добавить в справочник'};
const REQ_KIC={q:'help',bug:'alert',typo:'edit',dict:'plus'};
const REQ_CLOSED=new Set(['Решён','Добавлено','Отклонён','Отозван']);
const REQ_ST={Новый:['yellow','circle'],'В работе':['blue','clock'],Решён:['green','check'],Добавлено:['green','check'],Отклонён:['faint','ban'],Отозван:['faint','x'],
  'Ждёт вашего ответа':['orange','msg'],'Ждёт ответа автора':['orange','msg']};
const REQ_HOUR=20,REQ_MSG_HOUR=60,REQ_MAX=4000,REQ_SHOTS=3,REQ_SHOT_MB=5,REQ_REOPEN=30;
const REQ_IMG={};const REQ={sel:''};
// Формы «Добавить в справочник» (блок 3): поле — [ключ, подпись, вид, обязательно, подсказка или варианты]
const RQF_ACT=['','Сдача','Уплата','Сдача + уплата'],RQF_PER=['','Ежемесячно','Ежеквартально','Раз в полгода','Ежегодно','Разово'];
const RQF={
  type:{t:'Вид отчёта',dict:'Виды отчётов',f:[['name','Название','text',1,'Например: Отчёт по НДС на импорт услуг'],['organ','Орган','organ'],['code','Код формы','text'],['act','Что сделать','sel',0,RQF_ACT],['per','Как часто','sel',0,RQF_PER],['due','Срок словами','text',0,'Например: до 20-го числа следующего месяца'],['who','Кому нужен','text',0,'Режим, форма собственности или «всем»'],['law','Ссылка на закон или образец','text']]},
  tax:{t:'Налог или ставка',dict:'Налоги и ставки',f:[['name','Налог','text',1,'Например: Налог на продажи'],['rate','Ставка','text'],['who','Кому','text'],['from','С какой даты','date'],['law','Статья закона','text']]},
  ben:{t:'Льгота или особый статус',dict:'Налоговые льготы и особые статусы',f:[['name','Название','text',1],['what','Что меняет','area'],['law','Основание в законе','text']]},
  base:{t:'Основание для отчёта',dict:'Основания для отчётов',f:[['name','Название','text',1],['reps','Какие отчёты нужны','area']]},
  gked:{t:'Вид деятельности (ГКЭД)',dict:'ГКЭД',f:[['code','Код','text',1,'Например: 62.01.0'],['name','Название','text']]},
  ugns:{t:'Налоговый орган (УГНС)',dict:'Налоговые органы (УГНС)',f:[['name','Название','text',1],['code','Код','text'],['area','Район или город','text']]},
  organ:{t:'Орган',dict:'Органы',f:[['name','Название','text',1],['code','Код','text'],['area','Район или город','text']]},
  bank:{t:'Банк или БИК',dict:'Банковские провайдеры',f:[['name','Название','text',1],['bik','БИК','text'],['type','Вид','sel',0,['Банк','Электронный кошелёк']]]},
  cat:{t:'Категория задач',dict:'Категории задач',f:[['name','Название','text',1]]},
  reason:{t:'Причина изменения срока',dict:'Причины изменения срока',f:[['name','Название','text',1]]},
  dm:{t:'Шаблон «Витрины данных»',dict:'Витрина данных',f:[['name','Какого отчёта не хватает','text',1,'Например: Отчёты, сданные с опозданием, по месяцам'],['cols','Какие столбцы и параметры нужны','area']]},
  other:{t:'Другое',dict:'',f:[['dict','Справочник','dictsel',1],['name','Что добавить','text',1]]}};
// Справочник по названию (из окна справочника, прежних запросов) → форма
const reqFidOf=t=>{t=String(t||'');return /УГНС|Налоговые органы/.test(t)?'ugns':/Льгот|особ.. статус/i.test(t)?'ben':/Виды отчётов|Вид отчёта/i.test(t)?'type':/Основани/.test(t)?'base':/ГКЭД/.test(t)?'gked':/^Органы|^Орган$/.test(t)?'organ':/Банк|БИК/i.test(t)?'bank':/Категори/.test(t)?'cat':/Причин/.test(t)?'reason':/Витрин/.test(t)?'dm':/Налог|ставк/i.test(t)?'tax':'other'};
// Прежние запросы «Попросить добавить» (до 28.11.2026) → новый вид: номер, «Отклонено» → «Отклонён», ответ — первое сообщение администратора
function reqNorm(r){if(r.no!=null)return;const no=REQUESTS.reduce((m,x)=>Math.max(m,x.no||0),1200)+1;const at=r._ca||((r.at||TODAY)+' 09:00');
  Object.assign(r,{no,id:'rq'+no,kind:'dict',topic:r.what||'',fid:reqFidOf(r.dict),form:{name:r.what||'',note:r.note||''},status:r.status==='Отклонено'?'Отклонён':r.status||'Новый',wait:false,lead:null,where:null,shots:[],msgs:[],readA:0,readAdm:0});
  if(r.fid==='other')r.form.dict=r.dict||'';if(!r.at)r.at=at.slice(0,10);
  if(r.answer){r.msgs.push({n:1,at:r._ua||at,who:'admin',k:'msg',text:r.answer});if(r.status!=='Новый')r.msgs.push({n:2,at:r._ua||at,who:'admin',k:'st',from:'Новый',to:r.status,why:''});r.lead='admin'}
  if(REQ_CLOSED.has(r.status))r.closedAt=(r._ua||at).slice(0,10);r.readA=r.msgs.length;r.readAdm=r.msgs.length;delete r.what;delete r.note;delete r.answer}
function reqNormAll(){if(typeof REQUESTS!=='undefined')REQUESTS.forEach(reqNorm)}
const reqById=id=>REQUESTS.find(r=>r.id===id);
const reqWho=id=>id==='admin'?'Администратор платформы':empName(id)||((typeof OTHER_USERS!=='undefined'?OTHER_USERS:[]).find(u=>u.login===id)||{}).fio||whoName(id)||id;
const reqBy=r=>reqWho(r._cb);
const reqOpen=r=>!REQ_CLOSED.has(r.status);
// Кто видит запрос в организации (блок 4, п. 4): «Добавить в справочник» — все, кто видит «Справочники»; остальное — автор и владелец
const reqSees=r=>isAdmin()||(r.oid===ORG.id&&(r.kind==='dict'||r._cb===S.me||me().role==='owner'));
const reqMine=()=>REQUESTS.filter(r=>r.oid===ORG.id&&reqSees(r));
const reqLast=r=>r.msgs.filter(x=>isAdmin()||x.k!=='note').slice(-1)[0]||null;
const reqLastAt=r=>{const x=reqLast(r);return x?x.at:r._ca||r.at};
// Непрочитанный ответ: у автора — сообщение или решение администратора после последнего открытия; у администратора — сообщение автора
function reqUnread(r){if(isAdmin())return r.msgs.slice(r.readAdm||0).some(x=>x.who!=='admin');
  return r._cb===S.me&&r.msgs.slice(r.readA||0).some(x=>x.who==='admin'&&x.k!=='note'&&!(x.k==='st'&&x.to==='В работе'))}
const reqBadge=()=>isAdmin()?REQUESTS.filter(r=>r.status==='Новый'||reqUnread(r)).length:reqMine().filter(reqUnread).length;
// «Ждёт вашего ответа» — только автору; администратору и владельцу — «Ждёт ответа автора»
const reqWaitText=r=>!isAdmin()&&r._cb===S.me?'Ждёт вашего ответа':'Ждёт ответа автора';
const reqStText=r=>r.status==='В работе'&&r.wait?reqWaitText(r):r.status;
const reqPill=r=>pill(reqStText(r),REQ_ST);
const reqClip=(s,n=80)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s};

/* «Где» (блок 2, п. 2): модуль, вкладка, открытое окно, адрес экрана, версия, браузер, размер экрана, время — без значений полей */
function reqWhere(){const m=curMod(),t=modTabs(m).find(x=>x.id===S.tab),top=MODALS.length?MODALS[MODALS.length-1]:null,h2=top&&top.el.querySelector('.mh h2');
  const ua=navigator.userAgent,v=(re,n)=>{const x=re.exec(ua);return x?n+' '+x[1]:''};
  const br=v(/Edg\/(\d+)/,'Edge')||v(/OPR\/(\d+)/,'Opera')||v(/YaBrowser\/(\d+)/,'Яндекс Браузер')||v(/Firefox\/(\d+)/,'Firefox')||v(/Chrome\/(\d+)/,'Chrome')||v(/Version\/(\d+).*Safari/,'Safari')||'Браузер';
  return {path:[m.title,t&&t.label!==m.title?t.label:'',h2&&h2.textContent.trim()?`окно «${h2.textContent.trim()}»`:''].filter(Boolean).join(' → '),hash:location.hash||'#',ver:typeof PROTO_VER!=='undefined'?PROTO_VER:'',br,scr:innerWidth+'×'+innerHeight,at:nowStamp()}}

/* Снимки экрана: до 3 PNG или JPG по 5 МБ, кнопкой или из буфера обмена (Ctrl+V) */
function reqShotsHtml(list,id){return `<div class="fld full" data-f="${id}"><span class="lbl">Снимки экрана</span><div class="rq-shots">${list.map((f,i)=>`<span class="rq-shot">${f.url?`<img src="${f.url}" alt="${esc(f.name)}">`:ic('image')}<span class="rq-shot-n">${esc(f.name)}</span><button type="button" class="icon-btn sm" data-shx="${i}" aria-label="Убрать снимок ${esc(f.name)}" title="Убрать">${ic('x','sm')}</button></span>`).join('')}
  ${list.length<REQ_SHOTS?`<label class="btn sm rq-shot-add">${ic('image','sm')}Добавить снимок<input type="file" accept="image/png,image/jpeg" multiple hidden data-shin></label>`:''}</div><div class="hint">До ${REQ_SHOTS} картинок PNG или JPG, каждая до ${REQ_SHOT_MB} МБ. ${isMobile()?'':'Снимок можно вставить из буфера обмена: Ctrl+V'}</div><div class="err" hidden></div></div>`}
function reqShotsBind(el,list,id,redraw){const add=files=>{let bad='';[...files].forEach(f=>{if(!/^image\/(png|jpeg)$/.test(f.type))bad='Только картинки PNG или JPG';else if(f.size>REQ_SHOT_MB*1048576)bad=`Картинка «${f.name}» больше ${REQ_SHOT_MB} МБ`;else if(list.length>=REQ_SHOTS)bad=`Не больше ${REQ_SHOTS} снимков`;else list.push({name:f.name||'снимок.png',size:f.size,type:f.type,url:URL.createObjectURL(f)})});redraw();if(bad)setTimeout(()=>setErr(document,id,bad))};
  const inp=$('[data-shin]',el);if(inp)inp.onchange=()=>add(inp.files);$$('[data-shx]',el).forEach(b=>b.onclick=()=>{list.splice(+b.dataset.shx,1);redraw()});
  el.onpaste=e=>{const fs=[...((e.clipboardData||{}).files||[])].filter(f=>/^image\//.test(f.type));if(!fs.length)return;e.preventDefault();fs.forEach((f,i)=>{if(!f.name||f.name==='image.png')Object.defineProperty(f,'name',{value:`снимок-${list.length+i+1}.png`})});add(fs)}}
function reqShotsSave(list,key){return list.map((f,i)=>{const k=key+':'+i;if(f.url)REQ_IMG[k]=f.url;return {name:f.name,size:f.size,key:k}})}
const reqShotsView=l=>l&&l.length?`<div class="rq-shots">${l.map(s=>REQ_IMG[s.key]?`<a class="rq-shot" href="${REQ_IMG[s.key]}" target="_blank" rel="noopener"><img src="${REQ_IMG[s.key]}" alt="${esc(s.name)}"><span class="rq-shot-n">${esc(s.name)}</span></a>`:`<span class="rq-shot" title="В прототипе картинка хранится до перезагрузки страницы">${ic('image')}<span class="rq-shot-n">${esc(s.name)}</span></span>`).join('')}</div>`:'';

/* Пределы (блок 1, п. 4): 20 запросов и 60 сообщений в час на организацию */
const reqInHour=(at)=>{const now=Date.parse(nowStamp().replace(' ','T'));return at&&now-Date.parse(at.replace(' ','T'))<3600*1000};
const reqHour=()=>REQUESTS.filter(r=>r.oid===ORG.id&&reqInHour(r._ca)).length;
const reqMsgHour=()=>REQUESTS.filter(r=>r.oid===ORG.id).reduce((n,r)=>n+r.msgs.filter(x=>x.who!=='admin'&&x.k!=='st'&&reqInHour(x.at)).length,0);
const reqDemoNo=()=>{if(DEMO.on){toast('В демо-версии запросы не отправляются','lock',true);return true}return false};

/* Похожее в справочнике (блок 3, п. 4) */
function reqSimilar(fid,v){const q=norm(String(v||'')).trim();if(q.length<3)return null;const nm=x=>x&&(x.name||x.short||x.title||x.code)||'';
  const src={type:()=>RT.flatMap(t=>[t.name,t.short]),tax:()=>TAXES.map(nm),ben:()=>DICT.benefits.items.map(nm),base:()=>DICT.bases.items.map(nm),gked:()=>GK.flatMap(x=>[x.code,x.name]),ugns:()=>DICT.ugns.items.map(nm),organ:()=>DICT.organs.items.map(nm),
    bank:()=>[...DICT.banks.items.map(nm),...(DICT.bik?DICT.bik.items.flatMap(x=>[x.name,x.bik]):[])],cat:()=>DICT.cats.items.map(nm),reason:()=>DICT.reasons.items.map(nm),dm:()=>(typeof DM_TPL!=='undefined'?DM_TPL:[]).map(nm)}[fid];
  if(!src)return null;return src().filter(Boolean).find(x=>{const n=norm(String(x)).trim();return n===q||(q.length>=4&&(n.includes(q)||q.includes(n)&&n.length>=4))})||null}

/* Формы отправки (блок 2) */
function reqDictPick(){if(reqDemoNo())return;openModal({render:m=>({title:'Попросить добавить в справочник',sub:'Выберите справочник: форма покажет, что нужно указать',body:`<div class="rq-pick">${Object.entries(RQF).map(([k,f])=>`<button type="button" class="rq-pk" data-fid="${k}">${ic(k==='other'?'more':'plus','sm')}<span class="grow"><b>${esc(f.t)}</b>${f.dict?`<span class="hint">${esc(f.dict)}</span>`:'<span class="hint">Справочник, которого нет в списке</span>'}</span>${ic('right','sm')}</button>`).join('')}</div>`,
  foot:'<button class="btn ghost" data-close>Отмена</button>',mount(el){$$('[data-fid]',el).forEach(b=>b.onclick=()=>{m.close();reqForm('dict',{fid:b.dataset.fid})})}})})}
function reqForm(kind,pre={}){if(isAdmin())return;if(reqDemoNo())return;const where=pre.where||reqWhere();
  const st={where,useWhere:kind!=='dict',shots:[],fid:pre.fid||'other',v:Object.assign({},pre.v||{})};if(kind==='typo'&&pre.typo)st.v.was=pre.typo;if(kind==='bug'&&pre.what)st.v.what=pre.what;if(st.fid==='other'&&pre.dict)st.v.dict=pre.dict;
  const T={q:'Задать вопрос',bug:'Сообщить об ошибке',typo:'Опечатка',dict:'Попросить добавить'};
  const dictOpts=()=>[['','— выберите справочник —'],...['Виды отчётов','Налоги и ставки',...Object.values(DICT).map(d=>d.title),'ГКЭД','Коды стран телефонов','Производственный календарь','Статусы','Другое',...(st.v.dict?[st.v.dict]:[])].filter((x,i,a)=>a.indexOf(x)===i).map(x=>[x,x])];
  const fldOf=([k,l,t,req,o])=>{const id='rqf-'+k,v=st.v[k]||'';const ph=typeof o==='string'?`placeholder="${esc(o)}"`:'';
    const inner=t==='area'?`<textarea class="inp" id="${id}" style="min-height:64px" maxlength="${REQ_MAX}" ${ph}>${esc(v)}</textarea>`:t==='sel'?sel(id,o.map(x=>[x,x||'—']),v):t==='organ'?sel(id,[['','—'],...DICT.organs.items.filter(x=>x.active!==false).map(x=>[x.name,x.name])],v):t==='dictsel'?sel(id,dictOpts(),v):t==='date'?inp(id,v,'type="date"'):inp(id,v,`maxlength="300" ${ph}`);
    return fld(l,inner,{req:!!req,id,full:t==='area'||k==='name'&&st.fid!=='gked'})};
  openModal({form:true,size:kind==='dict'?'mid':'',render:m=>{const F=RQF[st.fid];const sim=kind==='dict'?reqSimilar(st.fid,st.fid==='gked'?st.v.code:st.v.name):null;
    const body=kind==='q'?fld('Тема',inp('rq-topic',st.v.topic||'','maxlength="200" placeholder="Коротко: о чём вопрос"'),{req:true,full:true,id:'rq-topic'})+fld('Вопрос',`<textarea class="inp" id="rq-text" style="min-height:90px" maxlength="${REQ_MAX}">${esc(st.v.text||'')}</textarea>`,{req:true,full:true,id:'rq-text'})
      :kind==='bug'?fld('Что случилось',`<textarea class="inp" id="rq-what" style="min-height:80px" maxlength="${REQ_MAX}" placeholder="Что вы делали и что пошло не так">${esc(st.v.what||'')}</textarea>`,{req:true,full:true,id:'rq-what'})+fld('Что вы ожидали',`<textarea class="inp" id="rq-exp" style="min-height:56px" maxlength="${REQ_MAX}">${esc(st.v.exp||'')}</textarea>`,{full:true,id:'rq-exp'})
      :kind==='typo'?fld('Как написано',`<textarea class="inp" id="rq-was" style="min-height:56px" maxlength="500">${esc(st.v.was||'')}</textarea>`,{req:true,full:true,id:'rq-was',hint:isMobile()?'':'Совет: выделите текст на экране и нажмите Ctrl+Enter — форма откроется с ним'})+fld('Как правильно',`<textarea class="inp" id="rq-right" style="min-height:56px" maxlength="500">${esc(st.v.right||'')}</textarea>`,{full:true,id:'rq-right'})
      :`${fld('Справочник',sel('rq-fid',Object.entries(RQF).map(([k,f])=>[k,f.t+(f.dict&&f.dict!==f.t?' · '+f.dict:'')]),st.fid),{full:true,id:'rq-fid'})}${F.f.map(fldOf).join('')}
        ${sim?`<div class="fld full"><div class="note warn">${ic('info')}<span>Похоже, это уже есть: <b>${esc(sim)}</b>. <button type="button" class="linkbtn" id="rq-simgo">Открыть справочник</button> Отправить запрос всё равно можно.</span></div></div>`:''}
        ${fld('Комментарий',`<textarea class="inp" id="rqf-note" style="min-height:56px" maxlength="${REQ_MAX}">${esc(st.v.note||'')}</textarea>`,{full:true,id:'rqf-note'})}`;
    const wh=st.useWhere&&st.where?`<div class="fld full rq-where"><span class="lbl">Где</span><div class="rq-wh">${ic('link','sm')}<span class="grow">${esc(st.where.path)}<span class="hint">${esc(st.where.ver)} · ${esc(st.where.br)} · ${esc(st.where.scr)} · ${esc(st.where.at)}</span></span><button type="button" class="icon-btn sm" id="rq-wx" aria-label="Убрать «Где»" title="Убрать «Где»">${ic('x','sm')}</button></div><span class="hint">Значения полей, суммы, файлы и пароли сюда не попадают</span></div>`
      :kind!=='dict'?`<div class="fld full"><button type="button" class="linkbtn" id="rq-wadd">Приложить «Где»: ${esc(st.where.path)}</button></div>`:'';
    return {title:T[kind],sub:'Запрос уйдёт администратору платформы. Ответ придёт в «Мои запросы», колокольчик и Telegram',body:`<div class="form">${body}${wh}${reqShotsHtml(st.shots,'rq-shots')}</div>`,
      foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="rq-ok">Отправить запрос</button>',
      mount(el){const snap=()=>{['topic','text','what','exp','was','right'].forEach(k=>{const x=$('#rq-'+k,el);if(x)st.v[k]=x.value});if(kind==='dict'){F.f.forEach(([k])=>{const x=$('#rqf-'+k,el);if(x)st.v[k]=x.value});st.v.note=val(el,'rqf-note')}};
        reqShotsBind(el,st.shots,'rq-shots',()=>{snap();m.draw()});
        if($('#rq-wx',el))$('#rq-wx',el).onclick=()=>{snap();st.useWhere=false;m.draw()};if($('#rq-wadd',el))$('#rq-wadd',el).onclick=()=>{snap();st.useWhere=true;m.draw()};
        if($('#rq-fid',el))$('#rq-fid',el).onchange=e=>{snap();st.fid=e.target.value;m.draw()};
        const nmI=$(st.fid==='gked'?'#rqf-code':'#rqf-name',el);if(nmI)nmI.onchange=()=>{snap();m.draw()};
        if($('#rq-simgo',el))$('#rq-simgo',el).onclick=()=>{m.close(true);go('dicts',st.fid==='type'?'types':'platform')};
        $('#rq-ok',el).onclick=()=>{snap();const e=(id,msg)=>setErr(el,id,msg);let ok=true;
          if(kind==='q'){const a=e('rq-topic',st.v.topic.trim()?'':'Напишите тему'),b=e('rq-text',st.v.text.trim()?'':'Напишите вопрос');ok=a&&b}
          if(kind==='bug')ok=e('rq-what',st.v.what.trim()?'':'Опишите, что случилось')&&ok;
          if(kind==='typo')ok=e('rq-was',st.v.was.trim()?'':'Укажите, как написано')&&ok;
          if(kind==='dict')F.f.forEach(([k,l,t,req])=>{if(req)ok=e('rqf-'+k,String(st.v[k]||'').trim()?'':(t==='dictsel'?'Выберите справочник':`Заполните «${l}»`))&&ok});
          if(!ok)return;if(reqHour()>=REQ_HOUR)return toast('Не больше 20 запросов за час. Отправьте этот запрос позже','alert',true);
          const no=REQUESTS.reduce((x,r)=>Math.max(x,r.no||0),1200)+1,id='rq'+no;
          const form={};if(kind==='q')Object.assign(form,{text:st.v.text.trim()});if(kind==='bug')Object.assign(form,{what:st.v.what.trim(),exp:(st.v.exp||'').trim()});if(kind==='typo')Object.assign(form,{was:st.v.was.trim(),right:(st.v.right||'').trim()});
          if(kind==='dict'){F.f.forEach(([k])=>{const x=String(st.v[k]||'').trim();if(x)form[k]=x});if(st.v.note&&st.v.note.trim())form.note=st.v.note.trim()}
          const topic=kind==='q'?st.v.topic.trim():kind==='bug'?reqClip(form.what,90):kind==='typo'?'«'+reqClip(form.was,70)+'»':st.fid==='gked'?[form.code,form.name].filter(Boolean).join(' '):form.name;
          const r=born({id,no,kind,topic,oid:ORG.id,org:ORG.name,at:TODAY,status:'Новый',wait:false,lead:null,fid:kind==='dict'?st.fid:null,dict:kind==='dict'?(st.fid==='other'?form.dict:RQF[st.fid].dict):null,form,
            where:st.useWhere&&kind!=='dict'?st.where:null,shots:reqShotsSave(st.shots,id),msgs:[],readA:0,readAdm:0,closedAt:null});
          REQUESTS.push(r);log('rq',id,`Запрос № ${no} отправлен: ${REQ_KINDS[kind]}`);reqTellAdm(r,'new');m.close();refreshAll();
          toast(`Запрос № ${no} отправлен`,'send',false,{label:'Открыть',run:()=>reqCard(r)})}}}}});
}

/* Уведомления (блок 5, п. 5; блок 6, п. 5): автору — колокольчик всегда, Telegram — по переключателю «Ответы на мои запросы» */
const REQ_TPL={ans:'tgReqAns',ask:'tgReqAsk',done:'tgReqDone',added:'tgReqAdded',rej:'tgReqRej'};
const reqLink=r=>`https://buhuchet.kg/#reqs.all/${r.no}`;
const reqBellTxt=t=>t.replace(/\s*Открыть:[\s\S]*$/,'').replace(/[\s:.]+$/,'');
function reqTell(r,ev,text){const u=r.oid===ORG.id?EM[r._cb]:null,t=tplFill(REQ_TPL[ev],{номер:r.no,ответ:reqClip(text,120),причина:reqClip(text,160),ссылка:reqLink(r)});
  if(u&&u.active!==false)bellPut(u.id,{kind:'req',ev:'req_'+ev,open:{k:'request',id:r.id},text:reqBellTxt(t),key:bellOnce(`req_${ev}:${r.id}`)});
  const tgOn=u?u.tg&&tgNotifyOn(u,'req'):true;if(tgOn)TG_LOG.unshift({id:TG_LOG.length+1,at:nowStamp(),to:u?u.short+' '+u.tg:reqWho(r._cb),org:r.org,kind:'Ответ на запрос',txt:t,st:'Ожидает',tries:0,err:''})}
function reqTellAdm(r,ev,text){const t=ev==='new'?tplFill('tgReqNew',{номер:r.no,вид:REQ_KINDS[r.kind],организация:r.org,тема:reqClip(r.topic,100),ссылка:reqLink(r)}):tplFill('tgReqReply',{номер:r.no,организация:r.org,начало:reqClip(text,120),ссылка:reqLink(r)});
  bellPut('admin',{kind:'req',ev:'req_adm_'+ev,open:{k:'request',id:r.id},text:reqBellTxt(t),key:bellOnce(`req_adm_${ev}:${r.id}`)});
  TG_LOG.unshift({id:TG_LOG.length+1,at:nowStamp(),to:ev!=='new'&&r.lead?'Администратор платформы (ведёт запрос)':'Администраторы платформы',org:r.org,kind:ev==='new'?'Новый запрос':'Ответ автора в запросе',txt:t,st:'Ожидает',tries:0,err:''})}

/* Переписка и статусы (блок 4) */
function reqPost(r,o){r.msgs.push(Object.assign({n:r.msgs.length+1,at:nowStamp(),who:S.me},o));touch(r)}
function reqSetSt(r,to,why){const from=r.status;if(from===to)return;reqPost(r,{k:'st',from,to,why:why||''});r.status=to;r.closedAt=REQ_CLOSED.has(to)?TODAY:null;if(to!=='В работе')r.wait=false}
function reqTake(r){if(!isAdmin())return;if(r.status==='Новый')reqSetSt(r,'В работе');r.lead='admin';touch(r)}
// Сообщение: автор или сотрудник организации, администратор (ответ, вопрос автору, заметка)
function reqSay(r,k,text,shots){text=String(text||'').trim();if(!text&&!(shots&&shots.length))return 'Напишите сообщение';if(text.length>REQ_MAX)return `Не длиннее ${fmtM(REQ_MAX,false)} знаков`;
  const adm=isAdmin();if(!adm){if(reqDemoNo())return '';if(reqMsgHour()>=REQ_MSG_HOUR)return 'Не больше 60 сообщений за час. Отправьте позже';
    if(!reqOpen(r)){if(r.status==='Отозван'||diffDays(TODAY,r.closedAt||TODAY)>REQ_REOPEN)return 'Запрос закрыт. Отправьте новый';reqSetSt(r,'В работе','ответ автора после закрытия')}
    reqPost(r,{k:'msg',text,shots:reqShotsSave(shots||[],r.id+':m'+(r.msgs.length+1))});r.wait=false;r.readA=r.msgs.length;reqTellAdm(r,'reply',text);return ''}
  if(k!=='note'&&r.status==='Новый')reqTake(r);
  reqPost(r,{k,text,shots:reqShotsSave(shots||[],r.id+':m'+(r.msgs.length+1))});if(k==='ask')r.wait=true;if(k==='msg')r.wait=false;r.readAdm=r.msgs.length;
  if(k!=='note')reqTell(r,k==='ask'?'ask':'ans',text);return ''}
function reqClose(r,to,text,link){if(text)reqPost(r,{k:'msg',text});reqSetSt(r,to,to==='Отклонён'?text:'');if(!r.lead)r.lead='admin';if(link)r.link=link;r.readAdm=r.msgs.length;
  reqTell(r,to==='Отклонён'?'rej':to==='Добавлено'?'added':'done',text||'')}
function reqCloseDlg(r,to){const no=to==='Отклонён';openModal({form:true,render:()=>({title:no?'Отклонить запрос':to==='Добавлено'?'Добавлено':'Запрос решён',sub:`№ ${r.no} · ${esc(r.org)} · ${esc(r.topic)}`,
  body:fld(no?'Причина':'Ответ автору',`<textarea class="inp" id="rc-t" style="min-height:80px" maxlength="${REQ_MAX}"></textarea>`,{req:no,full:true,id:'rc-t',hint:no?'Автор увидит причину в запросе, колокольчике и Telegram':'Можно не писать'}),
  foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn ${no?'danger':'cta'}" id="rc-ok">${no?'Отклонить':to==='Добавлено'?'Отметить «Добавлено»':'Отметить решённым'}</button>`,
  mount(el,m){$('#rc-ok',el).onclick=()=>{const t=val(el,'rc-t');if(!setErr(el,'rc-t',no&&!t?'Напишите, почему запрос отклонён':''))return;reqClose(r,to,t);m.close();refreshAll();toast(no?`Запрос № ${r.no} отклонён`:`Запрос № ${r.no}: ${to}`,'check')}}})})}
// «Добавить в справочник» (блок 3, п. 5): обычное окно добавления записи справочника, заполненное из формы; запись сохранена — «Добавлено» со ссылкой
const REQ_ADD={type:[()=>typeEditDlg(),()=>RT],ben:[()=>benefitDlg(),()=>DICT.benefits.items],base:[()=>baseDlg(),()=>DICT.bases.items],gked:[()=>gkEditDlg(),()=>GK],ugns:[()=>ugnsDlg(),()=>DICT.ugns.items],
  organ:[()=>valueDlg('organs'),()=>DICT.organs.items],bank:[()=>valueDlg('banks'),()=>DICT.banks.items],cat:[()=>valueDlg('cats'),()=>DICT.cats.items],reason:[()=>valueDlg('reasons'),()=>DICT.reasons.items]};
function reqAddDict(r){const a=REQ_ADD[r.fid];if(!a)return reqCloseDlg(r,'Добавлено');const before=new Set(a[1]()),n0=MODALS.length;a[0]();const m=MODALS[MODALS.length-1];if(!m||MODALS.length===n0)return;
  const f=r.form||{},put=(x,v)=>{if(x&&v&&!x.value){x.value=v;x.dispatchEvent(new Event('input',{bubbles:true}))}};
  const ins=[...m.el.querySelectorAll('.mb input.inp:not([type=checkbox]):not([type=radio]):not([type=date]):not([readonly]):not([disabled])')];
  if(r.fid==='gked'){put(ins[0],f.code);put(ins[1],f.name)}else put(ins[0],f.name);
  const prev=m.o.onClose;m.o.onClose=()=>{if(prev)prev();const x=a[1]().find(y=>!before.has(y));if(!x)return;const nm=x.name||x.code;reqClose(r,'Добавлено',`Добавлено в справочник «${RQF[r.fid].dict}»: ${nm}`,{dict:RQF[r.fid].dict,name:nm});refreshAll();toast(`Запрос № ${r.no}: Добавлено`,'check')}}

/* Карточка запроса (блок 4, п. 2; блок 5, п. 3; блок 6, п. 4) */
function reqSteps(r){if(r.status==='Отклонён'||r.status==='Отозван')return `<div class="rq-steps">${reqPill(r)}</div>`;
  const L=['Новый','В работе',r.kind==='dict'?'Добавлено':'Решён'],i=r.status==='Новый'?0:r.status==='В работе'?1:2;
  return `<div class="rq-steps" aria-label="Статус: ${esc(reqStText(r))}">${L.map((s,j)=>`<span class="rq-st ${j<i?'done':j===i?'cur':''}"><b>${j<i?ic('check','sm'):j+1}</b>${esc(s)}</span>`).join('<span class="rq-ar" aria-hidden="true">→</span>')}${r.status==='В работе'&&r.wait?' '+pill(reqWaitText(r),REQ_ST,'sm'):''}</div>`}
const REQ_FL={text:'Вопрос',what:'Что случилось',exp:'Что вы ожидали',was:'Как написано',right:'Как правильно',note:'Комментарий',dict:'Справочник'};
function reqSentHtml(r){const F=r.kind==='dict'?RQF[r.fid]||RQF.other:null,lab=k=>F&&(F.f.find(x=>x[0]===k)||[])[1]||REQ_FL[k]||k;
  const rows=Object.entries(r.form||{}).filter(([,v])=>v).map(([k,v])=>`<div class="full"><span class="k">${esc(lab(k))}</span><span class="v rq-pre">${esc(v)}</span></div>`);
  if(r.kind==='dict'&&r.dict&&!(r.form||{}).dict)rows.unshift(`<div><span class="k">Справочник</span><span class="v">${esc(r.dict)}</span></div>`);
  if(r.where)rows.push(`<div class="full"><span class="k">Где</span><span class="v">${esc(r.where.path)}${isAdmin()||r.kind==='bug'?`<span class="hint">${esc(r.where.hash)} · ${esc(r.where.ver)} · ${esc(r.where.br)} · ${esc(r.where.scr)} · ${esc(r.where.at)}</span>`:''}</span></div>`);
  if(r.link)rows.push(`<div class="full"><span class="k">Запись</span><span class="v">${ic('check','sm')} ${esc(r.link.dict)}: ${esc(r.link.name)}</span></div>`);
  return `<div class="box"><h3>Что отправлено</h3><div class="kv rq-kv">${rows.join('')}</div>${reqShotsView(r.shots)}</div>`}
function reqFeedHtml(r){const adm=isAdmin(),L=r.msgs.filter(x=>adm||x.k!=='note');
  const first=`<li class="rq-ev"><span class="rq-evt">${ic('send','sm')} Запрос отправлен · ${esc(reqBy(r))} · ${esc(fmtDT(r._ca||r.at+' 00:00'))}</span></li>`;
  return `<ol class="rq-feed">${first}${L.map(x=>x.k==='st'?`<li class="rq-ev"><span class="rq-evt">${ic('history','sm')} Статус: ${esc(x.from)} → ${esc(x.to)}${x.why?` (${esc(x.why)})`:''} · ${esc(reqWho(x.who))} · ${esc(fmtDT(x.at))}</span></li>`
    :`<li class="rq-msg ${x.who==='admin'?'adm':'usr'} ${x.k==='note'?'rq-note':''}"><div class="rq-mh"><b>${esc(x.who==='admin'?'Администратор платформы':reqWho(x.who))}</b>${x.who==='admin'&&x.k!=='note'?'':''}${x.k==='ask'?' '+pill('Вопрос автору',{'Вопрос автору':['orange','msg']},'sm'):''}${x.k==='note'?' '+pill('Заметка: видят только администраторы',{'Заметка: видят только администраторы':['purple','lock']},'sm'):''}<span class="faint">${esc(fmtDT(x.at))}</span></div>${x.text?`<div class="rq-pre">${esc(x.text)}</div>`:''}${reqShotsView(x.shots)}</li>`).join('')}</ol>`}
function reqCard(r){if(!r)return;if(!reqSees(r))return toast('Запрос вам не доступен','alert',true);
  const st={draft:'',shots:[]};const seen=()=>{if(isAdmin())r.readAdm=r.msgs.length;else if(r._cb===S.me)r.readA=r.msgs.length};seen();if(!isAdmin())reqPaint();
  openModal({size:'mid',live:true,render:m=>{seen();const adm=isAdmin(),open=reqOpen(r),late=!open&&(r.status==='Отозван'||diffDays(TODAY,r.closedAt||TODAY)>REQ_REOPEN);
    const canWrite=adm?r.status!=='Отозван':!late;
    const comp=canWrite?`<div class="box rq-comp"><h3>${adm?'Ответ автору':'Написать'}</h3><textarea class="inp" id="rq-m" style="min-height:72px" maxlength="${REQ_MAX}" placeholder="${adm?'Ответ увидит автор: в запросе, колокольчике и Telegram':open?'Сообщение администратору':'Ответ вернёт запрос в «В работе»'}">${esc(st.draft)}</textarea>${reqShotsHtml(st.shots,'rq-mshots')}
      <div class="row rq-cbtn">${adm?`<button type="button" class="btn sm" id="rq-note" title="Заметка — только для администраторов платформы">${ic('lock','sm')}Заметка</button><button type="button" class="btn sm" id="rq-ask">${ic('msg','sm')}Спросить у автора</button>`:''}<div class="grow"></div><button type="button" class="btn cta" id="rq-send">${ic('send','sm')}${adm?'Ответить':'Отправить'}</button></div></div>`
      :`<div class="note">${ic('lock')}<span>${r.status==='Отозван'?'Запрос отозван.':'Запрос закрыт больше 30 дней назад.'} Отправьте новый.</span></div>`;
    const acts=adm?[open&&(r.status==='Новый'||r.lead!=='admin')?`<button class="btn" id="rq-take">${ic('clock','sm')}Взять в работу</button>`:'',open&&r.kind==='dict'&&REQ_ADD[r.fid]?`<button class="btn" id="rq-add">${ic('plus','sm')}Добавить в справочник</button>`:'',
      open?`<button class="btn ok" id="rq-done">${ic('check','sm')}${r.kind==='dict'?'Добавлено':'Решён'}</button>`:'',open?`<button class="btn danger-o" id="rq-rej">${ic('ban','sm')}Отклонить</button>`:''].join('')
      :r.status==='Новый'&&r._cb===S.me?`<button class="btn danger-o" id="rq-wd">${ic('x','sm')}Отозвать запрос</button>`:'';
    return {title:`№ ${r.no} · ${esc(r.topic||REQ_KINDS[r.kind])}`,sub:`${ic(REQ_KIC[r.kind],'sm')} ${esc(REQ_KINDS[r.kind])}${r.kind==='dict'&&r.dict?' · '+esc(r.dict):''}${adm?' · '+esc(r.org):''} · ${esc(reqBy(r))} · ${fmtD(r.at)}${adm?` · ведёт: ${r.lead?'Администратор платформы':'никто'}`:''}`,
      body:`${reqSteps(r)}${reqSentHtml(r)}<div class="box"><h3>Переписка и история</h3>${reqFeedHtml(r)}</div>${comp}`,
      foot:`${acts}<div class="grow"></div><button class="btn ghost" data-close>Закрыть</button>`,
      mount(el){const ta=$('#rq-m',el);if(ta)ta.oninput=()=>{st.draft=ta.value};const box=$('.rq-comp',el);if(box)reqShotsBind(box,st.shots,'rq-mshots',()=>{if(ta)st.draft=ta.value;m.draw()});
        const send=k=>{const e=reqSay(r,k,ta.value,st.shots);if(e===''&&!ta.value.trim()&&!st.shots.length)return;if(e)return setErr(el,'rq-mshots',e)||toast(e,'alert',true);st.draft='';st.shots.length=0;refreshAll();toast(k==='note'?'Заметка сохранена':k==='ask'?'Вопрос автору отправлен':'Сообщение отправлено','send')};
        if($('#rq-send',el))$('#rq-send',el).onclick=()=>send('msg');if($('#rq-ask',el))$('#rq-ask',el).onclick=()=>send('ask');if($('#rq-note',el))$('#rq-note',el).onclick=()=>send('note');
        if($('#rq-take',el))$('#rq-take',el).onclick=()=>{reqTake(r);refreshAll();toast(`Запрос № ${r.no} в работе`,'clock')};
        if($('#rq-done',el))$('#rq-done',el).onclick=()=>reqCloseDlg(r,r.kind==='dict'?'Добавлено':'Решён');if($('#rq-rej',el))$('#rq-rej',el).onclick=()=>reqCloseDlg(r,'Отклонён');
        if($('#rq-add',el))$('#rq-add',el).onclick=()=>reqAddDict(r);
        if($('#rq-wd',el))$('#rq-wd',el).onclick=()=>confirmDlg({title:'Отозвать запрос?',text:`Запрос № ${r.no} закроется, администратор его не возьмёт в работу.`,ok:'Отозвать',danger:true,run:()=>{reqSetSt(r,'Отозван','отозван автором');refreshAll();toast(`Запрос № ${r.no} отозван`)}});
        const fd=$('.rq-feed',el);if(fd&&fd.lastElementChild&&m.o._scrolled!==r.msgs.length){m.o._scrolled=r.msgs.length;setTimeout(()=>{fd.scrollTop=fd.scrollHeight},30)}}}}});
}

/* Окно «Мои запросы» (блок 5) */
const REQ_F={open:['Открытые',r=>reqOpen(r)],wait:['Ждут моего ответа',r=>r.status==='В работе'&&r.wait&&r._cb===S.me],closed:['Закрытые',r=>!reqOpen(r)]};
function reqCols(adm){return [
  {key:'no',label:'№',type:'int',w:76,val:r=>r.no,html:r=>`${reqUnread(r)?'<span class="rq-dot" aria-label="Непрочитанный ответ"></span>':''}<span class="${reqUnread(r)?'strong':''}">${r.no}</span>`},
  {key:'at',label:'Дата',type:'date',w:100,val:r=>r.at},
  adm?{key:'org',label:'Организация',type:'enum',w:180,val:r=>r.org}:null,
  {key:'kind',label:'Вид',type:'enum',w:150,val:r=>REQ_KINDS[r.kind],html:r=>`${ic(REQ_KIC[r.kind],'sm')} ${esc(REQ_KINDS[r.kind])}`},
  {key:'topic',label:'Тема',type:'text',w:260,val:r=>r.topic,html:r=>`<span class="${reqUnread(r)||adm&&r.status==='Новый'?'strong':''}">${esc(r.topic)}</span>`},
  {key:'by',label:'Отправил',type:'enum',w:120,val:reqBy,hide:!adm},
  {key:'st',label:'Статус',type:'enum',w:180,val:reqStText,html:reqPill},
  adm?{key:'lead',label:'Ведёт',type:'enum',w:130,val:r=>r.lead?'Администратор платформы':'—'}:null,
  {key:'last',label:'Последнее сообщение',type:'text',w:220,val:r=>{const x=reqLast(r);return x?`${reqWho(x.who)}, ${fmtDT(x.at)}`:`${reqBy(r)}, ${fmtDT(r._ca||r.at+' 00:00')}`},
    sortVal:r=>(adm?(r.status==='Новый'||reqUnread(r)?'1':'0'):(reqUnread(r)?'1':'0'))+reqLastAt(r)},
  {key:'dict',label:'Справочник',type:'enum',w:170,val:r=>r.dict||'',hide:true},
  {key:'where',label:'Где',type:'text',w:240,val:r=>r.where?r.where.path:'',hide:true},
  adm?{key:'ver',label:'Версия',type:'enum',w:130,val:r=>r.where?r.where.ver:'',hide:true}:null].filter(Boolean)}
function reqMyDlg(f0){if(isAdmin())return go('reqs','all');const st={f:f0||null};
  openModal({size:'wide',live:true,render:m=>({title:'Мои запросы',sub:'Вопросы, ошибки, опечатки и запросы в справочник администратору платформы',
    body:`<div class="chipsel rq-fl" role="group" aria-label="Какие запросы показать">${Object.entries(REQ_F).map(([k,[l,fn]])=>`<button type="button" data-rqf="${k}" class="${st.f===k?'on':''}" aria-pressed="${st.f===k}">${esc(l)} <span class="faint">${reqMine().filter(fn).length}</span></button>`).join('')}</div><div id="mrq"></div>`,
    foot:`<button class="btn" id="rq-new">${ic('msg','sm')}Написать администратору</button><div class="grow"></div><button class="btn cta" data-close>Готово</button>`,
    mount(el){$$('[data-rqf]',el).forEach(b=>b.onclick=()=>{st.f=st.f===b.dataset.rqf?null:b.dataset.rqf;m.draw()});$('#rq-new',el).onclick=e=>reqMenu(e.currentTarget,true);
      grid($('#mrq',el),{id:'my-req',rid:r=>r.id,cols:reqCols(false),rows:()=>reqMine().filter(st.f?REQ_F[st.f][1]:()=>true),title:'topic',open:reqCard,noun:['запрос','запроса','запросов'],sort:{key:'last',dir:-1},ordered:true,
        searchText:r=>`${r.no} ${r.topic}`,rowClass:r=>reqUnread(r)?'unread':'',empty:{icon:'msg',title:'Запросов пока нет',text:'',add:()=>reqMenu($('#rq-new',el),true),addLabel:'Написать администратору',addIcon:'msg'}})}})})}

/* Кнопка «Написать администратору» в верхней панели (блок 2, п. 1) */
function reqMenu(anchor,noMine){const n=reqMine().filter(reqUnread).length;menu(anchor,[
  {label:'Задать вопрос',icon:'help',run:()=>reqForm('q')},{label:'Сообщить об ошибке',icon:'alert',run:()=>reqForm('bug')},
  {label:'Опечатка',icon:'edit',run:()=>reqForm('typo',{typo:REQ.sel})},{label:'Попросить добавить в справочник',icon:'plus',run:reqDictPick},
  noMine?null:{sep:true},noMine?null:{label:'Мои запросы'+(n?` · ${n}`:''),icon:'list',run:()=>reqMyDlg()}].filter(Boolean))}
function reqPaint(){const b=$('#reqb');if(!b)return;const off=S.loggedIn===false||isAdmin();b.hidden=off;if(off)return;
  if(!b.dataset.on){b.dataset.on=1;b.onpointerdown=()=>{REQ.sel=String(getSelection()||'').trim().slice(0,500)};b.onclick=()=>reqMenu(b)}
  const n=reqMine().filter(reqUnread).length;b.innerHTML=ic('msg')+(n?`<span class="badge red bell-n">${n>99?'99+':n}</span>`:'');const t=n?`Написать администратору · непрочитанных ответов: ${n}`:'Написать администратору';b.title=t;b.setAttribute('aria-label',t)}
// Опечатка: выделенный текст и Ctrl+Enter на ПК открывают форму сразу (блок 2, п. 3)
document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||e.key!=='Enter'||S.loggedIn===false||isAdmin())return;if(e.target.closest&&e.target.closest('input,textarea,select,[contenteditable]'))return;
  const s=String(getSelection()||'').trim();if(!s)return;e.preventDefault();reqForm('typo',{typo:s.slice(0,500)})});

/* Админка: модуль «Запросы» (блок 6) */
const REQ_ADM_T={new:['Новые',r=>r.status==='Новый'],work:['В работе',r=>r.status==='В работе'&&!r.wait],wait:['Ждут пользователя',r=>r.status==='В работе'&&r.wait],closed:['Закрытые',r=>!reqOpen(r)],all:['Все',()=>true]};
function reqAdmTabs(){return Object.entries(REQ_ADM_T).map(([id,[label,fn]])=>({id,label,icon:{new:'circle',work:'clock',wait:'msg',closed:'check',all:'list'}[id],count:['new','work'].includes(id)?REQUESTS.filter(fn).length||null:null}))}
function renderReqAdm(body,tab,fresh){const fn=(REQ_ADM_T[tab]||REQ_ADM_T.all)[1];body.innerHTML='<div id="rqa"></div>';
  grid($('#rqa',body),{id:'adm-reqs-'+tab,rid:r=>r.id,cols:reqCols(true),rows:()=>REQUESTS.filter(fn),title:'topic',noun:['запрос','запроса','запросов'],sort:{key:'last',dir:-1},ordered:true,open:reqCard,preset:S.preset,simulateLoad:fresh,
    searchText:r=>`${r.no} ${r.topic} ${Object.values(r.form||{}).join(' ')} ${r.msgs.map(x=>x.text||'').join(' ')}`,rowClass:r=>r.status==='Новый'||reqUnread(r)?'unread':'',
    actions:r=>[{label:'Открыть',icon:'msg',run:()=>reqCard(r)},reqOpen(r)&&r.lead!=='admin'?{label:'Взять в работу',icon:'clock',run:()=>{reqTake(r);refreshAll();toast(`Запрос № ${r.no} в работе`,'clock')}}:null,
      reqOpen(r)?{label:r.kind==='dict'?'Добавлено':'Решён',icon:'check',run:()=>reqCloseDlg(r,r.kind==='dict'?'Добавлено':'Решён')}:null,reqOpen(r)?{label:'Отклонить',icon:'ban',danger:true,run:()=>reqCloseDlg(r,'Отклонён')}:null].filter(Boolean),
    empty:{icon:'msg',title:'Запросов нет'}})}
