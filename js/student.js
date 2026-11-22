"use strict";
/* 근본국어 학생 화면: 학번 + 비밀번호로 로그인(처음 비밀번호는 학번, 첫 로그인 때 새로 정함) → 답안 제출, 내 결과, 누적 기록 */
const sb=window.supabase.createClient(window.GB_CONFIG.url,window.GB_CONFIG.key,{auth:{persistSession:false}});
const T={token:null,me:null,who:null,mustChange:false,view:'home',cur:null,draft:{},results:null,confirm:false,busy:false,msg:'',pwMsg:''};
const TOKEN_KEY='gb-student-token';

function saveToken(tok,who){T.token=tok;T.who=tok?(who||null):null;lsSet(TOKEN_KEY,tok?{tok,exp:Date.now()+11*3600e3,who:T.who}:null)}
function loadToken(){const v=lsGet(TOKEN_KEY,null);if(!(v&&v.exp>Date.now()))return null;T.who=v.who||null;return v.tok}
// 임시 답안은 학번별로 따로 둔다(같은 기기를 여러 학생이 쓰는 경우 남의 마킹이 보이지 않게).
const dkey=tid=>(T.me?.sid||T.who?.sid||'')+':'+tid;
const fmtTime=s=>s?new Date(s).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';

async function rpc(fn,args){
  const r=await sb.rpc(fn,args);
  if(r.error){
    if(/invalid_session/.test(r.error.message||'')){saveToken(null);T.me=null;T.mustChange=false;T.view='home';T.msg='로그인 시간이 지났습니다. 다시 로그인해 주세요.';render();throw r.error}
    if(/class_hidden/.test(r.error.message||'')){saveToken(null);T.me=null;T.mustChange=false;T.view='home';T.msg=loginErrorMsg('class_hidden');render();throw r.error}
    if(/must_change_password/.test(r.error.message||'')){T.mustChange=true;T.pwMsg='';render();throw r.error}
    throw r.error;
  }
  return r.data;
}
async function refreshHome(){T.me=await rpc('student_home',{p_token:T.token})}

/* ---------- 화면 ---------- */
function viewLogin(){
  return `<div class="card" style="max-width:420px;margin:32px auto"><h2>학생 로그인</h2><p class="sub">학번과 비밀번호를 입력하세요. 처음 로그인할 때 비밀번호는 <b>학번</b>이고, 들어가자마자 새 비밀번호를 정합니다.</p>
  <form id="stuLogin" class="stack" style="margin-top:14px"><label class="f">학번<input type="text" id="lgSid" inputmode="numeric" maxlength="5" autocomplete="username" placeholder="예: 10515" required></label>
  <label class="f">비밀번호<input type="password" id="lgCode" autocomplete="current-password" placeholder="처음에는 학번" required></label>
  <button class="btn primary" type="submit">로그인</button><p class="sub" id="lgMsg" role="status">${esc(T.msg)}</p></form></div>
  <p class="sub" style="text-align:center"><a href="teacher.html" style="color:var(--ink2)">교사 화면</a></p>`;
}
function head(){return `<div class="card"><div class="row" style="justify-content:space-between"><div><h2>${esc(T.me.name)}</h2><p class="sub">${esc(T.me.sid)}${T.me.class?' · '+esc(T.me.class):''}</p></div><div class="row"><button class="btn${T.view==='home'?' primary':''}" data-act="home">시험 목록</button><button class="btn${T.view==='history'?' primary':''}" data-act="history">내 누적 기록</button><button class="btn ghost${T.view==='pw'?' primary':''}" data-act="pw">비밀번호 바꾸기</button><button class="btn ghost" data-act="logout">로그아웃</button></div></div></div>`}
/* 비밀번호 정하기: forced=첫 로그인·초기화 직후(지금 비밀번호를 묻지 않음, 다른 화면으로 못 감) */
function viewPw(forced){
  const who=T.me||T.who||{};
  return `${forced?'':head()}<div class="card" style="max-width:460px;${forced?'margin:32px auto':''}"><h2>${forced?'새 비밀번호 정하기':'비밀번호 바꾸기'}</h2>
  <p class="sub">${forced?`${esc(who.name||'')} 학생, 지금 비밀번호는 학번이라 친구도 알 수 있습니다. 시험을 보기 전에 나만 아는 비밀번호로 바꿔 주세요.`:'지금 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.'}</p>
  <p class="sub" style="margin-top:6px">규칙: ${PW_MIN}자 이상, 학번과 다르게. 글자 종류는 상관없습니다.</p>
  <form id="stuPw" class="stack" style="margin-top:14px">${forced?'':'<label class="f">지금 비밀번호<input type="password" id="pwOld" autocomplete="current-password" required></label>'}
  <label class="f">새 비밀번호<input type="password" id="pwNew" autocomplete="new-password" required></label>
  <label class="f">새 비밀번호 한 번 더<input type="password" id="pwNew2" autocomplete="new-password" required></label>
  <button class="btn primary" type="submit">${forced?'저장하고 시작하기':'비밀번호 바꾸기'}</button><p class="sub" id="pwMsg" role="status" style="color:var(--bad)">${esc(T.pwMsg)}</p></form>
  ${forced?'<div class="row" style="margin-top:6px"><button class="btn ghost small" data-act="logout">로그아웃</button></div>':''}</div>`;
}
function viewHome(){
  const ts=T.me.tests||[];
  if(!T.me.class)return head()+`<div class="card empty"><h2>아직 반이 정해지지 않았습니다</h2><p>선생님께 방과후 반 명단에 넣어 달라고 말씀드려 주세요.</p></div>`;
  if(!ts.length)return head()+`<div class="card empty"><h2>지금 볼 수 있는 시험이 없습니다</h2><p>선생님이 응시를 열거나 결과를 공개하면 여기에 나타납니다.</p></div>`;
  return head()+`<div class="card"><h3>시험</h3><div class="focus-list">${ts.map(t=>`<div class="focus-item" style="grid-template-columns:1fr auto"><div style="min-width:0"><b>${esc(t.title)}</b><div class="why">${t.released?'<span class="pill rel">결과 공개</span>':t.is_open?'<span class="pill open">응시 중</span>':''}${t.retry_due?'<span class="pill" style="color:var(--omr-ink)">틀린 문항 다시 풀기</span>':''}${t.submitted_at?`<span class="pill draft">제출함 ${esc(fmtTime(t.submitted_at))}</span>`:'<span class="pill closed">아직 안 냄</span>'}</div></div><div class="row">${t.is_open?`<button class="btn red" data-act="take" data-v="${t.id}">${t.submitted_at?'답안 고치기':'답안 쓰기'}</button>`:''}${t.released?`<button class="btn" data-act="result" data-v="${t.id}">결과 보기</button>`:''}</div></div>`).join('')}</div></div>`;
}
function viewTake(){
  const t=(T.me.tests||[]).find(x=>x.id===T.cur);
  if(!t||!t.is_open){T.view='home';return viewHome()}
  const n=t.items.length;const dk=dkey(t.id);
  // 저장해 둔 임시 답안의 길이가 지금 문항 수와 다르면(선생님이 문항 수를 고친 경우) 맞춰 준다. 다르면 제출이 거절된다.
  if(T.draft[dk]&&T.draft[dk].a.length!==n)T.draft[dk].a=T.draft[dk].a.padEnd(n,'0').slice(0,n);
  const dr=T.draft[dk]||(T.draft[dk]={a:(t.answers||'').padEnd(n,'0').slice(0,n),el:''});
  const list=takeBlanks(t,dr);
  return head()+omrCard(t,dr,null,false)+`<div class="card"><div class="row" style="justify-content:space-between"><div><b>${t.submitted_at?'이미 냈습니다. 고쳐서 다시 낼 수 있습니다.':'다 마킹했으면 제출하세요.'}</b><p class="sub blank-info" id="blankInfo">${takeInfoHtml(list)}</p></div>
  <div class="row">${T.confirm?`<span class="confirm"><span id="blankConfirm">${blankSentence(list,10,blankBtn('omr-r'))}</span> <button class="btn small red" data-act="submit-yes">제출</button><button class="btn small ghost" data-act="submit-no">계속 마킹</button></span>`:`<button class="btn red" data-act="submit" ${T.busy?'disabled':''}>답안 제출</button>`}<button class="btn ghost" data-act="home">목록으로</button></div></div></div>`;
}
/* 답안지의 빈 문항: 번호 목록(누르면 그 줄로), 빈 줄 번호는 빨간 바탕 */
const takeBlanks=(t,dr)=>blankList(t.items,dr.a,applicable(t,dr.el));
const takeInfoHtml=list=>list.length?`빈 문항: ${blankNos(list,10,blankBtn('omr-r'))}`:'빈 문항 없음';
function paintTake(){
  const t=(T.me?.tests||[]).find(x=>x.id===T.cur);const dr=t&&T.draft[dkey(t.id)];if(!dr)return;
  const list=takeBlanks(t,dr);const bl=new Set(list.map(x=>x.i));
  document.querySelectorAll('.omr-row').forEach(r=>{const b=r.querySelector('.bub[data-i]');if(!b)return;const i=+b.dataset.i;r.id='omr-r'+i;r.classList.toggle('is-blank',bl.has(i))});
  const el=$('#blankInfo');if(el)el.innerHTML=takeInfoHtml(list);
  const cf=$('#blankConfirm');if(cf)cf.innerHTML=blankSentence(list,10,blankBtn('omr-r'));
  return list;
}
function clsOf(row){const st=row.stats||{};return {n:st.n||0,avgPct:st.avgPct??null,ir:st.ir||[],dist:st.dist||[],area:st.area||{},type:st.type||{},nat:row.nat||null}}
function allPicks(){const out=[];for(const row of T.results||[]){if(!row.answers||!row.tags||!row.key)continue;out.push(...tagPicks({items:row.items},row.key.split(''),row.tags,{a:row.answers,el:''},row.id))}return out}
function viewResult(){
  const row=(T.results||[]).find(x=>x.id===T.cur);
  if(!row)return head()+`<div class="card empty"><h2>결과를 불러오는 중입니다</h2></div>`;
  if(!row.answers)return head()+`<div class="card empty"><h2>${esc(row.title)}: 낸 답안이 없습니다</h2><p>종이로 냈다면 선생님이 입력하신 뒤에 결과가 보입니다.</p></div>`;
  if(row.keyHidden)return head()+viewResultPre(row);// js/student-retry.js: 정답·해설 공개 전
  const t={title:row.title,items:row.items};const key=(row.key||'').split('');const cls=clsOf(row);
  const r=report(t,key,{a:row.answers,el:''},cls);
  // 많은 학생이 맞혔는데 내가 놓친 문항 · 드물게 고른 오답: 따로 카드 대신 문항에 작은 꼬리표로
  const easy=new Set(r.missedEasy.map(x=>x.i)),rare=new Set(r.rare.map(x=>x.i));
  const easyTag=x=>!easy.has(x.i)?'':x.rate!=null&&x.rate>=.7?`<span class="pill tag-easy">반 ${pct(x.rate)}가 맞힌 문항</span>`:`<span class="pill tag-easy">전국 ${pct(x.nr)}가 맞힌 문항</span>`;
  const rareTag=x=>rare.has(x.i)?'<span class="pill tag-rare" tabindex="0" data-tip="다른 응시자가 거의 고르지 않은 답입니다. 발문(맞는 것/않은 것)을 거꾸로 읽지 않았는지, 마킹을 잘못하지 않았는지 확인해 보세요.">드물게 고른 답</span>':'';
  const card=x=>`<div class="focus-item"><div class="qno">${esc(x.no)}</div><div style="min-width:0">${esc(x.area)}${x.type?' · '+esc(x.type):''}<div class="why"><span class="pill" style="color:var(--bad)">내 답 ${x.mine==='0'?'비움':CIR[+x.mine]}</span><span class="pill" style="color:var(--s1)">정답 ${CIR[+x.ans]}</span>${easyTag(x)}${rareTag(x)}${retryPill(row,x.i)}</div>${exBlock(row.ex?.[x.i])}</div><div class="num" style="text-align:right">${x.rate!=null?'반 '+pct(x.rate):''}${x.nr!=null?`<br><span class="muted">전국 ${pct(x.nr)}</span>`:''}</div></div>`;
  const tags=tagCard(allPicks(),null,'s');
  return head()+`<div class="card"><h2>${esc(row.title)} 결과</h2>${scoreTiles(r,cls,`<div class="tile"><div class="k">틀린 문항</div><div class="v">${r.wrong.length}<small>개</small></div></div>`)}</div>
  ${resultExtras(row)}
  ${r.wrong.length?`<div class="card"><h3>틀린 문항 정답·해설</h3>${r.missedEasy.length?`<p class="sub" style="margin-bottom:4px">'N%가 맞힌 문항' 표시는 많은 학생이 맞혔는데 내가 놓친 문항입니다. 정답의 근거 문장을 지문에서 찾아 표시해 보세요.</p>`:''}<div class="focus-list">${r.wrong.map(card).join('')}</div></div>`:`<div class="card"><h3>모든 문항을 맞혔습니다</h3><p class="sub">풀이 시간을 줄이는 연습으로 넘어가 봅시다.</p></div>`}
  ${omrCard(t,{a:row.answers,el:''},key,true)}
  <details class="card more"><summary>영역·지문 세트 분석 보기</summary><div class="stack" style="margin-top:14px">
   <div><h3>영역별 · 반과 비교</h3>${barRows(r.areaCmp.map(x=>({label:x.name,v:x.me,w:x.cls})),{a:'나',b:'반 평균'})}</div>
   ${setList(r)}${tags}</div></details>`;
}
function viewHistory(){
  const rows=(T.results||[]).filter(x=>x.answers&&x.key);
  if(!rows.length)return head()+overallFbCard()+`<div class="card empty"><h2>아직 공개된 결과가 없습니다</h2><p>결과가 공개된 시험이 쌓이면 회차별 변화를 여기서 볼 수 있습니다.</p></div>`;
  const data=rows.map(row=>{const t={items:row.items};const key=row.key.split('');const g=grade(t,key,{a:row.answers,el:''});const cls=clsOf(row);const nat=row.nat||[];const hi=g.idx.filter(i=>nat[i]?.r!=null);
    return {label:row.title,id:row.id,me:g.pct,score:g.score,max:g.max,cls:cls.avgPct,hm:hi.length>=2?hi.filter(i=>g.res[i]).length/hi.length:null,hn:hi.length>=2?hi.reduce((a,i)=>a+nat[i].r,0)/hi.length:null}});
  return head()+overallFbCard()+`<div class="grid2"><div class="card"><h3>회차별 점수 (100점 환산)</h3>${lineChart(data.map(x=>x.label),[{name:'나',color:'var(--s2)',values:data.map(x=>x.me)},{name:'반 평균',color:'var(--s1)',values:data.map(x=>x.cls)}])}</div>
  ${data.some(x=>x.hm!=null)?`<div class="card"><h3>어려운 문항 정답률 (전국 오답률 상위 15문항)</h3>${lineChart(data.map(x=>x.label),[{name:'나',color:'var(--s2)',values:data.map(x=>x.hm)},{name:'전국',color:'var(--muted)',values:data.map(x=>x.hn)}])}<p class="sub">시험마다 난도가 달라서, 전국에서 많이 틀린 문항만 따로 모아 전국 정답률과 비교합니다.</p></div>`:''}</div>
  ${tagCard(allPicks(),null,'s')}
  <div class="card"><h3>시험별 결과</h3><div class="tbl-wrap"><table class="hist-tbl"><thead><tr><th>시험</th><th class="n">내 점수<br><small>(100점 환산)</small></th><th class="n">반 평균<br><small>(100점 환산)</small></th><th class="hist-more"></th></tr></thead><tbody>${data.map(x=>{const av=pct100(x.cls);return `<tr><td><button type="button" class="hist-link" data-act="result" data-v="${x.id}">${esc(x.label)}</button></td><td class="n" title="${x.max}점 만점에 ${x.score}점"><b>${score100(x.score,x.max)??'–'}점</b><div class="raw">${x.score}/${x.max}</div></td><td class="n"${av!=null?` title="${x.max}점 만점에 ${oneDec(x.cls*x.max)}점"`:''}>${av!=null?`${av}점<div class="raw">${oneDec(x.cls*x.max)}/${x.max}</div>`:'–'}</td><td class="hist-more"><button class="btn small" data-act="result" data-v="${x.id}">자세히</button></td></tr>`}).join('')}</tbody></table></div></div>`;
}
function render(){
  const app=$('#app');
  if(T.token&&T.mustChange){app.innerHTML=viewPw(true);return}
  if(!T.token||!T.me){app.innerHTML=viewLogin();return}
  if(T.view==='pw'){app.innerHTML=`<div class="stack">${viewPw(false)}</div>`;return}
  app.innerHTML=`<div class="stack">${({home:viewHome,take:viewTake,result:viewResult,history:viewHistory,retry:viewRetry}[T.view]||viewHome)()}</div>`;
  if(T.view==='take')paintTake();
}

/* ---------- 동작 ---------- */
document.addEventListener('submit',async e=>{
  if(e.target.id!=='stuLogin')return;e.preventDefault();
  const msg=$('#lgMsg');msg.textContent='확인하는 중…';
  const r=await sb.rpc('student_login',{p_sid:$('#lgSid').value.trim(),p_password:$('#lgCode').value.trim()});
  if(r.error){msg.textContent='서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';return}
  const d=r.data||{};
  if(!d.ok){msg.textContent=loginErrorMsg(d.error);return}
  saveToken(d.token,{sid:d.sid,name:d.name});T.msg='';T.pwMsg='';T.view='home';
  if(d.must_change){T.mustChange=true;render();return}
  try{await refreshHome();render()}catch(err){}
});
document.addEventListener('submit',async e=>{
  if(e.target.id!=='stuPw')return;e.preventDefault();
  const forced=T.mustChange;const nw=$('#pwNew').value,nw2=$('#pwNew2').value;const msg=$('#pwMsg');
  const sid=(T.me||T.who||{}).sid||'';
  const bad=pwProblem(nw,sid)||(nw!==nw2?'새 비밀번호 두 칸이 서로 다릅니다.':'');
  if(bad){T.pwMsg=bad;msg.textContent=bad;return}
  msg.textContent='저장하는 중…';
  try{
    const d=await rpc('student_change_password',forced?{p_token:T.token,p_new:nw}:{p_token:T.token,p_new:nw,p_old:$('#pwOld').value});
    if(!d.ok){T.pwMsg={wrong_old:'지금 비밀번호가 맞지 않습니다.',too_short:`비밀번호는 ${PW_MIN}자 이상이어야 합니다.`,too_long:'비밀번호가 너무 깁니다. 조금 짧게 정해 주세요.',same_as_sid:'학번과 같은 비밀번호는 쓸 수 없습니다.'}[d.error]||'바꾸지 못했습니다. 다시 시도해 주세요.';msg.textContent=T.pwMsg;return}
    T.mustChange=false;T.pwMsg='';T.view='home';toast('새 비밀번호를 저장했습니다');
    await refreshHome();render();
  }catch(err){if(!/invalid_session|class_hidden/.test(err?.message||''))msg.textContent='서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'}
});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const v=b.dataset.v;
  try{switch(b.dataset.act){
    case 'home':T.view='home';T.confirm=false;await refreshHome();render();break;
    case 'take':T.cur=v;T.view='take';T.confirm=false;render();break;
    case 'pw':T.view='pw';T.pwMsg='';render();break;
    case 'mark':{const dr=T.draft[dkey(T.cur)];const i=+b.dataset.i;const arr=dr.a.split('');arr[i]=arr[i]===v?'0':v;dr.a=arr.join('');b.parentElement.querySelectorAll('.bub').forEach(x=>x.setAttribute('aria-pressed',arr[i]===x.dataset.v));lsSet('gb-draft',T.draft);paintTake();break}
    case 'submit':{const t=(T.me.tests||[]).find(x=>x.id===T.cur);const dr=T.draft[dkey(T.cur)];if(t&&takeBlanks(t,dr).length){T.confirm=true;render();break}await submit();break}
    case 'goto':{const row=document.getElementById(b.dataset.t);if(!row)break;row.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});row.querySelector('.bub')?.focus({preventScroll:true});row.classList.add('flash');setTimeout(()=>row.classList.remove('flash'),1500);break}
    case 'submit-yes':T.confirm=false;await submit();break;
    case 'submit-no':T.confirm=false;render();break;
    case 'result':T.cur=v;T.view='result';if(!T.results)render();T.results=await loadResults();render();break;
    case 'history':T.view='history';render();[T.results]=await Promise.all([loadResults(),loadNote()]);render();break;
    case 'logout':try{await sb.rpc('student_logout',{p_token:T.token})}catch(_){}saveToken(null);T.me=null;T.mustChange=false;T.results=null;T.msg='';T.view='home';render();break;
  }}catch(err){console.error(err);if(!/invalid_session|must_change_password|class_hidden/.test(err?.message||''))toast('문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.')}
});
async function submit(){
  T.busy=true;render();
  const dr=T.draft[dkey(T.cur)];
  try{const d=await rpc('student_submit',{p_token:T.token,p_test:T.cur,p_answers:dr.a});
    if(d.ok){toast('제출했습니다');delete T.draft[dkey(T.cur)];lsSet('gb-draft',T.draft);await refreshHome();T.view='home'}
    else toast(d.error==='closed'?'응시가 닫혀서 낼 수 없습니다':'답안 형식이 맞지 않습니다. 새로고침 뒤 다시 시도해 주세요');
  }finally{T.busy=false;render()}
}
(async function boot(){
  T.draft=lsGet('gb-draft',{})||{};
  for(const k of Object.keys(T.draft))if(!k.includes(':'))delete T.draft[k];// 예전 형식(학번 없는) 임시 답안은 버림
  loadSite(sb,'student');
  const tok=loadToken();
  if(tok){T.token=tok;try{await refreshHome()}catch(err){if(!T.mustChange)T.token=null}}
  render();
})();
