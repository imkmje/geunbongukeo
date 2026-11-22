"use strict";
/* 근본국어 교사 화면 '내보내기·정리' 탭: CSV·백업 내려받기 + 수업 끝난(숨긴) 반 개인정보 정리(익명화).
   - 비밀번호(해시)·로그인 세션은 어떤 파일에도 넣지 않는다(students는 고른 칸만 읽고, student_sessions는 교사도 못 읽음).
   - 익명화는 서버 함수 teacher_anonymize_class 하나로 한꺼번에 한다(supabase/schema.sql 맨 끝).
   - teacher.js보다 먼저 불러온다. S·D() 같은 teacher.js 값은 함수 안에서만 쓴다. 표 만들기는 js/tools-logic.js. */
function DX(){return S.dx||(S.dx={tid:'',tcls:'',ccls:'',anon:{cls:'',exported:0,skip:false,typed:'',busy:false}})}

/* ---------- 자료 모으기 ---------- */
/* 학생 [{uid,sid,name,cls}] (c가 주어지면 그 반만). 반 없는 학생은 cls '' */
function dxStudents(c){
  let all;
  if(S.demo){all=[];for(const [cl,l] of Object.entries(rosterLists()))for(const p of l)all.push({uid:p.id,sid:p.id,name:p.name,cls:cl})}
  else{const nameOf={};for(const [n,id] of Object.entries(S.idx.classByName))nameOf[id]=n;
    all=Object.values(S.idx.studentById).map(x=>({uid:x.id,sid:x.sid,name:x.name,cls:nameOf[x.class_id]||''}))}
  return (c==null?all:all.filter(s=>s.cls===c)).sort((a,b)=>a.sid.localeCompare(b.sid));
}
/* 한 시험의 답안 {학번:{a,el,at,src}} (숨긴 반 포함 전부) */
function dxSubs(tid){const o={};for(const r of recordsFor(tid,'',true))o[ident(r.name)]={a:r.a,el:r.el||'',at:r.at,src:r.src};return o}
const dxTests=()=>testList().map(t=>({id:t.id,title:t.title,items:t.items,key:keyOf(t.id)}));
function dxSubsAll(){const o={};for(const t of testList())o[t.id]=dxSubs(t.id);return o}

function dxDownload(name,text,type){
  const blob=new Blob([text],{type});const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);
}
const dxCsv=(name,rows)=>dxDownload(safeFileName(name)+'.csv',CSV_BOM+toCsv(rows),'text/csv;charset=utf-8');
const dxToday=()=>new Date().toISOString().slice(0,10);

function csvTest(tid,c){
  const t=D().tests[tid];if(!t){toast('시험을 골라 주세요');return false}
  const studs=dxStudents(c||null).filter(s=>c||s.cls);// '모든 반' = 반에 속한 학생 전부
  dxCsv(`근본국어_${t.title}_${c||'모든 반'}_성적_${dxToday()}`,testCsvRows(t,keyOf(tid),studs,dxSubs(tid)));return true;
}
function csvCum(c){dxCsv(`근본국어_${c}_누적 점수_${dxToday()}`,classCumRows(dxTests(),dxStudents(c),dxSubsAll()));return true}
function csvClassAll(c){dxCsv(`근본국어_${c}_전체 답안 기록_${dxToday()}`,classAnswerRows(dxTests(),dxStudents(c),dxSubsAll()));return true}

/* 전체 백업(JSON): 교사가 읽을 수 있는 표 전부. students는 비밀번호 칸을 빼고 고른 칸만 읽는다. */
const BACKUP_COLS={classes:'*',students:'id,sid,name,class_id,must_change_pw,created_at',tests:'*',test_keys:'*',test_class:'*',submissions:'*'};
const BACKUP_ORD={classes:['id'],students:['id'],tests:['id'],test_keys:['test_id'],test_class:['test_id','class_id'],submissions:['id']};
async function dxBackup(){
  const out={app:'근본국어',kind:'backup',version:1,exported_at:new Date().toISOString(),note:'학생 비밀번호(해시)와 로그인 세션은 넣지 않았습니다.',tables:{}};
  if(S.demo){out.note+=' 예시 데이터입니다.';out.tables={tests:D().tests,keys:D().keys,roster:D().roster,answers:D().manual}}
  else{
    for(const [t,cols] of Object.entries(BACKUP_COLS)){const rows=[];
      for(let from=0;;from+=1000){let q=sb.from(t).select(cols);for(const c of BACKUP_ORD[t])q=q.order(c);const r=await q.range(from,from+999);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<1000)break}
      if(t==='students')for(const x of rows){delete x.code_hash;delete x.fail_count;delete x.locked_until}// 혹시 칸이 섞여 와도 뺀다
      out.tables[t]=rows}
    const st=await sb.from('site_settings').select('title,student_subtitle,teacher_subtitle').eq('id',1).maybeSingle();if(!st.error)out.tables.site_settings=st.data;
  }
  dxDownload(`근본국어_전체 백업_${dxToday()}.json`,JSON.stringify(out,null,1),'application/json');
}

/* ---------- 화면 ---------- */
function viewData(){
  const X=DX();const ts=testList();const cl=allClasses();
  if(X.tid&&!D().tests[X.tid])X.tid='';if(!X.tid&&ts.length)X.tid=ts[ts.length-1].id;
  if(X.tcls&&!cl.includes(X.tcls))X.tcls='';if(!X.ccls||!cl.includes(X.ccls))X.ccls=cl[0]||'';
  const clsOpt=(sel,all)=>(all?`<option value="" ${sel?'':'selected'}>모든 반</option>`:'')+cl.map(c=>`<option value="${esc(c)}" ${c===sel?'selected':''}>${esc(c)}${isHiddenCls(c)?' (숨김)':''}</option>`).join('');
  let h=`<div class="stack"><div class="card"><h2>자료 내보내기</h2><p class="sub">엑셀에서 바로 열리는 CSV 파일로 내려받습니다. 학생 비밀번호와 로그인 정보는 어떤 파일에도 들어가지 않습니다. 숨긴 반도 고를 수 있습니다.</p></div>
  <div class="grid2"><div class="card"><h3>시험별 성적</h3><p class="sub" style="margin-bottom:10px">한 시험의 학생별 점수와 문항별 답·정답 여부(O/X)입니다. 아직 안 낸 학생도 '미제출'로 들어갑니다.</p>
    ${ts.length?`<div class="row" style="align-items:flex-end"><label class="f" style="flex:2;min-width:180px">시험<select id="dxTest">${ts.map(t=>`<option value="${t.id}" ${t.id===X.tid?'selected':''}>${esc(t.title)}</option>`).join('')}</select></label><label class="f" style="flex:1;min-width:120px">반<select id="dxTCls">${clsOpt(X.tcls,true)}</select></label><button class="btn primary" data-act="dx-test">CSV 내려받기</button></div>`:'<p class="muted">아직 시험이 없습니다.</p>'}</div>
   <div class="card"><h3>반 누적 점수</h3><p class="sub" style="margin-bottom:10px">한 반 학생 × 회차 점수표입니다. 맨 끝에 응시 횟수와 평균(100점 환산), 맨 아래에 회차별 반 평균이 붙습니다.</p>
    ${cl.length?`<div class="row" style="align-items:flex-end"><label class="f" style="flex:1;min-width:140px">반<select id="dxCCls">${clsOpt(X.ccls,false)}</select></label><button class="btn primary" data-act="dx-cum">CSV 내려받기</button></div>`:'<p class="muted">아직 반이 없습니다.</p>'}</div></div>
  <div class="card"><div class="row" style="justify-content:space-between"><div><h3 style="margin:0 0 4px">전체 백업</h3><p class="sub">반·학생(이름·학번)·시험·정답·해설·응시 설정·답안을 모두 한 파일(JSON)로 받습니다. 비밀번호와 로그인 정보는 빠집니다. 학기가 끝날 때 한 번 받아 두면 좋습니다.</p></div><button class="btn" data-act="dx-backup">백업 파일 받기</button></div></div>`;
  h+=viewAnon();
  return h+'</div>';
}

function viewAnon(){
  const A=DX().anon;const hid=hiddenClasses();
  let h=`<div class="card dx-anon"><h2>수업 끝난 반 개인정보 정리</h2><p class="sub">숨긴 반 학생의 이름과 학번을 '학생01'·'90001' 같은 번호로 바꾸고 비밀번호를 지웁니다. 답안과 점수는 그대로 남아 반 분석·누적 추이는 계속 볼 수 있습니다.</p>`;
  if(!hid.length)return h+`<p class="note" style="margin-top:12px">숨긴 반이 없습니다. 수업이 끝난 반은 먼저 <button class="btn small" data-act="tab" data-v="classes">반 관리</button>에서 <b>반 숨기기</b>를 눌러 주세요.</p></div>`;
  if(A.cls&&!hid.includes(A.cls))A.cls='';
  const cnt=c=>{const l=dxStudents(c);return {all:l.length,left:l.filter(s=>!isAnon(s)).length}};
  h+=`<ol class="dx-steps"><li class="${A.cls?'done':'cur'}"><h3>① 반 고르기</h3><div class="chips" role="group" aria-label="정리할 반">${hid.map(c=>{const n=cnt(c);return `<button class="chip" aria-pressed="${A.cls===c}" data-act="dx-anon-cls" data-v="${esc(c)}">${esc(c)} <span class="cnt">${n.all}명</span>${n.all&&!n.left?' <span class="badge good">정리됨</span>':''}</button>`}).join('')}</div></li>`;
  if(!A.cls)return h+'</ol></div>';
  const c=A.cls;const list=dxStudents(c);let plan=[];let full=false;
  try{plan=anonPlan(list.map(s=>({uid:s.uid,sid:s.sid,name:s.name})),dxStudents(null).map(s=>s.sid))}catch(e){full=true}
  if(!list.length)return h+`<li class="cur"><p class="sub">${esc(c)}에 학생이 없습니다. 정리할 것이 없습니다.</p></li></ol></div>`;
  if(!plan.length&&!full)return h+`<li class="done"><p class="sub"><span class="badge good">정리됨</span> ${esc(c)} 학생 ${list.length}명은 이미 모두 번호로 바뀌었고 비밀번호도 지워졌습니다.</p></li></ol></div>`;
  const ready=A.exported||A.skip;
  h+=`<li class="${ready?'done':'cur'}"><h3>② 기록 먼저 내려받기</h3><p class="sub">정리한 뒤에는 이 반 학생의 이름을 다시 알 수 없습니다. 이름이 들어 있는 기록을 지금 받아 두세요.</p>
    <div class="row" style="margin-top:8px"><button class="btn primary" data-act="dx-anon-export">${esc(c)} 전체 답안 기록 받기 (CSV)</button><button class="btn" data-act="dx-anon-cum">누적 점수표도 받기</button>${A.exported?`<span class="badge good">✓ ${new Date(A.exported).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 받음</span>`:''}</div>
    <label class="mg-check"><input type="checkbox" id="dxSkip" ${A.skip?'checked':''}> 내려받지 않고 진행합니다 (이미 따로 받아 두었습니다)</label></li>`;
  const show=plan.slice(0,6);
  h+=`<li class="${ready?'cur':''}"><h3>③ 바뀌는 내용</h3><div class="tbl-wrap"><table><thead><tr><th>지금</th><th aria-hidden="true"></th><th>정리한 뒤</th></tr></thead><tbody>${show.map(p=>`<tr><td><span class="mono">${esc(p.sid)}</span> ${esc(p.name)}</td><td class="muted" aria-hidden="true">→</td><td><span class="mono">${esc(p.newSid)}</span> ${esc(p.label)}</td></tr>`).join('')}</tbody></table></div>
    ${plan.length>show.length?`<p class="sub" style="margin-top:6px">외 ${plan.length-show.length}명 (학번 순서대로 번호를 붙입니다)</p>`:''}
    ${full?'<p class="note">새 번호를 붙일 자리가 없습니다(90001~99999를 모두 씀). 관리자에게 문의하세요.</p>':''}
    <p class="sub" style="margin-top:8px">학번도 바꾸는 까닭: 학번은 명부와 맞춰 보면 누구인지 바로 알 수 있고, 내년에 같은 학번을 받은 새 학생의 명단을 넣을 때 옛 기록이 섞이지 않게 하려는 것입니다. 9로 시작하는 학번은 실제로 쓰이지 않습니다.</p></li>`;
  h+=`<li class="${ready?'cur':''}"><h3>④ 확인하고 정리하기</h3>
    <p class="dx-warn"><b>되돌릴 수 없습니다.</b> ${esc(c)} 학생 ${plan.length}명의 이름·학번이 번호로 바뀌고 비밀번호가 지워져 아무도 이 학생들로 로그인할 수 없게 됩니다.</p>
    <label class="f" style="max-width:320px;margin-top:8px"><span>확인을 위해 반 이름 <b>${esc(c)}</b>을(를) 그대로 적으세요</span><input type="text" id="dxTyped" value="${esc(A.typed)}" autocomplete="off" ${ready?'':'disabled'}></label>
    <div class="row" style="margin-top:10px"><button class="btn red" id="dxGo" data-act="dx-anon-go" ${ready&&A.typed.trim()===c&&!full&&!A.busy?'':'disabled'}>${A.busy?'정리하는 중…':`${plan.length}명 개인정보 정리`}</button>${ready?'':'<span class="sub">② 기록을 받거나 건너뛰기를 고르면 진행할 수 있습니다.</span>'}</div></li></ol></div>`;
  return h;
}

/* ---------- 익명화 실행 ---------- */
async function dxAnonGo(){
  const A=DX().anon;const c=A.cls;if(!c||A.typed.trim()!==c||!(A.exported||A.skip))return;
  if(S.demo){toast('예시 데이터에서는 저장되지 않습니다');return}
  A.busy=true;render();
  const r=await sb.rpc('teacher_anonymize_class',{p_class:clsId(c),p_confirm:A.typed.trim()});
  A.busy=false;
  const err=r.error?.message||(!r.data?.ok&&r.data?.error);
  if(err){render();toast('정리하지 못했습니다: '+({confirm_mismatch:'반 이름이 맞지 않습니다',not_hidden:'숨긴 반만 정리할 수 있습니다',not_found:'반을 찾지 못했습니다',sid_full:'새 번호를 붙일 자리가 없습니다'}[err]||(/teacher_anonymize_class/.test(err)?'최신 schema.sql을 Supabase에서 실행했는지 확인해 주세요':err)));return}
  A.typed='';A.exported=0;A.skip=false;
  try{await load()}catch(e){console.error(e)}
  render();toast(`'${c}' 학생 ${r.data.changed}명의 개인정보를 정리했습니다`);
}

/* ---------- 동작 ---------- */
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act^="dx-"]');if(!b)return;const X=DX(),A=X.anon;const v=b.dataset.v;
  switch(b.dataset.act){
    case 'dx-test':csvTest($('#dxTest')?.value||X.tid,$('#dxTCls')?.value??X.tcls);break;
    case 'dx-cum':{const c=$('#dxCCls')?.value||X.ccls;if(c)csvCum(c);break}
    case 'dx-backup':b.disabled=true;try{await dxBackup();toast('백업 파일을 내려받았습니다')}catch(err){console.error(err);toast('백업하지 못했습니다: '+(err?.message||err))}b.disabled=false;break;
    case 'dx-go':S.tab='data';S.confirm=null;A.cls=v;A.exported=0;A.skip=false;A.typed='';render();$('.dx-anon')?.scrollIntoView({block:'start'});break;
    case 'dx-anon-cls':if(A.cls!==v){A.cls=v;A.exported=0;A.skip=false;A.typed=''}render();break;
    case 'dx-anon-export':if(csvClassAll(A.cls)){A.exported=Date.now();render()}break;
    case 'dx-anon-cum':csvCum(A.cls);break;
    case 'dx-anon-go':await dxAnonGo();break;
  }
});
document.addEventListener('change',e=>{
  const el=e.target;const X=S.dx;if(!X)return;
  if(el.id==='dxTest')X.tid=el.value;
  if(el.id==='dxTCls')X.tcls=el.value;
  if(el.id==='dxCCls')X.ccls=el.value;
  if(el.id==='dxSkip'){X.anon.skip=el.checked;render()}
});
document.addEventListener('input',e=>{
  const el=e.target;if(el.id!=='dxTyped'||!S.dx)return;const A=S.dx.anon;A.typed=el.value;
  const go=$('#dxGo');if(go)go.disabled=!((A.exported||A.skip)&&A.typed.trim()===A.cls&&!A.busy);
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='dxTyped'){e.preventDefault();if(!$('#dxGo')?.disabled)dxAnonGo()}});
