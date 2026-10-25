'use strict';
// Модуль «Показатели контрагентов»: ввод из Excel — шаблон и загрузка заполненного шаблона
/* ═════════════ Показатели: ввод из Excel ═════════════ */
// Шаг 1 «Скачать шаблон»: строки — контрагенты, столбцы ИНН и название защищены, дальше «Показатель · ММ.ГГГГ» по ведущимся показателям.
// Шаг 2 «Загрузить заполненный шаблон»: контрагент — по ИНН, показатель и месяц — по заголовку столбца; пустая ячейка ничего не стирает.
const KIMP=DB.indicatorImports;
const KX_MAX_CP=1000,KX_MAX_M=24;
const kxHead=(i,m)=>`${i.name} · ${m.slice(5,7)}.${m.slice(0,4)}`;
const kxUnit=i=>`${i.unit||KTYPES[i.type].toLowerCase()}, ${KTYPES[i.type].toLowerCase()}`;
const kxRef=(r,c)=>xlCol(c)+(r+1);
const kxFileName=(from,to)=>`Показатели ${from===to?ymLabel(from):ymLabel(from)+' — '+ymLabel(to)}.xlsx`;
const kxCps=o=>{const q=norm(o.q||'').trim();return visCps(false,'kpi').filter(c=>c.kind!=='oneoff'&&(!o.resp||c.resp===o.resp)&&(!o.reg||c.regime===o.reg)&&(!q||norm(c.name).includes(q)||c.inn.includes(q))).sort((a,b)=>COLL.compare(a.name,b.name))};
// Состав шаблона: только контрагенты и столбцы, где показатель ведётся хотя бы у одного контрагента
function kxTpl(o){const ms=kMonths(o.from,o.to);const inds=kInds().filter(i=>o.inds.has(i.id));
  const cps=kxCps(o).filter(c=>inds.some(i=>ms.some(m=>kCanVal(i,c,m))));
  const cols=[];inds.forEach(i=>ms.forEach(m=>{if(cps.some(c=>kCanVal(i,c,m)))cols.push({i,m})}));
  const cell=(c,x)=>{if(!kCanVal(x.i,c,x.m))return {v:'',s:XL_ST.off,off:1};const v=kVal(c.id,x.i.id,x.m);const k=KMI[c.id+'|'+x.m];const chk=!!(v&&k&&k.status==='Проверено');return {v:v?v.v:'',s:chk?XL_ST.checked:XL_ST.input,chk}};
  const rows=cps.map(c=>[{v:c.inn,s:XL_ST.key},{v:c.name,s:XL_ST.key},...cols.map(x=>cell(c,x))]);
  return {ms,inds,cps,cols,rows}}
function kxTplBlob(t,o){const head=[{v:'ИНН',s:XL_ST.head},{v:'Контрагент',s:XL_ST.head},...t.cols.map(x=>({v:`${kxHead(x.i,x.m)} (${kxUnit(x.i)})`,s:XL_ST.head}))];
  const tips=[['Как заполнить шаблон'],[''],['Строки — контрагенты. Столбцы «ИНН» и «Контрагент» защищены: по ИНН система находит контрагента при загрузке.'],['Дальше — столбцы «Показатель · месяц.год». Вносите значения в белые ячейки.'],
    ['Серые ячейки — показатель у этого контрагента не ведётся: они защищены и при загрузке не принимаются.'],['Зелёные ячейки — значение уже проверено. Если его изменить, при загрузке система спросит подтверждение и месяц вернётся в «Заполнено».'],[''],
    ['Числа: можно с пробелами между тысячами или без них — 1 250 000 или 1250000; копейки — через запятую: 1 250,50; процент — числом без знака %: 12,5.'],['Пустая ячейка — «не заполнено» и при загрузке ничего не стирает. 0 — «внесено, равно нулю».'],
    ['Не меняйте заголовки столбцов: по ним определяются показатель и месяц.'],[''],['Показатели в шаблоне:'],...t.inds.map(i=>[`${i.name} — ${kxUnit(i)}${i.desc?'. '+i.desc:''}`])];
  return xlWrite([{name:'Показатели',rows:[head,...t.rows.map(r=>r.map(x=>({v:x.v,s:x.s})))],widths:[18,34,...t.cols.map(()=>20)],freeze:{x:2,y:1},protect:true},{name:'Подсказки',rows:tips.map(r=>[{v:r[0],s:XL_ST.wrap}]),widths:[110]}])}
// Разбор заполненного шаблона: новые, изменённые, без изменений, ошибки с адресом ячейки
function kxParse(rows){const res={nw:[],chg:[],same:0,errs:[],months:new Set()};const err=(r,c,why,cp,val)=>res.errs.push({row:r+1,col:xlCol(c),ref:kxRef(r,c),cp:cp?cp.name:'',val:val==null?'':String(val),why});
  const head=rows[0]||[];const ci=head.findIndex(h=>norm(String(h||'')).trim()==='инн');if(ci<0){err(0,0,'нет столбца «ИНН» в первой строке');return res}
  const cols=head.map((h,j)=>{if(j===ci||h==null||String(h).trim()==='')return null;const t=String(h).trim();if(norm(t)==='контрагент'||norm(t)==='название')return null;
    const mm=/^(.+?) · (\d{2})\.(\d{4})(?:\s*\(.*\))?$/.exec(t);const i=mm&&IND.find(x=>norm(x.name)===norm(mm[1].trim()));if(!i){err(0,j,'неизвестный показатель',null,t);return null}return {i,m:`${mm[3]}-${mm[2]}`}});
  const seen=new Set();
  rows.slice(1).forEach((r,k)=>{const ri=k+1;if(!r||r.every(v=>v==null||String(v).trim()===''))return;let inn=String(r[ci]==null?'':r[ci]).trim().replace(/\s/g,'');if(/^\d{13}$/.test(inn))inn='0'+inn;
    const c=CPS.find(x=>x.inn===inn);if(!c){err(ri,ci,'неизвестный контрагент',null,inn);return}
    if(!visCps(true,'kpi').includes(c)||!kCanEdit(c)){err(ri,ci,'нет доступа к контрагенту',c,inn);return}
    cols.forEach((x,j)=>{if(!x)return;const raw=r[j];if(raw==null||String(raw).trim()==='')return;
      if(x.i.archived)return err(ri,j,'показатель в архиве',c,raw);if(!kCanVal(x.i,c,x.m))return err(ri,j,'показатель не ведётся у контрагента',c,raw);
      const v=typeof raw==='number'?kParse(x.i,String(raw).replace('.',',')):kParse(x.i,raw);if(v==null||Number.isNaN(v))return err(ri,j,'не число',c,raw);
      const key=c.id+'|'+x.i.id+'|'+x.m;if(seen.has(key))return;seen.add(key);res.months.add(x.m);
      const o=kVal(c.id,x.i.id,x.m);const k=KMI[c.id+'|'+x.m];const it={c,i:x.i,m:x.m,v,old:o?o.v:null,chk:!!(o&&k&&k.status==='Проверено'),ref:kxRef(ri,j),row:ri+1};
      if(!o)res.nw.push(it);else if(o.v===v)res.same++;else res.chg.push(it)})});
  // Строка с ошибкой не записывается целиком: её значения уходят в «Пропущено из-за ошибок в строке»
  const bad=new Set(res.errs.map(e=>e.row));res.skipped=[...res.nw,...res.chg].filter(x=>bad.has(x.row)).length;res.nw=res.nw.filter(x=>!bad.has(x.row));res.chg=res.chg.filter(x=>!bad.has(x.row));
  return res}
function kxErrBlob(res){return xlWrite([{name:'Ошибки',rows:[['Ячейка','Строка','Столбец','Контрагент','Значение','Причина'].map(v=>({v,s:XL_ST.head})),...res.errs.map(e=>[e.ref,e.row,e.col,e.cp,e.val,e.why])],widths:[10,9,9,34,20,40]}])}
function kxApply(res,withChk,file){const its=[...res.nw,...res.chg.filter(x=>withChk||!x.chk)];let n=0,c=0;
  its.forEach(x=>{if(kSet(x.c,x.i,x.m,x.v,null,null,'xlsx'))x.old==null?n++:c++});const ms=[...res.months].sort();
  const rec={id:'ki'+(KIMP.length+1),at:nowStamp(),by:S.me,file,from:ms[0]||'',to:ms[ms.length-1]||'',nNew:n,nChg:c,nErr:res.errs.length,nSkip:withChk?0:res.chg.filter(x=>x.chk).length};KIMP.push(rec);
  HIST.push({at:nowStamp(),who:S.me,ent:'kimp',id:rec.id,what:`Ввод показателей из Excel «${file}»: новых ${n}, изменённых ${c}, ошибок ${res.errs.length}`});
  res.done=rec;refreshAll();toast(`Записано значений: ${n+c}${res.errs.length?`, ошибок осталось: ${res.errs.length}`:''}`,'upload');return rec}
const kxPeriod=r=>!r.from?'—':r.from===r.to?ymLabel(r.from):`${ymLabel(r.from)} — ${ymLabel(r.to)}`;
function kxHistHtml(){const hs=KIMP.slice().reverse();if(!hs.length)return `<div class="state">${ic('history','lg')}<b>Загрузок ещё не было</b><span>Здесь будет видно, кто, когда и какой файл загружал.</span></div>`;
  return `<div class="tbl-wrap"><table class="mini m-cards"><thead><tr><th>Когда</th><th>Кто</th><th>Файл</th><th>Период</th><th class="num">Новых</th><th class="num">Изменённых</th><th class="num">Ошибок</th></tr></thead><tbody>${hs.map(r=>`<tr><td class="tnum">${fmtDT(r.at)}</td><td>${esc(whoName(r.by))}</td><td>${ic('file','sm')} ${esc(r.file)}</td><td>${esc(kxPeriod(r))}</td><td class="num">${r.nNew}</td><td class="num">${r.nChg}${r.nSkip?` <small class="faint">пропущено проверенных: ${r.nSkip}</small>`:''}</td><td class="num ${r.nErr?'red strong':''}">${r.nErr}</td></tr>`).join('')}</tbody></table></div>`}
function kxDlg(step){if(!can('kpiImport'))return toast('Нет права «Вводить показатели из Excel»','alert',true);ckHit('kxls');
  const last=kPrev();const st={step:step||'tpl',o:{from:last,to:last,resp:'',reg:'',q:'',inds:new Set(kInds().map(i=>i.id))},res:null,file:'',busy:false,hist:false};
  let mm;const mount=el=>{const q=s=>el.querySelector(s);const o=st.o;
      $$('[data-kxs]',el).forEach(b=>b.onclick=()=>{st.step=b.dataset.kxs;mm.draw()});
      if(q('#kx-hist'))q('#kx-hist').onclick=()=>{st.hist=true;mm.draw()};if(q('#kx-back'))q('#kx-back').onclick=()=>{st.hist=false;mm.draw()};
      if(st.step==='tpl'&&!st.hist){const per=()=>{let a=val(el,'kx-f'),b=val(el,'kx-t');if(!a||!b)return;if(a>b)[a,b]=[b,a];o.from=a;o.to=b;mm.draw()};q('#kx-f').onchange=per;q('#kx-t').onchange=per;
        q('#kx-resp').onchange=()=>{o.resp=val(el,'kx-resp');mm.draw()};q('#kx-reg').onchange=()=>{o.reg=val(el,'kx-reg');mm.draw()};
        q('#kx-q').oninput=()=>{o.q=val(el,'kx-q');mm.draw();const n=el.querySelector('#kx-q');n.focus();n.setSelectionRange(n.value.length,n.value.length)};
        $$('[data-kxi]',el).forEach(x=>x.onchange=()=>{x.checked?o.inds.add(x.dataset.kxi):o.inds.delete(x.dataset.kxi);mm.draw()});
        const dl=q('#kx-dl');if(dl)dl.onclick=()=>{const t=kxTpl(o);const nm=kxFileName(o.from,o.to);xlSave(kxTplBlob(t,o),nm);log('kimp',0,`Скачан шаблон «${nm}»: контрагентов ${t.cps.length}, столбцов ${t.cols.length}`);toast(`Шаблон «${nm}» скачан. Заполните и загрузите его на шаге 2`,'download');st.step='load';mm.draw()}}
      if(st.step==='load'&&!st.hist){const read=async f=>{if(!f)return;st.busy=true;st.err='';mm.draw();try{const rows=await xlRead(f);st.res=kxParse(rows);st.file=f.name}catch(e){st.err=`Не удалось прочитать «${f.name}»: ${e.message||e}`}st.busy=false;mm.draw()};
        const fi=q('#kx-file');if(fi)fi.onchange=e=>read(e.target.files[0]);const dz=q('#kx-drop');
        if(dz){dz.ondragover=e=>{e.preventDefault();dz.classList.add('over')};dz.ondragleave=()=>dz.classList.remove('over');dz.ondrop=e=>{e.preventDefault();dz.classList.remove('over');read(e.dataTransfer.files[0])}}
        if(q('#kx-again'))q('#kx-again').onclick=()=>{st.res=null;st.file='';mm.draw()};
        if(q('#kx-errdl'))q('#kx-errdl').onclick=()=>{const nm='Ошибки загрузки показателей.xlsx';xlSave(kxErrBlob(st.res),nm);toast(`Файл «${nm}» скачан`,'download')};
        const ok=q('#kx-ok');if(ok)ok.onclick=()=>{const r=st.res;const ck=r.chg.filter(x=>x.chk).length;const go=w=>{kxApply(r,w,st.file);mm.draw()};
          if(!ck)return go(true);
          openModal({render:m2=>({title:`Изменить ${ck} ${plural(ck,'проверенное значение','проверенных значения','проверенных значений')}?`,body:`<p style="margin:0">Месяцы вернутся в «Заполнено» и потребуют повторной проверки. Можно применить файл без них — проверенные значения останутся как есть.</p>`,
            foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="kx-wo">Применить без них</button><button class="btn cta" id="kx-w">Изменить ${ck}</button>`,mount(e2){$('#kx-wo',e2).onclick=()=>{m2.close();go(false)};$('#kx-w',e2).onclick=()=>{m2.close();go(true)}}})})}}};
  openModal({size:'wide',live:true,render:m0=>{mm=m0;const o=st.o;let body='',foot='';
    const steps=`<div class="seg kx-steps" role="tablist"><button data-kxs="tpl" class="${st.step==='tpl'?'on':''}">1. Скачать шаблон</button><button data-kxs="load" class="${st.step==='load'?'on':''}">2. Загрузить заполненный шаблон</button></div>`;
    if(st.hist){body=kxHistHtml();foot=`<button class="btn ghost" id="kx-back">${ic('left','sm')}Назад</button><div class="grow"></div><button class="btn cta" data-close>Готово</button>`;return {title:'История загрузок',sub:'Ввод показателей из Excel',body,foot,mount}}
    if(st.step==='tpl'){const ms=kMonths(o.from,o.to);const t=kxTpl(o);const tooM=ms.length>KX_MAX_M,tooC=t.cps.length>KX_MAX_CP;const regs=[...new Set(visCps(false,'kpi').map(c=>c.regime).filter(Boolean))].sort();const rs=[...new Set(visCps(false,'kpi').map(c=>c.resp).filter(Boolean))];
      body=`${steps}<div class="form">${fld('С месяца',`<input type="month" class="inp" id="kx-f" value="${o.from}" max="${ym(TODAY)}">`,{id:'kx-f'})}${fld('По месяц',`<input type="month" class="inp" id="kx-t" value="${o.to}" max="${ym(TODAY)}">`,{id:'kx-t',hint:'По умолчанию — прошлый месяц; до 24 месяцев в одном шаблоне'})}
        ${fld('Ответственный',sel('kx-resp',[['','Все'],...rs.map(r=>[r,empName(r)])],o.resp),{id:'kx-resp'})}${fld('Режим',sel('kx-reg',[['','Все режимы'],...regs.map(r=>[r,r])],o.reg),{id:'kx-reg'})}
        ${fld('Контрагент',`<input class="inp" type="search" id="kx-q" value="${esc(o.q)}" placeholder="Название или ИНН">`,{id:'kx-q',full:true})}
        <div class="fld full"><span class="lbl">Показатели</span><div class="kx-inds">${kInds().map(i=>`<label class="kx-chip ${o.inds.has(i.id)?'on':''}"><input type="checkbox" data-kxi="${i.id}" ${o.inds.has(i.id)?'checked':''}>${esc(i.name)}</label>`).join('')||'<span class="faint">Показателей нет</span>'}</div></div></div>
        ${tooM?`<div class="note warn">${ic('alert')}<span>В одном шаблоне — не больше ${KX_MAX_M} месяцев. Сократите период.</span></div>`:tooC?`<div class="note warn">${ic('alert')}<span>В одном шаблоне — не больше ${KX_MAX_CP} контрагентов. Сузьте фильтр.</span></div>`:''}
        <div class="note">${ic('info')}<span>В шаблоне ${t.cps.length} ${plural(t.cps.length,'контрагент','контрагента','контрагентов')} и ${t.cols.length} ${plural(t.cols.length,'столбец','столбца','столбцов')} показателей. Столбцы ИНН и «Контрагент» защищены, внесённые значения подставлены, <span class="kx-chk-s">проверенные</span> выделены зелёным, <span class="kx-off-s">невключённые</span> — серые и защищены. Второй лист — «Подсказки».</span></div>
        ${t.cps.length&&t.cols.length?`<div class="sec-h">Предпросмотр листа «Показатели»${t.cps.length>8?` · первые 8 строк из ${t.cps.length}`:''}</div><div class="tbl-wrap kx-prev"><table class="mini kx-t"><thead><tr><th class="kx-n">#</th><th>A · ИНН</th><th>B · Контрагент</th>${t.cols.map((x,j)=>`<th>${xlCol(j+2)} · ${esc(kxHead(x.i,x.m))}<small>${esc(kxUnit(x.i))}</small></th>`).join('')}</tr></thead><tbody>${t.rows.slice(0,8).map((r,k)=>`<tr><td class="kx-n">${k+2}</td>${r.map((x,j)=>`<td class="${j<2?'kx-key mono':x.off?'kx-off':x.chk?'kx-chk num':'num'}">${j<2?esc(x.v):x.off?'':x.v===''?'':esc(kNum(t.cols[j-2].i,x.v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:`<div class="state">${ic('gauge','lg')}<b>Нет данных для шаблона</b><span>За выбранный период и фильтр показатели не ведутся.</span></div>`}`;
      foot=`<button class="btn ghost" id="kx-hist">${ic('history','sm')}История загрузок</button><div class="grow"></div><button class="btn ghost" data-close>Закрыть</button><button class="btn cta" id="kx-dl" ${tooM||tooC||!t.cps.length||!t.cols.length?'disabled':''}>${ic('download','sm')}Скачать шаблон .xlsx</button>`}
    else{const r=st.res;
      body=`${steps}${!r?`<label class="kx-drop" id="kx-drop"><input type="file" id="kx-file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden>${ic('upload','lg')}<b>${st.busy?'Читаем файл…':'Выберите заполненный шаблон или перетащите его сюда'}</b><span>Файл .xlsx из шага 1 (подойдёт и CSV с теми же столбцами). Контрагент ищется по ИНН, показатель и месяц — по заголовку столбца.</span></label>
        ${st.err?`<div class="note warn">${ic('alert')}<span>${esc(st.err)}</span></div>`:''}`
        :`<div class="row"><span>${ic('file','sm')} <b>${esc(st.file)}</b></span><div class="grow"></div>${r.done?'':`<button class="btn sm ghost" id="kx-again">${ic('refresh','sm')}Другой файл</button>`}</div>
        ${r.done?`<div class="note ok">${ic('check')}<span>Записано: новых ${r.done.nNew}, изменённых ${r.done.nChg}${r.done.nSkip?`, проверенных пропущено: ${r.done.nSkip}`:''}. Статусы месяцев пересчитаны. ${r.errs.length?'Строки с ошибками не записаны — исправьте их в файле и загрузите снова.':''}</span></div>`:''}
        <div class="plates static">${plate({id:'kxn',icon:'plus',color:'blue',label:'Новые',value:r.nw.length,sub:'было пусто'})}${plate({id:'kxc',icon:'edit',color:'orange',label:'Изменённые',value:r.chg.length,sub:r.chg.some(x=>x.chk)?`из них проверенных: ${r.chg.filter(x=>x.chk).length}`:'было → стало'})}${plate({id:'kxs',icon:'ok',color:'gray',label:'Без изменений',value:r.same,sub:'совпадают с внесёнными'})}${plate({id:'kxe',icon:'alert',color:r.errs.length?'red':'green',label:'Ошибки',value:r.errs.length,sub:r.errs.length?`строки с ошибками не записываются${r.skipped?`, пропущено значений: ${r.skipped}`:''}`:'ошибок нет'})}</div>
        ${r.errs.length?`<div class="box"><h3>Ошибки<span class="grow"></span><button class="btn sm" id="kx-errdl">${ic('download','sm')}Скачать ошибки</button></h3><div class="tbl-wrap" style="max-height:240px"><table class="mini m-cards"><thead><tr><th>Ячейка</th><th>Строка</th><th>Столбец</th><th>Контрагент</th><th>Значение</th><th>Причина</th></tr></thead><tbody>${r.errs.map(e=>`<tr><td class="mono strong">${e.ref}</td><td class="num">${e.row}</td><td>${e.col}</td><td>${esc(e.cp||'—')}</td><td class="mono">${esc(e.val)}</td><td class="red">${esc(e.why)}</td></tr>`).join('')}</tbody></table></div></div>`:''}
        ${r.chg.length?`<div class="box"><h3>Изменённые · ${r.chg.length}</h3><div class="tbl-wrap" style="max-height:240px"><table class="mini m-cards"><thead><tr><th>Ячейка</th><th>Контрагент</th><th>Показатель</th><th>Месяц</th><th class="num">Было</th><th class="num">Стало</th><th></th></tr></thead><tbody>${r.chg.map(x=>`<tr><td class="mono">${x.ref}</td><td>${esc(x.c.name)}</td><td>${esc(x.i.name)}</td><td>${esc(ymLabel(x.m))}</td><td class="num faint">${esc(kNum(x.i,x.old))}</td><td class="num strong">${esc(kNum(x.i,x.v))}</td><td>${x.chk?'<span class="pill green sm">проверено</span>':''}</td></tr>`).join('')}</tbody></table></div></div>`:''}
        ${r.nw.length?`<div class="box"><h3>Новые · ${r.nw.length}</h3><div class="tbl-wrap" style="max-height:240px"><table class="mini m-cards"><thead><tr><th>Ячейка</th><th>Контрагент</th><th>Показатель</th><th>Месяц</th><th class="num">Значение</th></tr></thead><tbody>${r.nw.map(x=>`<tr><td class="mono">${x.ref}</td><td>${esc(x.c.name)}</td><td>${esc(x.i.name)}</td><td>${esc(ymLabel(x.m))}</td><td class="num strong">${esc(kFmt(x.i,x.v))}</td></tr>`).join('')}</tbody></table></div></div>`:''}`}`;
      const n=r&&!r.done?r.nw.length+r.chg.length:0;
      foot=`<button class="btn ghost" id="kx-hist">${ic('history','sm')}История загрузок</button><div class="grow"></div><button class="btn ghost" data-close>${r&&r.done?'Готово':'Закрыть'}</button>${r&&!r.done?`<button class="btn cta" id="kx-ok" ${n?'':'disabled'}>${ic('check','sm')}Применить${n?' '+n:''}</button>`:''}`}
    return {title:'Ввод из Excel',sub:'Показатели контрагентов: шаблон и загрузка заполненного шаблона',body,foot,mount}}})}
