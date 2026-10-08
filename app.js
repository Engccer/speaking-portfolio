import { checkIn, downloadAudio, getClient, getTeacherDashboard, setClassOpen, getRecordingUrl, returnSubmission } from "./lib/supa.js?v=class-admission";
import { initNumberCombobox } from "./lib/number-combobox.js";
import { drawExam, drawPractice } from "./lib/draw.js";
import { mergeTracks, encodeWav } from "./lib/wav.js";

export const state = {
  cls: 0, num: 0, name: "", mode: "", dialogues: [], current: 0, recordings: {}, stream: null,
  submitted: false, built: null,
};
let DIALOGUES = [];
const SR = 16000;

const $ = (id) => document.getElementById(id);
const live = $("live");
initNumberCombobox($("student-number"), $("number-options"));
export function announce(text) { live.textContent = ""; setTimeout(() => { live.textContent = text; }, 50); }

export function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.id !== id; });
  $(id).querySelector("h2").focus();
}

const normName = (s) => s.replace(/[\s　]/g, "");
const fmt = (sec) => `${sec.toFixed(1)}초`;
let entryBusy = false;
const closedMessage = "지금은 이 반의 입장이 닫혀 있습니다. 선생님이 열어 주면 모의 평가와 본 평가에 참여할 수 있습니다.";
const entryMessage = (r) => r.reason === "class_closed" ? closedMessage : "명렬에 없습니다. 반, 번호, 이름을 확인하세요.";

// 입장
$("entry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (entryBusy) return;
  entryBusy = true;
  const entryButton = e.target.querySelector('button[type="submit"]');
  entryButton.setAttribute("aria-disabled", "true");
  const f = new FormData(e.target);
  const cls = Number(f.get("cls")), num = Number(f.get("num")), name = String(f.get("name") || "").trim();
  $("entry-error").textContent = "";
  try {
    const r = await checkIn(cls, num, name);
    if (!r.ok) { $("entry-error").textContent = entryMessage(r); announce($("entry-error").textContent); return; }
    Object.assign(state, { cls, num, name: normName(name) });
    if (r.is_teacher) {
      showScreen("screen-teacher");
      await refreshTeacher();
      return;
    }
    $("mode-greeting").textContent = `${cls}반 ${num}번 ${name}`;
    const examBtn = $("btn-exam");
    if (r.submitted) { examBtn.disabled = true; $("mode-note").textContent = "본 평가를 이미 제출했습니다. 모의 평가만 할 수 있습니다."; }
    else { examBtn.disabled = false; $("mode-note").textContent = "본 평가는 대화 2편을 녹음하고 한 번만 제출할 수 있습니다."; }
    showScreen("screen-mode");
  } catch (err) {
    $("entry-error").textContent = "서버에 연결할 수 없습니다. 선생님에게 알리세요.";
    announce($("entry-error").textContent);
    console.error(err);
  } finally {
    entryBusy = false;
    entryButton.removeAttribute("aria-disabled");
  }
});

async function loadDialogues() {
  if (DIALOGUES.length) return;
  DIALOGUES = await (await fetch("data/dialogues.json")).json();
}

let modeBusy = false;
async function chooseMode(mode) {
  if (modeBusy) return;
  modeBusy = true;
  const button = $(mode === "exam" ? "btn-exam" : "btn-practice");
  button.setAttribute("aria-disabled", "true");
  try {
    const r = await checkIn(state.cls, state.num, state.name);
    if (!r.ok) {
      $("entry-error").textContent = entryMessage(r);
      showScreen("screen-entry");
      announce($("entry-error").textContent);
      return;
    }
    if (mode === "exam" && r.submitted) {
      $("mode-note").textContent = "본 평가를 이미 제출했습니다. 모의 평가만 할 수 있습니다.";
      announce($("mode-note").textContent);
      return;
    }
    await loadDialogues();
    state.mode = mode;
    state.recordings = {};
    state.current = 0;
    state.submitted = false;
    state.built = null;
    $("btn-mic-next").disabled = true;
    if (mode === "exam") {
      const [a, b] = await drawExam(state.cls, state.num);
      state.dialogues = [DIALOGUES[a], DIALOGUES[b]];
    } else {
      state.dialogues = [DIALOGUES[drawPractice()]];
    }
    showScreen("screen-mic");
  } catch (err) {
    $("mode-note").textContent = "서버에 연결할 수 없습니다. 잠시 후 다시 참여하기를 누르세요.";
    announce($("mode-note").textContent);
    console.error(err);
  } finally {
    modeBusy = false;
    button.removeAttribute("aria-disabled");
  }
}
$("btn-practice").addEventListener("click", () => chooseMode("practice"));
$("btn-exam").addEventListener("click", () => chooseMode("exam"));

// 마이크 준비
$("btn-mic-test").addEventListener("click", async () => {
  const status = $("mic-status");
  const testBtn = $("btn-mic-test");
  testBtn.disabled = true;
  try {
    state.stream = state.stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    status.textContent = "녹음 중 (3초)";
    announce("녹음 중");
    const rec = new MediaRecorder(state.stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks = [];
    rec.ondataavailable = (ev) => chunks.push(ev.data);
    rec.onstop = () => {
      const audio = new Audio(URL.createObjectURL(new Blob(chunks, { type: "audio/webm" })));
      status.textContent = "들려줍니다";
      audio.onended = () => {
        status.textContent = "마이크가 잘 됩니다. [녹음 시작하기]를 누르세요.";
        testBtn.disabled = false;
        $("btn-mic-next").disabled = false;
        announce("마이크 준비 완료");
      };
      audio.play();
    };
    rec.start();
    setTimeout(() => rec.stop(), 3000);
  } catch (err) {
    status.textContent = "마이크를 사용할 수 없습니다. 헤드폰 연결과 브라우저 마이크 권한을 확인한 뒤 다시 누르세요.";
    testBtn.disabled = false;
    announce("마이크를 사용할 수 없습니다");
    console.error(err);
  }
});
$("btn-mic-next").addEventListener("click", () => { showRecordScreen(); });

// 녹음 화면
let recorder = null;          // 진행 중인 MediaRecorder
let playingAll = null;        // 전체 듣기 Audio
let recordingRevision = 0;
const audioCache = {};        // 대화 ID → object URL

async function blobDuration(blob) {
  return new Promise((res) => {
    const a = new Audio(URL.createObjectURL(blob));
    // MediaRecorder가 만든 webm은 길이가 Infinity로 오므로 끝으로 이동시켜 실제 길이를 얻는다.
    a.onloadedmetadata = () => { if (isFinite(a.duration)) res(a.duration); else { a.currentTime = 1e9; a.ontimeupdate = () => { a.ontimeupdate = null; res(a.duration); }; } };
  });
}

function stopPlayAll() {
  if (playingAll) { playingAll.pause(); playingAll = null; }
  $("btn-play-all").textContent = "공식 음원 재생하기";
}

export function showRecordScreen() {
  recordingRevision++;
  const d = state.dialogues[state.current];
  const isExam = state.mode === "exam";
  stopPlayAll();
  $("record-title").textContent = `${isExam ? `대화 ${state.current + 1} / 2` : "모의 평가"}: ${d.title}`;
  $("record-source").textContent = d.source;
  $("btn-prev-dialogue").hidden = !(isExam && state.current === 1);
  $("btn-next").textContent = (isExam && state.current === 0) ? "다음 대화 녹음하기" : "제출 준비하기";
  state.recordings[state.current] = state.recordings[state.current] || {};
  renderUnits();
  showScreen("screen-record");
}

function renderUnits() {
  const d = state.dialogues[state.current];
  const recs = state.recordings[state.current];
  const list = $("unit-list");
  list.innerHTML = "";
  d.units.forEach((u, i) => {
    const li = document.createElement("li");
    li.dataset.index = i;
    const text = document.createElement("p");
    text.id = `unit-text-${i}`;
    text.textContent = `${u.speaker}, ${u.text}`;
    text.lang = "en";
    const mk = (label, action, disabled) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.dataset.action = action; b.disabled = disabled;
      b.setAttribute("aria-describedby", text.id);
      return b;
    };
    const status = document.createElement("span"); status.className = "status"; status.textContent = recs[i] ? `녹음됨 ${fmt(recs[i].duration)}` : "녹음 전";
    li.append(text, mk(recs[i] ? "다시 녹음하기" : "녹음하기", "rec", false), mk("녹음 재생하기", "play", !recs[i]), mk("녹음 삭제하기", "del", !recs[i]), status);
    if (recs[i]) li.classList.add("recorded");
    list.append(li);
  });
  updateNext();
}

function updateNext() {
  const d = state.dialogues[state.current];
  const recs = state.recordings[state.current];
  $("btn-next").disabled = d.units.some((_, i) => !recs[i]) || !!recorder;
}

function setBusy(busy, activeIndex) {
  document.querySelectorAll("#unit-list button").forEach((b) => {
    const isActive = Number(b.closest("li").dataset.index) === activeIndex;
    if (busy) b.disabled = !(isActive && b.dataset.action === "rec");
  });
  $("btn-play-all").disabled = busy;
  $("btn-prev-dialogue").disabled = busy;
  if (busy) $("btn-next").disabled = true; else renderUnits();
}

function focusRec(i) {
  $("unit-list").querySelector(`li[data-index="${i}"] button[data-action="rec"]`).focus();
}

$("unit-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  const li = btn.closest("li"); const i = Number(li.dataset.index);
  const recs = state.recordings[state.current];
  const action = btn.dataset.action;
  if (action === "rec") {
    if (recorder) { recorder.stop(); return; }
    stopPlayAll();
    const chunks = [];
    recorder = new MediaRecorder(state.stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (ev) => chunks.push(ev.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      blob.duration = await blobDuration(blob);
      recs[i] = blob;
      recorder = null;
      setBusy(false);
      announce(`${i + 1}번 녹음됨 ${fmt(blob.duration)}`);
      focusRec(i);
    };
    recorder.start();
    li.classList.add("recording");
    btn.textContent = "녹음 정지하기";
    li.querySelector(".status").textContent = "녹음 중";
    setBusy(true, i);
    announce(`${i + 1}번 녹음 시작`);
  } else if (action === "play") {
    new Audio(URL.createObjectURL(recs[i])).play();
  } else if (action === "del") {
    delete recs[i];
    renderUnits();
    announce(`${i + 1}번 녹음 삭제됨`);
    focusRec(i);
  }
});

$("btn-play-all").addEventListener("click", async () => {
  const btn = $("btn-play-all");
  if (playingAll) { stopPlayAll(); return; }
  const d = state.dialogues[state.current];
  try {
    if (!audioCache[d.id]) audioCache[d.id] = URL.createObjectURL(await downloadAudio(d.audio));
    playingAll = new Audio(audioCache[d.id]);
    btn.textContent = "재생 정지하기";
    playingAll.onended = () => stopPlayAll();
    await playingAll.play();
  } catch (err) { stopPlayAll(); announce("음원을 불러오지 못했습니다"); console.error(err); }
});

$("btn-prev-dialogue").addEventListener("click", () => { state.current = 0; showRecordScreen(); });

$("btn-next").addEventListener("click", () => {
  stopPlayAll();
  if (state.mode === "exam" && state.current === 0) { state.current = 1; showRecordScreen(); }
  else showSubmitScreen();
});

window.addEventListener("beforeunload", (e) => {
  const has = Object.values(state.recordings).some((r) => Object.keys(r).length);
  if (has && !state.submitted) { e.preventDefault(); e.returnValue = ""; }
});

// 제출
export function showSubmitScreen() {
  const ul = $("submit-summary"); ul.innerHTML = "";
  state.dialogues.forEach((d, di) => {
    const total = Object.values(state.recordings[di]).reduce((s, b) => s + b.duration, 0);
    const li = document.createElement("li");
    li.textContent = `${d.title}: ${d.units.length}개 단위, ${fmt(total)}`;
    ul.append(li);
  });
  state.built = null; // 녹음 화면에서 돌아왔으면 다시 병합한다
  $("submit-status").textContent = "";
  $("btn-submit").textContent = "제출하기";
  $("btn-submit").disabled = false;
  $("btn-back-record").disabled = false;
  showScreen("screen-submit");
}

$("btn-back-record").addEventListener("click", () => { stopPreview(); showRecordScreen(); });

$("btn-submit").addEventListener("click", () => {
  if (submitBusy) return;
  stopPreview();
  const dlg = $("confirm-dialog");
  dlg.returnValue = "";
  dlg.showModal();
  $("confirm-ok").focus();
  dlg.onclose = () => { if (dlg.returnValue === "ok") submit(); else $("btn-submit").focus(); };
});

async function decodeToMono(blob) {
  // OfflineAudioContext는 장치를 열지 않고, decodeAudioData가 SR로 리샘플한다.
  const ctx = new OfflineAudioContext(1, 1, SR);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return out;
}

async function buildWav(di) {
  const d = state.dialogues[di];
  const tracks = [];
  for (let i = 0; i < d.units.length; i++) tracks.push(await decodeToMono(state.recordings[di][i]));
  const { samples, offsets } = mergeTracks(tracks, SR, 0.5);
  const turnOffsets = offsets.map((o, i) => ({ turn: d.units[i].n, start: +o.start.toFixed(3), end: +o.end.toFixed(3) }));
  return { blob: new Blob([encodeWav(samples, SR)], { type: "audio/wav" }), turnOffsets, duration: +(samples.length / SR).toFixed(2) };
}

let building = null;
async function ensureBuilt() {
  if (state.built) return state.built;
  if (building) return building;
  building = (async () => {
    const revision = recordingRevision;
    const wavs = [];
    for (let di = 0; di < state.dialogues.length; di++) wavs.push(await buildWav(di));
    if (revision !== recordingRevision) throw new Error("녹음이 변경되었습니다. 다시 재생하세요.");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const attempt = crypto.randomUUID();
    const paths = state.mode === "exam"
      ? state.dialogues.map((d, di) => `exam/${studentDir()}/${attempt}/${di + 1}_${d.id}.wav`)
      : [`practice/${studentDir()}/${stamp}_${state.dialogues[0].id}.wav`];
    state.built = { wavs, paths, uploaded: false };
    return state.built;
  })();
  try { return await building; } finally { building = null; }
}

let preview = null;
let previewVersion = 0;
function stopPreview() {
  previewVersion++;
  if (preview) { preview.pause(); URL.revokeObjectURL(preview.src); preview = null; }
  $("btn-preview").textContent = "내 녹음 전체 재생하기";
}
$("btn-preview").addEventListener("click", async () => {
  if (submitBusy) return;
  if (preview || $("btn-preview").textContent === "재생 정지하기") { stopPreview(); return; }
  const version = ++previewVersion;
  $("btn-preview").textContent = "재생 정지하기";
  try {
    const { wavs } = await ensureBuilt();
    async function playTrack(i) {
      if (version !== previewVersion) return;
      if (preview) { URL.revokeObjectURL(preview.src); preview = null; }
      if (i === wavs.length) { stopPreview(); return; }
      preview = new Audio(URL.createObjectURL(wavs[i].blob));
      preview.onended = () => { playTrack(i + 1).catch(failed); };
      preview.onerror = failed;
      await preview.play();
    }
    function failed() {
      if (version !== previewVersion) return;
      stopPreview(); announce("녹음을 재생하지 못했습니다. 다시 시도하세요.");
    }
    await playTrack(0);
  } catch (err) {
    if (version === previewVersion) { stopPreview(); announce("녹음을 재생하지 못했습니다. 다시 시도하세요."); }
    console.error(err);
  }
});

async function uploadWav(path, blob) {
  const { error } = await getClient().storage.from("recordings").upload(path, blob, { contentType: "audio/wav", upsert: false });
  // 이미 올라간 파일(재시도)은 성공으로 본다.
  if (error && !(error.status === 409 || String(error.statusCode) === "409" || /already exists/i.test(error.message))) throw error;
}

function studentDir() {
  const c = String(state.cls).padStart(2, "0");
  return `3-${c}/3-${c}-${String(state.num).padStart(2, "0")}`;
}

let submitBusy = false;
async function submit() {
  if (submitBusy) return;
  submitBusy = true;
  stopPreview();
  const status = $("submit-status");
  const step = (text) => { status.textContent = text; announce(text); };
  $("btn-submit").setAttribute("aria-disabled", "true");
  $("btn-submit").focus();
  $("btn-preview").disabled = true;
  $("btn-back-record").disabled = true;
  try {
    const access = await checkIn(state.cls, state.num, state.name);
    if (!access.ok) throw Object.assign(new Error(entryMessage(access)), { code: access.reason === "class_closed" ? "CLASS_CLOSED" : "STUDENT_INVALID" });
    if (!state.built) {
      step("병합 중");
      await ensureBuilt();
    }
    const { wavs, paths } = state.built;
    for (let di = 0; di < wavs.length; di++) {
      step(`업로드 ${di + 1}/${wavs.length}`);
      await uploadWav(paths[di], wavs[di].blob);
      state.built.uploaded = true;
    }
    step("기록 저장");
    const base = { class: state.cls, number: state.num, name: state.name, user_agent: navigator.userAgent };
    if (state.mode === "exam") {
      const { error } = await getClient().from("submissions").insert({
        ...base,
        dialogue_ids: state.dialogues.map((d) => d.id),
        turn_offsets: wavs.map((w) => w.turnOffsets),
        files: paths, durations: wavs.map((w) => w.duration),
      });
      if (error) {
        if (error.code === "23505") { finish("이미 제출된 기록이 있습니다. 선생님에게 확인하세요."); return; }
        throw error;
      }
      finish("제출이 완료되었습니다. 창을 닫아도 됩니다.");
    } else {
      const { error } = await getClient().from("practice_submissions").insert({
        ...base,
        dialogue_id: state.dialogues[0].id, turn_offsets: wavs[0].turnOffsets,
        file: paths[0], duration: wavs[0].duration,
      });
      if (error) throw error;
      finish("모의 평가 제출이 완료되었습니다.");
    }
  } catch (err) {
    console.error(err);
    let closed = err.code === "CLASS_CLOSED";
    if (!closed && (err.code === "42501" || Number(err.statusCode || err.status) === 403)) {
      try { closed = (await checkIn(state.cls, state.num, state.name)).reason === "class_closed"; } catch { /* 원래 제출 오류를 표시한다. */ }
    }
    status.textContent = closed
      ? "이 반의 입장이 닫혀 제출할 수 없습니다. 녹음은 이 화면에 보관됩니다. 창을 닫지 말고 선생님이 입장을 열어 주면 [다시 제출하기]를 누르세요."
      : `제출에 실패했습니다 (${err.message || err}). 입력 정보와 네트워크를 확인하고 [다시 제출하기]를 누르세요.`;
    $("btn-submit").textContent = "다시 제출하기";
    $("btn-submit").disabled = false;
    // 본 평가 파일이 이미 올라갔으면 다시 녹음하지 못하게 한다(같은 경로는 덮어쓸 수 없다).
    $("btn-back-record").disabled = state.mode === "exam" && !!state.built?.uploaded;
    announce(status.textContent);
  } finally {
    submitBusy = false;
    $("btn-submit").removeAttribute("aria-disabled");
    $("btn-preview").disabled = false;
  }
}

function finish(text) {
  state.submitted = true;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  $("btn-restart").hidden = state.mode !== "practice";
  $("done-text").textContent = text;
  showScreen("screen-done");
  announce(text);
}

$("btn-restart").addEventListener("click", () => {
  stopPreview();
  Object.assign(state, { cls: 0, num: 0, name: "", recordings: {}, built: null, submitted: false, dialogues: [], current: 0, mode: "" });
  $("entry-form").reset();
  $("entry-error").textContent = "";
  showScreen("screen-entry");
});

// 교사 대시보드
let teacherBusy = false;
let teacherAudio = null;
let teacherPlayButton = null;
let teacherPlayVersion = 0;
function stopTeacherAudio() {
  teacherPlayVersion++;
  if (teacherAudio) { teacherAudio.pause(); teacherAudio = null; }
  if (teacherPlayButton) {
    teacherPlayButton.textContent = teacherPlayButton.dataset.label;
    teacherPlayButton = null;
  }
}

async function refreshTeacher() {
  if (teacherBusy) return;
  teacherBusy = true;
  const button = $("btn-teacher-refresh");
  button.setAttribute("aria-disabled", "true");
  $("btn-teacher-exit").setAttribute("aria-disabled", "true");
  $("teacher-status").textContent = "제출 현황을 불러오는 중입니다.";
  stopTeacherAudio();
  $("teacher-classes").replaceChildren();
  try {
    const data = await getTeacherDashboard(state);
    renderTeacher(data.classes);
    $("teacher-status").textContent = "본 평가 제출 현황입니다.";
    announce("제출 현황을 불러왔습니다.");
    return true;
  } catch (err) {
    $("teacher-status").textContent = "제출 현황을 불러오지 못했습니다. 다시 새로고침하세요.";
    announce($("teacher-status").textContent);
    console.error(err);
    return false;
  } finally {
    teacherBusy = false;
    button.removeAttribute("aria-disabled");
    $("btn-teacher-exit").removeAttribute("aria-disabled");
  }
}

function renderTeacher(classes) {
  const container = $("teacher-classes");
  if (!classes.length) {
    const empty = document.createElement("p"); empty.textContent = "등록된 반이 없습니다.";
    container.append(empty); return;
  }
  classes.forEach((cls) => {
    const section = document.createElement("div"); section.className = "teacher-class";
    const title = document.createElement("h3"); title.textContent = `${cls.class}반`;
    const count = cls.students.filter((student) => student.submitted_at).length;
    const summary = document.createElement("p");
    summary.textContent = `전체 ${cls.students.length}명, 제출 ${count}명, 미제출 ${cls.students.length - count}명`;
    const toggle = document.createElement("button"); toggle.type = "button";
    // 동작 버튼의 문구와 별도로 현재 개방 상태를 명시한다.
    const status = document.createElement("p");
    const update = () => {
      status.textContent = `학급 입장 ${cls.class_open ? "열림" : "닫힘"}, 모의 평가와 본 평가에 함께 적용됩니다.`;
      toggle.textContent = `${cls.class}반 입장 ${cls.class_open ? "닫기" : "열기"}`;
    };
    update();
    let toggling = false;
    toggle.addEventListener("click", async () => {
      if (toggling || teacherBusy) return;
      toggling = true; teacherBusy = true;
      toggle.setAttribute("aria-disabled", "true");
      $("btn-teacher-refresh").setAttribute("aria-disabled", "true");
      $("btn-teacher-exit").setAttribute("aria-disabled", "true");
      try {
        const result = await setClassOpen(state, cls.class, !cls.class_open);
        cls.class_open = result.class_open;
        update();
        announce(`${cls.class}반 입장이 ${cls.class_open ? "열렸습니다" : "닫혔습니다"}.`);
      } catch (err) {
        status.textContent = "개방 상태를 확인하지 못했습니다. 현황을 새로고침하세요.";
        toggle.disabled = true;
        $("btn-teacher-refresh").focus();
        announce(status.textContent);
        console.error(err);
      } finally {
        toggling = false; teacherBusy = false;
        toggle.removeAttribute("aria-disabled");
        $("btn-teacher-refresh").removeAttribute("aria-disabled");
        $("btn-teacher-exit").removeAttribute("aria-disabled");
      }
    });
    const table = document.createElement("table");
    const caption = table.createCaption(); caption.textContent = `${cls.class}반 본 평가 제출 현황`;
    const header = table.createTHead().insertRow();
    ["번호", "이름", "제출 상태", "녹음", "재응시"].forEach((name) => {
      const th = document.createElement("th"); th.scope = "col"; th.textContent = name; header.append(th);
    });
    const tbody = table.createTBody();
    cls.students.forEach((student) => {
      const row = tbody.insertRow();
      row.insertCell().textContent = student.number;
      const name = document.createElement("th"); name.scope = "row"; name.textContent = student.name; row.append(name);
      row.insertCell().textContent = student.submitted_at ? "제출" : "미제출";
      const files = row.insertCell();
      student.files.forEach((path, i) => {
        const play = document.createElement("button"); play.type = "button";
        play.dataset.label = `${student.number}번 대화 ${i + 1} 녹음 재생하기`;
        play.textContent = play.dataset.label;
        play.addEventListener("click", async () => {
          if (teacherPlayButton === play) { stopTeacherAudio(); return; }
          stopTeacherAudio();
          const version = teacherPlayVersion;
          teacherPlayButton = play;
          play.textContent = "재생 정지하기";
          try {
            const url = await getRecordingUrl(state, path);
            if (version !== teacherPlayVersion) return;
            teacherAudio = new Audio(url);
            teacherAudio.onended = () => stopTeacherAudio();
            teacherAudio.onerror = () => {
              if (version !== teacherPlayVersion) return;
              stopTeacherAudio(); announce("녹음을 재생하지 못했습니다. 다시 시도하세요.");
            };
            await teacherAudio.play();
          } catch (err) {
            if (version === teacherPlayVersion) {
              stopTeacherAudio(); announce("녹음을 불러오지 못했습니다. 다시 시도하세요.");
            }
            console.error(err);
          }
        });
        files.append(play);
      });
      if (!student.files.length) files.textContent = "녹음 없음";
      const action = row.insertCell();
      if (student.submission_id) {
        const giveBack = document.createElement("button"); giveBack.type = "button";
        giveBack.textContent = `${student.number}번 제출 되돌려주기`;
        giveBack.addEventListener("click", () => confirmReturn(cls, student, giveBack));
        action.append(giveBack);
      }
    });
    const scroll = document.createElement("div"); scroll.className = "table-scroll"; scroll.append(table);
    section.append(title, summary, status, toggle, scroll); container.append(section);
  });
}

function confirmReturn(cls, student, button) {
  if (teacherBusy) return;
  const dialog = $("return-dialog");
  $("return-detail").textContent = `${cls.class}반 ${student.number}번 ${student.name}의 기존 제출과 녹음을 보관하고 다시 응시할 수 있게 합니다. 학생은 다시 입장해야 하며, 학급 입장이 열려 있어야 참여할 수 있습니다.`;
  dialog.returnValue = "";
  dialog.onclose = async () => {
    if (dialog.returnValue !== "ok") { button.focus(); return; }
    if (teacherBusy) return;
    teacherBusy = true;
    button.setAttribute("aria-disabled", "true");
    button.focus();
    try {
      const result = await returnSubmission(state, student.submission_id);
      // 목록에서 사라질 반환 버튼 대신 항상 남는 컨트롤로 포커스를 옮긴다.
      $("btn-teacher-refresh").focus();
      teacherBusy = false;
      const refreshed = await refreshTeacher();
      const message = result.returned
        ? `${cls.class}반 ${student.number}번 제출을 되돌려주었습니다. 학생이 다시 입장하면 재응시할 수 있습니다.`
        : "이미 처리된 제출입니다. 현재 현황을 확인하세요.";
      announce(refreshed ? message : `${message} 현황은 불러오지 못했습니다. 다시 새로고침하세요.`);
    } catch (err) {
      $("teacher-status").textContent = "되돌려주기 결과를 확인하지 못했습니다. 현황을 새로고침하세요.";
      announce($("teacher-status").textContent);
      console.error(err);
    } finally {
      teacherBusy = false;
      button.removeAttribute("aria-disabled");
    }
  };
  dialog.showModal();
  $("return-cancel").focus();
}

$("btn-teacher-refresh").addEventListener("click", refreshTeacher);
$("btn-teacher-exit").addEventListener("click", () => {
  if (teacherBusy) return;
  stopTeacherAudio();
  $("teacher-classes").replaceChildren();
  Object.assign(state, { cls: 0, num: 0, name: "" });
  $("entry-form").reset();
  showScreen("screen-entry");
});
