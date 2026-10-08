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

test("대시보드는 전체 학생·미제출·반별 상태를 반환하고 교사를 제외한다", async () => {
  const { classes } = await rpc("teacher_dashboard");
  assert.deepEqual(classes.map(c => c.class), [1, 2]);
  assert.equal(classes[0].exam_open, false);
  assert.deepEqual(classes[0].students.map(s => s.number), [1, 2]);
  assert.deepEqual(classes[0].students[0].files, ["exam/a.wav", "exam/b.wav"]);
  assert.deepEqual(classes[0].students[0].durations, [12, 13]);
  assert.ok(classes[0].students[0].submitted_at);
  assert.equal(classes[0].students[1].submitted_at, null);
  assert.deepEqual(classes[0].students[1].files, []);
});

test("학생·잘못된 교사 정보로 조회 및 설정 변경이 차단된다", async () => {
  for (const identity of [student, [1,40,"오답"], [null,null,null]]) {
    await assert.rejects(rpc("teacher_dashboard", identity), { code: "42501" });
    await assert.rejects(rpc("teacher_set_exam_open", [...identity,1,true]), { code: "42501" });
  }
  assert.equal((await rpc("check_in", student)).exam_open, false);
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

test("교사 표시 해제는 다음 RPC·Storage 요청부터 적용된다", async () => {
  await db.exec("reset role; update public.students set is_teacher = false where class = 1 and number = 40; set role anon;");
  assert.equal((await rpc("check_in")).is_teacher, false);
  await assert.rejects(rpc("teacher_dashboard"), { code: "42501" });
  await assert.rejects(rpc("teacher_set_exam_open", [...teacher,1,true]), { code: "42501" });
  assert.deepEqual(await recordings(header()), []);
});
