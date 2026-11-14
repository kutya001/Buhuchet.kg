'use strict';
// «Моя организация» → «Настройки» → блок «Telegram-уведомления» (пакет 14.11.2026, блок 3; поток Т, этап 1).
// Все автоматические сообщения Telegram — одним списком: у каждой строки что за сообщение, кому, включено ли,
// в какие дни, во сколько по Бишкеку и как часто. Сюда переехали и со старых мест убраны: «Напоминания
// в Telegram» (повтор при просрочке, час сводки), «Действия из Telegram», «Общий чат фирмы в Telegram» и
// «Telegram контрагентов» — работают как раньше. Меняет только владелец, сразу, без «Сохранить»,
// с записью в историю организации. Блок виден при включённой функции «Напоминания в Telegram».
// Строку рисует tgnRow — ею же поток К строит строки «К оплате» и «Оплата за обслуживание» (cp-telegram.js).

const TGN_TO={staff:['Сотрудникам','blue','users'],cp:['Контрагентам','purple','user'],group:['В общий чат','green','chat']};
const TGN_WD=['понедельник','вторник','среда','четверг','пятница','суббота','воскресенье'];
const TGN_WD_PL=['по понедельникам','по вторникам','по средам','по четвергам','по пятницам','по субботам','по воскресеньям'];
// Час напоминаний: в этот час каждый день уходят напоминания о сроках, недельная сводка (в свой день) и сводка
// дня в общий чат — один час на всё, как в продукте (бывшее поле «Еженедельная сводка, понедельник»)
const tgnAt=()=>ORG.digest||'09:00';
// День недельной сводки: 1 — понедельник … 7 — воскресенье; по умолчанию понедельник, как было
const tgnWeekDay=()=>ORG.tgWeekDay>=1&&ORG.tgWeekDay<=7?ORG.tgWeekDay:1;
const tgnOwn=()=>me().role==='owner';

// Строка блока: o = {id, title, to: 'staff'|'cp'|'group', on: true|false (нет — без переключателя, всегда работает),
// hint, days, at, often, set: элементы настройки строки, dis: переключатель только для просмотра, why: почему}
function tgnRow(o){const[toT,toC,toI]=TGN_TO[o.to],sw=o.on===undefined?`<span class="tgn-ic" aria-hidden="true">${ic(o.icon||'bell')}</span>`
  :`<input type="checkbox" class="sw" data-tgn-sw="${o.id}" ${o.on?'checked':''} ${o.dis?'disabled':''} aria-label="${esc(o.title)}" ${o.why?`title="${esc(o.why)}"`:''}>`;
  const kv=(k,v)=>`<div><span class="k">${k}</span><span class="v">${v.charAt(0).toUpperCase()+v.slice(1)}</span></div>`;
  return `<div class="tgn-row ${o.on===false?'off':''}" data-tgn="${o.id}"><div class="tgn-top">${sw}<div class="grow"><div class="tgn-t"><b>${esc(o.title)}</b>${pill(toT,{[toT]:[toC,toI]},'sm')}${o.on===false?pill('Выключено',{},'sm faint'):''}</div>${o.hint?`<div class="hint">${o.hint}</div>`:''}</div></div>
    <div class="kv tgn-kv">${kv('Дни',o.days||'—')}${kv('Время, Бишкек',o.at||'—')}${kv('Как часто',o.often||'—')}</div>${o.set?`<div class="tgn-set">${o.set}</div>`:''}</div>`}

function tgnHtml(){if(!feat('telegram'))return `<div class="box" id="org-tgn"><h3>Telegram-уведомления</h3><div class="note">${ic('info')}<span>Напоминания в Telegram отключены в учётной политике.</span></div></div>`;
  const own=tgnOwn(),dis=own?'':'disabled',at=tgnAt(),wd=tgnWeekDay(),rd=ORG.remind.length?`за ${ORG.remind.join(', ')} ${plural(ORG.remind[ORG.remind.length-1],'день','дня','дней')} до срока и в день срока`:'в день срока';
  const rows=[
    tgnRow({id:'remind',title:'Напоминания сотрудникам о сроках',to:'staff',icon:'bell',
      hint:'Ответственному за контрагента — о сроках сдачи и оплаты отчётов, о задачах и сдачах, которые ждут подтверждения. Все напоминания одному человеку за день — одним сообщением. Что получать, каждый выбирает сам в «Мой профиль».',
      days:rd,
      at,often:'Каждый день, когда есть что напомнить',
      set:`<label class="check-row"><input type="checkbox" class="sw" id="st-rep" ${ORG.overdueRepeat?'checked':''} ${dis}><span class="grow">Повторять при просрочке каждый день<div class="hint">Ответственному, главному бухгалтеру и владельцу — пока отчёт не сдан</div></span></label>
        <div class="fld" data-f="tgn-at"><label for="tgn-at">Час напоминаний</label><input class="inp" id="tgn-at" type="time" value="${esc(at)}" ${dis}><div class="hint">В этот час уходят и недельная сводка, и сводка дня в общий чат</div><div class="err" hidden></div></div>
        <span class="hint tgn-links">${ic('calendar','sm')}<span>Дни напоминаний до срока — <button type="button" class="linkbtn" data-tgn-go="policy">в учётной политике</button>; у отдельного вида отчёта — <button type="button" class="linkbtn" data-tgn-go="types">в «Справочники → Виды отчётов»</button></span></span>`}),
    tgnRow({id:'week',title:'Недельная сводка',to:'staff',icon:'calendar',
      hint:'Сотрудникам — что сдать и оплатить на неделе. Владельцу и главному бухгалтеру — ещё таблица по сотрудникам с кнопками «Напомнить» и долги контрагентов за обслуживание.',
      days:TGN_WD_PL[wd-1],at:`${at}, в час напоминаний`,often:'Раз в неделю',
      set:fld('День сводки',sel('tgn-wd',TGN_WD.map((d,i)=>[i+1,d[0].toUpperCase()+d.slice(1)]),wd,dis),{id:'tgn-wd'})}),
    tgnRow({id:'actions',title:'Действия из Telegram',to:'staff',on:ORG.tgActions!==false,dis:!own,why:own?'':'Меняет только владелец организации',
      hint:`Сотрудники отмечают отчёты и задачи кнопками под сообщениями бота, не заходя на сайт. Каждое нажатие проверяется по правам и области сотрудника и пишется в историю с пометкой «через Telegram». Деньги и удаление — только на сайте.${own?' Выключите, если действия должны быть только на сайте: кнопки «Открыть» и копирование останутся.':''}`,
      days:'—',at:'Сразу',often:'При нажатии кнопки'}),
    tgGrpRow(own),
    ...pgTgNoticeRows(own)].filter(Boolean);
  return `<div class="box" id="org-tgn"><h3>Telegram-уведомления</h3><span class="hint" style="margin-top:-4px">Все сообщения, которые бот присылает сам. Время — по Бишкеку. ${own?'Изменения сохраняются сразу и пишутся в историю организации.':'Меняет только владелец организации.'}</span>${rows.join('')}</div>`}

function tgnMount(body){const q=s=>body.querySelector(s),own=tgnOwn();if(!q('#org-tgn'))return;
  $$('[data-tgn-go]',body).forEach(b=>b.onclick=()=>{if(b.dataset.tgnGo==='types')return go('dicts','types');go('org','policy');setTimeout(()=>ckFlash('#rd-add'),320)});
  const rep=q('#st-rep');if(rep)rep.onchange=()=>{if(!own)return;ORG.overdueRepeat=rep.checked;log('org','settings',`Повторять напоминание при просрочке каждый день: ${rep.checked?'включено':'выключено'}`);toast(rep.checked?'Повтор при просрочке включён':'Повтор при просрочке выключен','tg')};
  // Пустое время не сохраняется молча: ошибка под полем, прежнее значение остаётся
  const at=q('#tgn-at');if(at)at.onchange=()=>{if(!own)return;const v=at.value,w=tgnAt();if(!setErr(body,'tgn-at',/^\d\d:\d\d$/.test(v)?'':'Укажите время')){at.value=w;return}if(v===w)return;
    ORG.digest=v;log('org','settings',`Час напоминаний: ${w} → ${v}`);renderPage();toast(`Напоминания будут приходить в ${v}`,'tg')};
  const wd=q('#tgn-wd');if(wd)wd.onchange=()=>{if(!own)return;const n=+wd.value,w=tgnWeekDay();if(n===w)return;ORG.tgWeekDay=n;
    log('org','settings',`Недельная сводка: ${TGN_WD[w-1]} → ${TGN_WD[n-1]}`);renderPage();toast(`Недельная сводка — ${TGN_WD_PL[n-1]}`,'tg')};
  // Поток Т (13.11.2026): «Действия из Telegram» — только владелец; выключено — на нажатие бот отвечает скрытым ответом «Действия из Telegram отключены»
  const ta=q('[data-tgn-sw="actions"]');if(ta)ta.onchange=()=>{if(!own)return;ORG.tgActions=ta.checked;log('org','settings',`Действия из Telegram: ${ta.checked?'включены':'выключены'}`);renderPage();toast(ta.checked?'Действия из Telegram включены':'Действия из Telegram выключены','tg')};
  tgGrpMount(body);
  pgTgNoticeMount(body)}
