import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { mergeTracks, encodeWav } from "../../lib/wav.js";
import { initNumberCombobox } from "../../lib/number-combobox.js";
import { startCapture } from "../../lib/recording.js";

const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const dialogues = JSON.parse(await readFile(new URL("../../data/dialogues.json", import.meta.url), "utf8"));
const source = (await readFile(new URL("../../app.js", import.meta.url), "utf8"))
  .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function app(t, overrides = {}) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" });
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
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.play = async function () {};
  Object.assign(w, {
    mergeTracks, encodeWav, initNumberCombobox,
    startCapture: (stream, handlers) => startCapture(stream, handlers, w.MediaRecorder),
    startMicMeter: () => () => {},
    fetch: async () => ({ json: async () => dialogues }),
    checkIn: async () => ({ ok: true, class_open: true, submitted: false, is_teacher: false }),
    getTeacherDashboard: async () => ({ classes: [{ class: 1, class_open: false, students: [
      { number: 1, name: "학생 가", submission_id: "old-submission", submitted_at: "2026-10-09T00:00:00Z", dialogue_ids: ["A", "B"], files: ["a.wav", "b.wav"], durations: [1, 1] },
      { number: 2, name: "학생 나", submitted_at: null, dialogue_ids: [], files: [], durations: [] },
    ] }] }),
    setClassOpen: async (_, cls, open) => ({ class: cls, class_open: open }),
    getRecordingUrl: async (_, path) => `https://example.test/${path}`,
    returnSubmission: async (_, id) => ({ returned: true, submission_id: id }),
    getClient: () => ({ storage: { from: () => ({ upload: async (path, blob) => { uploads.push({ path, blob }); return {}; } }) },
      from: (table) => ({ insert: async (row) => { inserts.push({ table, row }); return {}; } }) }),
    drawExam: async () => [0, 1], drawPractice: () => 0,
    downloadAudio: async () => new Blob(),
    ...overrides,
  });
  w.eval(`${source}\nwindow.testing = {state, showSubmitScreen, showRecordScreen, finish, submit};`);
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
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

function microphone(a) {
  const sessions = [], tracks = [];
  Object.defineProperty(a.w.navigator, "mediaDevices", { value: { getUserMedia: async () => {
    const track = { readyState: "live", stop() { this.readyState = "ended"; } };
    tracks.push(track);
    return { getAudioTracks: () => [track], getTracks: () => [track] };
  } } });
  a.w.MediaRecorder = class {
    static isTypeSupported(type) { return type === "audio/mp4"; }
    constructor(_, options) { this.mimeType = options.mimeType; this.state = "inactive"; this.stopCount = 0; sessions.push(this); }
    start() { this.state = "recording"; }
    stop() {
      this.stopCount++; this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  };
  return { sessions, tracks };
}

test("mobile stop saves without metadata events, keeps the same focused control and releases the mic", async (t) => {
  const a = app(t), { sessions, tracks } = microphone(a);
  a.recordings("practice");
  a.w.testing.state.recordings[0] = {};
  a.w.testing.showRecordScreen();
  const button = a.$("unit-list").querySelector('[data-action="rec"]');
  button.focus(); button.click(); await settle();
  assert.equal(button.textContent, "녹음 정지하기");
  button.click(); button.click();
  assert.equal(button.textContent, "녹음 저장 중");
  assert.equal(sessions[0].stopCount, 1);
  await settle();
  const blob = a.w.testing.state.recordings[0][0];
  assert.equal(blob.type, "audio/mp4");
  assert.ok(Number.isFinite(blob.duration) && blob.duration > 0);
  assert.equal(a.$("unit-list").querySelector('[data-action="rec"]'), button);
  assert.equal(a.w.document.activeElement, button);
  assert.equal(button.textContent, "다시 녹음하기");
  assert.equal(button.hasAttribute("aria-disabled"), false);
  assert.equal(a.$("btn-next").disabled, false);
  assert.equal(tracks[0].readyState, "ended");
  assert.equal(a.audios.length, 0);
});

test("recording errors retain an earlier take and permit another attempt", async (t) => {
  const a = app(t), { sessions } = microphone(a);
  a.w.console.error = () => {};
  a.recordings("practice"); a.w.testing.showRecordScreen();
  const original = a.w.testing.state.recordings[0][0];
  const button = a.$("unit-list").querySelector('[data-action="rec"]');
  button.click(); await settle();
  sessions[0].onerror({ error: new Error("device interrupted") });
  await settle();
  assert.equal(a.w.testing.state.recordings[0][0], original);
  assert.match(a.$("unit-list").textContent, /이전 녹음은 유지/);
  button.click(); await settle(); button.click(); await settle();
  assert.notEqual(a.w.testing.state.recordings[0][0], original);
});

test("leaving the visible page stops a take and releases microphone tracks", async (t) => {
  const a = app(t), { sessions, tracks } = microphone(a);
  a.recordings("practice"); a.w.testing.showRecordScreen();
  a.$("unit-list").querySelector('[data-action="rec"]').click(); await settle();
  Object.defineProperty(a.w.document, "hidden", { configurable: true, value: true });
  a.w.document.dispatchEvent(new a.w.Event("visibilitychange"));
  await settle();
  assert.equal(sessions[0].stopCount, 1);
  assert.equal(tracks[0].readyState, "ended");
  assert.ok(a.w.testing.state.recordings[0][0].size);
});

test("speaker letters are absent from dialogue text and control descriptions", (t) => {
  const a = app(t); a.recordings("practice");
  a.w.testing.state.dialogues[0].units.push({ n: 2, speaker: "B", text: "Good morning." });
  a.w.testing.showRecordScreen();
  const lines = [...a.w.document.querySelectorAll(".dialogue-text")];
  assert.deepEqual(lines.map(p => p.textContent), ["Hello.", "Good morning."]);
  assert.deepEqual(lines.map(p => p.dataset.speaker), ["A", "B"]);
  assert.equal(lines[0].getAttribute("aria-label"), null);
  assert.equal(a.$("unit-list").querySelector("button").getAttribute("aria-describedby"), lines[0].id);
});

test("mobile mic test provides manual playback when autoplay is blocked", async (t) => {
  const a = app(t); microphone(a);
  await a.enter(); a.$("btn-practice").click(); await settle();
  a.$("mic-playback").play = async () => { throw new Error("autoplay denied"); };
  let endTest;
  const timer = a.w.setTimeout.bind(a.w);
  a.w.setTimeout = (fn, delay, ...args) => delay === 3000 ? (endTest = fn, 0) : timer(fn, delay, ...args);
  a.$("btn-mic-test").focus(); a.$("btn-mic-test").click(); await settle();
  assert.equal(a.$("mic-indicator").hidden, false);
  assert.equal(a.$("mic-indicator").getAttribute("aria-hidden"), "true");
  endTest();
  assert.equal(a.$("mic-indicator").hidden, true);
  await settle();
  assert.equal(a.$("mic-indicator").hidden, true);
  assert.equal(a.$("mic-playback").hidden, false);
  assert.equal(a.$("mic-playback").controls, true);
  assert.equal(a.$("btn-mic-next").disabled, false);
  assert.equal(a.$("btn-mic-test").hasAttribute("aria-disabled"), false);
  assert.equal(a.w.document.activeElement, a.$("btn-mic-test"));
  assert.match(a.$("mic-status").textContent, /재생 버튼/);
});

test("pending official audio cannot start during recording", async (t) => {
  const pending = deferred();
  const a = app(t, { downloadAudio: () => pending.promise }); microphone(a);
  a.recordings("practice"); a.w.testing.showRecordScreen();
  a.$("btn-play-all").click();
  const button = a.$("unit-list").querySelector('[data-action="rec"]');
  button.click(); await settle();
  pending.resolve(new Blob(["official"])); await settle();
  assert.equal(a.audios.length, 0);
  button.click(); await settle();
});

test("mic-test completion in the background does not restart playback", async (t) => {
  const a = app(t); microphone(a);
  await a.enter(); a.$("btn-practice").click(); await settle();
  let plays = 0;
  a.$("mic-playback").play = async () => { plays++; };
  a.$("btn-mic-test").click(); await settle();
  Object.defineProperty(a.w.document, "hidden", { configurable: true, value: true });
  a.w.document.dispatchEvent(new a.w.Event("visibilitychange"));
  await settle();
  assert.equal(plays, 0);
  assert.equal(a.$("mic-playback").hidden, false);
  assert.equal(a.$("btn-mic-next").disabled, false);
});

test("entry uses a labelled select and routes a teacher to class progress", async (t) => {
  const a = app(t, { checkIn: async () => ({ ok: true, is_teacher: true }) });
  assert.equal(a.$("entry-form").elements.cls.tagName, "SELECT");
  assert.equal(a.w.document.querySelectorAll('input[type="password"]').length, 0);
  await a.enter();
  assert.equal(a.$("screen-teacher").hidden, false);
  assert.match(a.$("teacher-classes").textContent, /전체 2명, 제출 1명, 미제출 1명/);
  assert.equal(a.w.document.querySelectorAll("tbody tr").length, 2);
  const toggle = [...a.w.document.querySelectorAll("button")].find((b) => b.textContent === "1반 입장 열기");
  toggle.focus(); toggle.click(); await settle();
  assert.equal(toggle.textContent, "1반 입장 닫기");
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

test("closed-class entry explains closure and keeps identity for retry", async (t) => {
  const a = app(t, { checkIn: async () => ({ ok: false, reason: "class_closed", class_open: false }) });
  await a.enter();
  assert.equal(a.$("screen-entry").hidden, false);
  assert.equal(a.$("screen-mode").hidden, true);
  assert.match(a.$("entry-error").textContent, /입장이 닫혀/);
  assert.equal(a.$("entry-form").elements.cls.value, "1");
  assert.equal(a.w.testing.state.cls, 0);
  a.w.checkIn = async () => ({ ok: true, class_open: true, submitted: false });
  await a.enter();
  assert.equal(a.$("screen-mode").hidden, false);
});

for (const mode of ["practice", "exam"]) {
  test(`${mode} starts when the class remains open`, async (t) => {
    const a = app(t); await a.enter();
    a.$(`btn-${mode}`).click(); await settle();
    assert.equal(a.$("screen-mic").hidden, false);
    assert.equal(a.w.testing.state.mode, mode);
    assert.equal(a.w.testing.state.dialogues.length, mode === "exam" ? 2 : 1);
  });

  test(`${mode} rechecks admission before starting`, async (t) => {
    const a = app(t); await a.enter();
    a.w.checkIn = async () => ({ ok: false, reason: "class_closed", class_open: false });
    a.$(`btn-${mode}`).click(); await settle();
    assert.equal(a.$("screen-entry").hidden, false);
    assert.equal(a.$("screen-mic").hidden, true);
    assert.match(a.$("entry-error").textContent, /입장이 닫혀/);
    assert.equal(a.$(`btn-${mode}`).hasAttribute("aria-disabled"), false);
  });

  test(`${mode} preserves recordings on closure and can submit after reopening`, async (t) => {
    const a = app(t); a.recordings(mode);
    const original = a.w.testing.state.recordings;
    a.w.console.error = () => {};
    a.w.checkIn = async () => ({ ok: false, reason: "class_closed", class_open: false });
    await a.w.testing.submit();
    assert.equal(a.uploads.length, 0);
    assert.equal(a.inserts.length, 0);
    assert.equal(a.w.testing.state.recordings, original);
    assert.equal(a.$("screen-submit").hidden, false);
    assert.match(a.$("submit-status").textContent, /창을 닫지 말고/);
    assert.equal(a.w.document.activeElement, a.$("btn-submit"));
    a.w.checkIn = async () => ({ ok: true, class_open: true, submitted: false });
    await a.w.testing.submit();
    assert.equal(a.inserts.length, 1);
    assert.equal(a.$("screen-done").hidden, false);
  });
}

test("closure between admission check and upload is reported without losing recordings", async (t) => {
  let checks = 0;
  const a = app(t, {
    checkIn: async () => ++checks === 1 ? { ok: true, class_open: true } : { ok: false, reason: "class_closed" },
    getClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: { statusCode: "403", message: "RLS" } }) }) } }),
  });
  a.w.console.error = () => {};
  a.recordings("practice");
  await a.w.testing.submit();
  assert.equal(checks, 2);
  assert.match(a.$("submit-status").textContent, /입장이 닫혀/);
  assert.ok(a.w.testing.state.built);
  assert.equal(a.w.testing.state.submitted, false);
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

test("return requires confirmation, prevents duplicate requests, and refreshes progress", async (t) => {
  const pending = deferred();
  const calls = [];
  const a = app(t, { checkIn: async () => ({ ok: true, is_teacher: true }),
    returnSubmission: async (_, id) => { calls.push(id); return pending.promise; } });
  await a.enter();
  const button = [...a.w.document.querySelectorAll("button")].find((b) => b.textContent === "1번 제출 되돌려주기");
  button.click();
  assert.equal(a.w.document.activeElement, a.$("return-cancel"));
  assert.match(a.$("return-detail").textContent, /기존 제출과 녹음을 보관/);
  const dialog = a.$("return-dialog");
  dialog.returnValue = "cancel"; await dialog.onclose();
  assert.equal(calls.length, 0);
  button.click(); dialog.returnValue = "ok";
  const processing = dialog.onclose();
  await dialog.onclose();
  assert.deepEqual(calls, ["old-submission"]);
  a.w.getTeacherDashboard = async () => ({ classes: [{ class: 1, class_open: false, students: [
    { number: 1, name: "학생 가", submission_id: null, submitted_at: null, files: [] },
  ] }] });
  pending.resolve({ returned: true }); await processing;
  assert.match(a.$("teacher-classes").textContent, /제출 0명, 미제출 1명/);
  assert.equal(a.$("teacher-classes").textContent.includes("되돌려주기"), false);
  assert.equal(a.w.document.activeElement, a.$("btn-teacher-refresh"));
});

test("a second exam attempt gets new storage paths while retry uses cached paths", async (t) => {
  const a = app(t); a.recordings();
  a.$("btn-preview").click(); await settle();
  const first = [...a.w.testing.state.built.paths];
  a.$("btn-preview").click();
  a.$("btn-preview").click(); await settle();
  assert.deepEqual([...a.w.testing.state.built.paths], first);
  a.$("btn-back-record").click();
  a.w.testing.showSubmitScreen();
  a.$("btn-preview").click(); await settle();
  assert.notDeepEqual([...a.w.testing.state.built.paths], first);
});

test("successful return still announces a failed dashboard reload", async (t) => {
  const a = app(t, { checkIn: async () => ({ ok: true, is_teacher: true }) });
  await a.enter();
  const button = [...a.w.document.querySelectorAll("button")].find((b) => b.textContent === "1번 제출 되돌려주기");
  button.click();
  a.w.getTeacherDashboard = async () => { throw new Error("offline"); };
  a.w.console.error = () => {};
  const dialog = a.$("return-dialog"); dialog.returnValue = "ok"; await dialog.onclose();
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.match(a.$("live").textContent, /되돌려주었습니다.*현황은 불러오지 못했습니다/);
});
