// 교사 화면 배치 손질: 시험 칩 글·접기·스크롤, 종이 답안 미리 보기(js/tools-logic.js). 이름은 모두 지어낸 것.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../js/tools-logic.js');

test('시험 칩 글: N차시만, 차시가 없으면 괄호 메모를 뗀 짧은 제목',()=>{
  assert.equal(T.chipLabel('근본국어 2차시 · 독서(사회) · 문학(고전소설) · 문법'),'2차시');
  assert.equal(T.chipLabel('근본국어 12 차시'),'12차시');
  assert.equal(T.chipLabel('3월 학력평가 (예시)'),'3월 학력평가');
  assert.equal(T.chipLabel('2026년 6월 고2 전국연합학력평가'),'2026년 6월 고2 …');
  assert.equal(T.chipLabel('(예시)'),'(예시)','괄호뿐이면 그대로');
  assert.equal(T.chipLabel(''),'');
});

test('시험 칩 접기: 고른 반에서 연·닫은·공개한·답안 있는 시험만 위에, 나머지는 준비 중으로',()=>{
  const ts=[{id:'a',openFor:['가반']},{id:'b',closedFor:['나반']},{id:'c',releasedFor:['가반']},{id:'d'},{id:'e'}];
  const r=T.splitTestChips(ts,['가반'],t=>t.id==='e');
  assert.deepEqual(r.main.map(t=>t.id),['a','c','e']);
  assert.deepEqual(r.more.map(t=>t.id),['b','d'],'다른 반에서 닫은 시험은 이 반에서는 준비 중');
  assert.deepEqual(T.testStatus(ts[0],['가반','나반']),['open','응시 중 1/2']);
  assert.deepEqual(T.testStatus(ts[2],['가반','나반']),['rel','공개 1/2']);
});

test('칩 상자 스크롤: 고른 칩이 보이게(이미 보이면 그대로)',()=>{
  // 상자 높이 74(2줄), 칩 높이 34, 줄 간격 40
  assert.equal(T.revealScroll(0,74,0,34),0,'첫 줄');
  assert.equal(T.revealScroll(0,74,40,34),0,'둘째 줄은 이미 보임');
  assert.equal(T.revealScroll(0,74,200,34),160,'여섯째 줄 → 아래 끝에 맞춤');
  assert.equal(T.revealScroll(160,74,40,34),40,'위로 지나간 칩 → 위 끝에 맞춤');
  assert.equal(T.revealScroll(160,74,200,34),160);
});

const items=[{no:'1'},{no:'2'},{no:'3'}];
const elecItems=[{no:'1'},{no:'2'},{no:'3',el:'화작'},{no:'3',el:'언매'}];
const tests={t1:{title:'근본국어 1차시',items},t2:{title:'선택',items:elecItems}};
const roster={'20101':{name:'가나다',cls:'가반'},'20102':{name:'라마바',cls:'나반'},'20103':{name:'사아자',cls:''}};
const plan=(text,tid='t1',extra={})=>T.importPlan(text,{tid,tests,roster,now:1,decode:s=>JSON.parse(Buffer.from(s,'base64url').toString()),...extra});

test('종이 답안: 반은 그 학생의 실제 반, 명단에 없는 학번은 ✗이고 세지 않는다',()=>{
  const P=plan(['20101 가나다 123','20102 312','91999 없는학생 111','20103 사아자 1.3'].join('\n'));
  assert.deepEqual(P.ok.map(r=>[r.line,r.name,r.cls,r.a]),[[1,'20101 가나다','가반','123'],[2,'20102 라마바','나반','312'],[4,'20103 사아자','','103']]);
  assert.deepEqual(P.bad.map(r=>[r.line,r.sid,r.msg]),[[3,'91999','명단에 없는 학번']]);
  assert.deepEqual(P.rows.map(r=>r.line),[1,2,3,4],'줄 순서 그대로');
});

test('종이 답안: 같은 학번이 두 줄이면 둘 다 ✗(줄 번호를 알려 줌), 나머지는 저장',()=>{
  const P=plan(['20101 가나다 123','20102 라마바 111','20101 가나다 321'].join('\n'));
  assert.deepEqual(P.ok.map(r=>r.sid),['20102']);
  assert.deepEqual(P.dup,['20101']);
  assert.deepEqual(P.bad.map(r=>r.line),[1,3]);
  assert.match(P.bad[0].msg,/1·3번째 줄/);
});

test('종이 답안: 줄 오류(답안 수·학번 없음·선택과목)와 이름이 명단과 다를 때',()=>{
  const P=plan(['20101 가나다 12','김하늘 123','20102 라라라 123','20103'].join('\n'));
  assert.deepEqual(P.bad.map(r=>[r.line,r.msg.slice(0,6)]),[[1,'답안 2개,'],[2,'학번(숫자 '],[4,'학번 뒤에 ']]);
  assert.equal(P.ok[0].typed,'라라라','적은 이름이 명단과 다르면 알려 준다(저장은 명단 이름의 학생으로)');
  const E=plan(['20101 123','20102 언매 124','20103 화작 125'].join('\n'),'t2');
  assert.match(E.bad[0].msg,/화작 또는 언매/);
  assert.deepEqual(E.ok.map(r=>[r.sid,r.el,r.a]),[['20102','언매','1204'],['20103','화작','1250']]);
});

test('종이 답안: 학생 화면 코드(KORA1.) 줄도 같은 규칙',()=>{
  const code=o=>'KORA1.'+Buffer.from(JSON.stringify(o)).toString('base64url');
  const P=plan([code({n:'20102 라마바',t:'t1',a:'31',at:5}),code({n:'91999 누구',t:'t1',a:'111'}),code({n:'20101',t:'없음',a:'1'}),'KORA1.@@@'].join('\n'));
  assert.deepEqual(P.ok.map(r=>[r.sid,r.cls,r.a,r.cnt,r.at]),[['20102','나반','310',2,5]]);
  assert.deepEqual(P.bad.map(r=>r.msg),['명단에 없는 학번','없는 시험의 코드입니다','학생 화면 코드를 읽지 못했습니다']);
});

test('종이 답안 저장 결과는 한 줄로',()=>{
  assert.equal(T.importResultMsg(3,[]),'3명 저장');
  assert.equal(T.importResultMsg(3,[{sid:'91999',line:3},{sid:'20101',line:1},{sid:'20101',line:4},{line:7}]),'3명 저장, 3명 건너뜀(91999, 20101, 7번째 줄)');
  assert.equal(T.importResultMsg(2,[],'공개 자료도 갱신'),'2명 저장 · 공개 자료도 갱신');
});

test('여러 반 한꺼번에: 동작마다 할 수 있는 반만 처음부터 고르고, 못 하는 까닭과 미제출 수를 알려 준다',()=>{
  const t={id:'t',openFor:['가반','나반'],releasedFor:['다반','라반'],closedFor:['다반','라반']};
  const cs=['가반','나반','다반','라반','마반','숨반'];
  const lists={가반:[{id:'10101'},{id:'10102'}],나반:[{id:'10201'}],다반:[{id:'10301'},{id:'10302'}],라반:[],마반:[{id:'10501'}],숨반:[]};
  const o={recs:{가반:1,다반:2},lists,done:['10101','10301','10302'],keyRel:c=>c==='라반',hidden:['숨반']};
  const ok=act=>T.bulkPlan(act,t,cs,o).filter(r=>r.ok).map(r=>r.cls);
  assert.deepEqual(ok('open'),['마반']);
  assert.deepEqual(ok('close'),['가반','나반']);
  assert.deepEqual(ok('release'),['가반'],'답안이 있고 아직 공개 안 한 반만');
  assert.deepEqual(ok('key'),['다반'],'결과 공개 뒤, 정답·해설 공개 전인 반만');
  const R=T.bulkPlan('release',t,cs,o);
  assert.deepEqual(R.map(r=>[r.cls,r.why,r.miss]),[['가반','',1],['나반','낸 답안 없음',1],['다반','이미 결과 공개',0],['라반','이미 결과 공개',0],['마반','낸 답안 없음',0],['숨반','숨긴 반',0]]);
  assert.deepEqual(T.bulkPlan('release',t,['가반'],{...o,keyMissing:true}).map(r=>r.why),['정답이 비어 있음']);
  assert.equal(T.BULK_LABEL.key,'정답·해설 공개');
});
