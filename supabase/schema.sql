-- 근본국어 (geunbongukeo) 데이터베이스 구조
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전하도록 작성했다(이미 있는 것은 건너뛰거나 다시 만든다).
--
-- 원칙
--  * 모든 표에 RLS를 켠다. 공개 키(anon)만으로는 어떤 표도 직접 읽거나 쓸 수 없다.
--  * 교사: teachers 표에 등록된 로그인 계정만 모든 표를 읽고 쓴다.
--  * 학생: 표를 직접 만지지 못하고, 아래 student_* 함수만 부를 수 있다.
--  * 학생 비밀번호: 처음(또는 교사가 초기화한 뒤)에는 학번과 같다. 그 상태로 로그인하면
--    새 비밀번호(6자 이상, 학번과 다름)를 정하기 전에는 시험 목록·제출·결과 함수가 모두 거절된다.

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── 표 ─────────────────────────
create table if not exists public.teachers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  sid          text not null unique check (sid ~ '^[0-9]{5}$'),   -- 학번 5자리
  name         text not null check (length(trim(name)) between 1 and 30),
  class_id     uuid references public.classes(id) on delete set null,
  code_hash    text,                                               -- 비밀번호(bcrypt). 이름은 예전 '개인 코드' 때 그대로
  must_change_pw boolean not null default true,                    -- true면 로그인 직후 새 비밀번호를 정해야 함
  fail_count   int  not null default 0,
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.tests (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(trim(title)) between 1 and 100),
  test_date  date,
  items      jsonb not null default '[]'::jsonb,  -- [{no, area, type, pts, set}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.test_keys (
  test_id    uuid primary key references public.tests(id) on delete cascade,
  answers    text  not null default '',  -- 문항 순서대로 '1'~'5' ('0' = 미입력)
  nat        jsonb,                      -- 전국 정답률·선지 비율 [{r, d:[5]}|null]
  ex         jsonb,                      -- 해설 [text|null]
  tags       jsonb,                      -- 오답 선지 오류 유형 [{"2":"과잉 추론"}|null]
  updated_at timestamptz not null default now()
);

create table if not exists public.test_class (
  test_id     uuid not null references public.tests(id) on delete cascade,
  class_id    uuid not null references public.classes(id) on delete cascade,
  is_open     boolean not null default false,
  closed_once boolean not null default false,
  released    boolean not null default false,
  released_at timestamptz,
  stats       jsonb,                     -- 공개 시점의 반 통계(교사 화면에서 계산해 저장)
  primary key (test_id, class_id)
);

create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  test_id      uuid not null references public.tests(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  answers      text not null check (answers ~ '^[0-5]*$'),
  src          text not null default 'student' check (src in ('student','teacher')),
  submitted_at timestamptz not null default now(),
  unique (test_id, student_id)
);

create table if not exists public.student_sessions (
  token      uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '12 hours'
);

-- 예전 버전에서 만든 표에 새 칸 추가
alter table public.students add column if not exists must_change_pw boolean not null default true;
-- 반 숨기기: 수업이 끝난 반. 숨긴 반 학생은 로그인할 수 없지만 학생·답안·결과 기록은 그대로 남는다.
alter table public.classes add column if not exists hidden boolean not null default false;
alter table public.classes add column if not exists hidden_at timestamptz;

create index if not exists submissions_student_idx on public.submissions(student_id);
create index if not exists students_class_idx on public.students(class_id);

-- ───────────────────────── 학생 비밀번호: 기본값과 한 번만 하는 옮기기 ─────────────────────────
-- 새로 들어온 학생(명단 붙여넣기)은 비밀번호 = 학번, 첫 로그인 때 바꾸게 한다.
create or replace function public._students_default_pw()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if new.code_hash is null then
    new.code_hash := crypt(new.sid, gen_salt('bf', 8));
    new.must_change_pw := true;
  end if;
  return new;
end $$;
drop trigger if exists students_default_pw on public.students;
create trigger students_default_pw before insert on public.students
  for each row execute function public._students_default_pw();

-- 이미 실행한 옮기기를 기록하는 표(교사·학생 모두 직접 못 읽음)
create table if not exists public.schema_migrations (
  name   text primary key,
  run_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;

-- 개인 코드 → 비밀번호 옮기기: 이 파일을 처음 다시 실행할 때 딱 한 번만,
-- 기존 학생 모두의 비밀번호를 학번으로 바꾸고 첫 로그인 때 새로 정하게 한다. 로그인 중인 학생은 모두 로그아웃된다.
-- (두 번째 실행부터는 건너뛰므로, 학생이 바꾼 비밀번호가 다시 학번으로 돌아가지 않는다.)
do $$
begin
  if not exists (select 1 from public.schema_migrations where name = 'student_pw_v1') then
    update public.students
       set code_hash = extensions.crypt(sid, extensions.gen_salt('bf', 8)),
           must_change_pw = true, fail_count = 0, locked_until = null;
    delete from public.student_sessions;
    insert into public.schema_migrations(name) values ('student_pw_v1');
  end if;
end $$;

-- 예전 개인 코드 발급 함수는 더 쓰지 않는다.
drop function if exists public.teacher_issue_codes(uuid, uuid, boolean);

-- ───────────────────────── 교사 판별 ─────────────────────────
create or replace function public.is_teacher()
returns boolean language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.teachers where user_id = auth.uid()) $$;

-- ───────────────────────── 사이트 설정(제목 등) ─────────────────────────
-- 누구나 읽을 수 있는 공개 정보. 교사만 고칠 수 있다.
create table if not exists public.site_settings (
  id               int primary key default 1 check (id = 1),
  title            text not null default '근본국어' check (length(trim(title)) between 1 and 40),
  student_subtitle text not null default '고2 국어 · 내 답안과 결과' check (length(student_subtitle) <= 60),
  teacher_subtitle text not null default '교사 · 문항 분석' check (length(teacher_subtitle) <= 60),
  updated_at       timestamptz not null default now()
);
insert into public.site_settings(id) values (1) on conflict do nothing;
alter table public.site_settings enable row level security;
drop policy if exists public_read on public.site_settings;
create policy public_read on public.site_settings for select to anon, authenticated using (true);
drop policy if exists teacher_write on public.site_settings;
create policy teacher_write on public.site_settings for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- ───────────────────────── 접근 규칙(RLS) ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['teachers','classes','students','tests','test_keys','test_class','submissions','student_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists teacher_all on public.%I', t);
  end loop;
  -- 교사는 student_sessions를 제외한 모든 표를 읽고 쓴다.
  foreach t in array array['classes','students','tests','test_keys','test_class','submissions'] loop
    execute format('create policy teacher_all on public.%I for all to authenticated using (public.is_teacher()) with check (public.is_teacher())', t);
  end loop;
end $$;
-- teachers 표: 교사는 목록을 읽을 수만 있다(등록은 SQL Editor에서만).
create policy teacher_all on public.teachers for select to authenticated using (public.is_teacher());
-- student_sessions: 정책 없음 = 누구도 직접 못 읽음(함수만 사용).

-- ───────────────────────── 학생용 함수 ─────────────────────────
-- 세션 토큰 → 학생. 잘못되거나 만료되면 오류.
create or replace function public._session_student(p_token uuid)
returns public.students language plpgsql stable security definer
set search_path = public
as $$
declare s public.students;
begin
  select st.* into s from public.student_sessions ss join public.students st on st.id = ss.student_id
   where ss.token = p_token and ss.expires_at > now();
  if not found then raise exception 'invalid_session' using errcode = '28000'; end if;
  -- 숨긴 반 학생은 이미 로그인해 있어도 더 쓸 수 없다(반이 없는 학생은 예전처럼 로그인은 된다).
  if exists (select 1 from public.classes c where c.id = s.class_id and c.hidden) then
    raise exception 'class_hidden' using errcode = '28000';
  end if;
  return s;
end $$;

-- 위와 같지만, 비밀번호를 아직 바꾸지 않았으면 거절한다(시험 목록·제출·결과용).
create or replace function public._session_student_ready(p_token uuid)
returns public.students language plpgsql stable security definer
set search_path = public
as $$
declare s public.students;
begin
  s := public._session_student(p_token);
  if s.must_change_pw then raise exception 'must_change_password' using errcode = '28000'; end if;
  return s;
end $$;

-- 로그인: 학번 + 비밀번호. 5번 틀리면 10분 잠금. must_change가 true면 학생 화면이 비밀번호 바꾸기부터 보여 준다.
drop function if exists public.student_login(text, text);
create or replace function public.student_login(p_sid text, p_password text)
returns json language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare s public.students; tok uuid;
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
    update public.students set fail_count = 0, locked_until = null where id = s.id;
    -- 비밀번호가 맞아도 숨긴 반 학생이면 들어가지 못한다(비밀번호를 맞힌 뒤에만 알려 준다).
    if exists (select 1 from public.classes c where c.id = s.class_id and c.hidden) then
      return json_build_object('ok', false, 'error', 'class_hidden');
    end if;
    delete from public.student_sessions where expires_at < now();
    insert into public.student_sessions(student_id) values (s.id) returning token into tok;
    return json_build_object('ok', true, 'token', tok, 'sid', s.sid, 'name', s.name, 'must_change', s.must_change_pw);
  end if;
  update public.students
     set fail_count   = case when fail_count + 1 >= 5 then 0 else fail_count + 1 end,
         locked_until = case when fail_count + 1 >= 5 then now() + interval '10 minutes' else null end
   where id = s.id;
  perform pg_sleep(0.4);
  return json_build_object('ok', false, 'error', 'wrong');
end $$;

create or replace function public.student_logout(p_token uuid)
returns void language sql volatile security definer
set search_path = public
as $$ delete from public.student_sessions where token = p_token $$;

-- 내 화면: 내 반에 열렸거나 공개된 시험 목록(정답 없이)
create or replace function public.student_home(p_token uuid)
returns json language plpgsql stable security definer
set search_path = public
as $$
declare s public.students; cls text;
begin
  s := public._session_student_ready(p_token);
  select name into cls from public.classes where id = s.class_id;
  return json_build_object(
    'sid', s.sid, 'name', s.name, 'class', cls,
    'tests', coalesce((
      select json_agg(json_build_object(
               'id', t.id, 'title', t.title, 'test_date', t.test_date, 'items', t.items,
               'is_open', tc.is_open, 'released', tc.released,
               'submitted_at', sub.submitted_at, 'answers', sub.answers)
             order by t.test_date desc nulls last, t.created_at desc)
        from public.test_class tc
        join public.tests t on t.id = tc.test_id
        left join public.submissions sub on sub.test_id = t.id and sub.student_id = s.id
       where tc.class_id = s.class_id and (tc.is_open or tc.released)), '[]'::json));
end $$;

-- 답안 제출: 내 반에 응시가 열려 있을 때만
create or replace function public.student_submit(p_token uuid, p_test uuid, p_answers text)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare s public.students; n int;
begin
  s := public._session_student_ready(p_token);
  if not exists (select 1 from public.test_class where test_id = p_test and class_id = s.class_id and is_open) then
    return json_build_object('ok', false, 'error', 'closed');
  end if;
  select jsonb_array_length(items) into n from public.tests where id = p_test;
  if p_answers !~ '^[0-5]*$' or length(p_answers) <> n then
    return json_build_object('ok', false, 'error', 'bad_answers');
  end if;
  insert into public.submissions(test_id, student_id, answers, src, submitted_at)
  values (p_test, s.id, p_answers, 'student', now())
  on conflict (test_id, student_id) do update
    set answers = excluded.answers, src = 'student', submitted_at = now();
  return json_build_object('ok', true, 'submitted_at', now());
end $$;

-- 결과: 내 반에 공개된 시험만(정답·해설·통계·내 답안). p_test가 null이면 공개된 전부(누적 기록용).
create or replace function public.student_results(p_token uuid, p_test uuid default null)
returns json language plpgsql stable security definer
set search_path = public
as $$
declare s public.students;
begin
  s := public._session_student_ready(p_token);
  return coalesce((
    select json_agg(json_build_object(
             'id', t.id, 'title', t.title, 'test_date', t.test_date, 'items', t.items,
             'key', k.answers, 'nat', k.nat, 'ex', k.ex, 'tags', k.tags,
             'stats', tc.stats, 'answers', sub.answers, 'submitted_at', sub.submitted_at)
           order by t.test_date nulls last, t.created_at)
      from public.test_class tc
      join public.tests t on t.id = tc.test_id
      left join public.test_keys k on k.test_id = t.id
      left join public.submissions sub on sub.test_id = t.id and sub.student_id = s.id
     where tc.class_id = s.class_id and tc.released
       and (p_test is null or t.id = p_test)), '[]'::json);
end $$;

-- 비밀번호 바꾸기. 처음(must_change) 상태면 지금 비밀번호를 묻지 않고, 아니면 지금 비밀번호가 맞아야 한다.
-- 규칙: 앞뒤 빈칸을 뺀 길이 6자 이상·72바이트 이하(한글은 24자 정도), 학번과 같으면 안 됨(js/logic.js의 pwProblem과 같은 규칙).
-- 바꾸면 이 학생의 다른 로그인은 모두 끊긴다(먼저 들어와 있던 다른 사람을 내보냄).
create or replace function public.student_change_password(p_token uuid, p_new text, p_old text default null)
returns json language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare s public.students; pw text := trim(coalesce(p_new, ''));
begin
  s := public._session_student(p_token);
  if not s.must_change_pw and (p_old is null or s.code_hash <> crypt(trim(p_old), s.code_hash)) then
    perform pg_sleep(0.4);
    return json_build_object('ok', false, 'error', 'wrong_old');
  end if;
  if length(pw) < 6 then return json_build_object('ok', false, 'error', 'too_short'); end if;
  if octet_length(pw) > 72 then return json_build_object('ok', false, 'error', 'too_long'); end if;  -- bcrypt 한계(바이트)
  if pw = s.sid then return json_build_object('ok', false, 'error', 'same_as_sid'); end if;
  update public.students set code_hash = crypt(pw, gen_salt('bf', 8)), must_change_pw = false,
         fail_count = 0, locked_until = null where id = s.id;
  delete from public.student_sessions where student_id = s.id and token <> p_token;
  return json_build_object('ok', true);
end $$;

-- ───────────────────────── 교사용 함수 ─────────────────────────
-- 비밀번호 초기화: 한 학생의 비밀번호를 학번으로 되돌리고, 다음 로그인 때 새로 정하게 한다. 잠금도 풀린다.
-- 교사 계정(teachers 표)만 부를 수 있다. 반에 속한 학생만 대상으로 한다.
create or replace function public.teacher_reset_password(p_student uuid)
returns json language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare s public.students;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  select * into s from public.students where id = p_student and class_id is not null;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  update public.students set code_hash = crypt(s.sid, gen_salt('bf', 8)), must_change_pw = true,
         fail_count = 0, locked_until = null where id = s.id;
  delete from public.student_sessions where student_id = s.id;
  return json_build_object('ok', true, 'sid', s.sid, 'name', s.name);
end $$;
-- 반 숨기기 / 다시 보이기. 아무것도 지우지 않는다.
-- 숨겨도 로그인 세션은 지우지 않는다: 로그인해 있던 학생이 다음에 무엇을 누르면 _session_student가 'class_hidden'을 알려
-- 학생 화면에 '수업이 끝난 반…'이 뜬다(세션을 지우면 '로그인 시간이 지났습니다'로 잘못 보였다). 숨긴 반 학생은 어차피 아무 함수도 쓸 수 없다.
create or replace function public.teacher_set_class_hidden(p_class uuid, p_hidden boolean)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare n int;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  update public.classes set hidden = p_hidden, hidden_at = case when p_hidden then now() else null end where id = p_class;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  select count(*) into n from public.students where class_id = p_class;
  return json_build_object('ok', true, 'students', n);
end $$;

-- 무료 프로젝트 일시 정지 방지용(.github/workflows/keepalive.yml이 매일 부른다). 데이터는 읽지 않는다.
create or replace function public.keepalive()
returns timestamptz language sql stable
as $$ select now() $$;

-- ───────────────────────── 실행 권한 ─────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.keepalive() to anon, authenticated;
grant execute on function public.student_login(text, text) to anon, authenticated;
grant execute on function public.student_logout(uuid) to anon, authenticated;
grant execute on function public.student_home(uuid) to anon, authenticated;
grant execute on function public.student_submit(uuid, uuid, text) to anon, authenticated;
grant execute on function public.student_results(uuid, uuid) to anon, authenticated;
grant execute on function public.student_change_password(uuid, text, text) to anon, authenticated;
grant execute on function public.teacher_reset_password(uuid) to authenticated;
grant execute on function public.teacher_set_class_hidden(uuid, boolean) to authenticated;
-- _session_student, _session_student_ready, _students_default_pw는 아무에게도 주지 않는다(안에서만 쓰임).

-- ───────────────────────── 교사 등록 (따로 한 번 실행) ─────────────────────────
-- Authentication → Users에서 교사 계정을 만든 뒤, 아래 줄의 이메일을 바꿔 실행한다.
-- insert into public.teachers(user_id) select id from auth.users where email = '선생님@이메일' on conflict do nothing;

-- ═══ 추가 기능: 학생별 피드백 · 틀린 문항 다시 풀기 ═══
-- 수업 흐름(반마다): 응시 → ① 결과 공개 → ② 학생이 틀린 문항 다시 풀기(한 번) → 교사 설명 수업 → ③ 정답·해설 공개
--  * 결과 공개(test_class.released): 학생은 점수, 문항별 맞음/틀림/무응답, 영역·지문 세트별 결과, 반 통계만 본다.
--    정답·해설·선지 비율(전국·반)·오답 꼬리표·선생님 한마디는 보내지 않는다(서버에서 막음).
--  * 다시 풀기(retries): 결과 공개 뒤 정답·해설 공개 전까지만, 학생마다 시험당 한 번. 틀렸거나 비운 문항만 다시 마킹한다.
--    다시 푼 답이 맞았는지는 정답·해설 공개 뒤에만 알려 준다(정답을 떠보는 데 쓰지 못하게).
--  * 정답·해설 공개(test_class.key_released): 정답·해설·다시 풀기 결과(실수형/개념형)·선생님 한마디가 열린다.
--  * 결과가 공개된 뒤에는 학생이 처음 답안을 고칠 수 없다(맞음/틀림을 보고 답을 바꿔 정답을 알아내지 못하게).
-- 이 블록은 위쪽의 student_home·student_submit·student_results를 새 규칙으로 다시 만든다(이 블록이 최종본).

-- ───── 정답·해설 공개 단계 ─────
alter table public.test_class add column if not exists key_released boolean not null default false;
alter table public.test_class add column if not exists key_released_at timestamptz;

-- 이 기능 전에 이미 결과를 공개한 시험은 학생이 정답·해설을 보고 있었으므로, 처음 한 번만 '정답·해설 공개'로 옮긴다.
-- (그 시험은 다시 풀기 단계를 건너뛴 것으로 본다. 두 번째 실행부터는 건너뛴다.)
do $$
begin
  if not exists (select 1 from public.schema_migrations where name = 'key_release_v1') then
    update public.test_class set key_released = true, key_released_at = coalesce(released_at, now()) where released;
    insert into public.schema_migrations(name) values ('key_release_v1');
  end if;
end $$;

-- 결과 공개를 취소하면 정답·해설 공개도 함께 취소된다(다시 공개할 때 정답이 바로 보이지 않게).
create or replace function public._test_class_key_guard()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if not new.released then new.key_released := false; new.key_released_at := null; end if;
  if new.key_released and new.key_released_at is null then new.key_released_at := now(); end if;
  if not new.key_released then new.key_released_at := null; end if;
  return new;
end $$;
drop trigger if exists test_class_key_guard on public.test_class;
create trigger test_class_key_guard before insert or update on public.test_class
  for each row execute function public._test_class_key_guard();

-- ───── 표 ─────
-- 선생님 한마디: 시험별(test_id 있음) 또는 누적 코멘트(test_id 없음). 학생·시험마다 하나.
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  test_id    uuid references public.tests(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  body       text not null check (length(body) between 1 and 500),
  updated_at timestamptz not null default now(),
  constraint feedback_test_student_key unique nulls not distinct (test_id, student_id)
);
create index if not exists feedback_student_idx on public.feedback(student_id);

-- 다시 풀기: 처음 답안과 같은 길이. 다시 푼 문항만 '0'~'5'(0=또 비움), 나머지는 '-'.
create table if not exists public.retries (
  test_id      uuid not null references public.tests(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  answers      text not null check (answers ~ '^[0-5-]*$'),
  submitted_at timestamptz not null default now(),
  primary key (test_id, student_id)
);
create index if not exists retries_student_idx on public.retries(student_id);

do $$
declare t text;
begin
  foreach t in array array['feedback','retries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists teacher_all on public.%I', t);
    execute format('create policy teacher_all on public.%I for all to authenticated using (public.is_teacher()) with check (public.is_teacher())', t);
  end loop;
end $$;

-- ───── 채점 도우미(안에서만 씀) ─────
-- 문항마다 'O' 맞음 / 'X' 틀림 / 'B' 무응답 / '.' 채점 안 함(정답 없음·선택과목). 답안이 없으면 null.
create or replace function public._ox(p_items jsonb, p_key text, p_ans text)
returns text language sql immutable
set search_path = public
as $$
  select case when p_ans is null then null else coalesce(string_agg(
           case when substr(coalesce(p_key,''), i, 1) not between '1' and '5'
                  or coalesce(p_items->(i-1)->>'el', '') <> '' then '.'
                when substr(p_ans, i, 1) = substr(p_key, i, 1) then 'O'
                when substr(p_ans, i, 1) in ('', '0') then 'B'
                else 'X' end, '' order by i), '') end
    from generate_series(1, coalesce(jsonb_array_length(p_items), 0)) i
$$;

-- ───── 학생용 함수 (새 규칙으로 다시 만듦) ─────
-- 시험 목록: 결과가 공개된 시험은 응시 중으로 보이지 않는다.
create or replace function public.student_home(p_token uuid)
returns json language plpgsql stable security definer
set search_path = public
as $$
declare s public.students; cls text;
begin
  s := public._session_student_ready(p_token);
  select name into cls from public.classes where id = s.class_id;
  return json_build_object(
    'sid', s.sid, 'name', s.name, 'class', cls,
    'tests', coalesce((
      select json_agg(json_build_object(
               'id', t.id, 'title', t.title, 'test_date', t.test_date, 'items', t.items,
               'is_open', tc.is_open and not tc.released, 'released', tc.released,
               'key_released', tc.released and tc.key_released,
               'retry_due', tc.released and not tc.key_released and sub.answers is not null and rt.test_id is null
                            and public._ox(t.items, k.answers, sub.answers) ~ '[XB]',
               'submitted_at', sub.submitted_at, 'answers', sub.answers)
             order by t.test_date desc nulls last, t.created_at desc)
        from public.test_class tc
        join public.tests t on t.id = tc.test_id
        left join public.test_keys k on k.test_id = t.id
        left join public.submissions sub on sub.test_id = t.id and sub.student_id = s.id
        left join public.retries rt on rt.test_id = t.id and rt.student_id = s.id
       where tc.class_id = s.class_id and (tc.is_open or tc.released)), '[]'::json));
end $$;

-- 답안 제출: 내 반에 응시가 열려 있고, 아직 결과가 공개되지 않았을 때만
create or replace function public.student_submit(p_token uuid, p_test uuid, p_answers text)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare s public.students; n int;
begin
  s := public._session_student_ready(p_token);
  if not exists (select 1 from public.test_class where test_id = p_test and class_id = s.class_id and is_open and not released) then
    return json_build_object('ok', false, 'error', 'closed');
  end if;
  select jsonb_array_length(items) into n from public.tests where id = p_test;
  if p_answers !~ '^[0-5]*$' or length(p_answers) <> n then
    return json_build_object('ok', false, 'error', 'bad_answers');
  end if;
  insert into public.submissions(test_id, student_id, answers, src, submitted_at)
  values (p_test, s.id, p_answers, 'student', now())
  on conflict (test_id, student_id) do update
    set answers = excluded.answers, src = 'student', submitted_at = now();
  return json_build_object('ok', true, 'submitted_at', now());
end $$;

-- 작은 반 통계 기준: 응시 인원(stats.n)이 이 수보다 적으면 학생 화면에 반 통계(반 평균·문항 정답률·선지 비율·영역·유형)를 주지 않는다.
-- (몇 명뿐이면 반 평균으로 다른 학생 점수를 짐작할 수 있다.) 기준을 바꾸려면 아래 숫자 하나만 고친다.
create or replace function public._class_stats_min_n()
returns int language sql immutable
as $$ select 5 $$;

-- 결과: 내 반에 공개된 시험만. p_test가 null이면 공개된 전부(누적 기록용).
--  stage 'result'(정답·해설 공개 전): 점수 계산용 ox, 반 통계(문항 정답률·영역·유형), 전국 정답률(r)만.
--     key·ex·tags·선지 비율(nat.d, stats.dist)·선생님 한마디는 null.
--  stage 'key'(정답·해설 공개 후): 위에 더해 key·ex·tags·nat·stats 전체, 다시 풀기 답, 선생님 한마디.
--  두 단계 모두: 반 응시 인원이 _class_stats_min_n()보다 적으면 stats는 null이고 stats_small은 true(그 밖에는 false).
create or replace function public.student_results(p_token uuid, p_test uuid default null)
returns json language plpgsql stable security definer
set search_path = public
as $$
declare s public.students; r record; res jsonb := '[]'::jsonb; ox text; st jsonb; small boolean;
begin
  s := public._session_student_ready(p_token);
  for r in
    select t.id, t.title, t.test_date, t.items, k.answers as key, k.nat, k.ex, k.tags, tc.stats,
           tc.key_released as kr, sub.answers, sub.submitted_at,
           rt.answers as r_answers, rt.submitted_at as r_at, fb.body as fb_body, fb.updated_at as fb_at
      from public.test_class tc
      join public.tests t on t.id = tc.test_id
      left join public.test_keys k on k.test_id = t.id
      left join public.submissions sub on sub.test_id = t.id and sub.student_id = s.id
      left join public.retries rt on rt.test_id = t.id and rt.student_id = s.id
      left join public.feedback fb on fb.test_id = t.id and fb.student_id = s.id
     where tc.class_id = s.class_id and tc.released
       and (p_test is null or t.id = p_test)
     order by t.test_date nulls last, t.created_at
  loop
    ox := public._ox(r.items, r.key, r.answers);
    small := r.stats is not null
             and coalesce(case when jsonb_typeof(r.stats->'n') = 'number' then (r.stats->>'n')::numeric end, 0) < public._class_stats_min_n();
    if r.kr then
      res := res || jsonb_build_array(jsonb_build_object(
        'id', r.id, 'title', r.title, 'test_date', r.test_date, 'items', r.items, 'stage', 'key',
        'key', r.key, 'nat', r.nat, 'ex', r.ex, 'tags', r.tags,
        'stats', case when small then null else r.stats end, 'stats_small', small,
        'answers', r.answers, 'submitted_at', r.submitted_at, 'ox', ox,
        'retry', case when r.r_answers is null then null else jsonb_build_object('answers', r.r_answers, 'submitted_at', r.r_at) end,
        'can_retry', false,
        'feedback', case when r.fb_body is null then null else jsonb_build_object('body', r.fb_body, 'updated_at', r.fb_at) end));
    else
      st := case when small then null else r.stats end;
      if st is not null then st := st - 'dist'; end if;
      res := res || jsonb_build_array(jsonb_build_object(
        'id', r.id, 'title', r.title, 'test_date', r.test_date, 'items', r.items, 'stage', 'result',
        'key', null, 'ex', null, 'tags', null, 'stats', st, 'stats_small', small,
        'nat', case when jsonb_typeof(r.nat) = 'array' then
                 (select jsonb_agg(case when jsonb_typeof(e) = 'object' then jsonb_build_object('r', e->'r') else null end order by o)
                    from jsonb_array_elements(r.nat) with ordinality x(e, o)) end,
        'answers', r.answers, 'submitted_at', r.submitted_at, 'ox', ox,
        'retry', case when r.r_answers is null then null else jsonb_build_object('answers', r.r_answers, 'submitted_at', r.r_at) end,
        'can_retry', r.answers is not null and r.r_answers is null and coalesce(ox, '') ~ '[XB]',
        'feedback', null));
    end if;
  end loop;
  return res::json;
end $$;

-- 다시 풀기 제출: 결과 공개 뒤·정답 공개 전, 답안을 낸 학생만, 시험당 한 번.
-- p_answers: 처음 답안과 같은 길이('0'~'5' 또는 '-'). 틀렸거나 비운 문항 자리만 읽고 나머지는 '-'로 저장한다.
create or replace function public.student_retry_submit(p_token uuid, p_test uuid, p_answers text)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare s public.students; tc public.test_class; it jsonb; ky text; first text; ox text; n int; out text := ''; c text; i int;
begin
  s := public._session_student_ready(p_token);
  select * into tc from public.test_class where test_id = p_test and class_id = s.class_id;
  if not found or not tc.released then return json_build_object('ok', false, 'error', 'not_released'); end if;
  if tc.key_released then return json_build_object('ok', false, 'error', 'key_released'); end if;
  select answers into first from public.submissions where test_id = p_test and student_id = s.id;
  if not found then return json_build_object('ok', false, 'error', 'no_submission'); end if;
  if exists (select 1 from public.retries where test_id = p_test and student_id = s.id) then
    return json_build_object('ok', false, 'error', 'already');
  end if;
  select t.items, k.answers into it, ky from public.tests t left join public.test_keys k on k.test_id = t.id where t.id = p_test;
  ox := public._ox(it, ky, first);
  if ox !~ '[XB]' then return json_build_object('ok', false, 'error', 'nothing_to_retry'); end if;
  n := jsonb_array_length(it);
  if p_answers is null or length(p_answers) <> n or p_answers !~ '^[0-5-]*$' then
    return json_build_object('ok', false, 'error', 'bad_answers');
  end if;
  for i in 1..n loop
    if substr(ox, i, 1) in ('X', 'B') then
      c := substr(p_answers, i, 1); out := out || case when c = '-' then '0' else c end;
    else out := out || '-'; end if;
  end loop;
  insert into public.retries(test_id, student_id, answers) values (p_test, s.id, out)
  on conflict (test_id, student_id) do nothing;
  if not found then return json_build_object('ok', false, 'error', 'already'); end if;
  return json_build_object('ok', true, 'submitted_at', now());
end $$;

-- 누적 코멘트(시험과 상관없는 선생님 한마디). 교사가 적으면 바로 보인다.
create or replace function public.student_overall_feedback(p_token uuid)
returns json language plpgsql stable security definer
set search_path = public
as $$
declare s public.students; f public.feedback;
begin
  s := public._session_student_ready(p_token);
  select * into f from public.feedback where student_id = s.id and test_id is null;
  if not found then return null; end if;
  return json_build_object('body', f.body, 'updated_at', f.updated_at);
end $$;

-- ───── 교사용 함수 ─────
-- 선생님 한마디 저장. p_test null = 누적 코멘트. 빈 글이면 지운다. 500자까지.
create or replace function public.teacher_save_feedback(p_student uuid, p_test uuid, p_body text)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare b text := btrim(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E' \t\n'); at timestamptz;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  if not exists (select 1 from public.students where id = p_student)
     or (p_test is not null and not exists (select 1 from public.tests where id = p_test)) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  if b = '' then
    delete from public.feedback where student_id = p_student and test_id is not distinct from p_test;
    return json_build_object('ok', true, 'deleted', true);
  end if;
  if length(b) > 500 then return json_build_object('ok', false, 'error', 'too_long'); end if;
  insert into public.feedback(test_id, student_id, body, updated_at) values (p_test, p_student, b, now())
  on conflict (test_id, student_id) do update set body = excluded.body, updated_at = now()
  returning updated_at into at;
  return json_build_object('ok', true, 'body', b, 'updated_at', at);
end $$;

-- 새 함수 실행 권한(위의 전체 revoke 뒤에 만든 함수는 기본으로 모두에게 열려 있으므로 먼저 거둔다)
revoke execute on function public._ox(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public._test_class_key_guard() from public, anon, authenticated;
revoke execute on function public.student_retry_submit(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.student_overall_feedback(uuid) from public, anon, authenticated;
revoke execute on function public.teacher_save_feedback(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.student_home(uuid) to anon, authenticated;
grant execute on function public.student_submit(uuid, uuid, text) to anon, authenticated;
grant execute on function public.student_results(uuid, uuid) to anon, authenticated;
grant execute on function public.student_retry_submit(uuid, uuid, text) to anon, authenticated;
grant execute on function public.student_overall_feedback(uuid) to anon, authenticated;
grant execute on function public.teacher_save_feedback(uuid, uuid, text) to authenticated;
-- _ox, _test_class_key_guard는 아무에게도 주지 않는다(안에서만 쓰임).

-- ═══ 추가 기능: 실시간 현황 · 내보내기 · 익명화 ═══
-- 실시간 현황과 내보내기는 교사가 이미 읽을 수 있는 표(RLS teacher_all)만 쓰므로 새 함수가 필요 없다.
-- 내보내기(전체 백업)는 students 표에서 code_hash·fail_count·locked_until을 고르지 않고, student_sessions는 교사도 읽을 수 없다.
--
-- 익명화: 수업이 끝나 숨긴 반의 개인정보를 지운다. 답안(submissions)은 남겨 누적 통계는 그대로 볼 수 있다.
--  * 이름 → '학생01', '학생02'… (반 안에서 원래 학번 순서. 100명 이상이면 세 자리)
--  * 학번 → 9로 시작하는 새 5자리 번호(90001부터, 이미 쓰인 9xxxx 다음). 학번도 바꾸는 까닭:
--    학번은 명부와 맞춰 보면 바로 누구인지 알 수 있고, 내년 새 학생이 같은 학번을 받으면(학번은 해마다 다시 쓰인다)
--    명단 붙여넣기가 옛 기록을 새 학생에게 붙여 버린다. 고등학교 학번은 9로 시작하지 않으므로 섞이지 않는다.
--  * 비밀번호(code_hash)를 지우고 로그인 세션을 모두 지운다 → 아무도 그 학생으로 로그인할 수 없다.
--  * 한 함수 안에서 모두 하거나(성공) 아무것도 하지 않는다(실패). 반 이름을 정확히 적어야 실행된다.
--  * 이미 익명화된 학생(학번 9xxxx · 이름 학생NN)은 건너뛴다. 여러 번 불러도 안전하다.
--  js/tools-logic.js의 anonPlan이 같은 규칙으로 미리 보기를 만든다.
alter table public.classes add column if not exists anonymized_at timestamptz;

create or replace function public.teacher_anonymize_class(p_class uuid, p_confirm text)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare c public.classes; total int; done int; base int; n int; w int;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  select * into c from public.classes where id = p_class for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if not c.hidden then return json_build_object('ok', false, 'error', 'not_hidden'); end if;
  if coalesce(trim(p_confirm), '') <> c.name then return json_build_object('ok', false, 'error', 'confirm_mismatch'); end if;
  -- 같은 때에 두 번 눌려도 번호가 겹치지 않게 학생 표를 잠근다(교사 한 명이 쓰는 작은 표라 잠깐이면 된다).
  lock table public.students in share row exclusive mode;
  select count(*) into total from public.students where class_id = p_class;
  select count(*) into done from public.students where class_id = p_class and sid ~ '^9[0-9]{4}$' and name ~ '^학생[0-9]+$';
  select greatest(90000, coalesce(max(sid::int), 0)) into base from public.students where sid ~ '^9[0-9]{4}$';
  select count(*) into n from public.students where class_id = p_class and not (sid ~ '^9[0-9]{4}$' and name ~ '^학생[0-9]+$');
  if base + n > 99999 then return json_build_object('ok', false, 'error', 'sid_full'); end if;
  w := greatest(2, length(total::text));
  with todo as (
    select id, row_number() over (order by sid) as k from public.students
     where class_id = p_class and not (sid ~ '^9[0-9]{4}$' and name ~ '^학생[0-9]+$'))
  update public.students s
     set sid = (base + t.k)::text,
         name = '학생' || lpad((done + t.k)::text, w, '0'),
         code_hash = null, must_change_pw = true, fail_count = 0, locked_until = null
    from todo t where s.id = t.id;
  -- 이 반 학생의 로그인은 모두 끊는다(이미 익명화된 학생 것도).
  delete from public.student_sessions ss using public.students st where st.id = ss.student_id and st.class_id = p_class;
  -- 선생님 한마디에는 학생 이름이 들어갈 수 있으므로 함께 지운다(정리 전에 내보내기로 받아 둔다).
  delete from public.feedback f using public.students st where f.student_id = st.id and st.class_id = p_class;
  update public.classes set anonymized_at = now() where id = p_class;
  return json_build_object('ok', true, 'changed', n, 'students', total,
    'first_sid', case when n > 0 then (base + 1)::text end, 'last_sid', case when n > 0 then (base + n)::text end);
end $$;

-- 비밀번호가 지워진(익명화된) 학생은 초기화로 다시 살리지 않는다(학번 9xxxx 학생으로 로그인되는 일을 막음).
-- teacher_reset_password는 위에 그대로 두고, 익명화된 학생의 비밀번호를 다시 만들지 못하게 막는 장치만 더한다.
create or replace function public._students_no_anon_pw()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if old.code_hash is null and new.code_hash is not null
     and new.sid ~ '^9[0-9]{4}$' and new.name ~ '^학생[0-9]+$' then
    raise exception 'anonymized_student' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists students_no_anon_pw on public.students;
create trigger students_no_anon_pw before update of code_hash on public.students
  for each row execute function public._students_no_anon_pw();

revoke execute on function public.teacher_anonymize_class(uuid, text) from public, anon, authenticated;
revoke execute on function public._students_no_anon_pw() from public, anon, authenticated;
grant execute on function public.teacher_anonymize_class(uuid, text) to authenticated;

-- ═══ 2026-11 상태 정리: 결과 공개 = 응시 닫기 · 잠금만 풀기 · 작은 반 통계 가리기 ═══
-- (위쪽에서 바꾼 것: teacher_set_class_hidden은 숨겨도 로그인 세션을 지우지 않음, student_results는 작은 반 통계를 null로)
-- 이 블록만 따로 실행하려면 supabase/migrations/2026-11-ux-state.sql을 쓴다(같은 내용).

-- ───── 결과를 공개하면 응시도 닫는다 ─────
-- 학생은 결과 공개 뒤 더 낼 수 없으므로(student_submit: is_open and not released) 표의 is_open도 false로 맞춘다.
-- 교사 화면이 공개할 때 함께 저장하지만, 예전 화면이나 다른 경로로 공개해도 어긋나지 않게 표에서 한 번 더 지킨다.
create or replace function public._test_class_release_close()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.released and new.is_open then
    new.is_open := false;
    new.closed_once := true;
  end if;
  return new;
end $$;
drop trigger if exists test_class_release_close on public.test_class;
create trigger test_class_release_close before insert or update on public.test_class
  for each row execute function public._test_class_release_close();
-- 이미 응시를 닫지 않고 공개한 반을 바로잡는다(맞는 줄이 없으면 아무것도 하지 않음).
update public.test_class set is_open = false, closed_once = true where released and is_open;

-- ───── 잠금만 풀기 ─────
-- 학번만 알면 다른 학생이 일부러 5번 틀려 잠글 수 있다. 교사가 비밀번호는 그대로 두고 잠금(틀린 횟수)만 푼다.
create or replace function public.teacher_unlock_student(p_student uuid)
returns json language plpgsql volatile security definer
set search_path = public
as $$
declare s public.students;
begin
  if not public.is_teacher() then raise exception 'not_teacher' using errcode = '42501'; end if;
  update public.students set fail_count = 0, locked_until = null where id = p_student returning * into s;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true, 'sid', s.sid, 'name', s.name);
end $$;

-- ───── 실행 권한 ─────
revoke execute on function public._test_class_release_close() from public, anon, authenticated;
revoke execute on function public._class_stats_min_n() from public, anon, authenticated;
revoke execute on function public.teacher_unlock_student(uuid) from public, anon, authenticated;
grant execute on function public.teacher_unlock_student(uuid) to authenticated;
grant execute on function public.teacher_set_class_hidden(uuid, boolean) to authenticated;
grant execute on function public.student_results(uuid, uuid) to anon, authenticated;
-- _test_class_release_close, _class_stats_min_n은 아무에게도 주지 않는다(안에서만 쓰임).

-- ═══ 2026-11 보안: 학생 로그인 기기 번호 받는 자리 · 교사 화면도 비밀번호 해시를 읽지 못하게 ═══
-- 이 블록만 따로 실행하려면 supabase/migrations/2026-11-login-dev.sql, 2026-11-hash-privilege.sql을 쓴다(같은 내용).

-- ───── 로그인 기기 번호 받는 자리(student_login_dev) ─────
-- 학생 화면은 로그인할 때 이 함수를 먼저 부르고, 기기(브라우저)마다 만든 무작위 번호(p_device)를 함께 보낸다.
-- 기본 규칙에서는 기기 번호를 쓰지도 저장하지도 않고 student_login(5번 틀리면 10분 잠금)을 그대로 부른다.
-- 잠금 방식 선택안 D(supabase/migrations/optional-lockout-d-device.sql)를 실행하면 이 함수가 '로그인했던 기기 기억'으로 바뀌고,
-- 이 파일을 다시 실행하면 아래 기본(그대로 넘기기)으로 돌아간다.
-- (이 함수가 없는 서버에서는 학생 화면이 예전 student_login을 부른다.)
create or replace function public.student_login_dev(p_sid text, p_password text, p_device text default null)
returns json language sql volatile
set search_path = public
as $$ select public.student_login(p_sid, p_password) $$;
revoke execute on function public.student_login_dev(text, text, text) from public, anon, authenticated;
grant execute on function public.student_login_dev(text, text, text) to anon, authenticated;

-- ───── 학생 표(students) 칸 권한: 비밀번호 해시(code_hash)는 교사 로그인으로도 읽을 수 없다 ─────
-- RLS는 '어떤 줄'을 볼지 정할 뿐 '어떤 칸'은 막지 못한다. 그래서 교사 화면이 select('*')로 읽으면 학생 비밀번호 해시가
-- 교사 브라우저까지 내려왔다(교사 계정이 털리면 해시를 가져가 비밀번호를 맞혀 볼 수 있음). 이제 칸마다 권한을 준다.
--  * 읽기: id, sid, name, class_id, must_change_pw, fail_count, locked_until, created_at (code_hash는 빠짐)
--  * 새로 넣기·고치기: sid, name, class_id만(명단 붙여넣기 upsert, 반 옮기기·빼기). 비밀번호·잠금은 함수(teacher_*)로만 바꾼다.
--  * 지우기: 그대로 둔다(교사만, RLS).
--  * anon(공개 키)은 어떤 칸도 못 읽고 못 쓴다(원래도 RLS로 막혀 있었다).
-- 주의: 이 뒤로는 students를 select('*')로 읽으면 'permission denied for table students' 오류가 난다.
--       교사 화면은 칸 이름을 적어서 읽어야 한다. 학생 함수(student_*)와 교사 함수(teacher_*)는 소유자 권한으로 돌아 영향이 없다.
-- 표 전체 권한을 거두면 칸 권한도 함께 거둬지므로, 여러 번 실행해도 결과가 같다.
revoke all on table public.students from anon, authenticated;
grant select (id, sid, name, class_id, must_change_pw, fail_count, locked_until, created_at) on public.students to authenticated;
grant insert (sid, name, class_id) on public.students to authenticated;
grant update (sid, name, class_id) on public.students to authenticated;
grant delete on public.students to authenticated;
