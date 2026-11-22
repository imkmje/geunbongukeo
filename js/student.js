"use strict";
/* 근본국어 학생 화면: 학번 + 개인 코드로 로그인 → 답안 제출, 내 결과, 누적 기록 */
const sb=window.supabase.createClient(window.GB_CONFIG.url,window.GB_CONFIG.key,{auth:{persistSession:false}});
const T={token:null,me:null,view:'home',cur:null,draft:{},results:null,confirm:false,busy:false,msg:''};
const TOKEN_KEY='gb-student-token';

function saveToken(tok){T.token=tok;lsSet(TOKEN_KEY,tok?{tok,exp:Date.now()+11*3600e3}:null)}
function loadToken(){const v=lsGet(TOKEN_KEY,null);return v&&v.exp>Date.now()?v.tok:null}
const fmtTime=s=>s?new Date(s).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';

async function rpc(fn,args){
  const r=await sb.rpc(fn,args);
  if(r.error){
    if(/invalid_session/.test(r.error.message||'')){saveToken(null);T.me=null;T.view='home';T.msg='로그인 시간이 지났습니다. 다시 로그인해 주세요.';render();throw r.error}
    throw r.error;
  }
  return r.data;
}
async function refreshHome(){T.me=await rpc('student_home',{p_token:T.token})}

/* ---------- 화면 ---------- */
function viewLogin(){
  return `<div class="card" style="max-width:420px;margin:32px auto"><h2>학생 로그인</h2><p class="sub">학번과 선생님께 받은 개인 코드(6자리)를 입력하세요.</p>
  <form id="stuLogin" class="stack" style="margin-top:14px"><label class="f">학번<input type="text" id="lgSid" inputmode="numeric" maxlength="5" autocomplete="username" placeholder="예: 10515" required></label>
  <label class="f">개인 코드<input type="password" id="lgCode" maxlength="6" autocomplete="current-password" placeholder="6자리" required style="text-transform:uppercase"></label>
  <button class="btn primary" type="submit">로그인</button><p class="sub" id="lgMsg" role="status">${esc(T.msg)}</p></form></div>
  <p class="sub" style="text-align:center"><a href="teacher.html" style="color:var(--ink2)">교사 화면</a></p>`;
}
function head(){return `<div class="card"><div class="row" style="justify-content:space-between"><div><h2>${esc(T.me.name)}</h2><p class="sub">${esc(T.me.sid)}${T.me.class?' · '+esc(T.me.class):''}</p></div><div class="row"><button class="btn${T.view==='home'?' primary':''}" data-act="home">시험 목록</button><button class="btn${T.view==='history'?' primary':''}" data-act="history">내 누적 기록</button><button class="btn ghost" data-act="logout">로그아웃</button></div></div></div>`}
function viewHome(){
  const ts=T.me.tests||[];
  if(!T.me.class)return head()+`<div class="card empty"><h2>아직 반이 정해지지 않았습니다</h2><p>선생님께 방과후 반 명단에 넣어 달라고 말씀드려 주세요.</p></div>`;
  if(!ts.length)return head()+`<div class="card empty"><h2>지금 볼 수 있는 시험이 없습니다</h2><p>선생님이 응시를 열거나 결과를 공개하면 여기에 나타납니다.</p></div>`;
  return head()+`<div class="card"><h3>시험</h3><div class="focus-list">${ts.map(t=>`<div class="focus-item" style="grid-template-columns:1fr auto"><div style="min-width:0"><b>${esc(t.title)}</b><div class="why">${t.released?'<span class="pill rel">결과 공개</span>':t.is_open?'<span class="pill open">응시 중</span>':''}${t.submitted_at?`<span class="pill draft">제출함 ${esc(fmtTime(t.submitted_at))}</span>`:'<span class="pill closed">아직 안 냄</span>'}</div></div><div class="row">${t.is_open?`<button class="btn red" data-act="take" data-v="${t.id}">${t.submitted_at?'답안 고치기':'답안 쓰기'}</button>`:''}${t.released?`<button class="btn" data-act="result" data-v="${t.id}">결과 보기</button>`:''}</div></div>`).join('')}</div></div>`;
}
function viewTake(){
  const t=(T.me.tests||[]).find(x=>x.id===T.cur);
  if(!t||!t.is_open){T.view='home';return viewHome()}
  const n=t.items.length;
  const dr=T.draft[t.id]||(T.draft[t.id]={a:(t.answers||'').padEnd(n,'0').slice(0,n),el:''});
  const blanks=dr.a.split('').filter(c=>c==='0').length;
  return head()+omrCard(t,dr,null,false)+`<div class="card"><div class="row" style="justify-content:space-between"><div><b>${t.submitted_at?'이미 냈습니다. 고쳐서 다시 낼 수 있습니다.':'다 마킹했으면 제출하세요.'}</b><p class="sub" id="blankInfo">빈 문항 ${blanks}개</p></div>
  <div class="row">${T.confirm?`<span class="confirm">빈 문항 ${blanks}개가 있습니다. 그대로 낼까요? <button class="btn small red" data-act="submit-yes">제출</button><button class="btn small ghost" data-act="submit-no">계속 마킹</button></span>`:`<button class="btn red" data-act="submit" ${T.busy?'disabled':''}>답안 제출</button>`}<button class="btn ghost" data-act="home">목록으로</button></div></div></div>`;
}
function clsOf(row){const st=row.stats||{};return {n:st.n||0,avgPct:st.avgPct??null,ir:st.ir||[],dist:st.dist||[],area:st.area||{},type:st.type||{},nat:row.nat||null}}
function allPicks(){const out=[];for(const row of T.results||[]){if(!row.answers||!row.tags||!row.key)continue;out.push(...tagPicks({items:row.items},row.key.split(''),row.tags,{a:row.answers,el:''},row.id))}return out}
function viewResult(){
  const row=(T.results||[]).find(x=>x.id===T.cur);
  if(!row)return head()+`<div class="card empty"><h2>결과를 불러오는 중입니다</h2></div>`;
  if(!row.answers)return head()+`<div class="card empty"><h2>${esc(row.title)}: 낸 답안이 없습니다</h2><p>종이로 냈다면 선생님이 입력하신 뒤에 결과가 보입니다.</p></div>`;
  const t={title:row.title,items:row.items};const key=row.key.split('');const cls=clsOf(row);
  const r=report(t,key,{a:row.answers,el:''},cls);
  const card=(x,extra)=>`<div class="focus-item"><div class="qno">${esc(x.no)}</div><div style="min-width:0">${esc(x.area)} · ${esc(x.type||'')}<div class="why"><span class="pill" style="color:var(--bad)">내 답 ${x.mine==='0'?'무응답':CIR[+x.mine]}</span><span class="pill" style="color:var(--s1)">정답 ${CIR[+x.ans]}</span></div>${extra||''}</div><div class="num" style="text-align:right">${x.rate!=null?'반 '+pct(x.rate):''}${x.nr!=null?`<br><span class="muted">전국 ${pct(x.nr)}</span>`:''}</div></div>`;
  return head()+`<div class="card"><h2>${esc(row.title)} 결과</h2><div class="tiles" style="margin-top:10px"><div class="tile"><div class="k">내 점수</div><div class="v">${r.score}<small> / ${r.max}</small></div></div><div class="tile"><div class="k">반 평균 (100점 환산)</div><div class="v">${cls.avgPct!=null?Math.round(cls.avgPct*100):'–'}<small> 점</small></div></div><div class="tile"><div class="k">틀린 문항</div><div class="v">${r.wrong.length}<small> 개</small></div></div></div></div>
  <div class="grid2"><div class="card"><h3>많은 학생이 맞혔는데 내가 놓친 문항</h3>${r.missedEasy.length?`<div class="focus-list">${r.missedEasy.map(x=>card(x)).join('')}</div><p class="sub" style="margin-top:8px">이 문항들은 다시 풀면서 정답의 근거가 되는 문장을 지문에서 찾아 표시해 보세요.</p>`:'<p class="muted">없습니다. 쉬운 문항을 잘 챙겼습니다.</p>'}</div>
  <div class="card"><h3>영역별 · 반과 비교</h3>${barRows(r.areaCmp.map(x=>({label:x.name,v:x.me,w:x.cls})),{a:'나',b:'반 평균'})}</div></div>
  ${setCard(r)}${tagCard(allPicks(),null,'s')}
  ${r.rare.length?`<div class="card"><h3>드물게 고른 오답</h3><p class="sub" style="margin-bottom:8px">다른 응시자가 거의 고르지 않은 선지를 골라 틀린 문항입니다. 발문(맞는 것/않은 것)을 거꾸로 읽지 않았는지, 지문을 잘못 이해하지 않았는지, 마킹을 잘못하지 않았는지 확인해 보세요.</p><div class="focus-list">${r.rare.map(x=>card(x)).join('')}</div></div>`:''}
  ${r.wrong.length?`<div class="card"><h3>틀린 문항 다시 보기</h3><div class="focus-list">${r.wrong.map(x=>card(x,exBlock(row.ex?.[x.i]))).join('')}</div></div>`:''}
  ${omrCard(t,{a:row.answers,el:''},key,true)}`;
}
function viewHistory(){
  const rows=(T.results||[]).filter(x=>x.answers&&x.key);
  if(!rows.length)return head()+`<div class="card empty"><h2>아직 공개된 결과가 없습니다</h2><p>결과가 공개된 시험이 쌓이면 회차별 변화를 여기서 볼 수 있습니다.</p></div>`;
  const data=rows.map(row=>{const t={items:row.items};const key=row.key.split('');const g=grade(t,key,{a:row.answers,el:''});const cls=clsOf(row);const nat=row.nat||[];const hi=g.idx.filter(i=>nat[i]?.r!=null);
    return {label:row.title,id:row.id,me:g.pct,score:g.score,max:g.max,cls:cls.avgPct,hm:hi.length>=2?hi.filter(i=>g.res[i]).length/hi.length:null,hn:hi.length>=2?hi.reduce((a,i)=>a+nat[i].r,0)/hi.length:null}});
  return head()+`<div class="grid2"><div class="card"><h3>회차별 점수 (100점 환산)</h3>${lineChart(data.map(x=>x.label),[{name:'나',color:'var(--s2)',values:data.map(x=>x.me)},{name:'반 평균',color:'var(--s1)',values:data.map(x=>x.cls)}])}</div>
  ${data.some(x=>x.hm!=null)?`<div class="card"><h3>어려운 문항 정답률 (전국 오답률 상위 15문항)</h3>${lineChart(data.map(x=>x.label),[{name:'나',color:'var(--s2)',values:data.map(x=>x.hm)},{name:'전국',color:'var(--muted)',values:data.map(x=>x.hn)}])}<p class="sub">시험마다 난도가 달라서, 전국에서 많이 틀린 문항만 따로 모아 전국 정답률과 비교합니다.</p></div>`:''}</div>
  ${tagCard(allPicks(),null,'s')}
  <div class="card"><h3>시험별 결과</h3><div class="tbl-wrap"><table><thead><tr><th>시험</th><th class="n">점수</th><th class="n">반 평균</th><th></th></tr></thead><tbody>${data.map(x=>`<tr><td>${esc(x.label)}</td><td class="n">${x.score}/${x.max}</td><td class="n">${x.cls!=null?Math.round(x.cls*100)+'점':'–'}</td><td><button class="btn small" data-act="result" data-v="${x.id}">자세히</button></td></tr>`).join('')}</tbody></table></div></div>`;
}
function render(){
  const app=$('#app');
  if(!T.token||!T.me){app.innerHTML=viewLogin();return}
  app.innerHTML=`<div class="stack">${({home:viewHome,take:viewTake,result:viewResult,history:viewHistory}[T.view]||viewHome)()}</div>`;
}

/* ---------- 동작 ---------- */
document.addEventListener('submit',async e=>{
  if(e.target.id!=='stuLogin')return;e.preventDefault();
  const msg=$('#lgMsg');msg.textContent='확인하는 중…';
  const r=await sb.rpc('student_login',{p_sid:$('#lgSid').value.trim(),p_code:$('#lgCode').value.trim()});
  if(r.error){msg.textContent='서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';return}
  const d=r.data||{};
  if(!d.ok){msg.textContent=d.error==='locked'?'여러 번 틀려서 10분 동안 잠겼습니다. 잠시 뒤 다시 시도해 주세요.':'학번 또는 코드가 맞지 않습니다.';return}
  saveToken(d.token);T.msg='';
  try{await refreshHome();T.view='home';render()}catch(err){}
});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const v=b.dataset.v;
  try{switch(b.dataset.act){
    case 'home':T.view='home';T.confirm=false;await refreshHome();render();break;
    case 'take':T.cur=v;T.view='take';T.confirm=false;render();break;
    case 'mark':{const dr=T.draft[T.cur];const i=+b.dataset.i;const arr=dr.a.split('');arr[i]=arr[i]===v?'0':v;dr.a=arr.join('');b.parentElement.querySelectorAll('.bub').forEach(x=>x.setAttribute('aria-pressed',arr[i]===x.dataset.v));lsSet('gb-draft',T.draft);const bl=$('#blankInfo');if(bl)bl.textContent='빈 문항 '+arr.filter(c=>c==='0').length+'개';break}
    case 'submit':{const dr=T.draft[T.cur];if(dr.a.includes('0')){T.confirm=true;render();break}await submit();break}
    case 'submit-yes':T.confirm=false;await submit();break;
    case 'submit-no':T.confirm=false;render();break;
    case 'result':T.cur=v;T.view='result';if(!T.results)render();T.results=await rpc('student_results',{p_token:T.token,p_test:null});render();break;
    case 'history':T.view='history';render();T.results=await rpc('student_results',{p_token:T.token,p_test:null});render();break;
    case 'logout':try{await sb.rpc('student_logout',{p_token:T.token})}catch(_){}saveToken(null);T.me=null;T.results=null;T.msg='';render();break;
  }}catch(err){console.error(err);if(!/invalid_session/.test(err?.message||''))toast('문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.')}
});
async function submit(){
  T.busy=true;render();
  const dr=T.draft[T.cur];
  try{const d=await rpc('student_submit',{p_token:T.token,p_test:T.cur,p_answers:dr.a});
    if(d.ok){toast('제출했습니다');delete T.draft[T.cur];lsSet('gb-draft',T.draft);await refreshHome();T.view='home'}
    else toast(d.error==='closed'?'응시가 닫혀서 낼 수 없습니다':'답안 형식이 맞지 않습니다. 새로고침 뒤 다시 시도해 주세요');
  }finally{T.busy=false;render()}
}
(async function boot(){
  T.draft=lsGet('gb-draft',{})||{};
  loadSite(sb,'student');
  const tok=loadToken();
  if(tok){T.token=tok;try{await refreshHome()}catch(_){T.token=null}}
  render();
})();
