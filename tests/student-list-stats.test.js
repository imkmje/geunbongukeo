// 학생 화면: 반 통계 null 처리, 시험 목록 순서, 학생 함수 오류 나누기 (js/student-logic.js). 자료는 모두 지어낸 것.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../js/student-logic.js');

test('classStats: stats가 null이면 반 통계를 숨기고 빈 값만',()=>{
  for(const st of [null,undefined,{},{n:3,avgPct:null,ir:null,dist:null,area:null,type:null},{n:3,avgPct:null,ir:[.5,.6]}]){
    const c=S.classStats(st);
    assert.equal(c.hidden,true);
    assert.equal(c.avgPct,null);
    assert.deepEqual(c.ir,[]);assert.deepEqual(c.dist,[]);assert.deepEqual(c.area,{});assert.deepEqual(c.type,{});
  }
  assert.equal(S.classStats({n:2,avgPct:.5,hidden:true}).hidden,true,'서버가 hidden 표시를 주면 숨김');
});

test('classStats: 숫자가 아닌 칸은 null로(NaN·문자열이 화면에 새지 않게)',()=>{
  const c=S.classStats({n:12,avgPct:.62,ir:[.8,null,NaN,'x',.4],dist:[[0,.1,.9,0,0,0],null,[0,NaN,1,0,0,0]],area:{'독서':.7,'문학':null,'언어':NaN},type:null});
  assert.equal(c.hidden,false);
  assert.equal(c.avgPct,.62);assert.equal(c.n,12);
  assert.deepEqual(c.ir,[.8,null,null,null,.4]);
  assert.deepEqual(c.dist,[[0,.1,.9,0,0,0],null,[0,null,1,0,0,0]]);
  assert.deepEqual(c.area,{'독서':.7});
  assert.deepEqual(c.type,{});
  assert.equal(S.classStats({avgPct:NaN}).hidden,true);
});

test('CLS_HIDDEN_MSG: 안내 문장',()=>{
  assert.match(S.CLS_HIDDEN_MSG,/^응시 인원이 적어 반 평균을 보여 드리지 않습니다/);
});

test('studentTestSort: 응시 중 → 다시 풀기 남음 → 나머지는 차시 순서(숫자로)',()=>{
  const t=(id,title,o={})=>({id,title,test_date:null,...o});
  const list=[t('a','근본국어 14차시 · 독서'),t('b','근본국어 13차시 · 문학',{retry_due:true}),t('c','근본국어 3차시 · 독서'),
    t('d','근본국어 15차시',{is_open:true}),t('e','근본국어 2차시'),t('f','근본국어 10차시')];
  assert.deepEqual(S.studentTestSort(list).map(x=>x.id),['d','b','e','c','f','a']);
  assert.deepEqual(list.map(x=>x.id),['a','b','c','d','e','f'],'원래 배열은 그대로');
});

test('studentTestSort: 교사 화면처럼 시행일이 먼저, 같으면 제목',()=>{
  const list=[{id:'x',title:'9월 모의',test_date:'2026-09-03'},{id:'y',title:'1차시',test_date:'2026-10-01'},{id:'z',title:'2차시',test_date:null}];
  assert.deepEqual(S.studentTestSort(list).map(x=>x.id),['z','x','y']);
  assert.deepEqual(S.studentTestSort(null),[]);
});

test('rpcErrorKind: 로그인 끊김·망가진 토큰·숨긴 반·비밀번호 바꾸기',()=>{
  assert.equal(S.rpcErrorKind({message:'invalid_session',code:'28000'}),'session');
  assert.equal(S.rpcErrorKind({message:'invalid input syntax for type uuid: "abc"',code:'22P02'}),'session');
  assert.equal(S.rpcErrorKind({message:'invalid input syntax for type uuid: "abc"'}),'session','code가 없어도');
  assert.equal(S.rpcErrorKind({message:'something',code:'22P02'}),'session');
  assert.equal(S.rpcErrorKind({message:'class_hidden',code:'28000'}),'class_hidden');
  assert.equal(S.rpcErrorKind({message:'must_change_password',code:'28000'}),'must_change');
  assert.equal(S.rpcErrorKind({message:'Failed to fetch'}),null);
  assert.equal(S.rpcErrorKind(null),null);
});
