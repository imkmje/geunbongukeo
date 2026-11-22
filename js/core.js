"use strict";
/* 근본국어 공통: 채점·분석·차트·카드 (교사·학생 화면이 함께 씀) */
/* ---------- 기본 상수 ---------- */
const CIR=['·','①','②','③','④','⑤'];
const AREAS=['화법','작문','언어','매체','독서','문학','기타'];
const AREA_COLOR={'독서':'var(--s1)','문학':'var(--s2)','언어':'var(--s3)','화법':'var(--s4)','작문':'var(--s5)','매체':'var(--s6)','화법과 작문':'var(--s4)','언어와 매체':'var(--s3)','기타':'var(--muted)'};
const TYPES={
 '독서':['세부 정보 확인','핵심 개념 이해','추론','<보기> 적용','어휘·문맥'],
 '문학':['표현상 특징','내용 이해','<보기> 감상','작품 비교','시어·소재 기능'],
 '화법':['말하기 전략','듣기·반응','자료 활용','토의·토론'],
 '작문':['글쓰기 계획','자료 활용','고쳐쓰기','조건에 맞게 쓰기'],
 '언어':['음운','단어·형태소','문장·문법 요소','국어사','담화·국어 생활'],
 '매체':['매체 표현','매체 자료 읽기'],
 '화법과 작문':['말하기 전략','듣기·반응','글쓰기 계획','자료 활용','고쳐쓰기'],
 '언어와 매체':['음운','단어·형태소','문장·문법 요소','국어사·담화','매체 표현'],
 '기타':[]
};
const ELEC={'화작':'화법과 작문','언매':'언어와 매체'};


/* ---------- 유틸 ---------- */
const $=(s,el=document)=>el.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>v==null||isNaN(v)?'–':Math.round(v*100)+'%';
const pp=v=>v==null||isNaN(v)?'–':(v>0?'+':'')+Math.round(v*100);
const normName=s=>String(s||'').trim().replace(/\s+/g,' ');
function fnv(s){let h=0x811c9dc5;for(const ch of new TextEncoder().encode(s)){h^=ch;h=Math.imul(h,0x01000193)>>>0}return h.toString(16).padStart(8,'0')}
function b64u(str){const b=new TextEncoder().encode(str);let bin='';b.forEach(x=>bin+=String.fromCharCode(x));return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function unb64u(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);return new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0)))}
let toastT;function toast(m){let t=$('.toast');if(!t){t=document.createElement('div');t.className='toast';t.setAttribute('role','status');document.body.appendChild(t)}t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,2600)}
async function copy(text,el){try{await navigator.clipboard.writeText(text);toast('복사했습니다')}catch(e){if(el){el.focus();el.select?.()}toast('자동 복사가 막혀 있습니다. 선택된 글을 직접 복사해 주세요')}}
function lsGet(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}

const ERR=['사실 불일치','과잉 추론','관계 왜곡','부분 오류','대상 혼동','개념 오적용','표현 오판'];
const ERR_DESC={'사실 불일치':'지문 내용과 다르게 말한 선지','과잉 추론':'지문에 없는 내용을 끌어온 선지','관계 왜곡':'원인·결과, 순서, 대조 같은 관계를 뒤바꾼 선지','부분 오류':'대부분 맞고 일부만 틀린 선지','대상 혼동':'다른 인물·개념·문단의 내용을 섞은 선지','개념 오적용':'<보기>나 개념을 잘못 적용한 선지','표현 오판':'표현 방식이나 서술상 특징을 잘못 짚은 선지'};
const ERR_TIP={'사실 불일치':'선지의 핵심어를 지문에서 찾아 한 단어씩 대조하는 연습을 해 봅시다.','과잉 추론':'선지 내용이 지문에 실제로 쓰여 있는지 먼저 확인하고, 그럴듯해도 근거가 없으면 지우는 연습을 해 봅시다.','관계 왜곡':'원인과 결과, 앞뒤 순서, 대조 관계를 지문에 화살표로 표시하며 읽어 봅시다.','부분 오류':'선지를 쉼표나 접속어 단위로 끊어 각 부분을 따로 확인해 봅시다.','대상 혼동':'선지의 주어(누가, 무엇이)를 먼저 확인하고 지문의 해당 문단으로 돌아가 봅시다.','개념 오적용':'<보기>나 개념의 조건을 먼저 정리한 뒤 선지에 하나씩 대입해 봅시다.','표현 오판':'선지의 표현 용어가 작품의 어느 구절에 해당하는지 찾아 표시해 봅시다.'};

/* ---------- 채점·분석 ---------- */
function applicable(t,el){return t.items.map((it,i)=>(!it.el||it.el===el)?i:-1).filter(i=>i>=0)}
function hasElectives(t){return t.items.some(it=>it.el)}
function grade(t,key,rec){
  const idx=applicable(t,rec.el);let score=0,max=0;const res={};
  for(const i of idx){const p=t.items[i].pts||2;max+=p;const ok=!!key[i]&&key[i]!=='0'&&rec.a[i]===key[i];res[i]=ok;if(ok)score+=p}
  return {score,max,pct:max?score/max:0,res,idx};
}
function analyze(t,key,recs){
  const N=t.items.length;
  const graded=recs.map(r=>({...r,...grade(t,key,r)}));
  const items=t.items.map((it,i)=>({i,no:it.no,area:it.area,type:it.type,ans:key[i]||'',n:0,c:0,cnt:[0,0,0,0,0,0]}));
  for(const g of graded)for(const i of g.idx){const ch=+(g.a[i]||0)||0;items[i].n++;items[i].cnt[ch]++;if(g.res[i])items[i].c++}
  // 상·하위 27% 집단으로 변별도
  const sorted=[...graded].sort((a,b)=>b.pct-a.pct);const k=Math.max(1,Math.round(sorted.length*.27));
  const up=sorted.slice(0,k),lo=sorted.slice(-k);
  for(const it of items){
    it.rate=it.n?it.c/it.n:null;it.dist=it.cnt.map(c=>it.n?c/it.n:0);
    let best=0,opt=0;for(let o=1;o<=5;o++){if(String(o)!==it.ans&&it.dist[o]>best){best=it.dist[o];opt=o}}it.lure={opt,share:best};
    const ru=rateIn(up,it.i),rl=rateIn(lo,it.i);it.disc=(graded.length>=6&&ru!=null&&rl!=null)?ru-rl:null;
  }
  function rateIn(g,i){const a=g.filter(x=>x.res[i]!==undefined);return a.length?a.filter(x=>x.res[i]).length/a.length:null}
  const agg=f=>{const m={};for(const it of items){if(!it.n)continue;const kk=f(it)||'(미지정)';m[kk]=m[kk]||{c:0,n:0};m[kk].c+=it.c;m[kk].n+=it.n}const o={};for(const kk in m)o[kk]=m[kk].c/m[kk].n;return o};
  const pcts=graded.map(g=>g.pct).sort((a,b)=>a-b);
  const scores=graded.map(g=>g.score);
  return {n:graded.length,graded,items,area:agg(it=>it.area),type:agg(it=>it.type),
    avgPct:pcts.length?pcts.reduce((a,b)=>a+b,0)/pcts.length:null,
    medPct:pcts.length?(pcts.length%2?pcts[(pcts.length-1)/2]:(pcts[pcts.length/2-1]+pcts[pcts.length/2])/2):null,
    avg:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null,
    hi:scores.length?Math.max(...scores):null, lo:scores.length?Math.min(...scores):null, N};
}
function toStats(an,nat){return {n:an.n,avgPct:an.avgPct,ir:an.items.map(it=>it.rate),dist:an.items.map(it=>it.dist.map(x=>Math.round(x*1000)/1000)),area:an.area,type:an.type,nat:nat||null,at:Date.now()}}
function classFromAn(an,nat){return {n:an.n,avgPct:an.avgPct,ir:an.items.map(it=>it.rate),dist:an.items.map(it=>it.dist),area:an.area,type:an.type,nat:nat||null}}
function report(t,key,rec,cls){
  const g=grade(t,key,rec);const nat=cls.nat||[];
  const rows=g.idx.map(i=>({i,no:t.items[i].no,area:t.items[i].area,type:t.items[i].type,mine:rec.a[i]||'0',ans:key[i],ok:g.res[i],rate:cls.ir[i],nr:nat[i]?.r??null,nsh:(rec.a[i]&&rec.a[i]!=='0')?(nat[i]?.d?.[+rec.a[i]-1]??null):null,csh:(rec.a[i]&&rec.a[i]!=='0')?(cls.dist?.[i]?.[+rec.a[i]]??null):null}));
  const wrong=rows.filter(r=>!r.ok);
  const ref=r=>r.nr!=null?r.nr:r.rate;
  const missedEasy=wrong.filter(r=>ref(r)!=null&&ref(r)>=.7);
  const hard=wrong.filter(r=>ref(r)!=null&&ref(r)<.4);
  // 드문 오답: 전국 응시자 5% 이하가 고른 선지(전국 자료가 없으면 반에서 혼자 고른 선지, 8명 이상일 때)
  const rare=wrong.filter(r=>r.mine!=='0'&&(r.nsh!=null?r.nsh<=.05:(r.csh!=null&&cls.n>=8&&r.csh*cls.n<=1.01))).map(r=>({...r,src:r.nsh!=null?'전국':'반',sh:r.nsh!=null?r.nsh:r.csh}));
  const by=f=>{const m={};for(const r of rows){const k=f(r)||'(미지정)';m[k]=m[k]||{c:0,n:0};m[k].n++;if(r.ok)m[k].c++}return Object.entries(m).map(([k,v])=>({name:k,me:v.c/v.n,n:v.n,cls:(f===fa?cls.area:cls.type)[k]??null}))};
  const fa=r=>r.area,ft=r=>r.type;
  const areaCmp=by(fa),typeCmp=by(ft);
  const weak=typeCmp.filter(x=>x.n>=2&&x.cls!=null&&x.me-x.cls<=-.2).sort((a,b)=>(a.me-a.cls)-(b.me-b.cls));
  const strong=areaCmp.filter(x=>x.cls!=null&&x.me-x.cls>=.12).sort((a,b)=>(b.me-b.cls)-(a.me-a.cls));
  const sm={};for(const x of rows){const nm=t.items[x.i].set;if(!nm)continue;sm[nm]=sm[nm]||{name:nm,n:0,w:0,nos:[]};sm[nm].n++;sm[nm].nos.push(x.no);if(!x.ok)sm[nm].w++}
  const sets=Object.values(sm).map(x=>({...x,state:x.w>=2&&x.w/x.n>=.5?'collapse':(x.w===1&&x.n>=2?'slip':(x.w?'part':'ok'))}));
  return {...g,rows,wrong,missedEasy,hard,rare,sets,areaCmp,typeCmp,weak,strong};
}
function feedbackText(name,t,r,cls){
  const L=[];const nm=name||'학생';
  L.push(`${nm} 학생, ${t.title} 결과입니다. ${r.score}/${r.max}점(반 평균 ${cls.avgPct!=null?Math.round(cls.avgPct*r.max):'–'}점 수준).`);
  if(r.missedEasy.length){
    L.push(`· 많은 학생이 맞힌 문항(정답률 70% 이상) 중 틀린 문항: ${r.missedEasy.map(x=>`${x.no}번(${x.type||x.area}, 내 답 ${(x.mine==='0'?'무응답':CIR[+x.mine])} → 정답 ${CIR[+x.ans]})`).join(', ')}.`);
    L.push('  아는 내용인데 놓쳤을 가능성이 큽니다. 선지를 고르기 전에 근거 문장을 지문에서 찾아 표시하는 습관을 점검해 봅시다.');
  }
  if(r.rare.length){
    L.push(`· 다른 응시자가 거의 고르지 않은 선지를 고른 문항: ${r.rare.map(x=>`${x.no}번(${CIR[+x.mine]}, ${x.src} ${x.src==='전국'?(Math.round(x.sh*1000)/10)+'%':'에서 혼자 선택'})`).join(', ')}.`);
    L.push('  함정에 걸린 오답이 아니라 읽기 단계에서 어긋났을 가능성이 큽니다. 발문(맞는 것/않은 것)을 거꾸로 읽었는지, 지문 내용을 잘못 이해했는지, 마킹 실수인지 하나씩 확인해 봅시다.');
  }
  const col=(r.sets||[]).filter(x=>x.state==='collapse'),sl=(r.sets||[]).filter(x=>x.state==='slip');
  if(col.length)L.push(`· 지문 하나를 통째로 놓친 세트: ${col.map(x=>`${x.name}(${x.n}문항 중 ${x.w}개 오답)`).join(', ')}. 선지보다 지문 이해 단계에서 막힌 것으로 보입니다. 문단마다 핵심을 한 줄로 적어 보는 연습을 해 봅시다.`);
  if(sl.length)L.push(`· 지문은 이해했지만 한 문항만 놓친 세트: ${sl.map(x=>x.name).join(', ')}. 선지를 지문과 하나씩 대조하는 단계를 점검해 봅시다.`);
  if(r.tagCum&&r.tagCum.length>=3){const c=tagCount(r.tagCum);const [top,cnt]=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];if(cnt/r.tagCum.length>=.35)L.push(`· 지금까지 고른 오답 ${r.tagCum.length}개 중 ${cnt}개가 '${top}' 선지였습니다${ERR_DESC[top]?'('+ERR_DESC[top]+')':''}. ${ERR_TIP[top]||'이 유형의 선지를 따로 모아 다시 풀어 봅시다.'}`)}
  if(r.weak.length)L.push(`· 반 평균보다 약한 유형: ${r.weak.slice(0,3).map(w=>`${w.name}(나 ${pct(w.me)} / 반 ${pct(w.cls)})`).join(', ')}. 다음 주에는 이 유형을 집중해서 풀어 봅시다.`);
  if(r.hard.length)L.push(`· 반 전체가 어려워한 고난도 문항 ${r.hard.map(x=>x.no+'번').join(', ')}은 수업 시간에 함께 다룹니다.`);
  if(r.strong.length)L.push(`· 잘한 점: ${r.strong.map(s=>`${s.name} 영역 정답률 ${pct(s.me)}(반 ${pct(s.cls)})`).join(', ')}.`);
  if(!r.wrong.length)L.push('· 모든 문항을 맞혔습니다. 풀이 시간을 줄이는 연습으로 넘어가 봅시다.');
  return L.join('\n');
}


function tagPicks(t,key,tags,rec,tid){const out=[];if(!tags)return out;for(const i of applicable(t,rec.el)){const m=rec.a[i];if(!m||m==='0'||m===key[i])continue;const g=tags[i]?.[m];if(g)out.push({tag:g,no:t.items[i].no,tid})}return out}

function tagCount(p){const m={};for(const x of p)m[x.tag]=(m[x.tag]||0)+1;return m}

function tagCard(mine,cls,who){if(!mine.length)return '';const mc=tagCount(mine),cc=cls&&cls.length?tagCount(cls):null;const ks=[...new Set([...Object.keys(mc),...Object.keys(cc||{})])].sort((a,b)=>(mc[b]||0)-(mc[a]||0));const tm=mine.length,tc=cls&&cls.length?cls.length:1;
  return `<div class="card"><h3>${who==='s'?'내가 고른 오답의 유형 (누적)':'고른 오답의 유형 (누적)'}</h3><p class="sub" style="margin-bottom:8px">${who==='s'?'틀린 선지가 어떤 방식으로 틀린 선지였는지 모았습니다.':'이 학생이 고른 오답 선지의 꼬리표 비율과 반 전체 비율입니다.'} 오답 ${tm}개 기준${tm<5?', 아직 수가 적어 참고만 하세요':''}.</p>${barRows(ks.map(k=>({label:k,v:(mc[k]||0)/tm,w:cc?(cc[k]||0)/tc:null})),{a:who==='s'?'나':'이 학생',b:cc?'반 전체':null})}${mc[ks[0]]&&ERR_DESC[ks[0]]?`<p class="sub" style="margin-top:8px"><b>${esc(ks[0])}</b>: ${esc(ERR_DESC[ks[0]])}. ${esc(ERR_TIP[ks[0]]||'')}</p>`:''}</div>`}

function setCard(r){if(!r.sets||!r.sets.length)return '';const lab={collapse:['bad','지문 전체를 놓침'],slip:['warn','한 문항만 놓침'],part:['warn','일부 놓침'],ok:['good','모두 맞음']};
  return `<div class="card"><h3>지문 세트별 결과</h3><p class="sub" style="margin-bottom:8px">같은 지문에 딸린 문항을 절반 이상(2개 이상) 틀렸으면 지문 이해 단계에서, 하나만 틀렸으면 선지 판단 단계에서 막힌 것으로 봅니다.</p><div class="tbl-wrap"><table><thead><tr><th>지문 세트</th><th>문항</th><th class="n">틀린 수</th><th>판단</th></tr></thead><tbody>${r.sets.map(x=>`<tr><td>${esc(x.name)}</td><td class="mono">${esc(x.nos.join(', '))}</td><td class="n">${x.w}/${x.n}</td><td><span class="pill" style="color:var(--${lab[x.state][0]})">${lab[x.state][1]}</span></td></tr>`).join('')}</tbody></table></div></div>`}

/* ---------- 차트 ---------- */
function lineChart(labels,series,{h=230,max=1,legend=true}={}){
  if(!labels.length)return '<p class="muted">아직 표시할 회차가 없습니다.</p>';
  const W=640,H=h,L=40,R=110,T=16,B=34,pw=W-L-R,ph=H-T-B;
  const x=i=>L+(labels.length===1?pw/2:pw*i/(labels.length-1)),y=v=>T+ph*(1-v/max);
  let g='';for(const t of [0,.25,.5,.75,1]){g+=`<line x1="${L}" x2="${L+pw}" y1="${y(t*max)}" y2="${y(t*max)}" stroke="var(--line)" stroke-width="1"/><text x="${L-8}" y="${y(t*max)+4}" text-anchor="end" font-size="12">${Math.round(t*max*100)}</text>`}
  labels.forEach((lb,i)=>{g+=`<text x="${x(i)}" y="${H-10}" text-anchor="middle" font-size="12">${esc(lb.length>9?lb.slice(0,9)+'…':lb)}</text>`});
  const ends=[];
  for(const s of series){
    const pts=s.values.map((v,i)=>v==null?null:[x(i),y(v),v,i]).filter(Boolean);if(!pts.length)continue;
    g+=`<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p=>p[0]+','+p[1]).join(' ')}"/>`;
    for(const p of pts){g+=`<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="${s.color}" stroke="var(--paper)" stroke-width="2"/><circle cx="${p[0]}" cy="${p[1]}" r="14" fill="transparent" tabindex="0" data-tip="${esc(labels[p[3]]+'\n'+s.name+': '+Math.round(p[2]*100)+'%')}"/>`}
    const last=pts[pts.length-1];ends.push({y:last[1],name:s.name,color:s.color,v:last[2]});
  }
  ends.sort((a,b)=>a.y-b.y);for(let i=1;i<ends.length;i++)if(ends[i].y-ends[i-1].y<15)ends[i].y=ends[i-1].y+15;
  for(const e of ends)g+=`<text x="${L+pw+10}" y="${e.y+4}" font-size="12.5" style="fill:var(--ink)">${esc(e.name)} ${Math.round(e.v*100)}</text>`;
  const lg=legend&&series.length>1?`<div class="legend">${series.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`:'';
  return `${lg}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="회차별 추이 그래프">${g}</svg>`;
}
function barRows(rows,{a='반',b=null}={}){
  if(!rows.length)return '<p class="muted">데이터가 없습니다.</p>';
  const lg=b?`<div class="legend" style="margin-bottom:8px"><span><i style="background:var(--s1)"></i>${esc(a)}</span><span><i style="background:var(--s2)"></i>${esc(b)}</span></div>`:'';
  return lg+'<div class="bars">'+rows.map(r=>`<div class="bar" data-tip="${esc(r.label+'\n'+a+' '+pct(r.v)+(b?'\n'+b+' '+pct(r.w):''))}"><span class="lab" title="${esc(r.label)}">${esc(r.label)}</span><span class="trk"><i class="${b?'':'one'}" style="width:${Math.max(1,(r.v||0)*100)}%"></i>${b&&r.w!=null?`<i class="b" style="width:${Math.max(1,r.w*100)}%"></i>`:''}</span><span class="val">${pct(r.v)}</span></div>`).join('')+'</div>';
}
const exBlock=t=>t?`<details class="ex"><summary>해설 보기</summary><div>${esc(t)}</div></details>`:'';
function distBar(it){
  const segs=[1,2,3,4,5,0].map(o=>{const v=it.dist[o]||0;if(o===0&&!v)return '';const cls=o===0?'blank':String(o)===it.ans?'ans':(o===it.lure.opt&&it.lure.share>=.2?'lure':'');return `<span class="${cls}" style="flex:${Math.max(v,0.0001)} 1 0" data-tip="${esc((o?CIR[o]:'무응답')+' '+pct(v)+(String(o)===it.ans?' (정답)':''))}"></span>`}).join('');
  const lab=[1,2,3,4,5].map(o=>`${CIR[o]}${Math.round((it.dist[o]||0)*100)}`).join(' ');
  return `<div class="dist" aria-hidden="true">${segs}</div><div class="distlab">${lab}</div>`;
}
const tip=$('#tip');
function showTip(e){const el=e.target.closest?.('[data-tip]');if(!el){tip.hidden=true;return}tip.textContent=el.getAttribute('data-tip');tip.hidden=false;const r=el.getBoundingClientRect();const tx=Math.min(window.innerWidth-tip.offsetWidth-8,Math.max(8,(e.clientX??r.left+r.width/2)+12));const ty=Math.max(8,(e.clientY??r.top)-tip.offsetHeight-10);tip.style.left=tx+'px';tip.style.top=ty+'px'}
document.addEventListener('pointermove',showTip);document.addEventListener('focusin',showTip);document.addEventListener('pointerleave',()=>tip.hidden=true);


function omrCard(t,rec,key,ro){
  const idx=applicable(t,rec.el);
  let cols='';let cur=null;
  for(const i of (hasElectives(t)&&!rec.el?t.items.map((_,i)=>i).filter(i=>!t.items[i].el):idx)){
    const it=t.items[i];const sec=it.el?ELEC[it.el]:it.area;
    if(sec!==cur){cur=sec;cols+=`<div class="omr-sec">${esc(sec)}</div>`}
    cols+=`<div class="omr-row"><span class="no">${esc(it.no)}</span>${[1,2,3,4,5].map(o=>{const on=rec.a[i]===String(o);let c='bub';if(ro&&key){if(key[i]===String(o))c+=' key';if(on)c+=key[i]===String(o)?' right':' wrong'}return `<button class="${c}" aria-pressed="${on}" ${ro?'disabled':''} data-act="mark" data-i="${i}" data-v="${o}" aria-label="${esc(it.no)}번 ${o}">${o}</button>`}).join('')}</div>`;
  }
  const elec=hasElectives(t)?`<div class="elec"><span>선택과목</span>${Object.keys(ELEC).map(k=>`<button class="chip" aria-pressed="${rec.el===k}" ${ro?'disabled':''} data-act="el" data-v="${k}">${esc(ELEC[k])}</button>`).join('')}</div>`:'';
  return `<div class="omr"><div class="omr-head"><span class="t">${esc(t.title)}</span><span class="mono" style="font-size:12px">국어 영역 답안지${ro?' · 파란 테두리가 정답':''}</span>${elec}</div><div class="omr-cols">${cols}</div></div>`;
}

