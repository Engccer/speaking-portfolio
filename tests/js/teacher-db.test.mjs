import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// 실제 PostgreSQL 엔진의 격리된 메모리 DB. 원격 서버나 실제 명단은 사용하지 않는다.
const db = new PGlite();
const teacher = [1, 40, "교사 예시"];
const student = [1, 1, "학생 예시"];
const header = (identity = teacher) => JSON.stringify({
  "x-teacher-class": String(identity[0]), "x-teacher-number": String(identity[1]),
  "x-teacher-name": encodeURIComponent(identity[2]),
});
async function rpc(name, args = teacher) {
  return (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`, args)).rows[0].value;
}
async function recordings(headers = "{}") {
  await db.query("select set_config('request.headers', $1, false)", [headers]);
  return (await db.query("select name from storage.objects where bucket_id = 'recordings' order by name")).rows.map(r => r.name);
}

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema public, storage to anon;
    grant select, insert on storage.objects to anon;
  `);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    let sql = await readFile(new URL(file, dir), "utf8");
    // gen_random_uuid는 PostgreSQL 기본 함수이므로 pgcrypto 바이너리 없이도 실행된다.
    sql = sql.replace("create extension if not exists pgcrypto;", "");
    if (file.includes("teacher_dashboard")) {
      await db.query("insert into public.students(class,number,name) values ($1,$2,$3)", teacher);
    }
    await db.exec(sql);
  }
  await db.query("insert into public.students(class,number,name) values ($1,$2,$3)", student);
  await db.exec(`
    insert into public.students values (1,2,'학생 둘',false), (2,1,'학생 셋',false), (3,1,'교사 둘',true);
    insert into public.settings values (1,false);
    insert into public.submissions(class,number,name,dialogue_ids,turn_offsets,files,durations)
      values (1,1,'학생 예시',array['L5-1','L6-1'],'[]',array['exam/a.wav','exam/b.wav'],array[12,13]);
    insert into public.practice_submissions(class,number,name,dialogue_id,turn_offsets,file,duration)
      values (1,1,'학생 예시','L5-1','[]','practice/a.wav',10);
    insert into storage.objects(bucket_id,name) values
      ('recordings','exam/a.wav'),('recordings','exam/b.wav'),
      ('recordings','practice/a.wav'),('recordings','exam/orphan.wav'),('audio','official.mp3');
    grant select on public.students, public.settings, public.submissions, public.practice_submissions to anon;
    set role anon;
  `);
});
after(async () => { await db.close(); });

test("체크인은 DB 교사 표시와 정규화된 이름을 확인한다", async () => {
  assert.equal((await rpc("check_in", [1, 40, "교사　 예시"])).is_teacher, true);
  assert.equal((await rpc("check_in", student)).is_teacher, false);
  assert.equal((await rpc("check_in", [1, 40, "틀린 이름"])).ok, false);
  assert.equal((await rpc("check_in", [1, 40, ""])).is_teacher, false);
});

test("닫힌 반은 학생 입장을 막고 교사에게는 관리 화면 진입을 허용한다", async () => {
  assert.deepEqual(await rpc("check_in", student), {
    ok: false, reason: "class_closed", class_open: false, exam_open: false,
    submitted: true, practice_completed: true, is_teacher: false,
  });
  const result = await rpc("check_in");
  assert.equal(result.ok, true);
  assert.equal(result.is_teacher, true);
  assert.equal(result.class_open, false);
  assert.equal(result.reason, null);
  assert.deepEqual(await rpc("check_in", [1, 40, "오답"]), {
    ok: false, reason: null, class_open: null, exam_open: null,
    submitted: null, practice_completed: null, is_teacher: false,
  });
});

test("설정 없는 반도 닫힘으로 처리하며 교사는 설정 없이 입장한다", async () => {
  const result = await rpc("check_in", [2, 1, "학생 셋"]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "class_closed");
  assert.equal(result.class_open, false);
  assert.equal(result.exam_open, false);
  assert.equal((await rpc("check_in", [3, 1, "교사 둘"])).ok, true);
  const missing = (await rpc("teacher_dashboard")).classes.find(c => c.class === 2);
  assert.equal(missing.class_open, false);
});

test("대시보드는 전체 학생·미제출·반별 상태를 반환하고 교사를 제외한다", async () => {
  const { classes } = await rpc("teacher_dashboard");
  assert.deepEqual(classes.map(c => c.class), [1, 2]);
  assert.equal(classes[0].exam_open, false);
  assert.equal(classes[0].class_open, false);
  assert.deepEqual(classes[0].students.map(s => s.number), [1, 2]);
  assert.deepEqual(classes[0].students[0].files, ["exam/a.wav", "exam/b.wav"]);
  assert.deepEqual(classes[0].students[0].durations, [12, 13]);
  assert.ok(classes[0].students[0].submitted_at);
  assert.ok(classes[0].students[0].submission_id);
  assert.equal(classes[0].students[1].submitted_at, null);
  assert.equal(classes[0].students[1].submission_id, null);
  assert.deepEqual(classes[0].students[1].files, []);
  assert.equal(classes[0].students[0].practice_submissions.length, 1);
  assert.equal(classes[0].students[0].practice_submissions[0].file, "practice/a.wav");
  assert.deepEqual(classes[0].students[1].practice_submissions, []);
});

test("모의 평가 완료 여부와 녹음 목록은 학생별로 분리하고 여러 시도를 최신순으로 반환한다", async () => {
  assert.equal((await rpc("check_in", student)).practice_completed, true);
  assert.equal((await rpc("check_in", [1, 2, "학생 둘"])).practice_completed, false);
  assert.equal((await rpc("check_in", [2, 1, "학생 셋"])).practice_completed, false);
  try {
    await db.exec(`
      reset role;
      insert into public.practice_submissions(class,number,name,dialogue_id,turn_offsets,file,duration,submitted_at)
      values
        (1,2,'학생 둘','L5-1','[]','practice/older.wav',10,'2026-10-01T01:00:00Z'),
        (1,2,'학생 둘','L6-1','[]','practice/newer.wav',11,'2026-10-02T01:00:00Z');
      insert into storage.objects(bucket_id,name) values
        ('recordings','practice/older.wav'), ('recordings','practice/newer.wav'),
        ('recordings','practice/unsubmitted.wav');
      set role anon;
    `);
    const { classes } = await rpc("teacher_dashboard");
    const practices = classes[0].students[1].practice_submissions;
    assert.deepEqual(practices.map(p => p.file), ["practice/newer.wav", "practice/older.wav"]);
    assert.deepEqual(practices.map(p => p.dialogue_id), ["L6-1", "L5-1"]);
    assert.ok(practices.every(p => p.id && p.submitted_at));
    assert.equal(classes[0].students.length, 2);
    assert.equal(classes[0].students[0].practice_submissions.length, 1);
    assert.deepEqual(classes[1].students[0].practice_submissions, []);
    assert.equal((await rpc("check_in", [1, 2, "학생 둘"])).practice_completed, true);
    assert.equal((await rpc("check_in", [1, 2, "학생 둘"])).submitted, false);
    assert.deepEqual((await recordings(header())).filter(p => p.startsWith("practice/")),
      ["practice/a.wav", "practice/newer.wav", "practice/older.wav"]);
    assert.deepEqual(await recordings(header([1, 2, "학생 둘"])), []);
  } finally {
    await db.exec(`
      reset role;
      delete from public.practice_submissions where class = 1 and number = 2;
      delete from storage.objects where name in ('practice/older.wav','practice/newer.wav','practice/unsubmitted.wav');
      set role anon;
    `);
  }
});

test("학생·잘못된 교사 정보로 조회 및 설정 변경이 차단된다", async () => {
  for (const identity of [student, [1,40,"오답"], [null,null,null]]) {
    await assert.rejects(rpc("teacher_dashboard", identity), { code: "42501" });
    await assert.rejects(rpc("teacher_set_exam_open", [...identity,1,true]), { code: "42501" });
    await assert.rejects(rpc("teacher_set_class_open", [...identity,1,true]), { code: "42501" });
  }
  await assert.rejects(db.query("update public.settings set exam_open = true where class = 1"), { code: "42501" });
  await assert.rejects(db.query("insert into public.settings values (2,true)"), { code: "42501" });
  assert.equal((await rpc("check_in", student)).exam_open, false);
});

test("교사는 닫힌 반에서 새 RPC로 입장을 열고 다시 닫을 수 있다", async () => {
  try {
    assert.deepEqual(await rpc("teacher_set_class_open", [...teacher,1,true]), {
      class: 1, class_open: true, exam_open: true,
    });
    const result = await rpc("check_in", student);
    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.class_open, true);
    assert.equal(result.exam_open, true);
    const dashboard = (await rpc("teacher_dashboard")).classes[0];
    assert.equal(dashboard.class_open, true);
    assert.equal(dashboard.exam_open, true);
    for (const args of [[999,true], [3,true], [1,null]]) {
      await assert.rejects(rpc("teacher_set_class_open", [...teacher,...args]), { code: "22023" });
    }
  } finally {
    await rpc("teacher_set_class_open", [...teacher,1,false]);
  }
  assert.equal((await rpc("check_in", student)).reason, "class_closed");
  assert.equal((await rpc("check_in")).ok, true);
});

test("연습과 실전 제출은 설정 없음·마감 시 차단되고 개방 후에만 허용된다", async () => {
  const exam = () => db.query(`insert into public.submissions(class,number,name,dialogue_ids,turn_offsets,files,durations)
    values (2,1,'학생 셋',array['L5-1','L6-1'],'[]',array['exam/test-a.wav','exam/test-b.wav'],array[1,1])`);
  const practice = (name = "학생 셋") => db.query(`insert into public.practice_submissions(class,number,name,dialogue_id,turn_offsets,file,duration)
    values (2,1,$1,'L5-1','[]','practice/test.wav',1)`, [name]);
  try {
    await assert.rejects(exam(), { code: "42501" });
    await assert.rejects(practice(), { code: "42501" });
    await rpc("teacher_set_class_open", [...teacher,2,true]);
    await assert.rejects(practice("틀린 이름"), { code: "42501" });
    assert.equal((await rpc("check_in", [2, 1, "학생 셋"])).practice_completed, false);
    await exam();
    assert.equal((await rpc("check_in", [2, 1, "학생 셋"])).submitted, true);
    await practice();
    await practice();
    assert.equal((await rpc("check_in", [2, 1, "학생 셋"])).practice_completed, true);
    await rpc("teacher_set_class_open", [...teacher,2,false]);
    await assert.rejects(exam(), { code: "42501" });
    await assert.rejects(practice(), { code: "42501" });
  } finally {
    await db.exec("reset role; delete from public.submissions where class = 2; delete from public.practice_submissions where class = 2; delete from public.settings where class = 2; set role anon;");
  }
});

test("녹음 업로드는 연습·실전의 실제 반 경로와 현재 개방 상태를 검사한다", async () => {
  const paths = [
    "exam/3-02/3-02-01/550e8400-e29b-41d4-a716-446655440000/1_L5-1.wav",
    "practice/3-02/3-02-01/20261009T123456Z_L5-1.wav",
  ];
  const upload = (path, bucket = "recordings") => db.query(
    "insert into storage.objects(bucket_id,name) values ($1,$2)", [bucket,path]);
  try {
    for (const path of paths) await assert.rejects(upload(path), { code: "42501" });
    await rpc("teacher_set_class_open", [...teacher,2,true]);
    for (const path of paths) await upload(path);
    for (const path of [
      "exam/3-01/3-01-01/attempt/1_L5-1.wav",
      "practice/3-01/3-01-01/20261009_L5-1.wav",
      "exam/3-02/3-01-01/attempt/1_L5-1.wav",
      "practice/3-99/3-99-01/20261009_L5-1.wav",
      "exam/a.wav", "practice/x/file.wav", "practice/3-x/3-x-01/file.wav",
      "practice/3-2147483648/3-2147483648-01/file.wav",
      "practice/3-02/3-02-01/../../3-01/file.wav",
    ]) await assert.rejects(upload(path), { code: "42501" });
    await assert.rejects(upload(paths[0], "audio"), { code: "42501" });
    await rpc("teacher_set_class_open", [...teacher,2,false]);
    for (const path of paths) await assert.rejects(upload(path), { code: "42501" });
  } finally {
    await db.exec("reset role; delete from storage.objects where name like '%/3-02/%'; delete from public.settings where class = 2; set role anon;");
  }
});

test("교사 설정은 실제 학생이 있는 반만 생성·변경한다", async () => {
  assert.deepEqual(await rpc("teacher_set_exam_open", [...teacher,2,true]), { class: 2, exam_open: true });
  assert.equal((await rpc("teacher_dashboard")).classes[1].exam_open, true);
  assert.deepEqual(await rpc("teacher_set_exam_open", [...teacher,2,false]), { class: 2, exam_open: false });
  for (const args of [[999,true], [3,true], [1,null]]) {
    await assert.rejects(rpc("teacher_set_exam_open", [...teacher,...args]), { code: "22023" });
  }
});

test("테이블 직접 조회는 교사 헤더가 있어도 차단된다", async () => {
  await recordings(header());
  for (const name of ["students", "settings", "submissions", "practice_submissions"]) {
    assert.deepEqual((await db.query(`select * from public.${name}`)).rows, []);
  }
});

test("Storage RLS는 유효한 교사에게 제출된 경로만 공개한다", async () => {
  assert.deepEqual(await recordings(), []);
  assert.deepEqual(await recordings(header(student)), []);
  assert.deepEqual(await recordings(header([1,40,"오답"])), []);
  assert.deepEqual(await recordings(header()), ["exam/a.wav", "exam/b.wav", "practice/a.wav"]);
  assert.deepEqual(await recordings(header([1,40,"교사　예시"])), ["exam/a.wav", "exam/b.wav", "practice/a.wav"]);
  assert.deepEqual((await db.query("select name from storage.objects where bucket_id = 'audio'")).rows, [{ name: "official.mp3" }]);
});

test("깨진 헤더는 권한을 부여하지 않는다", async () => {
  for (const headers of ["", "{}", "invalid", "null", header(["x",40,"교사 예시"]), header([1,2147483648,"교사 예시"]),
    JSON.stringify({"x-teacher-class":"1","x-teacher-number":"40","x-teacher-name":"%FF"}),
    JSON.stringify({"x-teacher-class":"1","x-teacher-number":"40","x-teacher-name":"%XY"})]) {
    assert.deepEqual(await recordings(headers), []);
  }
});

test("되돌리기는 교사만 가능하고 보관 테이블 직접 접근은 차단된다", async () => {
  const id = (await rpc("teacher_dashboard")).classes[0].students[0].submission_id;
  for (const identity of [student, [1,40,"오답"], [null,null,null]]) {
    await assert.rejects(rpc("teacher_return_submission", [...identity,id]), { code: "42501" });
  }
  await assert.rejects(rpc("teacher_return_submission", [...teacher,null]), { code: "22023" });
  await assert.rejects(db.query("select * from public.returned_submissions"), { code: "42501" });
  await assert.rejects(db.query("delete from public.submissions"), { code: "42501" });
  assert.equal((await rpc("check_in", student)).submitted, true);
});

test("보관 실패 시 되돌리기 전체가 취소되어 원본이 남는다", async () => {
  const id = (await rpc("teacher_dashboard")).classes[0].students[0].submission_id;
  await db.exec("reset role; alter table public.returned_submissions add constraint reject_archive check (false); set role anon;");
  try {
    await assert.rejects(rpc("teacher_return_submission", [...teacher,id]), { code: "23514" });
    assert.equal((await rpc("check_in", student)).submitted, true);
  } finally {
    await db.exec("reset role; alter table public.returned_submissions drop constraint reject_archive; set role anon;");
  }
});

test("되돌리기는 원본을 보관하고 마감을 유지하며 오래된 요청이 새 제출을 건드리지 않는다", async () => {
  const id = (await rpc("teacher_dashboard")).classes[0].students[0].submission_id;
  await db.exec("reset role");
  const original = (await db.query("select to_jsonb(s) as value from public.submissions s where id = $1", [id])).rows[0].value;
  await db.exec("set role anon");
  assert.deepEqual(await rpc("teacher_return_submission", [...teacher,id]), {
    returned: true, submission_id: id, class: 1, number: 1, exam_open: false,
  });
  assert.equal((await rpc("check_in", student)).submitted, false);
  assert.equal((await rpc("check_in", student)).exam_open, false);
  const dashboardStudent = (await rpc("teacher_dashboard")).classes[0].students[0];
  assert.equal(dashboardStudent.submission_id, null);
  assert.equal(dashboardStudent.submitted_at, null);
  assert.deepEqual(dashboardStudent.files, []);
  assert.deepEqual(await recordings(header()), ["exam/a.wav", "exam/b.wav", "practice/a.wav"]);
  assert.deepEqual(await recordings(header(student)), []);
  await db.exec("reset role");
  const archived = (await db.query("select to_jsonb(s) as value from public.returned_submissions s where id = $1", [id])).rows[0].value;
  const { returned_at, returned_by_class, returned_by_number, ...snapshot } = archived;
  assert.ok(returned_at);
  assert.equal(returned_by_class, teacher[0]);
  assert.equal(returned_by_number, teacher[1]);
  assert.deepEqual(snapshot, original);
  await db.exec("set role anon");
  assert.deepEqual(await rpc("teacher_return_submission", [...teacher,id]), { returned: false, submission_id: id });
  const resubmit = () => db.query(`insert into public.submissions(class,number,name,dialogue_ids,turn_offsets,files,durations)
    values (1,1,'학생 예시',array['L5-1','L6-1'],'[]',array['exam/new-a.wav','exam/new-b.wav'],array[14,15])`);
  await assert.rejects(resubmit(), { code: "42501" });
  await rpc("teacher_set_exam_open", [...teacher,1,true]);
  await resubmit();
  const newId = (await rpc("teacher_dashboard")).classes[0].students[0].submission_id;
  assert.notEqual(newId, id);
  assert.deepEqual(await rpc("teacher_return_submission", [...teacher,id]), { returned: false, submission_id: id });
  assert.equal((await rpc("teacher_dashboard")).classes[0].students[0].submission_id, newId);
  await assert.rejects(resubmit(), { code: "23505" });
  assert.equal((await rpc("check_in", student)).submitted, true);
});

test("교사 표시 해제는 다음 RPC·Storage 요청부터 적용된다", async () => {
  await db.exec("reset role; update public.students set is_teacher = false where class = 1 and number = 40; set role anon;");
  assert.equal((await rpc("check_in")).is_teacher, false);
  await assert.rejects(rpc("teacher_dashboard"), { code: "42501" });
  await assert.rejects(rpc("teacher_set_exam_open", [...teacher,1,true]), { code: "42501" });
  await assert.rejects(rpc("teacher_set_class_open", [...teacher,1,true]), { code: "42501" });
  await assert.rejects(rpc("teacher_return_submission", [...teacher,"00000000-0000-0000-0000-000000000001"]), { code: "42501" });
  assert.deepEqual(await recordings(header()), []);
});
