export function startMicMeter(canvas, stream) {
  let context, source, analyser, frame;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    source?.disconnect();
    analyser?.disconnect();
    context?.close().catch(() => {});
  };
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    context.resume().catch(() => {});
    const samples = new Uint8Array(analyser.fftSize);
    const pen = canvas.getContext("2d");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const draw = () => {
      if (stopped) return;
      analyser.getByteTimeDomainData(samples);
      pen.clearRect(0, 0, canvas.width, canvas.height);
      pen.strokeStyle = "#b42332";
      pen.lineWidth = 2;
      pen.lineCap = "round";
      pen.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = i * canvas.width / (samples.length - 1);
        const y = canvas.height / 2 + (samples[i] - 128) / 128 * canvas.height * 0.45;
        if (i === 0) pen.moveTo(x, y); else pen.lineTo(x, y);
      }
      pen.stroke();
      if (!reducedMotion.matches) frame = requestAnimationFrame(draw);
    };
    draw();
  } catch { stop(); }
  return stop;
}
