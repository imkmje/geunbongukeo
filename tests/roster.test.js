// 반 명단 붙여넣기 미리보기(js/logic.js rosterPlan). 이름은 모두 지어낸 것.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {rosterPlan}=require('../js/logic.js');

const NOW=[
  {uid:'a',sid:'20101',name:'가나다',cls:'화목반'},
  {uid:'b',sid:'20102',name:'라마바',cls:'화목반'},
  {uid:'c',sid:'20103',name:'사아자',cls:'화목반'},
  {uid:'d',sid:'20201',name:'차카타',cls:'수금반'},
  {uid:'e',sid:'20301',name:'파하가',cls:''},
];

test('줄마다 추가·옮김·이름 바뀜·그대로·빠짐을 나눈다',()=>{
  const P=rosterPlan(['순번\t학번\t이름\t신청시간',
    '1\t20101\t가나다\t2026-09-16 16:30:02',
    '2\t20102\t라마바바\t2026-09-16 16:30:02',
    '3\t20107\t새학생\t2026-09-16',
    '4\t20201\t차카타',
    '5 20301, 파하가',''].join('\n'),'화목반',NOW);
  assert.deepEqual(P.same.map(x=>x.sid),['20101']);
  assert.deepEqual(P.rename.map(x=>[x.sid,x.oldName,x.name]),[['20102','라마바','라마바바']]);
  assert.deepEqual(P.add.map(x=>[x.sid,x.name]),[['20107','새학생']]);
  assert.deepEqual(P.move.map(x=>[x.sid,x.from]),[['20201','수금반'],['20301','']]);
  assert.deepEqual(P.missing.map(x=>x.sid),['20103']);
  assert.deepEqual(P.skipped.map(x=>x.line),[1],'머리글 줄은 건너뜀');
  assert.equal(P.errors.length,0);
  assert.equal(P.changes,4);
});

test('잘못된 줄은 줄 번호와 이유를 알려 준다',()=>{
  const P=rosterPlan(['20101 가나다','2010 사람이','20108','20101 가나다','201011 너무긴','2026-09-16 신청'].join('\n'),'화목반',NOW);
  assert.deepEqual(P.errors.map(e=>[e.line,e.msg.slice(0,8)]),[[2,'학번은 숫자 5'],[3,'학번 뒤에 이름'],[4,'학번 20101'],[5,'학번은 숫자 5']]);
  assert.match(P.errors[2].msg,/1번째 줄에도/);
  assert.deepEqual(P.skipped.map(x=>x.line),[6],'날짜만 있는 줄은 오류가 아니라 건너뜀');
});

test('빈 글이면 아무것도 바꾸지 않는다',()=>{
  const P=rosterPlan('  \n\n','화목반',NOW);
  assert.equal(P.changes,0);assert.equal(P.errors.length,0);
  assert.equal(P.missing.length,3);
});

const {visibleClasses,loginErrorMsg}=require('../js/logic.js');
test('반 숨기기: 숨긴 반은 기본으로 빠지고, 보기를 켜면 원래 순서대로 나온다',()=>{
  assert.deepEqual(visibleClasses(['화목반','수금반','토요반'],['수금반'],false),['화목반','토요반']);
  assert.deepEqual(visibleClasses(['화목반','수금반','토요반'],['수금반'],true),['화목반','수금반','토요반']);
  assert.deepEqual(visibleClasses(['화목반'],[],false),['화목반']);
  assert.deepEqual(visibleClasses([],null,false),[]);
});
test('학생 로그인 실패 문구',()=>{
  assert.match(loginErrorMsg('class_hidden'),/수업이 끝난 반/);
  assert.match(loginErrorMsg('locked'),/10분/);
  assert.match(loginErrorMsg('wrong'),/맞지 않습니다/);
  assert.match(loginErrorMsg(undefined),/맞지 않습니다/);
});

const {testOrder}=require('../js/logic.js');
test('시험 순서: 시행일 → 제목(숫자 인식) → 만든 시각',()=>{
  const ts=[10,1,15,2,11,9].map((n,i)=>({title:`근본국어 ${n}차시`,date:'',created:String(100+i)}));
  assert.deepEqual(ts.sort(testOrder).map(t=>t.title.match(/\d+/)[0]),['1','2','9','10','11','15']);
  const d=[{title:'B',date:'2026-06-04'},{title:'A',date:'2026-09-03'},{title:'C',date:''}].sort(testOrder);
  assert.deepEqual(d.map(x=>x.title),['C','B','A'],'시행일이 먼저(비어 있으면 맨 앞)');
  const same=[{title:'같음',date:'',created:'2'},{title:'같음',date:'',created:'1'}].sort(testOrder);
  assert.deepEqual(same.map(x=>x.created),['1','2']);
});

test('신청시간(날짜)이 있는 줄의 4자리 학번 오타도 고칠 줄로 알려 준다',()=>{
  const P=rosterPlan(['순번\t학번\t이름\t신청시간',
    '1\t2010\t가나다\t2026-09-16 16:30:02',
    '2026-09-16 신청 마감'].join('\n'),'화목반',[]);
  assert.deepEqual(P.errors.map(x=>x.line),[2]);
  assert.deepEqual(P.skipped.map(x=>x.line),[1,3],'머리글·날짜만 있는 줄은 건너뜀');
});
