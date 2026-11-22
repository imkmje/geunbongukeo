-- 근본국어 (선택) 로그인 잠금 방식 D: 로그인했던 기기 기억 — 학번이 잠겨도, 그 학생이 전에 로그인했던 기기에서는 들어갈 수 있다
-- 고를지 말지는 선생님이 정한다. 고르면 Supabase SQL Editor에서 이 파일만 실행한다(여러 번 실행해도 안전).
-- 필요한 것: supabase/schema.sql 최신본(또는 migrations/2026-11-login-dev.sql)과, 기기 번호를 보내는 새 학생 화면(js/student.js).
-- A·B·C와 함께 쓸 수 있다: 처음 보는 기기에는 그때 쓰고 있는 학번 잠금 규칙(student_login: 기본 10분, A, B, C)이 그대로 적용된다.
--
-- 규칙
--  * 학생 화면은 브라우저마다 무작위 기기 번호(32자)를 만들어 그 브라우저에 저장하고, 로그인할 때 함께 보낸다.
--    서버는 번호 자체가 아니라 그 해시(sha256)만, 그것도 '비밀번호를 맞혀 로그인에 성공한 기기'만 학생별로 최근 5대까지 기억한다.
--    (처음 비밀번호 = 학번 상태로 들어온 로그인은 기억하지 않는다. 학번을 아는 친구 기기가 기억되지 않게)
--  * 처음 보는 기기: 지금과 똑같다(5번 틀리면 학번이 10분 잠김. 잠기면 교사가 '잠금만 풀기').
--  * 기억된 기기: 학번 잠금을 보지 않는다. 비밀번호가 맞으면 학번이 잠겨 있어도 들어간다.
--    그 기기에서 5번 연속 틀리면 그 기기를 잊는다(그다음부터는 처음 보는 기기와 같음).
--  * 비밀번호가 바뀌면(학생이 바꿈, 교사가 초기화, 개인정보 정리) 그 학생의 기억된 기기를 모두 잊는다.
--
-- 좋은 점
--  * 2026-11 시험처럼 스크립트가 학번만으로 한 반을 잠가도, 평소 쓰던 기기(자기 휴대폰·태블릿)로 들어오는 학생은 막히지 않는다.
--  * 비밀번호 맞혀 보기는 지금(10분 잠금)보다 쉬워지지 않는다: 처음 보는 기기의 시도는 모두 학번 잠금 규칙을 따른다.
--    기억된 기기 번호는 그 학생 브라우저 안에만 있고 서버에는 해시만 있어서, 스크립트가 짐작해 낼 수 없다.
--  * 잠금 시간·문구는 그대로라 학생·교사가 새로 배울 것이 없다.
-- 아쉬운 점
--  * 과속 방지턱일 뿐이다: 브라우저 기록·사이트 데이터를 지우거나, 시크릿 창, 다른 브라우저, 새 기기로 들어오면 '처음 보는 기기'라서
--    학번이 잠겨 있으면 못 들어간다(교사가 '잠금만 풀기'/한꺼번에 풀기로 푼다).
--  * 학교 공용 컴퓨터·태블릿은 여러 학생이 같은 기기 번호를 쓴다. 그 기기에서 전에 로그인한 학생이면 기억된 기기로 취급된다
--    (그 기기 앞에 앉은 다른 학생이 그 학번으로 맞혀 보면 5번까지는 학번 잠금 없이 틀릴 수 있고, 그다음은 보통 규칙).
--  * 첫 수업처럼 아직 아무 기기도 기억되지 않았을 때(모두 처음 비밀번호를 바꾼 직후)는 지금과 같다.
--    기기는 '새 비밀번호를 정한 뒤 다시 로그인'했을 때부터 기억된다.
--  * 표 하나(student_devices)와 함수 하나가 늘어난다. 교사 화면에서는 이 표가 보이지 않는다.
-- IP 주소로 막지 않는 까닭: 학교 와이파이는 한 반(때로는 학교 전체)이 공인 IP 하나를 함께 쓰므로, IP로 횟수를 세면
--   장난 한 번에 반 전체가 막힌다. 또 Supabase 앞단의 x-forwarded-for 같은 머리글은 요청한 쪽이 앞부분을 지어 넣을 수 있다.
--
-- 되돌리기: supabase/schema.sql(또는 migrations/2026-11-login-dev.sql)을 다시 실행하면 student_login_dev가 기기 번호를 쓰지 않는
--   기본으로 돌아간다. 표와 트리거까지 지우려면 그 뒤에 아래 두 줄을 실행한다.
--   drop trigger if exists students_forget_devices on public.students;
--   drop table if exists public.student_devices;

create extension if not exists pgcrypto with schema extensions;

-- 로그인에 성공했던 기기. 기기 번호의 sha256 해시만 둔다. 학생·교사 모두 직접 못 읽는다(함수만 씀).
create table if not exists public.student_devices (
  student_id  uuid not null references public.students(id) on delete cascade,
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  fail_count  int  not null default 0,                 -- 이 기기에서 연속으로 틀린 횟수(5번이면 이 기기를 잊음)
  last_ok_at  timestamptz not null default now(),      -- 이 기기에서 마지막으로 로그인한 때(최근 5대만 남김)
  primary key (student_id, device_hash)
);
alter table public.student_devices enable row level security;
revoke all on table public.student_devices from anon, authenticated;

-- 비밀번호가 바뀌면(학생이 바꿈·교사 초기화·개인정보 정리) 기억된 기기를 모두 잊는다.
create or replace function public._students_forget_devices()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if new.code_hash is distinct from old.code_hash then
    delete from public.student_devices where student_id = new.id;
  end if;
  return null;
end $$;
revoke execute on function public._students_forget_devices() from public, anon, authenticated;
drop trigger if exists students_forget_devices on public.students;
create trigger students_forget_devices after update of code_hash on public.students
  for each row execute function public._students_forget_devices();

-- 로그인(기기 기억). p_device: 학생 화면이 만든 기기 번호(영문·숫자·_- 16~64자). 없거나 모양이 다르면 처음 보는 기기로 본다.
create or replace function public.student_login_dev(p_sid text, p_password text, p_device text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare s public.students; d public.student_devices; h text; tok uuid; r json;
begin
  if p_device ~ '^[A-Za-z0-9_-]{16,64}$' then
    h := encode(digest(p_device, 'sha256'), 'hex');
    select * into s from public.students where sid = trim(p_sid);
    if found and s.code_hash is not null then
      select * into d from public.student_devices where student_id = s.id and device_hash = h for update;
    end if;
  end if;

  if d.student_id is null then
    -- 처음 보는 기기: 학번 잠금 규칙(student_login) 그대로. 새 비밀번호로 로그인에 성공했을 때만 이 기기를 기억한다.
    r := public.student_login(p_sid, p_password);
    if h is not null and s.id is not null and coalesce((r->>'ok')::boolean, false)
       and not coalesce((r->>'must_change')::boolean, true) then
      insert into public.student_devices(student_id, device_hash) values (s.id, h)
      on conflict (student_id, device_hash) do update set fail_count = 0, last_ok_at = now();
      delete from public.student_devices x
       where x.student_id = s.id
         and x.device_hash not in (select y.device_hash from public.student_devices y where y.student_id = s.id
                                   order by y.last_ok_at desc limit 5);
    end if;
    return r;
  end if;

  -- 기억된 기기: 학번 잠금(locked_until)은 보지 않는다.
  if s.code_hash = crypt(trim(p_password), s.code_hash) then
    update public.student_devices set fail_count = 0, last_ok_at = now() where student_id = s.id and device_hash = h;
    -- 학번이 잠겨 있지 않을 때만 학번의 틀린 횟수를 0으로(잠금은 그대로 두어 교사 화면에 '잠김'이 남는다)
    update public.students set fail_count = 0 where id = s.id and (locked_until is null or locked_until <= now());
    if exists (select 1 from public.classes c where c.id = s.class_id and c.hidden) then
      return json_build_object('ok', false, 'error', 'class_hidden');
    end if;
    delete from public.student_sessions where expires_at < now();
    insert into public.student_sessions(student_id) values (s.id) returning token into tok;
    return json_build_object('ok', true, 'token', tok, 'sid', s.sid, 'name', s.name, 'must_change', s.must_change_pw);
  end if;
  if d.fail_count + 1 >= 5 then
    delete from public.student_devices where student_id = s.id and device_hash = h;   -- 이 기기를 잊는다
  else
    update public.student_devices set fail_count = fail_count + 1 where student_id = s.id and device_hash = h;
  end if;
  perform pg_sleep(0.4);
  return json_build_object('ok', false, 'error', 'wrong');
end $$;
revoke execute on function public.student_login_dev(text, text, text) from public, anon, authenticated;
grant execute on function public.student_login_dev(text, text, text) to anon, authenticated;
