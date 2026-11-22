"use strict";
/* 근본국어 교사 화면 '시험 관리' → '파일로 새 시험 만들기'
   NN차시_사이트등록_통계.txt / NN차시_사이트등록_해설.txt 를 여러 쌍 한꺼번에 골라(또는 끌어다 놓아) 차시 번호로 짝짓고,
   미리 보기 표를 확인한 뒤 시험 편집기와 같은 방식(tests + test_keys 저장)으로 저장한다.
   파일 내용은 이 브라우저 안에서만 읽고, 저장 버튼을 누르기 전에는 아무 데도 보내지 않는다.
   teacher.js보다 먼저 불러온다. 짝짓기·제목·내용 읽기는 js/tools-logic.js(pairSessionFiles·sessionEntry). */
function RG(){return S.reg}
function regStart(){S.reg={files:{},entries:[],other:[],dup:[],choice:{},drag:false,busy:false};S.edit=null}

/* 같은 시험이 이미 있는지: 제목이 같거나, 같은 'N차시'로 시작하는 시험 */
function regExisting(e){
  const ts=testList();
  return ts.find(t=>t.title===e.title)||ts.find(t=>{const m=String(t.title).match(/^근본국어\s*(\d+)\s*차시(?:\s*·|$)/);return m&&+m[1]===e.n})||null;
}
function regRebuild(){
  const R=RG();const P=pairSessionFiles(Object.keys(R.files));
  R.other=P.other;R.dup=P.dup;
  R.entries=P.pairs.map(p=>{const e=sessionEntry(p.n,p.stat?R.files[p.stat]:null,p.ex?R.files[p.ex]:null);e.statName=p.stat;e.exName=p.ex;
    const ex=regExisting(e);e.existing=ex?{id:ex.id,title:ex.title,subs:recordsFor(ex.id,'',true).length,len:ex.items.length}:null;
    if(e.existing&&e.existing.subs&&e.existing.len!==e.items.length)e.warn.push(`이미 낸 답안 ${e.existing.subs}개가 있는데 문항 수가 ${e.existing.len}→${e.items.length}로 바뀜`);
    if(!(p.n in R.choice))R.choice[p.n]=e.existing?'skip':'new';
    if(!e.existing&&R.choice[p.n]==='over')R.choice[p.n]='new';
    return e});
}
async function regAddFiles(list){
  const R=RG();if(!R)return;
  const txt=[...list].filter(f=>/\.txt$/i.test(f.name));const skipped=[...list].length-txt.length;
  for(const f of txt){if(f.size>2e6){toast(f.name+': 파일이 너무 큽니다');continue}R.files[f.name]=await f.text()}
  regRebuild();render();
  if(skipped)toast(`.txt가 아닌 파일 ${skipped}개는 건너뛰었습니다`);
}

/* ---------- 화면 ---------- */
function viewRegister(){
  const R=RG();const E=R.entries;
  const act=e=>R.choice[e.n];
  const nSave=E.filter(e=>act(e)!=='skip'&&e.statName).length;
  let h=`<div class="stack"><div class="card"><div class="row" style="justify-content:space-between"><div><h2>파일로 새 시험 만들기</h2><p class="sub">차시 파일 <span class="mono">NN차시_사이트등록_통계.txt</span>와 <span class="mono">NN차시_사이트등록_해설.txt</span>를 여러 개 한꺼번에 넣으세요. 같은 차시 번호끼리 짝을 지어 시험 하나로 만듭니다.</p></div><button class="btn ghost" data-act="reg-close">닫기</button></div>
   <label class="rg-drop${R.drag?' over':''}" id="rgDrop"><input type="file" id="rgFile" multiple accept=".txt,text/plain"><span class="rg-big">여기에 파일을 끌어다 놓으세요</span><span class="sub">또는 <span class="btn small">파일 고르기</span> (여러 개를 한 번에 골라도 됩니다)</span></label>
   ${Object.keys(R.files).length?`<p class="sub" style="margin-top:8px">읽은 파일 ${Object.keys(R.files).length}개 <button class="btn small ghost" data-act="reg-clear">모두 지우고 다시 고르기</button></p>`:''}
   ${R.other.length?`<p class="note" style="margin-top:8px">차시 파일 이름이 아니라 건너뛴 파일: ${esc(R.other.join(', '))}</p>`:''}
   ${R.dup.length?`<p class="note" style="margin-top:8px">같은 차시의 같은 종류 파일이 또 있어 건너뛴 파일: ${esc(R.dup.join(', '))}</p>`:''}</div>`;
  if(E.length){
    h+=`<div class="card"><h3>미리 보기 · ${E.length}개 차시</h3><p class="sub" style="margin-bottom:8px">저장하기 전에 확인하세요. 같은 시험이 이미 있으면 <b>덮어쓰기</b> 또는 <b>건너뛰기</b>를 고릅니다(덮어써도 학생 답안과 응시 설정은 그대로이고, 오답 선지 꼬리표도 남습니다).</p>
     <div class="tbl-wrap"><table class="rg-table"><thead><tr><th class="n">차시</th><th>시험 이름</th><th class="n">문항 수</th><th>정답</th><th>3점</th><th class="n">유형</th><th class="n">전국 자료</th><th class="n">해설</th><th>경고</th><th>처리</th></tr></thead><tbody>
     ${E.map(e=>`<tr class="${act(e)==='skip'?'rg-skip':''}"><td class="n"><b>${e.n}</b></td><td>${esc(e.title)}${e.existing&&e.existing.title!==e.title?`<br><span class="muted">있는 시험: ${esc(e.existing.title)}</span>`:''}</td><td class="n">${e.items.length}</td><td class="mono">${esc(e.key)}</td><td class="mono">${esc(e.pts3.join(', ')||'–')}</td><td class="n">${e.typeN}/${e.items.length}</td><td class="n">${e.natN?e.natN+'문항':'<span class="muted">없음</span>'}</td><td class="n">${e.exN}/${e.items.length}</td>
       <td>${e.warn.length?e.warn.map(w=>`<div class="rg-warn">${esc(w)}</div>`).join(''):'<span class="badge good">없음</span>'}</td>
       <td>${!e.statName?'<span class="badge bad">통계 파일 필요</span>':e.existing?`<select class="rg-choice" data-n="${e.n}" aria-label="${e.n}차시 처리"><option value="over" ${act(e)==='over'?'selected':''}>덮어쓰기</option><option value="skip" ${act(e)==='skip'?'selected':''}>건너뛰기</option></select>`:`<label class="rg-new"><input type="checkbox" class="rg-pick" data-n="${e.n}" ${act(e)==='new'?'checked':''}> 새로 만들기</label>`}</td></tr>`).join('')}
     </tbody></table></div>
     <div class="row" style="margin-top:12px"><button class="btn primary" data-act="reg-save" ${nSave&&!R.busy?'':'disabled'}>${R.busy?'저장하는 중…':nSave?`${nSave}개 시험 저장`:'저장할 시험이 없습니다'}</button><span class="sub">저장한 시험은 '준비 중' 상태입니다. 반마다 응시를 열어야 학생에게 보입니다.</span></div></div>`;
  }
  return h+'</div>';
}

/* ---------- 저장 (시험 편집기 saveEdit와 같은 표·칸) ---------- */
async function regSave(){
  const R=RG();if(S.demo){toast('예시 데이터에서는 저장되지 않습니다');return}
  const todo=R.entries.filter(e=>R.choice[e.n]!=='skip'&&e.statName);if(!todo.length)return;
  R.busy=true;render();const ok=[],bad=[];
  for(const e of todo){
    try{
      const over=R.choice[e.n]==='over'&&e.existing;const id=over?e.existing.id:crypto.randomUUID();
      const t={id,title:e.title,items:e.items,updated_at:nowIso()};if(!over)t.test_date=null;
      chk(await sb.from('tests').upsert(t));
      const k={test_id:id,answers:e.key,nat:e.nat,ex:e.ex,updated_at:nowIso()};if(!over)k.tags=null;
      chk(await sb.from('test_keys').upsert(k));
      ok.push(e.n);
    }catch(err){console.error(err);bad.push(`${e.n}차시(${err?.message||err})`)}
  }
  R.busy=false;
  try{await load()}catch(err){console.error(err)}
  if(!bad.length){S.reg=null;render();toast(`${ok.length}개 시험을 저장했습니다`)}
  else{regRebuild();render();toast(`${ok.length}개 저장, 저장하지 못함: ${bad.join(', ')}`)}
}

/* ---------- 동작 ---------- */
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act^="reg-"]');if(!b)return;
  switch(b.dataset.act){
    case 'reg-open':regStart();render();break;
    case 'reg-close':S.reg=null;render();break;
    case 'reg-clear':regStart();render();break;
    case 'reg-save':await regSave();break;
  }
});
document.addEventListener('change',e=>{
  const el=e.target;const R=RG();if(!R)return;
  if(el.id==='rgFile'){regAddFiles(el.files);return}
  if(el.classList.contains('rg-choice')){R.choice[+el.dataset.n]=el.value;render()}
  if(el.classList.contains('rg-pick')){R.choice[+el.dataset.n]=el.checked?'new':'skip';render()}
});
for(const ev of ['dragenter','dragover'])document.addEventListener(ev,e=>{const z=e.target.closest?.('#rgDrop');if(!z||!S.reg)return;e.preventDefault();if(!S.reg.drag){S.reg.drag=true;z.classList.add('over')}});
document.addEventListener('dragleave',e=>{const z=e.target.closest?.('#rgDrop');if(!z||!S.reg||z.contains(e.relatedTarget))return;S.reg.drag=false;z.classList.remove('over')});
document.addEventListener('drop',e=>{const z=e.target.closest?.('#rgDrop');if(!S.reg)return;e.preventDefault();S.reg.drag=false;if(z)regAddFiles(e.dataTransfer.files)});
