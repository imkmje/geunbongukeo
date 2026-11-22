// 실행: node --test tests/
// 실제 차시 파일(NN차시_사이트등록_통계.txt / _해설.txt)은 저장소에 넣지 않는다(시험 문항 저작물).
// GB_SAMPLES 폴더(기본: 저장소 옆 ../winter-edit)가 있으면 그 파일들을 읽어 확인하고, 없으면 그 부분만 건너뛴다.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseNat,parseEx,parseRanges,pwProblem}=require('../js/logic.js');

// 교사 화면 '새 시험 만들기'와 같은 45문항 기본 틀
function newEdit(n=45){const items=[];for(let i=1;i<=n;i++)items.push({no:String(i),area:i<=17?'독서':i<=34?'문학':'기타',type:'',pts:2,el:''});return {items,key:Array(n).fill('0'),nat:[],ex:[],tags:[]}}

/* ---------- 합성 자료(실제 시험 내용 없음) ---------- */
const SYN_STAT=['﻿# 근본국어 0차시 · 출처: 예시',
  '# 정답: 1234512',
  '# 배점 3점 문항: 3, 7',
  '# 영역: 1 언어 / 2~4 독서 / 5~7 문학',
  '# 세트: 2~4 인문 가상의 지문 A/B 비교 / 5~7 현대시 가상의 작품',
  '# 전국 정답률은 오답률 상위 15문항만 있음',
  '2 58.5 58.5 26.0 6.7 7.9 0.9',
  '6 0.41 0.41 0.2 0.19 0.1 0.1',
  '7 39.7 3.6 5.0 39.9 11.9 39.7',''].join('\r\n');
const SYN_EX=['[1] 정답 ① (출제 의도: 가상)','정답 해설: 예시 문장.','오답 풀이: ② 예시.','',
  '[2] 정답 ③ (출제 의도: 가상)','정답 해설: 예시.','오답 풀이: ','',
  '[10] 정답 ① (출제 의도: 없는 문항)','정답 해설: 무시되어야 함.'].join('\n');

test('통계 파일(합성): 문항 수·정답·3점·영역·세트·전국 비율',()=>{
  const E=newEdit(45);const r=parseNat(E,SYN_STAT);
  assert.equal(E.items.length,7,'정답 개수에 맞춰 문항 수를 줄인다');
  assert.equal(E.key.join(''),'1234512');
  assert.deepEqual(E.items.filter(x=>x.pts===3).map(x=>x.no),['3','7']);
  assert.deepEqual(E.items.map(x=>x.area),['언어','독서','독서','독서','문학','문학','문학']);
  assert.equal(E.items[0].set||'','');
  assert.equal(E.items[1].set,'인문 가상의 지문 A/B 비교','세트 이름 안의 / 는 나누지 않는다');
  assert.equal(E.items[6].set,'현대시 가상의 작품');
  assert.equal(r.ok,3);assert.equal(r.bad.length,0);
  assert.equal(E.nat[1].r,0.585);
  assert.equal(E.nat[1].d[4],0.009,'0.9%를 90%로 읽으면 안 된다');
  assert.equal(E.nat[5].r,0.41,'소수 비율 줄은 그대로');
  assert.equal(E.nat[6].d[4],0.397);
  assert.match(r.meta,/문항 수 45→7/);
});

test('통계 파일(합성): 문항 수가 이미 맞으면 다른 칸은 건드리지 않는다',()=>{
  const E=newEdit(7);E.items[0].type='음운';E.ex[0]='기존 해설';
  parseNat(E,SYN_STAT);
  assert.equal(E.items.length,7);assert.equal(E.items[0].type,'음운');assert.equal(E.ex[0],'기존 해설');
});

test('통계 파일(합성): # 유형: 줄을 문항 유형으로 읽고, 줄이 없으면 유형을 건드리지 않는다',()=>{
  const E=newEdit(45);parseNat(E,SYN_STAT+'# 유형: 1 음운 / 2~3 추론 / 4 <보기> 적용 / 5 내용 이해\n');
  assert.deepEqual(E.items.map(x=>x.type),['음운','추론','추론','<보기> 적용','내용 이해','','']);
  const F=newEdit(7);F.items[0].type='기존';parseNat(F,SYN_STAT);assert.equal(F.items[0].type,'기존');
});

test('통계 파일(합성): 정답이 원문자여도 읽는다',()=>{
  const E=newEdit(45);parseNat(E,'# 정답: ③①⑤②④');assert.equal(E.key.join(''),'31524');assert.equal(E.items.length,5);
});

test('범위 읽기',()=>{
  assert.deepEqual(parseRanges('1~1 언어 / 2~5 독서 / 6~9 문학').map(x=>[x.a,x.z,x.name]),[[1,1,'언어'],[2,5,'독서'],[6,9,'문학']]);
  assert.deepEqual(parseRanges('1 언어/2-3 독서').map(x=>[x.a,x.z,x.name]),[[1,1,'언어'],[2,3,'독서']]);
});

test('해설 파일(합성): 번호별로 나누고, 정답 불일치를 알려 준다',()=>{
  const E=newEdit(45);parseNat(E,SYN_STAT);const r=parseEx(E,SYN_EX);
  assert.equal(r.n,2);
  assert.match(E.ex[0],/^정답 ① \(출제 의도: 가상\)\n정답 해설: 예시 문장\.\n오답 풀이: ② 예시\.$/);
  assert.deepEqual(r.mismatch,['2'],'2번 키는 2인데 해설은 ③');
  assert.equal(E.ex[9],undefined,'없는 문항 번호는 무시');
});

test('학생 새 비밀번호 규칙',()=>{
  assert.match(pwProblem('abc12','20315'),/6자 이상/);
  assert.match(pwProblem('20315 ','20315'),/6자 이상/);
  assert.match(pwProblem('203150','203150'),/학번과 같은/);
  assert.equal(pwProblem('hello1','20315'),'');
  assert.equal(pwProblem('하늘바다별님','20315'),'','한글도 된다');
  assert.equal(pwProblem('203151','20315'),'','학번이 들어 있기만 한 것은 허용');
  assert.match(pwProblem('x'.repeat(73),'20315'),/너무 깁니다/);
  assert.match(pwProblem('가'.repeat(25),'20315'),/너무 깁니다/,'한글 25자 = 75바이트(bcrypt 한계 초과)');
  assert.equal(pwProblem('가'.repeat(24),'20315'),'');
});

/* ---------- 실제 차시 파일 (있을 때만) ---------- */
const DIR=process.env.GB_SAMPLES||path.join(__dirname,'..','..','winter-edit');
const have=fs.existsSync(DIR);
const pairs=have?fs.readdirSync(DIR).filter(f=>/^\d+차시_사이트등록_통계\.txt$/.test(f)).sort().map(f=>({n:f.slice(0,2),stat:path.join(DIR,f),ex:path.join(DIR,f.replace('통계','해설'))})):[];

test('실제 차시 파일 15쌍',{skip:have?false:'샘플 폴더 없음: '+DIR},async t=>{
  assert.equal(pairs.length,15,'통계 파일 15개');
  for(const p of pairs)await t.test(p.n+'차시',()=>{
    const st=fs.readFileSync(p.stat,'utf8'),ext=fs.readFileSync(p.ex,'utf8');
    const want=st.match(/^# 정답:\s*([1-5]+)/m)[1];
    const want3=st.match(/^# 배점 3점 문항:\s*(.*)$/m)[1].match(/\d+/g);
    const rows=st.split('\n').filter(l=>l.trim()&&!l.startsWith('#'));
    const exHeads=(ext.match(/^\[\d+\]/gm)||[]).length;
    const E=newEdit(45);
    const r=parseNat(E,st);
    // 정답 길이 = 문항 수
    assert.equal(E.items.length,want.length,'문항 수');
    assert.equal(E.key.join(''),want,'정답');
    // 3점
    assert.deepEqual(E.items.filter(x=>x.pts===3).map(x=>x.no),want3,'3점 문항');
    // 영역: 모든 문항이 독서/문학/언어 중 하나로 덮인다
    for(const it of E.items)assert.ok(['독서','문학','언어'].includes(it.area),`${it.no}번 영역 ${it.area}`);
    const areaCover=parseRanges(st.match(/^# 영역:\s*(.*)$/m)[1]).reduce((a,x)=>a+x.z-x.a+1,0);
    assert.equal(areaCover,want.length,'영역 범위가 모든 문항을 덮음');
    // 세트: 세트 줄에 적힌 범위의 문항에만 세트 이름이 붙는다
    const sets=parseRanges(st.match(/^# 세트:\s*(.*)$/m)[1]);assert.ok(sets.length>=1,'세트 1개 이상');
    for(const it of E.items){const s=sets.find(x=>+it.no>=x.a&&+it.no<=x.z);assert.equal(it.set||'',s?s.name:'',`${it.no}번 세트`)}
    // 유형: # 유형: 줄이 있으면 모든 문항에 유형이 붙는다(줄이 없는 예전 파일은 건너뜀)
    const ty=st.match(/^# 유형:\s*(.*)$/m);
    if(ty){const tr=parseRanges(ty[1]);for(const it of E.items){const x=tr.find(q=>+it.no>=q.a&&+it.no<=q.z);assert.ok(it.type,`${it.no}번 유형이 비어 있음`);assert.equal(it.type,x.name,`${it.no}번 유형`)}}
    // TOP15 줄: 모두 읽히고, 값은 0~1, 정답 선지 비율 = 정답률
    assert.equal(r.bad.length,0,'읽지 못한 줄: '+r.bad.join(' | '));
    assert.equal(r.ok,rows.length,'전국 줄 수');
    for(const [i,v] of E.nat.entries()){if(!v)continue;
      assert.ok(v.r>0&&v.r<=1,'정답률 범위');assert.equal(v.d.length,5);
      for(const d of v.d)assert.ok(d>=0&&d<=1,'선지 비율 범위');
      assert.ok(Math.abs(v.d[+E.key[i]-1]-v.r)<0.0001,`${i+1}번: 정답 선지 비율과 정답률이 같아야 함`);
      const sum=v.d.reduce((a,b)=>a+b,0);assert.ok(sum>0.95&&sum<1.05,`${i+1}번 비율 합 ${sum}`)}
    // 해설: 모든 문항에 하나씩, 잘림 없음, 해설의 정답 = 통계의 정답
    const x=parseEx(E,ext);
    assert.equal(exHeads,want.length,'해설 블록 수 = 문항 수');
    assert.equal(x.n,want.length,'해설이 들어간 문항 수');
    assert.deepEqual(x.mismatch,[],'해설 정답 불일치');
    assert.deepEqual(x.cut,[],'잘린 해설');
    for(const e of E.ex)assert.match(e,/^정답 [①②③④⑤]/);
  });
});
