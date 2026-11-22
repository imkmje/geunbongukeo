// 학생 화면 순수 함수: 100점 환산, 빈 문항 번호, 문항 번호 줄여 쓰기 (js/student-logic.js). 자료는 모두 지어낸 것.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../js/student-logic.js');

test('score100: 원점수 → 100점 환산(반올림)',()=>{
  assert.equal(S.score100(13,20),65);
  assert.equal(S.score100(7,20),35,'부동소수 오차 없이');
  assert.equal(S.score100(1,8),13,'12.5는 올림');
  assert.equal(S.score100(2,3),67);
  assert.equal(S.score100(1,3),33);
  assert.equal(S.score100(0,20),0);
  assert.equal(S.score100(20,20),100);
  assert.equal(S.score100(5,0),null,'만점이 0이면 없음');
  assert.equal(S.score100(5,undefined),null);
});

test('pct100 · oneDec: 반 평균 100점 환산과 원점수',()=>{
  assert.equal(S.pct100(.8),80);
  assert.equal(S.pct100(.655),66);
  assert.equal(S.pct100(null),null);
  assert.equal(S.oneDec(.8*20),'16');
  assert.equal(S.oneDec(13.26),'13.3');
  assert.equal(S.oneDec(null),'–');
});

test('blankList: 답이 0이거나 없는 자리만, 문항 번호와 함께',()=>{
  const items=[1,2,3,4,5,6,7,8,9].map(n=>({no:String(n)}));
  assert.deepEqual(S.blankList(items,'123451010').map(x=>x.no),['7','9']);
  assert.deepEqual(S.blankList(items,'1234510').map(x=>x.i),[6,7,8],'짧은 답안의 뒤쪽도 빈 문항');
  assert.deepEqual(S.blankList(items,'000000000',[0,2]).map(x=>x.no),['1','3'],'채점하는 자리(idx)만');
  assert.deepEqual(S.blankList(items,'111111111'),[]);
});

test('blankNos · blankSentence: "7번, 9번이 비어 있습니다. 그대로 낼까요?"',()=>{
  const l=[{i:6,no:'7'},{i:8,no:'9'}];
  assert.equal(S.blankNos(l),'7번, 9번');
  assert.equal(S.blankSentence(l),'7번, 9번이 비어 있습니다. 그대로 낼까요?');
  assert.equal(S.blankSentence([]),'그대로 낼까요?');
  const many=Array.from({length:13},(_,k)=>({i:k,no:String(k+1)}));
  assert.equal(S.blankNos(many,3),'1번, 2번, 3번 외 10문항');
  assert.equal(S.blankSentence(many,3),'1번, 2번, 3번 외 10문항이 비어 있습니다. 그대로 낼까요?');
  assert.equal(S.blankNos(l,10,x=>`[${x.no}]`),'[7], [9]','번호 하나를 다르게 쓸 수 있다');
});

test('noRange: 이어지는 번호는 2~5번처럼',()=>{
  assert.equal(S.noRange(['2','3','4','5']),'2~5번');
  assert.equal(S.noRange(['2','3','4','5','8']),'2~5, 8번');
  assert.equal(S.noRange(['1','3']),'1, 3번');
  assert.equal(S.noRange(['7']),'7번');
  assert.equal(S.noRange([]),'');
});
