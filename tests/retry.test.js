// 틀린 문항 다시 풀기 · 선생님 한마디 · 설명할 문항 순서 (js/retry.js, js/logic.js explainPriority). 자료는 모두 지어낸 것.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../js/retry.js');
const {explainPriority}=require('../js/logic.js');

test('pseudoKey: 맞은 문항은 내 답, 틀리거나 비운 문항은 ? (정답이 들어가지 않음)',()=>{
  assert.equal(R.pseudoKey('OXBO.','31044'),'3??40','채점 안 하는 문항(.)은 0');
  // 정답 31524, 내 답 31000 → OOBBB
  assert.equal(R.pseudoKey('OOBBB','31000'),'31???');
  assert.equal(R.pseudoKey(null,'123'),'');
});

test('pseudoKey로 채점하면 실제 정답으로 채점한 점수와 같다',()=>{
  const key='31524',ans='31525';
  const ox=Array.from(key,(k,i)=>ans[i]===k?'O':ans[i]==='0'?'B':'X').join('');
  const pk=R.pseudoKey(ox,ans);
  const score=k=>Array.from(k).filter((c,i)=>ans[i]===c).length;
  assert.equal(score(pk),score(key));
  assert.ok(!pk.includes('4')||ans.includes('4'),'틀린 문항의 정답(4)이 새지 않는다');
});

test('retryTargets · retryString: 틀린/비운 자리만 답, 나머지는 -',()=>{
  const tg=R.retryTargets('OXB.O');
  assert.deepEqual(tg,[1,2]);
  assert.equal(R.retryString(5,tg,'55521'),'-55--');
  assert.equal(R.retryString(5,tg,''),'-00--','고르지 않은 자리는 0');
  assert.equal(R.retryString(3,[0],'x'),'0--');
});

test('retryOutcome · retryMessage: 실수형/개념형 나누기',()=>{
  const o=R.retryOutcome('31524','--521');
  assert.deepEqual(o.targets,[2,3,4]);
  assert.deepEqual(o.fixed,[2,3]);
  assert.deepEqual(o.again,[4]);
  assert.equal(Math.round(o.rate*100),67);
  assert.match(R.retryMessage(o),/맞힌 2문항은 '실수형', 또 틀린 1문항은 '개념형'/);
  assert.match(R.retryMessage(R.retryOutcome('123','-23')),/모두 맞혔습니다.*실수형/);
  assert.match(R.retryMessage(R.retryOutcome('123','-00')),/또 틀렸습니다.*개념형/);
  assert.equal(R.retryMessage(R.retryOutcome('123','---')),'');
  assert.equal(R.retryOutcome(['1','2'],'-2').fixed.length,1,'정답이 배열이어도 된다');
});

test('fbClean · fbLen: 서버와 같은 규칙(줄바꿈 통일, 앞뒤 빈칸 제거, 글자 단위)',()=>{
  assert.equal(R.fbClean('  잘했어요\r\n다음엔 3번!  \n'),'잘했어요\n다음엔 3번!');
  assert.equal(R.fbLen('가나다'),3);
  assert.equal(R.fbLen('👍'),1);
  assert.equal(R.FB_MAX,500);
});

test('stageSteps: 응시 중 → 결과 공개 → 다시 풀기 진행 → 정답·해설 공개',()=>{
  const st=s=>R.stageSteps(s).map(x=>x.state).join(',');
  assert.equal(st({open:false,rel:false,kr:false}),'todo,todo,todo,todo');
  assert.equal(st({open:true,rel:false,kr:false}),'now,todo,todo,todo');
  assert.equal(st({open:false,closed:true,rel:false,kr:false}),'done,todo,todo,todo');
  assert.equal(st({open:false,rel:true,kr:false,done:3,due:5}),'done,done,now,todo');
  assert.equal(R.stageSteps({rel:true,done:3,due:5})[2].label,'다시 풀기 진행 (3/5명 완료)');
  assert.equal(st({open:false,rel:true,kr:true}),'done,done,done,done');
});

test('nextAfter: 다음 학생, 마지막이면 null',()=>{
  assert.equal(R.nextAfter(['a','b','c'],'a'),'b');
  assert.equal(R.nextAfter(['a','b','c'],'c'),null);
  assert.equal(R.nextAfter(['a'],'z'),null);
});

test('explainPriority: 또 틀린 수 → 처음 오답률 순, 이름 없이 숫자만',()=>{
  const items=[1,2,3,4].map(n=>({no:String(n),area:'독서',type:'추론'}));
  const key='1234';
  // 학생 4명(지어낸 답안)
  const subs=['1234','2234','2334','3314'];
  // 처음 틀린 수: 1번 3명, 2번 2명, 3번 1명, 4번 0명
  // 다시 풀기: 1번은 3명이 다시 풀어 1명만 맞힘(또 틀림 2), 2번은 1명이 다시 풀어 맞힘
  const retries=['----','1---','2---',{answers:'22--'}];
  const out=explainPriority(items,key,subs.map(a=>({a,name:'가상'})),retries);
  assert.deepEqual(out.map(x=>x.no),['1','2','3'],'틀린 학생이 없는 문항은 빠진다');
  assert.equal(out[1].fixed,1);assert.equal(out[1].again,0);assert.equal(out[1].notRetried,1);
  const q1=out[0];
  assert.equal(q1.wrong,3);assert.equal(q1.retried,3);assert.equal(q1.fixed,1);assert.equal(q1.again,2);assert.equal(q1.notRetried,0);
  assert.equal(Math.round(q1.wrongRate*100),75);
  assert.deepEqual(q1.topWrong,{opt:2,count:2,share:.5});
  assert.ok(!JSON.stringify(out).includes('가상'),'학생 이름이 결과에 없다');
});

test('explainPriority: 또 틀린 수가 같으면 처음 오답률이 높은 문항이 먼저',()=>{
  const items=[{no:'1'},{no:'2'},{no:'3',el:'언매'}];
  const out=explainPriority(items,['1','2','3'],['2100','3100','1200'],[]);
  // 1번: 2명 틀림, 2번: 2명 틀림(무응답 포함) → 같으면 번호 순. 3번은 선택과목이라 빠짐
  assert.deepEqual(out.map(x=>x.no),['1','2']);
  assert.equal(out[1].topWrong.opt,1,'무응답은 오답 선지로 세지 않는다');
  assert.equal(out[0].notRetried,2);
  // 1번 1/3 틀림, 2번 2/3 틀림 → 오답률이 높은 2번이 먼저
  const out2=explainPriority([{no:'1'},{no:'2'}],'12',['21','11','12'],[]);
  assert.deepEqual(out2.map(x=>x.no),['2','1']);
  // 또 틀린 수가 오답률보다 먼저
  const out3=explainPriority([{no:'1'},{no:'2'}],'12',['21','11','12'],['3-']);
  assert.deepEqual(out3.map(x=>x.no),['1','2']);
});
