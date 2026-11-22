"use strict";
/* 근본국어 교사 화면 '반 관리' 탭: 반 고르기 → 반 요약(학생 수·비밀번호 상태) → 학생 표(찾기·거르기·줄마다 할 일).
   teacher.js보다 먼저 불러온다. 이 파일의 맨 위에서는 S 같은 teacher.js 값을 바로 쓰지 않고, 함수 안에서만 쓴다. */
const NONE='__none';// '반 없음' 학생 모음을 가리키는 값
function MG(){return S.mg||(S.mg={cls:lsGet('gb-mg-cls','')||'',q:'',f:'all',panel:null,text:'',plan:null,drop:false})}

/* 지금 학생 목록 [{uid,sid,name,cls,must,locked,until}] (cls ''=반 없음, until=잠금이 풀리는 시각 ms) */
function mgStudents(){
  if(S.demo){const out=[];for(const [c,l] of Object.entries(rosterLists()))for(const p of l)out.push({uid:p.id,sid:p.id,name:p.name,cls:c,must:false,locked:false});return out}
  const nameOf={};for(const [n,id] of Object.entries(S.idx.classByName))nameOf[id]=n;
  return Object.values(S.idx.studentById).map(x=>({uid:x.id,sid:x.sid,name:x.name,cls:nameOf[x.class_id]||'',must:x.must_change_pw!==false,locked:!!x.locked_until&&Date.parse(x.locked_until)>Date.now(),until:Date.parse(x.locked_until||'')||0})).sort((a,b)=>a.sid.localeCompare(b.sid));
}
const BADGE={must:['warn','아직 학번 그대로'],own:['good','직접 정함'],locked:['bad','잠김']};
const badge=k=>`<span class="badge ${BADGE[k][0]}">${BADGE[k][1]}</span>`;
const hhmm=ms=>new Date(ms).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});
const pwBadges=s=>(s.must?badge('must'):badge('own'))+(s.locked?' '+badge('locked')+(s.until?` <span class="sub">잠금 해제 예정 ${esc(hhmm(s.until))}</span>`:''):'');
/* 잠긴 학생: 비밀번호는 그대로 두고 잠금만 푼다(서버 teacher_unlock_student). 함수가 아직 없으면(SQL 실행 전) 안내만 한다. */
async function unlockStu(uid){
  if(S.demo){toast('예시 데이터에서는 바꾸지 않습니다');return}
  const s=stu(uid);const r=await sb.rpc('teacher_unlock_student',{p_student:uid});
  if(r.error){const missing=r.error.code==='PGRST202'||/teacher_unlock_student|function|schema cache/i.test(r.error.message||'');
    toast(missing?UNLOCK_MISSING:'잠금을 풀지 못했습니다: '+r.error.message);return}
  if(!r.data?.ok){toast('잠금을 풀지 못했습니다: 명단에서 학생을 찾지 못했습니다');return}
  await load();render();toast((s?who(s):'학생')+'의 잠금을 풀었습니다. 비밀번호는 그대로입니다');
}
const who=s=>`${s.name}(${s.sid})`;
const UNLOCK_MISSING='잠금만 풀기는 서버 준비가 필요합니다. Supabase SQL Editor에서 supabase/migrations/2026-11-ux-state.sql을 실행해 주세요. 지금은 비밀번호 초기화로도 잠금이 풀립니다';
/* 이 반 잠긴 학생 모두: 같은 teacher_unlock_student를 4명씩 나눠 부른다(진행 표시 → 결과 한 줄). 함수가 없으면 바로 멈추고 안내. */
async function unlockAll(c){
  const M=MG();if(S.demo){toast('예시 데이터에서는 바꾸지 않습니다');M.unlockAsk=false;render();return}
  const L=mgStudents().filter(s=>s.cls===c&&s.locked);M.unlockAsk=false;if(!L.length){render();return}
  M.unlockBusy={done:0,total:L.length};render();
  let ok=0,missing=false;const fail=[];
  for(let i=0;i<L.length&&!missing;i+=4){
    await Promise.all(L.slice(i,i+4).map(async s=>{
      try{const r=await sb.rpc('teacher_unlock_student',{p_student:s.uid});
        if(r.error){if(r.error.code==='PGRST202'||/teacher_unlock_student|function|schema cache/i.test(r.error.message||''))missing=true;else fail.push(s)}
        else if(r.data?.ok)ok++;else fail.push(s)}catch(e){fail.push(s)}
      M.unlockBusy.done++;const el=document.getElementById('mgUnlockProg');if(el)el.textContent=`잠금 푸는 중 ${M.unlockBusy.done}/${L.length}명…`}));
  }
  M.unlockBusy=null;
  if(missing&&!ok){render();toast(UNLOCK_MISSING);return}
  M.unlockMsg=`${ok}명 잠금 해제`+(fail.length?`, ${fail.length}명은 풀지 못함(${fail.map(x=>x.sid).join(', ')})`:'')+(missing?' · '+UNLOCK_MISSING:'');
  try{await load()}catch(e){}render();toast(M.unlockMsg);
}

/* ---------- 확인 상자 (Esc·취소 = 아니오) ----------
   돌려주는 값: true(ok 버튼) / false(취소·Esc). alt를 주면 버튼이 하나 더 생기고, 그것을 누르면 'alt'. */
function ask({title,msg,ok='확인',danger=false,alt=''}){
  let d=document.getElementById('gbDlg');
  if(!d){d=document.createElement('dialog');d.id='gbDlg';d.className='dlg';document.body.appendChild(d)}
  d.innerHTML=`<form method="dialog"><h2 id="gbDlgT"></h2><p id="gbDlgM"></p><div class="row" style="justify-content:flex-end"><button class="btn" value="no" autofocus>취소</button>${alt?'<button class="btn" value="alt" id="gbDlgAlt"></button>':''}<button class="btn ${danger?'red':'primary'}" value="yes" id="gbDlgOk"></button></div></form>`;
  d.setAttribute('aria-labelledby','gbDlgT');d.setAttribute('aria-describedby','gbDlgM');
  d.querySelector('#gbDlgT').textContent=title;d.querySelector('#gbDlgM').textContent=msg;d.querySelector('#gbDlgOk').textContent=ok;if(alt)d.querySelector('#gbDlgAlt').textContent=alt;
  return new Promise(res=>{d.onclose=()=>res(d.returnValue==='yes'?true:alt&&d.returnValue==='alt'?'alt':false);d.returnValue='';d.showModal()});
}

/* ---------- 화면 ---------- */
function viewClasses(){
  const M=MG();const cl=classes();const all=mgStudents();const none=all.filter(s=>!s.cls);
  if(M.cls!==NONE&&!cl.includes(M.cls))M.cls=cl[0]||(none.length?NONE:'');
  if(M.cls===NONE&&!none.length)M.cls=cl[0]||'';
  const cnt=c=>all.filter(s=>s.cls===c).length;
  const newForm=`<form id="mgNewForm" class="row mg-inline" style="margin-top:10px"><label class="f" style="flex:1;min-width:160px">새 반 이름<input type="text" id="mgNewName" maxlength="40" placeholder="예: 화목반" required></label><button class="btn primary" type="submit">반 만들기</button>${cl.length?'<button class="btn ghost" type="button" data-act="mg-panel" data-v="">취소</button>':''}</form>`;
  let h=`<div class="stack"><div class="card"><h2>반 관리</h2>`;
  if(!allClasses().length&&!none.length){
    return h+`<div class="empty" style="padding:20px 8px"><h3>아직 반이 없습니다</h3><p>방과후 반 이름을 적고 <b>반 만들기</b>를 누르세요. 반을 만든 뒤 수강생 명단을 붙여넣으면, 학생은 학번으로 로그인할 수 있습니다.</p><div style="max-width:420px;margin:0 auto;text-align:left">${newForm}</div></div></div></div>`;
  }
  h+=`<p class="sub">반을 고르면 그 반 학생과 비밀번호 상태가 아래에 나옵니다.</p>
   <div class="chips mg-picker" role="group" aria-label="반 고르기" style="margin-top:12px">${cl.map(c=>`<button class="chip${isHiddenCls(c)?' is-hidden':''}" aria-pressed="${M.cls===c}" data-act="mg-cls" data-v="${esc(c)}">${esc(c)} <span class="cnt">${cnt(c)}명</span>${isHiddenCls(c)?' <span class="badge">숨김</span>':''}</button>`).join('')}${none.length?`<button class="chip muted-chip" aria-pressed="${M.cls===NONE}" data-act="mg-cls" data-v="${NONE}">반 없음 <span class="cnt">${none.length}명</span></button>`:''}<button class="btn small" data-act="mg-panel" data-v="new" aria-expanded="${M.panel==='new'}">＋ 새 반</button>${hidToggle()}</div>
   ${M.panel==='new'?newForm:''}</div>`;
  h+=M.cls===NONE?viewNone(none):M.cls?viewOneClass(M.cls,all.filter(s=>s.cls===M.cls)):`<div class="card empty"><h3>보이는 반이 없습니다</h3><p>모든 반을 숨겼습니다. <b>＋ 새 반</b>으로 반을 만들거나, <b>숨긴 반 보기</b>를 눌러 숨긴 반을 다시 보이게 하세요.</p></div>`;
  return h+'</div>';
}

function viewOneClass(c,list){
  const M=MG();const hid=isHiddenCls(c);if(hid&&['paste','add'].includes(M.panel))M.panel=null;
  const n={all:list.length,must:list.filter(s=>s.must).length,own:list.filter(s=>!s.must).length,locked:list.filter(s=>s.locked).length};
  if(n[M.f]===undefined)M.f='all';
  const tile=(k,label,tone)=>`<button class="mg-tile ${tone}" aria-pressed="${M.f===k}" data-act="mg-f" data-v="${k}"><span class="k">${label}</span><span class="v">${n[k]}<small>명</small></span></button>`;
  let h=`<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${esc(c)}</h2>
    <div class="row" style="gap:6px">${hid?'<button class="btn small primary" data-act="mg-unhide">다시 보이기</button><button class="btn small" data-act="dx-go" data-v="'+esc(c)+'">개인정보 정리…</button>':'<button class="btn small" data-act="mg-hide">반 숨기기</button>'}<button class="btn small ghost" data-act="mg-panel" data-v="rename" aria-expanded="${M.panel==='rename'}">이름 바꾸기</button><button class="btn small ghost danger" data-act="mg-del-cls">반 삭제</button></div></div>
    ${hid?`<p class="note" style="margin-top:10px"><span class="badge">숨김</span> 수업이 끝나 숨긴 반입니다. 이 반 학생은 로그인할 수 없고, 시험 응시도 열 수 없습니다. 답안과 결과 기록은 그대로 남아 있어서, 반 분석·누적 추이에서 <b>숨긴 반 보기</b>를 켜면 볼 수 있습니다.</p>`:''}
    ${M.panel==='rename'?`<form id="mgRenameForm" class="row mg-inline" style="margin-top:10px"><label class="f" style="flex:1;min-width:160px">새 이름<input type="text" id="mgRename" maxlength="40" value="${esc(c)}" required></label><button class="btn primary" type="submit">이름 저장</button><button class="btn ghost" type="button" data-act="mg-panel" data-v="">취소</button></form>`:''}
    <div class="mg-tiles" role="group" aria-label="비밀번호 상태로 거르기">${tile('all','학생','')}${tile('must','아직 학번 그대로','warn')}${tile('own','직접 정함','good')}${tile('locked','잠김','bad')}</div>
    ${n.locked&&!hid||M.unlockBusy||M.unlockMsg?`<div class="mg-unlock" role="status">${M.unlockBusy?`<span id="mgUnlockProg" class="sub"><b>잠금 푸는 중 ${M.unlockBusy.done}/${M.unlockBusy.total}명…</b></span>`
      :M.unlockAsk?`<span class="confirm" role="alert">잠긴 학생 ${n.locked}명의 잠금을 풉니다. 비밀번호는 그대로입니다. <span class="row" style="gap:6px"><button class="btn small primary" data-act="mg-unlock-all-yes">모두 풀기</button><button class="btn small" data-act="mg-unlock-all-no">취소</button></span></span>`
      :`${n.locked&&!hid?`<button class="btn small primary" data-act="mg-unlock-all">이 반 잠금 모두 풀기 (${n.locked}명)</button>`:''}${M.unlockMsg?` <span class="sub">${esc(M.unlockMsg)}</span>`:''}`}</div>`:''}
    <p class="sub" style="margin-top:8px">학생은 학번과 비밀번호로 로그인합니다. 처음 비밀번호는 <b>학번</b>이고, 처음 로그인하면 새 비밀번호를 정해야 시험을 볼 수 있습니다. 칸을 누르면 그 상태의 학생만 보입니다.</p>
    ${hid?'':`<div class="row" style="margin-top:12px"><button class="btn primary" data-act="mg-panel" data-v="paste" aria-expanded="${M.panel==='paste'}">명단 붙여넣기</button><button class="btn" data-act="mg-panel" data-v="add" aria-expanded="${M.panel==='add'}">학생 한 명 추가</button></div>`}
    ${M.panel==='paste'?pastePanel(c):''}${M.panel==='add'?addPanel():''}
  </div>`;
  if(!list.length)return h+(hid?`<div class="card empty"><h3>${esc(c)}에 학생이 없습니다</h3></div>`:`<div class="card empty"><h3>${esc(c)}에 아직 학생이 없습니다</h3><p><b>명단 붙여넣기</b>로 수강생 표를 통째로 붙여넣거나, <b>학생 한 명 추가</b>를 누르세요.</p></div>`);
  const shown=list.filter(s=>M.f==='all'||(M.f==='must'&&s.must)||(M.f==='own'&&!s.must)||(M.f==='locked'&&s.locked));
  const others=liveClasses().filter(x=>x!==c);
  return h+studentTable(shown,list.length,s=>`${s.locked&&!hid?`<button class="btn small primary" data-act="mg-unlock" data-v="${esc(s.uid)}">잠금만 풀기</button>`:''}${hid?'':`<button class="btn small" data-act="mg-reset" data-v="${esc(s.uid)}">비밀번호 초기화</button>`}${others.length?`<select class="mg-move" data-uid="${esc(s.uid)}" aria-label="${esc(who(s))} 다른 반으로 옮기기"><option value="">다른 반으로…</option>${others.map(o=>`<option>${esc(o)}</option>`).join('')}</select>`:''}${hid?'':`<button class="btn small ghost danger" data-act="mg-out" data-v="${esc(s.uid)}">반에서 빼기</button>`}`);
}

function viewNone(list){
  return `<div class="card"><h2 style="margin:0 0 4px">반 없음</h2><p class="sub">반이 지워졌거나 반에서 뺀 학생입니다. 답안 기록은 남아 있지만, 반에 넣기 전에는 시험을 볼 수 없습니다.</p></div>`+
    studentTable(list,list.length,s=>`${liveClasses().length?`<select class="mg-move" data-uid="${esc(s.uid)}" aria-label="${esc(who(s))} 반에 넣기"><option value="">반에 넣기…</option>${liveClasses().map(o=>`<option>${esc(o)}</option>`).join('')}</select>`:''}<button class="btn small" data-act="mg-reset" data-v="${esc(s.uid)}">비밀번호 초기화</button>`);
}

function studentTable(rows,total,actions){
  const M=MG();const q=M.q.trim();
  const hit=s=>!q||s.sid.includes(q)||s.name.includes(q);
  const vis=rows.filter(hit).length;
  return `<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:10px"><label class="f" style="flex:1;max-width:280px">학번·이름 찾기<input type="search" id="stuQ" value="${esc(M.q)}" placeholder="예: 20315 또는 김하늘" autocomplete="off"></label><span class="sub" id="stuQn" role="status">${rows.length<total?`${total}명 중 `:''}${vis}명</span></div>
   ${rows.length?`<div class="tbl-wrap mg-wrap"><table class="mg-table"><thead><tr><th>학번</th><th>이름</th><th>비밀번호</th><th><span class="sr">할 일</span></th></tr></thead><tbody>${rows.map(s=>`<tr data-q="${esc(s.sid+' '+s.name)}" ${hit(s)?'':'hidden'}><td class="mono" data-l="학번">${esc(s.sid)}</td><td class="nm" data-l="이름">${esc(s.name)}</td><td data-l="비밀번호">${pwBadges(s)}</td><td class="acts"><div class="acts-in">${actions(s)}</div></td></tr>`).join('')}</tbody></table></div><p class="muted" id="stuQe" ${vis?'hidden':''} style="margin-top:10px">찾는 학생이 없습니다.</p>`:'<p class="muted">이 상태의 학생이 없습니다. 위의 <b>학생</b> 칸을 누르면 모두 보입니다.</p>'}</div>`;
}

function pastePanel(c){
  const M=MG();const P=M.plan;
  let h=`<div class="mg-panel"><h3>명단 붙여넣기 · ${esc(c)}</h3>
   <p class="sub">한 줄에 한 명씩, <b>5자리 학번 뒤에 이름</b>을 적습니다. 예: <span class="mono">20315 김하늘</span><br>이름에는 한글·영문·띄어쓰기·가운뎃점(·)·붙임표(-)를 쓸 수 있습니다(30자까지). 띄어 쓴 이름(예: 마리아 로페즈)은 엑셀 표처럼 칸을 나눠 붙여넣거나 '학생 한 명 추가' 버튼으로 넣으세요.<br>수강생 표를 통째로 복사해 붙여넣어도 됩니다. 순번·신청시간·머리글 줄은 알아서 건너뜁니다.</p>
   <label class="f" style="margin-top:8px"><span class="sr">명단</span><textarea id="rosterText" rows="7" placeholder="20315 김하늘&#10;20316 이바다">${esc(M.text)}</textarea></label>
   <div class="row" style="margin-top:8px"><button class="btn" data-act="mg-plan">미리 보기</button><button class="btn ghost" data-act="mg-panel" data-v="">닫기</button></div>`;
  if(!P)return h+'</div>';
  const sum=[['add','새로 추가','good'],['move','다른 반에서 옮겨 옴','warn'],['rename','이름 바뀜','warn'],['same','그대로',''],['errors','고칠 줄','bad'],['skipped','건너뛴 줄','']];
  h+=`<div id="mgPlan" style="margin-top:12px"><div class="row" style="gap:6px">${sum.map(([k,l,t])=>`<span class="badge ${t}">${l} ${P[k].length}</span>`).join('')}</div>`;
  if(P.errors.length)h+=`<div class="mg-errs" role="alert"><b>아래 줄은 읽지 못해 저장되지 않습니다. 고친 뒤 다시 미리 보기를 누르세요.</b><ul>${P.errors.map(e=>`<li><b>${e.line}번째 줄</b> <span class="mono">${esc(e.text)}</span> → ${esc(e.msg)}</li>`).join('')}</ul></div>`;
  const ch=[...P.add.map(x=>({...x,what:'새로 추가'})),...P.move.map(x=>({...x,what:`${x.from||'반 없음'} → ${c}`+(x.oldName!==x.name?` (이름 ${x.oldName} → ${x.name})`:'')})),...P.rename.map(x=>({...x,what:`이름 ${x.oldName} → ${x.name}`}))].sort((a,b)=>a.line-b.line);
  if(ch.length)h+=`<div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th class="n">줄</th><th>학번</th><th>이름</th><th>바뀌는 것</th></tr></thead><tbody>${ch.map(x=>`<tr><td class="n muted">${x.line}</td><td class="mono">${esc(x.sid)}</td><td style="white-space:nowrap">${esc(x.name)}</td><td>${esc(x.what)}</td></tr>`).join('')}</tbody></table></div>`;
  if(P.same.length)h+=`<details class="ex"><summary>그대로인 학생 ${P.same.length}명</summary><div>${P.same.map(x=>esc(x.sid+' '+x.name)).join(', ')}</div></details>`;
  if(P.skipped.length)h+=`<details class="ex"><summary>학번이 없어 건너뛴 줄 ${P.skipped.length}개 (머리글 등)</summary><div>${P.skipped.map(x=>`${x.line}번째 줄: ${esc(x.text)}`).join('\n')}</div></details>`;
  if(P.missing.length)h+=`<label class="mg-check"><input type="checkbox" id="mgDrop" ${M.drop?'checked':''}> 붙여넣은 명단에 없는 ${P.missing.length}명(${esc(P.missing.slice(0,5).map(x=>x.name).join(', '))}${P.missing.length>5?' 등':''})을 이 반에서 빼기<br><span class="sub">빼도 답안 기록은 남고, 학생은 '반 없음'으로 옮겨집니다.</span></label>`;
  const nSave=P.changes+(M.drop?P.missing.length:0);
  h+=`<div class="row" style="margin-top:10px"><button class="btn primary" data-act="mg-save" ${nSave?'':'disabled'}>${nSave?`${nSave}명 저장`:'바뀌는 학생이 없습니다'}</button>${P.add.length?'<span class="sub">새로 추가한 학생의 처음 비밀번호는 학번입니다.</span>':''}</div></div>`;
  return h+'</div>';
}

function addPanel(){
  return `<form id="mgAddForm" class="mg-panel"><h3>학생 한 명 추가</h3><div class="row" style="align-items:flex-end"><label class="f">학번 (5자리)<input type="text" id="mgAddSid" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" required style="width:110px"></label><label class="f">이름<input type="text" id="mgAddName" maxlength="30" required style="width:140px"></label><button class="btn primary" type="submit">추가</button><button class="btn ghost" type="button" data-act="mg-panel" data-v="">닫기</button></div><p class="sub" style="margin-top:6px">처음 비밀번호는 학번입니다. 다른 반에 있는 학번이면 이 반으로 옮길지 물어봅니다.</p></form>`;
}

/* ---------- 저장 ---------- */
async function setHidden(c,on){
  if(S.demo){toast('예시 데이터에서는 저장되지 않습니다');return}
  const r=await sb.rpc('teacher_set_class_hidden',{p_class:clsId(c),p_hidden:on});
  if(r.error||!r.data?.ok){toast('바꾸지 못했습니다: '+(r.error?.message||'반을 찾지 못했습니다. 최신 schema.sql을 실행했는지 확인해 주세요'));return}
  await load();if(on&&!S.showHidden)MG().cls='';render();
  toast(on?`'${c}' 반을 숨겼습니다. 다시 보려면 '숨긴 반 보기'를 누르세요`:`'${c}' 반을 다시 보이게 했습니다`);
}
const stu=uid=>mgStudents().find(s=>s.uid===uid);
async function moveTo(uid,c){const s=stu(uid);if(!s)return;
  if(!await ask({title:'다른 반으로 옮기기',msg:`${who(s)} 학생을 ${c}(으)로 옮깁니다. 답안 기록은 그대로이고, 앞으로 ${c} 시험을 보게 됩니다.`,ok:'옮기기'})){render();return}
  await api(async()=>chk(await sb.from('students').update({class_id:clsId(c)}).eq('id',uid)),`${s.name} 학생을 ${c}(으)로 옮겼습니다`)}
async function savePlan(){
  const M=MG();const P=M.plan;const c=M.cls;if(!P)return;const cid=clsId(c);
  const up=[...P.add,...P.move,...P.rename].map(x=>({sid:x.sid,name:x.name,class_id:cid}));
  const out=M.drop?P.missing.map(x=>x.uid):[];
  const ok=await api(async()=>{
    if(up.length)chk(await sb.from('students').upsert(up,{onConflict:'sid'}));
    if(out.length)chk(await sb.from('students').update({class_id:null}).in('id',out));
  },`${c} 명단을 저장했습니다`+(()=>{const t=[[P.add.length,'추가'],[P.move.length,'옮김'],[P.rename.length,'이름 고침'],[out.length,'뺌']].filter(x=>x[0]).map(([n,l])=>`${l} ${n}명`);return t.length?` (${t.join(', ')})`:''})());
  if(ok){M.plan=null;M.text='';M.drop=false;M.panel=null;render()}
}

/* ---------- 동작 ---------- */
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act^="mg-"]');if(!b)return;
  const M=MG();const v=b.dataset.v;
  switch(b.dataset.act){
    case 'mg-cls':M.cls=v;M.q='';M.f='all';M.plan=null;M.drop=false;M.unlockAsk=false;M.unlockMsg='';if(M.panel!=='new')M.panel=null;lsSet('gb-mg-cls',v);render();break;
    case 'mg-f':M.f=v;render();break;
    case 'mg-panel':M.panel=M.panel===v?null:(v||null);render();{const f={new:'#mgNewName',rename:'#mgRename',paste:'#rosterText',add:'#mgAddSid'}[M.panel];if(f)$(f)?.focus()}break;
    case 'mg-plan':M.text=$('#rosterText').value;M.plan=rosterPlan(M.text,M.cls,mgStudents());M.drop=false;render();break;
    case 'mg-save':await savePlan();break;
    case 'mg-unlock-all':MG().unlockAsk=true;MG().unlockMsg='';render();break;
    case 'mg-unlock-all-no':MG().unlockAsk=false;render();break;
    case 'mg-unlock-all-yes':await unlockAll(MG().cls);break;
    case 'mg-unlock':{const s=stu(v);if(!s)break;if(await ask({title:'잠금만 풀기',msg:`${who(s)} 학생의 잠금을 풉니다. 비밀번호는 바뀌지 않으니 학생은 원래 비밀번호로 바로 로그인할 수 있습니다. (다른 학생이 일부러 틀려서 잠근 경우에 쓰세요)`,ok:'잠금 풀기'}))await unlockStu(v);break}
    case 'mg-reset':{const s=stu(v);if(!s)break;if(await ask({title:'비밀번호 초기화',msg:`${who(s)} 학생의 비밀번호를 학번으로 되돌립니다. 잠금도 풀리고, 지금 로그인해 있으면 로그아웃됩니다.`,ok:'초기화',danger:true}))await resetPw(v);break}
    case 'mg-out':{const s=stu(v);if(!s)break;if(await ask({title:'반에서 빼기',msg:`${who(s)} 학생을 ${s.cls}에서 뺍니다. 답안 기록은 남지만, 다시 반에 넣기 전에는 시험을 볼 수 없습니다.`,ok:'반에서 빼기',danger:true}))await api(async()=>chk(await sb.from('students').update({class_id:null}).eq('id',v)),`${s.name} 학생을 반에서 뺐습니다`);break}
    case 'mg-hide':{const c=M.cls;const n=mgStudents().filter(s=>s.cls===c).length;
      if(await ask({title:'반 숨기기',msg:`숨기면 '${c}' 학생 ${n}명은 더 이상 로그인할 수 없습니다. 답안과 결과 기록은 그대로 남고, 언제든 다시 보이게 할 수 있습니다.`,ok:'반 숨기기',danger:true}))
        await setHidden(c,true);break}
    case 'mg-unhide':{const c=M.cls;if(await ask({title:'다시 보이기',msg:`'${c}' 반을 다시 보이게 합니다. 이 반 학생은 다시 로그인할 수 있습니다.`,ok:'다시 보이기'}))await setHidden(c,false);break}
    case 'mg-del-cls':{const c=M.cls;const n=mgStudents().filter(s=>s.cls===c).length;
      if(await ask({title:'반 삭제',msg:`'${c}' 반을 지웁니다. ${n?`학생 ${n}명은 '반 없음'으로 옮겨지고 `:''}답안 기록은 남지만, 이 반의 시험 응시·결과 공개 설정은 사라집니다.`,ok:'반 삭제',danger:true})){
        const ok=await api(async()=>chk(await sb.from('classes').delete().eq('id',clsId(c))),`'${c}' 반을 지웠습니다`);if(ok){M.cls='';render()}}break}
  }
});
document.addEventListener('change',async e=>{
  const el=e.target;
  if(el.id==='mgDrop'){MG().drop=el.checked;render();return}
  if(el.classList?.contains('mg-move')&&el.value)await moveTo(el.dataset.uid,el.value);
});
document.addEventListener('input',e=>{
  const el=e.target;if(!S.mg)return;
  if(el.id==='rosterText'&&S.tab==='classes'){S.mg.text=el.value;if(S.mg.plan){S.mg.plan=null;$('#mgPlan')?.remove()}}
  if(el.id==='stuQ'){S.mg.q=el.value;const q=el.value.trim();let vis=0,all=0;
    document.querySelectorAll('.mg-table tbody tr').forEach(tr=>{all++;const ok=!q||tr.dataset.q.includes(q);tr.hidden=!ok;if(ok)vis++});
    const n=$('#stuQn');if(n)n.textContent=vis+'명';const em=$('#stuQe');if(em)em.hidden=!!vis}
});
document.addEventListener('submit',async e=>{
  const f=e.target;const M=S.mg;
  if(f.id==='mgNewForm'){e.preventDefault();const n=normName($('#mgNewName').value);if(!n)return;
    if(classes().includes(n)){toast('이미 있는 반 이름입니다');return}
    const ok=await api(async()=>chk(await sb.from('classes').insert({name:n})),`'${n}' 반을 만들었습니다. 이제 명단을 붙여넣으세요`);
    if(ok){MG().cls=n;MG().panel='paste';lsSet('gb-mg-cls',n);render();$('#rosterText')?.focus()}}
  if(f.id==='mgRenameForm'){e.preventDefault();const old=M.cls;const n=normName($('#mgRename').value);if(!n||n===old){M.panel=null;render();return}
    if(classes().includes(n)){toast('이미 있는 반 이름입니다');return}
    const ok=await api(async()=>chk(await sb.from('classes').update({name:n}).eq('id',clsId(old))),`반 이름을 '${n}'(으)로 바꿨습니다`);
    if(ok){M.cls=n;M.panel=null;if(S.cf===old){S.cf=n;lsSet('omr-cf',n)}lsSet('gb-mg-cls',n);render()}}
  if(f.id==='mgAddForm'){e.preventDefault();const sid=$('#mgAddSid').value.trim(),name=normName($('#mgAddName').value);
    const P=rosterPlan(sid+'\t'+name,M.cls,mgStudents());// 탭으로 이어 '마리아 로페즈'처럼 띄어 쓴 이름도 통째로
    if(P.errors.length||!(P.add.length+P.move.length+P.rename.length+P.same.length)){toast(P.errors[0]?.msg||'학번 5자리와 이름을 적어 주세요');return}
    if(P.same.length){toast('이미 이 반에 있는 학생입니다');return}
    const m=P.move[0];if(m&&!await ask({title:'다른 반에 있는 학번',msg:`${m.sid}은(는) 지금 ${m.from||'반 없음'}의 ${m.oldName} 학생입니다. ${M.cls}(으)로 옮길까요?`,ok:'옮기기'}))return;
    M.plan=P;M.drop=false;await savePlan()}
});
