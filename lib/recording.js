export function startCapture(stream, { onComplete, onError }, Recorder = globalThis.MediaRecorder) {
  if (!Recorder) throw new Error("이 브라우저는 녹음을 지원하지 않습니다.");
  const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"]
    .find((type) => Recorder.isTypeSupported?.(type));
  const recorder = mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream);
  const chunks = [];
  let startedAt = performance.now(), stoppedAt, timer, settled = false, stopping = false;
  const cleanup = () => {
    clearTimeout(timer);
    recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
  };
  const fail = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* 오류 뒤에도 UI를 복구한다. */ }
    onError(error);
  };
  recorder.ondataavailable = ({ data }) => { if (data?.size) chunks.push(data); };
  recorder.onerror = (event) => fail(event.error || new Error("녹음 장치 오류"));
  recorder.onstop = () => {
    if (settled) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "" });
    if (!blob.size) { fail(new Error("녹음된 소리가 없습니다.")); return; }
    // 화면 표시용 시간. 제출 WAV의 정확한 길이는 디코딩한 샘플 수로 계산한다.
    blob.duration = Math.max(0.001, ((stoppedAt ?? performance.now()) - startedAt) / 1000);
    settled = true;
    cleanup();
    onComplete(blob);
  };
  try { recorder.start(); startedAt = performance.now(); } catch (error) { cleanup(); throw error; }
  return {
    stop() {
      if (settled || stopping) return;
      stopping = true;
      stoppedAt = performance.now();
      timer = setTimeout(() => fail(new Error("녹음 정지를 완료하지 못했습니다. 다시 녹음하세요.")), 10000);
      try { if (recorder.state !== "inactive") recorder.stop(); } catch (error) { fail(error); }
    },
  };
}
