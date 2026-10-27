'use strict';
// Общие утилиты: $, esc, store (localStorage), случайные числа, даты по времени Бишкека
/* ═════════════ Utils ═════════════ */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MEMSTORE={};const ukey=k=>/^(g5|stats)\./.test(k)&&typeof S!=='undefined'&&S.me?k.replace('.','.'+S.me+'.'):k;const store={get(k,d){k=ukey(k);if(k in MEMSTORE)return MEMSTORE[k];try{const v=localStorage.getItem('bu.'+k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){k=ukey(k);MEMSTORE[k]=v;try{localStorage.setItem('bu.'+k,JSON.stringify(v))}catch(e){}}};
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const R=mulberry(20261011);
const pick=a=>a[Math.floor(R()*a.length)];
const rint=(a,b)=>a+Math.floor(R()*(b-a+1));
const isMobile=()=>matchMedia('(max-width: 767px)').matches;
const plural=(n,a,b,c)=>{const m=Math.abs(n)%100,k=m%10;return m>10&&m<20?c:k>1&&k<5?b:k===1?a:c};

/* Dates — everything in Bishkek time (UTC+6) */
function bishkekNow(){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bishkek',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const g=t=>(p.find(x=>x.type===t)||{}).value;
  return {iso:`${g('year')}-${g('month')}-${g('day')}`,hm:`${g('hour')}:${g('minute')}`};
}
let TODAY=bishkekNow().iso;

// Латинское имя для адресов страниц по названию: «ОсОО «Бухгалтер Плюс»» → buhgalter-plyus (форма собственности и кавычки отбрасываются); slugFree — первое свободное: name, name-2, name-3…
const TRL={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',ң:'ng',о:'o',ө:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ү:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const slugOf=s=>String(s||'').toLowerCase().replace(/^\s*(осоо|оао|зао|ао|оо|ип|гп|мп|чп|ф\/х|кх|оф)\s+/,'').replace(/[«»"'“”„]/g,'').replace(/[а-яёңөү]/g,c=>TRL[c]??'').replace(/[^a-z0-9]+/g,'-').replace(/^-+/,'').slice(0,30).replace(/-+$/,'');
// Занятые слова: служебные адреса сайта; slugFree их не предлагает (расхождение продукта п. 19, 27.10.2026)
const SLUG_BUSY=['api','admin','login','logout','auth','signup','register','reset','password','test','www','inn','app','help','support','docs','static','assets','files','mail','status','staging','dev','demo','buhuchet'],SLUG_BUSY_T='Этот адрес занят, выберите другой';
const slugFree=(base,taken)=>{let b=base.length>=3?base:(base?base+'-org':'org').slice(0,30),s=b,i=2;while(taken.includes(s)||SLUG_BUSY.includes(s)){const t='-'+i++;s=b.slice(0,30-t.length).replace(/-+$/,'')+t}return s};
// Временный пароль вида Bh-7K4M-Q9TX: заглавные латинские буквы и цифры без похожих 0/O и 1/I/L (расхождение продукта п. 17, 27.10.2026)
const TMP_ABC='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const tmpPass=()=>{const a=new Uint32Array(8);crypto.getRandomValues(a);const t=[...a].map(x=>TMP_ABC[x%TMP_ABC.length]).join('');return `Bh-${t.slice(0,4)}-${t.slice(4)}`};
