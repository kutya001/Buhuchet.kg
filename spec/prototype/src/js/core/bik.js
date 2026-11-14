'use strict';
/* ═════════════ Справочник «БИК банков» (решение заказчика 14.11.2026) ═════════════
   БИК участников платёжной системы КР по данным НБКР: {bik, swift, type, name, addr, status, succ, bank — код провайдера или ''}.
   Первые три цифры БИК — код банка, головной офис — «<код>001». У провайдера банка «Код банка в БИК» (bikCode, 3 цифры).
   В «Расчётном счёте» БИК вписывается первым: банк и филиал определяются сами; БИК не из справочника — банк выбирается вручную, счёт с отметкой bikOff */
const BIK_T=['НБКР','Банк','Филиал банка','ЦК КР','Нерезидент'];
const BIK_ST=['Активный','Введены ограничения','Приостановлен','Закрыт'];
const BIK_STC={'Активный':['green','check'],'Введены ограничения':['yellow','alert'],'Приостановлен':['orange','pause'],'Закрыт':['red','ban'],'':['gray','circle']};
// Коды из файла НБКР: тип участника 1, 2, 3, 4, 7; статус 1, 2, 3, 0
const BIK_T_N={1:'НБКР',2:'Банк',3:'Филиал банка',4:'ЦК КР',7:'Нерезидент'},BIK_ST_N={1:'Активный',2:'Введены ограничения',3:'Приостановлен',0:'Закрыт'};
const BIKD=()=>(DICT.bik&&DICT.bik.items)||[];
const bikNorm=c=>String(c==null?'':c).replace(/\D/g,'');
const bikFind=c=>{c=bikNorm(c);return c.length===6?BIKD().find(x=>x.bik===c)||null:null};
const bikHead=c=>BIKD().find(x=>x.bik===bikNorm(c).slice(0,3)+'001')||null;
// Провайдер банка для БИК: по ссылке записи, иначе по «Коду банка в БИК» у провайдера
function bikProv(x){if(!x)return null;const B=DICT.banks.items;return (x.bank&&B.find(b=>b.code===x.bank))||B.find(b=>b.bikCode&&b.bikCode===String(x.bik).slice(0,3))||null}
// Строка под полем: головной банк · филиал · адрес
function bikLine(x){const h=x.type==='Филиал банка'?bikHead(x.bik):null;return [h&&h!==x?h.name:'',x.name,x.addr].filter(Boolean).join(' · ')}
// Сколько реквизитов организации ссылаются на БИК (в прототипе — одна организация)
const bikUsed=c=>ORG.accounts.filter(a=>a.kind!=='phone'&&a.bik===c).length;
// Проверка БИК в «Расчётном счёте»: {x, prov, err, warn, none, succ}
function bikCheck(c){c=String(c||'').trim();if(!c)return {err:'Введите БИК'};if(!/^\d{6}$/.test(c))return {err:'БИК — 6 цифр'};const x=bikFind(c);
  if(!x)return {none:true,warn:'БИК не найден в справочнике НБКР. Проверьте код или выберите банк вручную'};const prov=bikProv(x);
  if(x.status==='Закрыт'){const s=x.succ&&bikFind(x.succ);return {x,prov,err:s?`БИК закрыт, новый — ${x.succ}`:'БИК закрыт',succ:s?x.succ:''}}
  return {x,prov,warn:x.status==='Введены ограничения'||x.status==='Приостановлен'?`У БИК статус «${x.status}» в справочнике НБКР: платежи через него могут не пройти. Сохранить можно`:''}}
// Счёт другого банка: первые три цифры счёта не совпадают с кодом банка в БИК
const bikAccWarn=(bik,acc)=>{const a=bikNorm(acc);return /^\d{6}$/.test(String(bik||'').trim())&&a.length>=3&&a.slice(0,3)!==String(bik).trim().slice(0,3)?'Счёт, похоже, другого банка: первые три цифры счёта не совпадают с кодом банка в БИК. Сохранить можно':''};
/* Поиск БИК (v108, замечание заказчика 14.11.2026: стандартный список браузера неудобен и плохо ищет по названию).
   Ищет по цифрам БИК (с начала), по названию банка или филиала, банку-провайдеру и адресу: все слова запроса, без учёта регистра, кавычек, дефисов и «ё».
   Сначала головные офисы, потом филиалы; закрытые БИК не предлагаются */
const bikTxt=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[«»"'“”„()]/g,' ').replace(/[-–—.,/]/g,' ').replace(/\s+/g,' ').trim();
function bikSearch(q,lim=50){const t=bikTxt(q);if(!t)return {rows:[],n:0};const L=BIKD().filter(x=>x.status!=='Закрыт');let hit;
  if(/^\d+$/.test(t.replace(/ /g,''))){const d=t.replace(/ /g,'');hit=L.filter(x=>x.bik.startsWith(d)).map(x=>[x.bik===d?0:1,x])}
  else{const ws=t.split(' '),tc=t.replace(/ /g,'');hit=L.map(x=>{const p=bikProv(x),nm=bikTxt(x.name),pn=bikTxt(p&&p.name),h=nm+' '+pn+' '+bikTxt(x.addr),cm=h.replace(/ /g,'').includes(tc);if(!cm&&!ws.every(w=>h.includes(w)))return null;
    return [(x.type==='Банк'||x.type==='НБКР'?0:2)+(cm||ws.every(w=>nm.includes(w)||pn.includes(w))?0:4)+(ws.length>1&&!cm?1:0),x]}).filter(Boolean)}
  hit.sort((a,b)=>a[0]-b[0]||(a[1].bik<b[1].bik?-1:1));return {rows:hit.slice(0,lim).map(h=>h[1]),n:hit.length}}
function bikItem(x,on){const p=bikProv(x);return `<button type="button" class="bik-it${on?' on':''}" data-bik="${x.bik}" role="option" aria-selected="${!!on}"><span class="mono bik-c">${x.bik}</span><span class="bik-t"><b>${esc(x.name)}</b><small>${esc([p?p.name:'',x.type==='Банк'?'головной офис':x.type==='Филиал банка'?'':x.type,x.addr].filter(Boolean).join(' · '))}</small></span>${x.status&&x.status!=='Активный'?pill(x.status,BIK_STC,'sm'):''}</button>`}
// Поле БИК с выпадающим поиском: el — окно, id — поле ввода; список #<id>-dd под полем; выбор ставит БИК и вызывает onPick
function bikCombo(el,id,onPick){const i=$('#'+id,el),dd=$('#'+id+'-dd',el);if(!i||!dd)return;let res=[],k=-1;
  const close=()=>{dd.hidden=true;i.setAttribute('aria-expanded','false');k=-1};
  const draw=()=>{const q=i.value.trim();if(!q||/^\d{6}$/.test(q)&&bikFind(q)){close();return}const r=bikSearch(q);res=r.rows;if(k>=res.length)k=res.length-1;
    dd.innerHTML=res.length?res.map((x,j)=>bikItem(x,j===k)).join('')+(r.n>res.length?`<div class="bik-more">Показаны ${res.length} из ${r.n}: уточните запрос</div>`:''):`<div class="bik-more">${/^\d+$/.test(q)?'БИК с такими цифрами нет в справочнике НБКР':'Ничего не найдено: попробуйте часть названия, например «Бакай» или «Ош»'}</div>`;
    dd.hidden=false;i.setAttribute('aria-expanded','true');const a=dd.querySelector('.on');if(a)a.scrollIntoView({block:'nearest'})};
  const pick=x=>{i.value=x.bik;close();onPick&&onPick(x)};
  i.addEventListener('input',()=>{k=-1;draw()});i.addEventListener('focus',()=>{if(i.value.trim()&&!/^\d{6}$/.test(i.value.trim()))draw()});
  i.addEventListener('keydown',e=>{if(dd.hidden){if(e.key==='ArrowDown'){draw();e.preventDefault()}return}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){k=Math.max(0,Math.min(res.length-1,k+(e.key==='ArrowDown'?1:-1)));draw();e.preventDefault()}
    else if(e.key==='Enter'){const x=res[k<0?0:k];if(x){pick(x);e.preventDefault()}}else if(e.key==='Escape'){close();e.stopPropagation();e.preventDefault()}});
  dd.addEventListener('mousedown',e=>e.preventDefault());dd.addEventListener('click',e=>{const b=e.target.closest('[data-bik]');if(b)pick(bikFind(b.dataset.bik))});
  i.addEventListener('blur',()=>setTimeout(close,120))}
