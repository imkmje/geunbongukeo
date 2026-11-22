// 반마다 시험 상태 · 제출 현황(미제출 대상 반) · 4단계 표시 · 변별도 (js/tools-logic.js, js/retry.js, js/logic.js). 자료는 모두 지어낸 것.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../js/tools-logic.js');
const {stageSteps}=require('../js/retry.js');
const {itemDisc,discRank,DISC_MIN_N,loginErrorMsg}=require('../js/logic.js');

// 반 세 개(가반·나반·다반). load()가 test_class 줄에서 반마다 만드는 모양
const tt=(o={})=>({openFor:[],closedFor:[],releasedFor:[],...o});

test('상태: 한 번도 안 연 반은 다른 반에서 닫았어도 "준비 중" (마감은 반마다)',()=>{
  const t=tt({closedFor:['가반']});
  assert.deepEqual(T.testStatus(t,['가반']),['closed','마감']);
  assert.deepEqual(T.testStatus(t,['나반']),['draft','준비 중'],'가반에서 닫은 것이 나반에 번지지 않는다');
  assert.deepEqual(T.testStatus(tt(),['다반']),['draft','준비 중'],'새 반은 준비 중');
  assert.deepEqual(T.testStatus(t,['가반','나반','다반']),['closed','마감 1/3']);
  assert.deepEqual(T.testStatus(tt({closedFor:['가반','나반']}),['가반','나반']),['closed','마감']);
});

test('상태: 결과를 공개한 반은 is_open이 남아 있어도 응시 중이 아니다(서버 student_submit 규칙)',()=>{
  const t=tt({openFor:['가반','나반'],releasedFor:['가반']});
  assert.equal(T.clsOpen(t,'가반'),false);assert.equal(T.clsOpen(t,'나반'),true);
  assert.deepEqual(T.testStatus(t,['가반']),['rel','결과 공개']);
  assert.deepEqual(T.testStatus(t,['나반']),['open','응시 중']);
  assert.deepEqual(T.testStatus(t,['가반','나반']),['rel','공개 1/2']);
  assert.deepEqual(T.testStatus(tt({openFor:['가반']}),['가반','나반']),['open','응시 중 1/2']);
  assert.deepEqual(T.testStatus(tt(),[]),['draft','준비 중'],'반이 없어도 깨지지 않는다');
});

test('4단계 표시: 안 연 반은 모두 할 일, 연 반은 응시 중이 지금, 닫은 반은 응시 단계 끝',()=>{
  const S=o=>stageSteps({open:false,rel:false,kr:false,closed:false,done:0,due:0,...o}).map(s=>s.state);
  assert.deepEqual(S({}),['todo','todo','todo','todo'],'한 번도 안 연 반에 ✓가 붙지 않는다');
  assert.deepEqual(S({open:true}),['now','todo','todo','todo']);
  assert.deepEqual(S({closed:true}),['done','todo','todo','todo']);
  assert.deepEqual(S({rel:true,closed:true,due:3,done:1}),['done','done','now','todo']);
  assert.deepEqual(S({rel:true,kr:true,closed:true}),['done','done','done','done']);
  // 교사 화면은 open = clsOpen(공개한 반은 false)을 넘긴다 → 공개 뒤 '응시 중'이 지금으로 남지 않는다
  const t=tt({openFor:['가반'],releasedFor:['가반']});
  assert.deepEqual(S({open:T.clsOpen(t,'가반'),rel:true}),['done','done','now','todo']);
  assert.match(stageSteps({rel:true,done:2,due:5})[2].label,/2\/5명/);
});

// 반 분석 '제출 현황'·'지금 할 일'·실시간 현황이 같은 함수로 센다
const lists={'가반':[{id:'20101',name:'가'},{id:'20102',name:'나'},{id:'20103',name:'다'}],
  '나반':[{id:'20201',name:'라'},{id:'20202',name:'마'}],
  '다반':[{id:'20301',name:'바'},{id:'20302',name:'사'},{id:'20303',name:'아'}]};

test('제출 현황: 한 번도 안 연 반 학생은 미제출로 세지 않는다',()=>{
  const t=tt({openFor:['가반']});
  assert.deepEqual(T.submitTargets(t,['가반','나반','다반']),['가반']);
  const s=T.submitStatus(t,['가반','나반','다반'],lists,new Set(['20101','20102']));
  assert.equal(s.n,2);assert.equal(s.m,3,'가반 3명만 대상');
  assert.deepEqual(s.miss.map(r=>r.sid),['20103']);assert.deepEqual(s.openMiss.map(r=>r.sid),['20103']);
  assert.deepEqual(s.late,[]);assert.deepEqual(s.openClasses,['가반']);
});

test('제출 현황: 공개한 반은 대상에 들지만 못 낸 학생은 "공개 전에 못 냄"(late)',()=>{
  const t=tt({openFor:['가반','나반'],releasedFor:['나반'],closedFor:['나반','다반']});
  const s=T.submitStatus(t,['가반','나반','다반'],lists,['20101','20201','20301','20302','20303']);
  assert.deepEqual(s.classes,['가반','나반','다반']);
  assert.equal(s.m,8);assert.equal(s.n,5);
  assert.deepEqual(s.miss.map(r=>r.sid),['20102','20103'],'응시 중·닫은 반의 미제출');
  assert.deepEqual(s.late.map(r=>[r.sid,r.cls]),[['20202','나반']]);
  assert.deepEqual(s.openMiss.map(r=>r.sid),['20102','20103'],'공개한 반 학생은 응시 중 미제출이 아니다');
  assert.deepEqual(s.openClasses,['가반']);
  assert.deepEqual(s.rows.map(r=>r.sid),[...s.rows.map(r=>r.sid)].sort(),'학번순');
});

test('제출 현황: 같은 자료면 어느 화면(반 전체/한 반)에서 세도 합이 맞다',()=>{
  const t=tt({openFor:['가반','다반'],closedFor:['나반']});const done=new Set(['20101','20201','20301']);
  const all=T.submitStatus(t,['가반','나반','다반'],lists,done);
  const per=['가반','나반','다반'].map(c=>T.submitStatus(t,[c],lists,done));
  assert.equal(all.n,per.reduce((a,x)=>a+x.n,0));assert.equal(all.m,per.reduce((a,x)=>a+x.m,0));
  assert.equal(all.m,8);
  assert.deepEqual(T.submitStatus(t,[],lists,done).m,0);
  assert.deepEqual(T.submitStatus(tt(),['가반'],lists,done),{classes:[],openClasses:[],rows:[],n:0,m:0,miss:[],late:[],openMiss:[]});
});

test('시험 칩: 그 반에서 열었다 닫은(답안 없는) 시험도 위에 보인다',()=>{
  const ts=[{id:'a',...tt({closedFor:['가반']})},{id:'b',...tt({closedFor:['나반']})},{id:'c',...tt()}];
  const r=T.splitTestChips(ts,['가반'],()=>false);
  assert.deepEqual(r.main.map(t=>t.id),['a']);assert.deepEqual(r.more.map(t=>t.id),['b','c']);
});

test('변별도: 응시 15명 미만이면 계산하지 않는다(null)',()=>{
  assert.equal(DISC_MIN_N,15);
  const mk=n=>Array.from({length:n},(_,k)=>({name:String(20100+k)+' 학생',pct:k/n,score:k,res:{0:k>=n/2,1:k%2===0}}));
  assert.deepEqual(itemDisc(mk(14),2),[null,null]);
  const d=itemDisc(mk(15),2);assert.ok(d[0]>0.9,'잘하는 학생만 맞힌 문항은 변별도가 높다');assert.equal(typeof d[1],'number');
  assert.deepEqual(itemDisc([],3),[null,null,null]);
});

test('변별도: 같은 점수면 원점수 → 학번 순서로 늘 같게 정렬한다(입력 순서와 상관없이)',()=>{
  const g=[{name:'20103 다',pct:.5,score:10},{name:'20101 가',pct:.5,score:10},{name:'20102 나',pct:.5,score:12},{name:'20104 라',pct:.9,score:18}];
  const ord=x=>discRank(x).map(r=>r.name.slice(0,5));
  assert.deepEqual(ord(g),['20104','20102','20101','20103']);
  assert.deepEqual(ord([...g].reverse()),ord(g));
  // 같은 점수 학생이 상·하위 경계에 걸려도 결과가 입력 순서에 따라 바뀌지 않는다
  const many=Array.from({length:20},(_,k)=>({name:String(20200+k)+' 학생',pct:k<10?.5:.7,score:k<10?10:14,res:{0:k%3===0}}));
  assert.deepEqual(itemDisc(many,1),itemDisc([...many].reverse(),1));
});

test('잠금 안내: 서버가 준 해제 시각이 있으면 그 시각을 알려 준다',()=>{
  const u=new Date(2026,10,22,14,7).toISOString();
  assert.match(loginErrorMsg('locked',u),/14:07 뒤에 다시 시도/);
  assert.match(loginErrorMsg('locked'),/10분/);assert.match(loginErrorMsg('locked','엉뚱한 값'),/10분/);
  assert.match(loginErrorMsg('locked',u),/선생님께 잠금을 풀어/);
});
