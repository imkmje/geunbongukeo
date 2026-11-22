-- 근본국어 (선택) 로그인 잠금 방식 B: 단계적 잠금 — 처음 잠금은 3분, 또 잠기면 10분 → 30분
-- 고를지 말지는 선생님이 정한다. 고르면 Supabase SQL Editor에서 이 파일만 실행한다(여러 번 실행해도 안전).
-- A·B 중 하나만 실행한다(마지막에 실행한 것이 남음). 되돌리려면 supabase/schema.sql을 다시 실행한다
-- (새로 생긴 lock_level 칸은 남지만 쓰이지 않는다).
--
-- 규칙
--  * 5번 틀릴 때마다 잠긴다. 잠금 단계: 1번째 3분, 2번째 10분, 3번째부터 30분.
--  * 비밀번호를 맞혀 로그인하면 단계가 처음(0)으로 돌아간다. 마지막 잠금 뒤 하루가 지나도 처음으로 돌아간다.
--  * 교사의 '잠금만 풀기'와 '비밀번호 초기화'도 단계를 처음으로 돌린다.
-- 좋은 점: 실수로 잠긴 학생·장난으로 한 번 잠긴 학생은 3분이면 풀린다. 계속 맞혀 보려는 사람은 점점 오래 기다린다
--          (하루 최대 약 250번 정도로, 지금 10분 고정(약 720번)보다 적다).
-- 아쉬운 점: 누가 일부러 계속 잠그면 피해 학생이 30분까지 못 들어갈 수 있다(교사가 '잠금만 풀기'로 바로 풀 수 있음).
--           표에 칸이 하나(lock_level) 더 생긴다.

alter table public.students add column if not exists lock_level int not null default 0;

create or replace function public.student_login(p_sid text, p_password text)
returns json language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare s public.students; tok uuid; lv int;
begin
  select * into s from public.students where sid = trim(p_sid);
  if not found or s.code_hash is null then
    perform pg_sleep(0.4);
    return json_build_object('ok', false, 'error', 'wrong');
  end if;
  if s.locked_until is not null and s.locked_until > now() then
    return json_build_object('ok', false, 'error', 'locked', 'until', s.locked_until);
  end if;
  if s.code_hash = crypt(trim(p_password), s.code_hash) then
    update public.students set fail_count = 0, locked_until = null, lock_level = 0 where id = s.id;
    if exists (select 1 from public.classes c where c.id = s.class_id and c.hidden) then
      return json_build_object('ok', false, 'error', 'class_hidden');
    end if;
    delete from public.student_sessions where expires_at < now();
    insert into public.student_sessions(student_id) values (s.id) returning token into tok;
    return json_build_object('ok', true, 'token', tok, 'sid', s.sid, 'name', s.name, 'must_change', s.must_change_pw);
  end if;
  if s.fail_count + 1 >= 5 then
    -- 마지막 잠금이 하루보다 오래전이면 처음 단계부터
    lv := case when s.locked_until is null or s.locked_until < now() - interval '1 day' then 1 else s.lock_level + 1 end;
    update public.students
       set fail_count = 0, lock_level = lv,
           locked_until = now() + case lv when 1 then interval '3 minutes' when 2 then interval '10 minutes'
                                          else interval '30 minutes' end
     where id = s.id;
  else
    update public.students set fail_count = fail_count + 1 where id = s.id;
  end if;
  perform pg_sleep(0.4);
  return json_build_object('ok', false, 'error', 'wrong');
end $$;
grant execute on function public.student_login(text, text) to anon, authenticated;

-- 교사 '잠금만 풀기'·'비밀번호 초기화'도 단계를 처음으로 돌린다.
create or replace function public._students_lock_level_reset()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.locked_until is null and new.fail_count = 0 and old.locked_until is not null and old.locked_until > now() then
    new.lock_level := 0;   -- 잠금이 걸려 있는데 밖에서 풀었다 = 교사가 풀었다
  end if;
  return new;
end $$;
revoke execute on function public._students_lock_level_reset() from public, anon, authenticated;
drop trigger if exists students_lock_level_reset on public.students;
create trigger students_lock_level_reset before update of locked_until on public.students
  for each row execute function public._students_lock_level_reset();
