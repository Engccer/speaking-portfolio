import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { mergeTracks, encodeWav } from "../../lib/wav.js";

const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const source = (await readFile(new URL("../../app.js", import.meta.url), "utf8"))
  .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function app(t, overrides = {}) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.test/" });
  t.after(() => dom.window.close());
  const w = dom.window;
  const audios = [], uploads = [], inserts = [], revoked = [];
  let urlId = 0;
  w.URL.createObjectURL = () => `blob:test-${++urlId}`;
  w.URL.revokeObjectURL = (url) => revoked.push(url);
  w.Audio = class {
    constructor(src) { this.src = src; this.paused = true; audios.push(this); }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
  };
  w.OfflineAudioContext = class {
    async decodeAudioData() { return { length: 160, numberOfChannels: 1, getChannelData: () => new Float32Array(160) }; }
  };
  Object.assign(w, {
    mergeTracks, encodeWav,
    checkIn: async () => ({ ok: true, exam_open: true, submitted: false, is_teacher: false }),
    getTeacherDashboard: async () => ({ classes: [{ class: 1, exam_open: false, students: [
      { number: 1, name: "학생 가", submitted_at: "2026-10-09T00:00:00Z", dialogue_ids: ["A", "B"], files: ["a.wav", "b.wav"], durations: [1, 1] },
      { number: 2, name: "학생 나", submitted_at: null, dialogue_ids: [], files: [], durations: [] },
    ] }] }),
    setExamOpen: async (_, cls, open) => ({ class: cls, exam_open: open }),
    getRecordingUrl: async (_, path) => `https://example.test/${path}`,
    getClient: () => ({ storage: { from: () => ({ upload: async (path, blob) => { uploads.push({ path, blob }); return {}; } }) },
      from: (table) => ({ insert: async (row) => { inserts.push({ table, row }); return {}; } }) }),
    drawExam: async () => [0, 1], drawPractice: () => 0,
    downloadAudio: async () => new Blob(),
    ...overrides,
  });
  w.eval(`${source}\nwindow.testing = {state, showSubmitScreen, showRecordScreen, finish, submit};`);
  const $ = (id) => w.document.getElementById(id);
  async function enter() {
    const form = $("entry-form");
    form.elements.cls.value = "1"; form.elements.num.value = "40"; form.elements.name.value = "교사 예시";
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await settle();
  }
  function recordings(mode = "exam") {
    const dialogues = [0, 1].slice(0, mode === "exam" ? 2 : 1).map((n) => ({
      id: `L5-${n + 1}`, title: `대화 ${n + 1}`, source: "교과서", units: [{ n: 1, speaker: "A", text: "Hello." }],
    }));
    const recs = Object.fromEntries(dialogues.map((_, i) => [i, { 0: { duration: 1, arrayBuffer: async () => new ArrayBuffer(1) } }]));
    Object.assign(w.testing.state, { cls: 1, num: 2, name: "학생 예시", mode, dialogues, recordings: recs });
    w.testing.showSubmitScreen();
  }
  return { w, $, enter, recordings, audios, uploads, inserts, revoked };
}

test("entry uses a labelled select and routes a teacher to class progress", async (t) => {
  const a = app(t, { checkIn: async () => ({ ok: true, is_teacher: true }) });
  assert.equal(a.$("entry-form").elements.cls.tagName, "SELECT");
  assert.equal(a.w.document.querySelectorAll('input[type="password"]').length, 0);
  await a.enter();
  assert.equal(a.$("screen-teacher").hidden, false);
  assert.match(a.$("teacher-classes").textContent, /전체 2명, 제출 1명, 미제출 1명/);
  assert.equal(a.w.document.querySelectorAll("tbody tr").length, 2);
  const toggle = [...a.w.document.querySelectorAll("button")].find((b) => b.textContent === "1반 본 평가 개방하기");
  toggle.focus(); toggle.click(); await settle();
  assert.equal(toggle.textContent, "1반 본 평가 마감하기");
  assert.equal(a.w.document.activeElement, toggle);
});

test("teacher refresh failure clears stale data and reports failure", async (t) => {
  const a = app(t, { checkIn: async () => ({ ok: true, is_teacher: true }) });
  await a.enter();
  a.w.getTeacherDashboard = async () => { throw new Error("offline"); };
  a.w.console.error = () => {};
  a.$("btn-teacher-refresh").click(); await settle();
  assert.equal(a.$("teacher-classes").children.length, 0);
  assert.match(a.$("teacher-status").textContent, /불러오지 못했습니다/);
});

test("teacher playback request cannot start after leaving the dashboard", async (t) => {
  const pending = deferred();
  const a = app(t, { checkIn: async () => ({ ok: true, is_teacher: true }), getRecordingUrl: () => pending.promise });
  await a.enter();
  a.w.document.querySelector("tbody button").click();
  a.$("btn-teacher-exit").click();
  pending.resolve("https://example.test/file.wav"); await settle();
  assert.equal(a.audios.length, 0);
  assert.equal(a.$("teacher-classes").children.length, 0);
});

test("ordinary students still enter the assessment selection", async (t) => {
  const a = app(t); await a.enter();
  assert.equal(a.$("screen-mode").hidden, false);
  assert.equal(a.$("screen-teacher").hidden, true);
});

test("preview plays both merged WAVs in order and submits the same blobs", async (t) => {
  const a = app(t); a.recordings();
  a.$("btn-preview").click(); await settle();
  assert.equal(a.audios.length, 1);
  const built = a.w.testing.state.built;
  a.audios[0].onended(); await settle();
  assert.equal(a.audios.length, 2);
  a.audios[1].onended();
  assert.equal(a.$("btn-preview").textContent, "내 녹음 전체 재생하기");
  await a.w.testing.submit();
  assert.equal(a.uploads.length, 2);
  assert.equal(a.uploads[0].blob, built.wavs[0].blob);
  assert.equal(a.inserts.length, 1);
  assert.equal(a.$("btn-restart").hidden, true);
});

test("stopping preview during merge prevents delayed playback", async (t) => {
  const pending = deferred();
  const a = app(t); a.recordings("practice");
  a.w.testing.state.recordings[0][0].arrayBuffer = () => pending.promise;
  a.$("btn-preview").click(); a.$("btn-preview").click();
  pending.resolve(new ArrayBuffer(1)); await settle();
  assert.equal(a.audios.length, 0);
});

test("practice completion returns to entry and clears submission state", async (t) => {
  const a = app(t); await a.enter(); a.recordings("practice");
  let stopped = false;
  a.w.testing.state.stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };
  await a.w.testing.submit();
  assert.equal(stopped, true);
  assert.equal(a.$("btn-restart").hidden, false);
  a.$("btn-restart").click();
  assert.equal(a.$("screen-entry").hidden, false);
  assert.equal(a.w.testing.state.submitted, false);
  assert.equal(Object.keys(a.w.testing.state.recordings).length, 0);
  assert.equal(a.w.testing.state.built, null);
  assert.equal(a.w.testing.state.name, "");
  assert.equal(a.w.testing.state.cls, 0);
  assert.equal(a.$("entry-form").elements.name.value, "");
  assert.equal(a.$("entry-form").elements.cls.value, "");
});

test("editing while a preview is being built cannot reuse a stale WAV", async (t) => {
  const pending = deferred();
  const a = app(t); a.recordings("practice");
  a.w.console.error = () => {};
  a.w.testing.state.recordings[0][0].arrayBuffer = () => pending.promise;
  a.$("btn-preview").click();
  a.$("btn-back-record").click();
  pending.resolve(new ArrayBuffer(1)); await settle();
  assert.equal(a.w.testing.state.built, null);
  assert.equal(a.audios.length, 0);
});
