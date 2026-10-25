'use strict';
// Чтение свидетельства (справки) о госрегистрации и выписки из реестра Минюста: текстовый слой PDF → реквизиты
/* ═════════════ PDF: текстовый слой через pdf.js ═════════════ */
/* pdf.js 3.11.174 лежит в vendor/pdfjs. В собранном файле он встроен блоками vendor-pdf и vendor-pdf-worker
   (type="text/plain", чтобы не разбирать 1,4 МБ кода при каждом открытии) и запускается при первой загрузке PDF.
   Обработчик pdf.js работает в основном потоке: глобальный pdfjsWorker из pdf.worker.min.js — без Worker и без сети. */
let PDFJS_P=null;
const PDFJS_CDN='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
// Порядок: встроенный блок сборки → файл vendor/pdfjs рядом с index.html → тот же файл с cdnjs
function pdfjsScript(id,file){const ok=()=>id==='vendor-pdf'?!!window.pdfjsLib:!!window.pdfjsWorker;
  const tag=src=>new Promise(res=>{const s=document.createElement('script');s.src=src;s.onload=()=>res(ok());s.onerror=()=>res(false);document.head.appendChild(s)});
  return (async()=>{if(ok())return true;const t=document.getElementById(id);
    if(t){try{const s=document.createElement('script');s.textContent=t.textContent;document.head.appendChild(s)}catch(e){}if(ok())return true}
    if(location.protocol!=='file:'||!t){if(await tag('vendor/pdfjs/'+file))return true}
    return tag(PDFJS_CDN+file)})()}
function pdfjsLoad(){
  if(window.pdfjsLib&&window.pdfjsWorker)return Promise.resolve(window.pdfjsLib);
  if(PDFJS_P)return PDFJS_P;
  PDFJS_P=(async()=>{const w=await pdfjsScript('vendor-pdf-worker','pdf.worker.min.js'),l=await pdfjsScript('vendor-pdf','pdf.min.js');
    if(!w||!l)throw new Error('Библиотека чтения PDF не загрузилась');return window.pdfjsLib})().catch(e=>{PDFJS_P=null;throw e});
  return PDFJS_P}
// Файл → {pages:[{items:[{str,x,y,w,h}]}], info} или ошибка {err}
async function pdfRead(file){
  let lib;try{lib=await pdfjsLoad()}catch(e){return {err:'lib',msg:e.message}}
  let doc;try{doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:false,disableFontFace:true}).promise}
  catch(e){return {err:/password/i.test(e&&e.name||'')?'password':'broken',msg:String(e&&e.message||e)}}
  const pages=[];
  for(let p=1;p<=Math.min(doc.numPages,10);p++){const pg=await doc.getPage(p);const tc=await pg.getTextContent();
    pages.push({items:tc.items.filter(i=>i.str&&i.str.trim()).map(i=>({str:i.str,x:i.transform[4],y:i.transform[5],w:i.width,h:Math.abs(i.transform[3])||10}))})}
  let info={};try{info=(await doc.getMetadata()).info||{}}catch(e){}
  doc.destroy();return {pages,info,numPages:doc.numPages}}

/* ═════════════ Строки и столбцы ═════════════ */
/* Элементы одной высоты (±3 pt) — одна строка; внутри строки разрыв больше 18 pt делит её на части. Порядок элементов в файле не важен. */
function rdLines(pages){const out=[];
  pages.forEach((pg,pi)=>{const it=[...pg.items].sort((a,b)=>b.y-a.y||a.x-b.x);const rows=[];
    it.forEach(i=>{const r=rows.find(r=>Math.abs(r.y-i.y)<=3);if(r)r.items.push(i);else rows.push({y:i.y,items:[i]})});
    rows.sort((a,b)=>b.y-a.y).forEach(r=>{const s=r.items.sort((a,b)=>a.x-b.x);const segs=[];
      s.forEach(i=>{const l=segs[segs.length-1];if(l&&i.x-(l.x2)<=18){l.t+=(i.x-l.x2>1.5&&!/\s$/.test(l.t)?' ':'')+i.str;l.x2=Math.max(l.x2,i.x+i.w)}else segs.push({t:i.str,x:i.x,x2:i.x+i.w})});
      segs.forEach(g=>g.t=g.t.replace(/\s+/g,' ').trim());
      out.push({page:pi,y:r.y,segs:segs.filter(g=>g.t),text:segs.map(g=>g.t).join(' ').trim()})})});
  return out.filter(l=>l.text)}

/* ═════════════ Подписи полей ═════════════ */
// Нормализация подписи: нижний регистр, ё → е, без номера пункта и двоеточия
const rdNorm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/^\s*\d{1,3}\s*[.)]\s*/,'').replace(/[:：]\s*$/,'').replace(/\s+/g,' ').trim();
// Порядок важен: срабатывает первое совпадение. kg — подпись на государственном языке (значение берётся, только если русского нет)
const RD_LABELS=[
  ['regOrgan',/регистрирующ\w* орган|орган регистрации/],['regOrgan',/каттоочу орган/,1],
  ['shortKg',/сокращ\w* (фирменн\w* )?наименован\w*.*государствен/],['shortKg',/кыскартылган.*мамлекеттик/,1],
  ['shortRu',/сокращ\w* (фирменн\w* )?наименован\w*.*официальн/],['shortRu',/кыскартылган.*расмий/,1],
  ['shortRu',/^сокращенное (фирменное )?наименование$/],
  ['nameKg',/наименован\w*.*государствен/],['nameKg',/мамлекеттик тилде толук|толук аталышы.*мамлекеттик/,1],
  ['nameRu',/наименован\w*.*официальн/],['nameRu',/расмий тилде толук|толук аталышы.*расмий/,1],
  ['nameRu',/^(полное )?(фирменное )?наименование( юридического лица)?$/],
  ['form',/организационно.?правов/],['form',/уюштуруу.?укуктук/,1],
  ['foreign',/иностранн\w* участ/],
  ['regNo',/регистрационн\w* номер|^рег\.? ?номер|^номер регистрац/],['regNo',/каттоо номери/,1],
  ['okpo',/окпо/],['okpo',/иужк/,1],
  ['inn',/^инн$|идентификационн\w* налогов\w* номер|^инн /],['inn',/^исн$/,1],
  ['address',/юридическ\w* адрес|^адрес( \(место нахождения\))?$|место нахождения/],['address',/юридикалык дарег/,1],
  ['region',/^област|город республиканского значения/],
  ['district',/^район|город областного значения/],
  ['city',/город\/село|^населенн\w* пункт|^город$/],
  ['micro',/микрорайон|жилмассив/],
  ['street',/^улица/],
  ['house',/№ дома|^дом$|номер дома/],
  ['flat',/квартир|офис/],
  ['phone',/телефон/],['fax',/факс/],
  ['email',/e-?mail|электронн\w* (адрес|почт)/],
  ['regKind',/государственн\w* регистрация или перерегистрация/],
  ['status',/текущ\w* статус|^статус/],['status',/учурдагы статус/,1],
  ['orderDate',/дата приказа/],
  ['firstReg',/дата первичн\w* (гос\w* )?регистрац|дата (гос\w* )?регистрации$/],['firstReg',/алгачкы катталган/,1],
  ['reReg',/дата перерегистрац/],['reReg',/кайра катталган/,1],
  ['stop',/прекращени\w* деятельност|ликвидац/],['stop',/токтотулган/,1],
  ['ownership',/форма собственност/],
  ['actMain',/основн\w* вид\w* деятельност/],
  ['actMore',/дополнительн\w* вид\w* деятельност|иные виды деятельност|прочие виды деятельност/],
  ['gked',/код\w*.*(экономическ\w* деятельност|гкэд|окэд)|^гкэд|^код вида деятельност/],
  ['foundersAll',/общее количество учредител|количество учредителей\/участников|^количество учредителей( \(участников\))?$/],['foundersAll',/уюштуруучулардын.*саны/,1],
  ['foundersPhys',/учредител\w*.*физическ/],['foundersJur',/учредител\w*.*юридическ/],
  ['founder',/^учредител\w*( \(участник\w*\))?( ф\.?\s?и\.?\s?о\.?| \(?фио\)?)?$|^учредители \(участники\)$/],
  ['head',/^руководител|^директор|^первый руководител|ф\.?\s?и\.?\s?о\.?.*руководител|руководител\w* \(ф\.?\s?и\.?\s?о/],['head',/башкаруучу|жетекчи/,1],
  ['fio',/^фамилия,? имя,? отчество|^ф\.?\s?и\.?\s?о\.?$/],
  ['benef',/бенефициар/],
];
// \w в JS — только латиница: в подписях он означает любую букву, поэтому регулярки пересобираются с флагом u
const rdU=re=>new RegExp(re.source.replace(/\\w/g,'[\\p{L}\\d_]'),'u');
RD_LABELS.forEach(x=>x[1]=rdU(x[1]));
function rdLabel(s){const n=rdNorm(s);if(!n||n.length>120)return null;for(const[k,re,kg]of RD_LABELS)if(re.test(n))return {k,kg:!!kg};return null}
// Пусто в документе: «---», «== не заполнено ==», «нет данных»
const rdEmpty=v=>!v||/^[-–—=\s.]*$/.test(v)||/^=*\s*не заполнен\p{L}*\s*=*$/iu.test(v.trim())||/^нет данных$/i.test(v.trim())||/^не указан\p{L}*$/iu.test(v.trim());

/* ═════════════ Вид документа ═════════════ */
function rdKind(lines){const all=lines.map(l=>l.text.toLowerCase().replace(/ё/g,'е')).join('\n');let sv=0,vy=0;
  if(/справка\s*\(свидетельство\)|свидетельств\w* о государственн\w* (пере)?регистрац/.test(all))sv+=3;if(/маалымкат|күбөлүк/.test(all))sv+=2;
  if(/справка из единого государственного реестра/.test(all))sv+=2;
  if(/выписк\w* из (единого )?государственн\w* реестр|^выписка/m.test(all))vy+=3;
  if(/сведения о наименовании|сведения о регистрационном номере|сведения об адресе/.test(all))vy+=2;
  if(/код экономической деятельности|сведения об учредителях/.test(all))vy+=1;
  const num=lines.filter(l=>/^\d{1,2}\.\s+\S/.test(l.text)).length;if(num>=6)vy+=2;
  const col=lines.filter(l=>/:\s*$/.test(l.segs[0].t)&&l.segs.length===1).length;if(col>=6)sv+=1;
  return vy>sv?'vyp':sv>0?'svid':vy>0?'vyp':''}

/* ═════════════ Разбор пар «подпись — значение» ═════════════ */
/* Два вида раскладки, и оба разбираются по положению текста, а не по номеру строки:
   • свидетельство — подпись с двоеточием отдельной строкой, значение — следующей строкой (или строками) до следующей подписи;
   • выписка — таблица: подпись в левом столбце, значение в правом; перенос подписи и перенос значения склеиваются. */
const RD_STOP=/https?:\/\/|^справка из единого|^выписка из единого|^юридикалык жактардын|^\d{1,3}\/\d{1,3}$|^страница \d/i;
function rdPairs(lines,kind){const pairs=[];let sec='';
  // правый столбец: левая граница частей значения у пронумерованных строк (самая частая)
  const xs=lines.filter(l=>l.segs.length>1&&(/^\d{1,3}\s*[.)]/.test(l.segs[0].t)||rdLabel(l.segs[0].t))&&!/:\s*$/.test(l.segs[0].t)).map(l=>Math.round(l.segs[l.segs.length-1].x/10)*10);
  const valX=xs.length?+Object.entries(xs.reduce((a,x)=>(a[x]=(a[x]||0)+1,a),{})).sort((a,b)=>b[1]-a[1])[0][0]-8:null;
  const isSec=t=>/^[IVXLC]{1,5}\.\s+\S/.test(t)||/^раздел \d/i.test(t);
  if(valX&&xs.length>=4&&kind!=='svid'){let cur=null;
    lines.forEach(l=>{const t=l.text;if(isSec(t)){sec=t;cur=null;return}if(RD_STOP.test(t)||/^\d\d\.\d\d\.\d{4}\s+\d\d:\d\d/.test(t)){cur=null;return}
      const left=l.segs.filter(g=>g.x<valX).map(g=>g.t).join(' '),right=l.segs.filter(g=>g.x>=valX).map(g=>g.t).join(' ');
      const numbered=/^\d{1,3}\s*[.)]/.test(left);
      if(numbered||(left&&right&&(!cur||cur.v||rdLabel(left)))){cur={l:left,v:right,sec};pairs.push(cur);return}
      if(!cur)return;if(left)cur.l+=' '+left;if(right)cur.v+=(cur.v?' ':'')+right});
  }
  if(kind!=='vyp'||!pairs.length){let cur=null;
    lines.forEach(l=>{const t=l.text;if(RD_STOP.test(t)){cur=null;return}
      const m=t.match(/^([^:]{2,120}):\s*(.*)$/);const lb=m&&rdLabel(m[1]);
      if(m&&(lb||!m[2])&&!/^\d/.test(m[1].trim())||lb&&m){cur={l:m[1],v:m[2]||'',sec:'',page:l.page};pairs.push(cur);return}
      if(cur&&cur.page===l.page&&cur.v.split('\n').length<4)cur.v+=(cur.v?' ':'')+t});
  }
  return pairs.map(p=>({l:p.l.trim(),v:p.v.trim(),sec:p.sec}))}

/* ═════════════ Значения ═════════════ */
const rdDate=s=>{const m=String(s||'').match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
// «ОМУРАЛИЕВ КУТМАН ШАБДАНБЕКОВИЧ» → «Омуралиев Кутман Шабданбекович»
const rdFio=s=>String(s||'').replace(/\s+/g,' ').trim().replace(/[A-Za-zА-Яа-яЁёӨөҮүҢң]+/g,w=>w===w.toUpperCase()&&w.length>1?w[0]+w.slice(1).toLowerCase():w);
const rdQuotes=s=>String(s||'').replace(/"([^"]+)"/g,'«$1»').replace(/[“”„]([^“”„]+)[“”„]/g,'«$1»').replace(/\s+/g,' ').trim();
// Значения справки из нескольких документов: {v, src, date}
function rdExtract(file){const lines=rdLines(file.pages);const kind=rdKind(lines);const pairs=rdPairs(lines,kind);const all=lines.map(l=>l.text).join('\n');
  const f={};const put=(k,v,kg)=>{if(rdEmpty(v))return;if(f[k]&&!(f[k].kg&&!kg))return;f[k]={v:v.trim(),kg:!!kg}};
  const founders=[],more=[];
  pairs.forEach(p=>{let lb=rdLabel(p.l);if(!lb)return;let k=lb.k;
    if(k==='fio')k=/руковод/i.test(p.sec)?'head':/учредител/i.test(p.sec)?'founder':/бенефициар/i.test(p.sec)?'benefName':'';
    if(k==='benef'&&/^всего/i.test(rdNorm(p.l)))k='benefCount';
    if(/бенефициар/i.test(p.sec)&&/^всего/.test(rdNorm(p.l)))k='benefCount';
    if(!k)return;
    if(k==='founder'){if(!rdEmpty(p.v)&&!/^\d+$/.test(p.v))founders.push(rdFio(p.v));return}
    if(k==='actMore'){if(!rdEmpty(p.v))more.push(p.v);return}
    if(k==='gked'){(p.v.match(/\b\d{2}\.\d{1,2}(\.\d{1,2})?\b/g)||[]).forEach((c,i)=>i||f.gked?more.push(c):put('gked',c,lb.kg));return}
    put(k,p.v,lb.kg)});
  // Запасной поиск по всему тексту — если подпись поля изменилась
  const fb=(k,re,g=0)=>{if(f[k])return;const m=all.match(re);if(m)f[k]={v:m[g].trim(),kg:false,guess:true}};
  fb('inn',/(?:ИНН|ИСН)[^0-9\n]{0,20}\n?\s*([0-2]\d{13})\b/,1);fb('inn',/\b([0-2]\d{13})\b/,1);
  fb('okpo',/(?:ОКПО|ИУЖК)[^0-9\n]{0,30}\n?\s*(\d{8})\b/,1);
  fb('regNo',/(?<![\d-])(\d{2,7}-\d{3,5}-[А-ЯЁA-Z]{2,6})(?![\p{L}\d])/u,1);
  fb('email',/\b([\w.+-]+@[\w-]+(\.[\w-]+)+)\b/,1);
  fb('phone',/(\+?996[\s-]?\(?\d{3}\)?[\s-]?\d{2,3}[\s-]?\d{2,3}[\s-]?\d{2,3})/,1);
  if(!f.gked&&kind==='vyp')fb('gked',/\b(\d{2}\.\d{2}\.\d)\b/,1);
  if(!f.nameRu){const m=all.match(/((?:Общество с ограниченной|Общество с дополнительной|Открытое акционерное|Закрытое акционерное|Акционерное)[^\n"«]*["«][^"»\n]+["»])/);if(m)f.nameRu={v:m[1],kg:false,guess:true}}
  if(!f.head){const m=all.match(/(?:Руководитель|Директор)[:\s]*\n?\s*([А-ЯЁӨҮҢ][А-ЯЁӨҮҢа-яёөүң-]+\s+[А-ЯЁӨҮҢ][А-ЯЁӨҮҢа-яёөүң-]+(?:\s+[А-ЯЁӨҮҢ][А-ЯЁӨҮҢа-яёөүң-]+)?)/);if(m)f.head={v:m[1],kg:false,guess:true}}
  // Дата выдачи: выписка — дата и время в колонтитуле; свидетельство — дата рядом со ссылкой на реестр; иначе дата создания PDF
  let issued='';{const m=all.match(/(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}(:\d{2})?/);const u=lines.find(l=>/https?:\/\//.test(l.text)&&/\d{2}\.\d{2}\.\d{4}/.test(l.text));
    const d=all.match(/(?:дата выдачи|выдан\w*|берилген күнү)[:\s]*(\d{2}\.\d{2}\.\d{4})/i);
    issued=rdDate(d?d[1]:u?u.text.match(/\d{2}\.\d{2}\.\d{4}/)[0]:m?m[1]:'');
    if(!issued){const c=String((file.info||{}).CreationDate||'').match(/D:(\d{4})(\d{2})(\d{2})/);if(c)issued=`${c[1]}-${c[2]}-${c[3]}`}}
  const link=(all.match(/https?:\/\/\S*minjust\S*/)||[''])[0];
  return {kind,f,founders:[...new Set(founders)],more:[...new Set(more)],issued,link,text:all,lines:lines.length,pairs:pairs.length}}

/* ═════════════ Реквизиты контрагента из одного или двух документов ═════════════ */
const RD_DOC={svid:'Свидетельство',vyp:'Выписка'};
const RD_FROM={svid:'из свидетельства',vyp:'из выписки',both:'из выписки и свидетельства'};
const rdCmp=x=>String(x??'').toLowerCase().replace(/ё/g,'е').replace(/[\s"«»'.,()-]/g,'');
// Форма собственности: по организационно-правовой форме или по началу наименования
function rdForm(t){const n=norm(t||'');if(!n)return '';const it=DICT.forms.items.filter(x=>x.active);
  const byFull=it.filter(x=>x.full&&n.startsWith(norm(x.full))).sort((a,b)=>b.full.length-a.full.length)[0];if(byFull)return byFull.name;
  const sh=n.match(/^([а-яёa-z()]{2,8})\s*[«"]/);const byShort=sh&&it.find(x=>norm(x.short||x.name)===sh[1]);return byShort?byShort.name:''}
const rdFormShort=name=>{const x=DICT.forms.items.find(y=>y.name===name);return x?(x.short||x.name):''};
// Название для списка: краткое наименование, иначе «ОсОО «Имя»» из полного
function rdName(f){const q=v=>rdQuotes(v);if(f.shortRu)return q(f.shortRu.v);if(!f.nameRu)return '';const full=q(f.nameRu.v);const m=full.match(/«(.+)»\s*$/);const fs=rdFormShort(rdForm(full));return m&&fs?`${fs} «${m[1]}»`:full}
function rdAddr(f){if(f.region||f.street||f.house){const ps=[];const add=(v,pre='')=>{if(!v||rdEmpty(v.v))return;const t=v.v.trim();if(ps.some(p=>rdCmp(p).endsWith(rdCmp(t))))return;ps.push(/^\d/.test(t)&&pre?pre+t:t)};
    add(f.region);add(f.district);add(f.city);add(f.micro);add(f.street);add(f.house,'д. ');add(f.flat,'кв. ');return ps.join(', ')}
  return f.address?f.address.v.trim():''}
// Телефон → {cc:'KG',digits:'996…'}; неполный номер — null
function rdPhone(v){const d=String(v||'').replace(/\D/g,'');if(/^996\d{9}$/.test(d))return {cc:'KG',digits:d};if(/^0?[2-9]\d{8}$/.test(d))return {cc:'KG',digits:'996'+d.slice(-9)};return null}
// УГНС по району или городу адреса
function rdUgns(f,addr){const t=[f.district&&f.district.v,f.city&&f.city.v,f.region&&f.region.v,addr].filter(Boolean).join(' ');
  const rm=t.match(/([А-ЯЁ][а-яё-]+)(ский|ской|ский)\s+район/);const city=(t.match(/(?:г\.\s*|город\s+)([А-ЯЁ][а-яё-]+)/)||[])[1]||'';
  const it=DICT.ugns.items.filter(x=>x.active);let u=null;
  if(rm){const stem=norm(rm[1]+rm[2]).slice(0,-3);u=it.find(x=>norm(x.name).includes(stem)&&(!city||norm(x.name+' '+(x.city||'')).includes(norm(city).slice(0,5))))||it.find(x=>norm(x.name).includes(stem))}
  if(!u&&city)u=it.find(x=>norm(x.name).includes('г. '+norm(city))||norm(x.name).includes(norm(city).slice(0,-1)+'у'))||null;
  return u?ugK(u):''}
// ГКЭД: подкласс — сразу; класс или группа — единственный подкласс или выбор; нет кода — до 5 похожих по словам
function rdGked(code,text){const r={code:'',choose:[],like:[],raw:code||'',text:text||''};
  if(code){const c=code.trim();const x=GKM[c]||GKM[c.replace(/\.0$/,'')]||GKM[c+'.0'];
    if(x&&x.level==='subclass'){r.code=x.code;return r}
    if(x){const subs=GK.filter(y=>y.level==='subclass'&&y.active!==false&&(y.code===x.code||y.code.startsWith(x.code+'.')||gkUp(y.code).includes(x.code)));if(subs.length===1)r.code=subs[0].code;else r.choose=subs.map(y=>y.code);return r}}
  if(text){const ws=[...new Set(norm(text).split(/[^а-яёa-z0-9]+/).filter(w=>w.length>3).map(w=>w.slice(0,Math.max(4,w.length-2))))];const need=Math.max(1,Math.ceil(ws.length/3));
    r.like=GK.filter(y=>y.level==='subclass'&&y.active!==false).map(y=>{const nw=norm(y.name).split(/[^а-яёa-z0-9]+/).filter(w=>w.length>3);const n=ws.filter(w=>nw.some(x=>x.startsWith(w))).length;return {c:y.code,n,s:n-0.1*Math.max(0,nw.length-n)}})
      .filter(y=>y.n>=need).sort((a,b)=>b.s-a.s).slice(0,5).map(y=>y.c)}
  return r}
// Поля одного документа в терминах контрагента
function rdCpFields(d){const f=d.f;const o={};const set=(k,v)=>{if(v!==''&&v!=null&&!(typeof v==='string'&&rdEmpty(v)))o[k]=v};
  set('name',rdName(f));set('full',f.nameRu?rdQuotes(f.nameRu.v):'');set('inn',f.inn?f.inn.v.replace(/\D/g,''):'');set('regNo',f.regNo?f.regNo.v.replace(/\s+/g,''):'');set('okpo',f.okpo?f.okpo.v.replace(/\D/g,''):'');
  set('form',rdForm(f.form?f.form.v:'')||rdForm(f.nameRu?rdQuotes(f.nameRu.v):'')||rdForm(f.shortRu?rdQuotes(f.shortRu.v):''));
  set('addr',rdAddr(f));if(f.phone)set('phoneRaw',f.phone.v);if(f.phone&&rdPhone(f.phone.v))o.phone=rdPhone(f.phone.v);
  set('email',f.email?f.email.v.toLowerCase():'');set('head',f.head?rdFio(f.head.v):'');
  set('regDate',rdDate(f.firstReg&&f.firstReg.v));
  const re=rdDate(f.reReg&&f.reReg.v)||(f.regKind&&/перерегистр/i.test(f.regKind.v)?rdDate(f.orderDate&&f.orderDate.v):'');set('reRegDate',re);
  if(f.foundersAll&&/\d/.test(f.foundersAll.v))o.founders=parseInt(f.foundersAll.v,10);
  if(f.foreign)o.foreign=/^(да|есть|имеется)/i.test(f.foreign.v.trim())?'yes':/^(нет|отсутств)/i.test(f.foreign.v.trim())?'no':undefined;if(o.foreign===undefined)delete o.foreign;
  const codes=[f.gked&&f.gked.v,...d.more.filter(x=>/^\d{2}\.\d/.test(x))].filter(Boolean);if(codes.length||f.actMain)o.gk={codes,text:f.actMain?f.actMain.v:''};
  o.ugns=rdUgns(f,o.addr);
  const st=(f.status&&f.status.v)||'';o.stopped=!!(f.stop&&rdDate(f.stop.v))||/прекращ|ликвид|исключ/i.test(st);o.status=st;
  o.ip=/индивидуальн\S* предпринимател/i.test(d.text||'')&&!f.nameRu;o.branch=/^(филиал|представительств)/i.test(f.nameRu?f.nameRu.v.trim():'');
  return o}
/* Итог по документам: значения формы, источник у каждого поля, расхождения и ошибки.
   Расхождение: верх берёт документ с более поздней датой выдачи, второе значение показывается с датой */
const RD_KEYS=['name','full','inn','regNo','okpo','form','addr','phone','email','head','regDate','reRegDate','founders','foreign'];
function rdToCp(docs){const ok=docs.filter(d=>d.kind);const res={v:{},src:{},alt:{},gk:null,ugns:'',stopped:false,err:'',docs:ok};
  if(!ok.length){res.err='none';return res}
  const F=ok.map(d=>({d,o:rdCpFields(d)}));
  if(F.some(x=>x.o.ip||x.o.branch)){res.err='ip';return res}
  const inns=[...new Set(F.map(x=>x.o.inn).filter(Boolean))];if(inns.length>1){res.err='diff';return res}
  const ord=[...F].sort((a,b)=>(b.d.issued||'').localeCompare(a.d.issued||'')||(a.d.kind==='vyp'?-1:1));
  RD_KEYS.forEach(k=>{const has=ord.filter(x=>x.o[k]!=null&&x.o[k]!=='');if(!has.length)return;
    // адрес: из выписки (по частям), свидетельство — если выписки нет
    let top=has[0];if(k==='addr'){top=has.find(x=>x.d.kind==='vyp')||top}
    res.v[k]=top.o[k];const same=has.filter(x=>rdCmp(JSON.stringify(x.o[k]))===rdCmp(JSON.stringify(top.o[k])));
    res.src[k]=same.length>1?'both':top.d.kind;
    const other=k==='addr'?null:has.find(x=>rdCmp(JSON.stringify(x.o[k]))!==rdCmp(JSON.stringify(top.o[k])));
    if(other)res.alt[k]=[{v:top.o[k],src:top.d.kind,date:top.d.issued},{v:other.o[k],src:other.d.kind,date:other.d.issued}]});
  if(!res.v.phone&&ord.some(x=>x.o.phoneRaw))res.phoneBad=ord.find(x=>x.o.phoneRaw).o.phoneRaw;
  const g=ord.find(x=>x.o.gk&&x.o.gk.codes.length)||ord.find(x=>x.o.gk);
  if(g){const codes=g.o.gk.codes;const main=rdGked(codes[0],g.o.gk.text);
    res.gk=Object.assign(main,{src:g.d.kind,more:codes.slice(1).map(c=>rdGked(c).code).filter(c=>c&&c!==main.code)})}
  const u=ord.find(x=>x.o.ugns);if(u){res.ugns=u.o.ugns}
  res.stopped=F.some(x=>x.o.stopped);res.status=(F.find(x=>x.o.status)||{o:{}}).o.status||'';
  return res}
