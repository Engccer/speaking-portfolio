import { checkIn, downloadAudio, getClient } from "./lib/supa.js";
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
export function announce(text) { live.textContent = ""; setTimeout(() => { live.textContent = text; }, 50); }

export function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.id !== id; });
  $(id).querySelector("h2").focus();
}

const normName = (s) => s.replace(/[\s　]/g, "");
const fmt = (sec) => `${sec.toFixed(1)}초`;

// 입장
$("entry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const cls = Number(f.get("cls")), num = Number(f.get("num")), name = String(f.get("name") || "").trim();
  $("entry-error").textContent = "";
  try {
    const r = await checkIn(cls, num, name);
    if (!r.ok) { $("entry-error").textContent = "명렬에 없습니다. 반, 번호, 이름을 확인하세요."; return; }
    Object.assign(state, { cls, num, name: normName(name) });
    $("mode-greeting").textContent = `${cls}반 ${num}번 ${name}`;
    const examBtn = $("btn-exam");
    if (r.submitted) { examBtn.disabled = true; $("mode-note").textContent = "본 평가를 이미 제출했습니다. 모의 평가만 할 수 있습니다."; }
    else if (!r.exam_open) { examBtn.disabled = true; $("mode-note").textContent = "본 평가는 수업 시간에 선생님이 열어 줍니다."; }
    else { examBtn.disabled = false; $("mode-note").textContent = "본 평가는 대화 2편을 녹음하고 한 번만 제출할 수 있습니다."; }
    showScreen("screen-mode");
  } catch (err) {
    $("entry-error").textContent = "서버에 연결할 수 없습니다. 선생님에게 알리세요.";
    console.error(err);
  }
});

async function loadDialogues() {
  if (DIALOGUES.length) return;
  DIALOGUES = await (await fetch("data/dialogues.json")).json();
}

async function chooseMode(mode) {
  await loadDialogues();
  state.mode = mode;
  state.recordings = {};
  state.current = 0;
  if (mode === "exam") {
    const [a, b] = await drawExam(state.cls, state.num);
    state.dialogues = [DIALOGUES[a], DIALOGUES[b]];
  } else {
    state.dialogues = [DIALOGUES[drawPractice()]];
  }
  showScreen("screen-mic");
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
        status.textContent = "마이크가 잘 됩니다. [시작]을 누르세요.";
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
  $("btn-play-all").textContent = "전체 듣기";
}

export function showRecordScreen() {
  const d = state.dialogues[state.current];
  const isExam = state.mode === "exam";
  stopPlayAll();
  $("record-title").textContent = `${isExam ? `대화 ${state.current + 1} / 2` : "모의 평가"}: ${d.title}`;
  $("record-source").textContent = d.source;
  $("btn-prev-dialogue").hidden = !(isExam && state.current === 1);
  $("btn-next").textContent = (isExam && state.current === 0) ? "다음 대화" : "제출 화면으로";
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
    const sp = document.createElement("span"); sp.className = "speaker"; sp.textContent = u.speaker;
    text.append(sp, document.createTextNode(u.text));
    const mk = (label, action, disabled) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.dataset.action = action; b.disabled = disabled;
      b.setAttribute("aria-describedby", text.id);
      return b;
    };
    const status = document.createElement("span"); status.className = "status"; status.textContent = recs[i] ? `녹음됨 ${fmt(recs[i].duration)}` : "녹음 전";
    li.append(text, mk(recs[i] ? "다시 녹음" : "녹음", "rec", false), mk("듣기", "play", !recs[i]), mk("삭제", "del", !recs[i]), status);
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
    btn.textContent = "정지";
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
    btn.textContent = "정지";
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
  $("btn-submit").textContent = "제출";
  $("btn-submit").disabled = false;
  $("btn-back-record").disabled = false;
  showScreen("screen-submit");
}

$("btn-back-record").addEventListener("click", () => showRecordScreen());

$("btn-submit").addEventListener("click", () => {
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

async function uploadWav(path, blob) {
  const { error } = await getClient().storage.from("recordings").upload(path, blob, { contentType: "audio/wav", upsert: false });
  // 이미 올라간 파일(재시도)은 성공으로 본다.
  if (error && !(error.status === 409 || String(error.statusCode) === "409" || /already exists/i.test(error.message))) throw error;
}

function studentDir() {
  const c = String(state.cls).padStart(2, "0");
  return `3-${c}/3-${c}-${String(state.num).padStart(2, "0")}`;
}

async function submit() {
  const status = $("submit-status");
  const step = (text) => { status.textContent = text; announce(text); };
  $("btn-submit").disabled = true;
  $("btn-back-record").disabled = true;
  try {
    if (!state.built) {
      step("병합 중");
      const wavs = [];
      for (let di = 0; di < state.dialogues.length; di++) wavs.push(await buildWav(di));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const paths = state.mode === "exam"
        ? state.dialogues.map((d, di) => `exam/${studentDir()}/${di + 1}_${d.id}.wav`)
        : [`practice/${studentDir()}/${stamp}_${state.dialogues[0].id}.wav`];
      state.built = { wavs, paths, uploaded: false };
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
      finish("모의 평가 제출이 완료되었습니다. 다시 하려면 페이지를 새로 고치세요.");
    }
  } catch (err) {
    console.error(err);
    status.textContent = `제출에 실패했습니다 (${err.message || err}). 네트워크를 확인하고 [다시 시도]를 누르세요.`;
    $("btn-submit").textContent = "다시 시도";
    $("btn-submit").disabled = false;
    // 본 평가 파일이 이미 올라갔으면 다시 녹음하지 못하게 한다(같은 경로는 덮어쓸 수 없다).
    $("btn-back-record").disabled = state.mode === "exam" && !!state.built?.uploaded;
    announce("제출 실패");
  }
}

function finish(text) {
  state.submitted = true;
  $("done-text").textContent = text;
  showScreen("screen-done");
  announce(text);
}
