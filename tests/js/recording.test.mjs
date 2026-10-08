import test from "node:test";
import assert from "node:assert/strict";
import { startCapture } from "../../lib/recording.js";

function capture(t, { supported = ["audio/webm;codecs=opus"], mimeType, supportApi = true } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const completed = [], errors = [], instances = [], stream = {};
  class FakeMediaRecorder {
    static isTypeSupported(type) { return supported.includes(type); }
    constructor(input, options) {
      this.stream = input;
      this.options = options;
      this.mimeType = mimeType ?? options?.mimeType ?? "audio/ogg";
      this.state = "inactive";
      this.stopCalls = 0;
      instances.push(this);
    }
    start() { this.state = "recording"; }
    stop() { this.stopCalls++; this.state = "inactive"; }
    data(text, type = this.mimeType) { this.ondataavailable?.({ data: new Blob([text], { type }) }); }
    finish() { this.state = "inactive"; this.onstop?.(); }
    error(error) { this.onerror?.({ error }); }
  }
  if (!supportApi) FakeMediaRecorder.isTypeSupported = undefined;
  const callbacks = { onComplete: (blob) => completed.push(blob), onError: (error) => errors.push(error) };
  const controller = startCapture(stream, callbacks, FakeMediaRecorder);
  return { controller, recorder: instances[0], completed, errors, stream, callbacks, Recorder: FakeMediaRecorder, instances };
}

test("an MP4-only recorder receives a supported format and preserves its actual MIME type", async (t) => {
  const a = capture(t, { supported: ["audio/mp4"], mimeType: "audio/mp4;codecs=mp4a.40.2" });
  assert.equal(a.recorder.stream, a.stream);
  assert.deepEqual(a.recorder.options, { mimeType: "audio/mp4" });
  a.recorder.data("first");
  a.controller.stop();
  a.recorder.data("last");
  a.recorder.finish();
  assert.equal(a.completed.length, 1);
  assert.equal(a.completed[0].type, "audio/mp4;codecs=mp4a.40.2");
  assert.equal(await a.completed[0].text(), "firstlast");
  assert.equal(a.errors.length, 0);
});

for (const supportApi of [true, false]) {
  test(`browser defaults are used when ${supportApi ? "no preferred format is supported" : "format detection is unavailable"}`, async (t) => {
    const a = capture(t, { supported: [], supportApi });
    assert.equal(a.recorder.options, undefined);
    a.recorder.data("sound");
    a.controller.stop();
    a.recorder.finish();
    assert.equal(a.completed[0].type, "audio/ogg");
    assert.equal(await a.completed[0].text(), "sound");
    assert.equal(a.errors.length, 0);
  });
}

test("a chunk MIME type is retained when the recorder does not report one", (t) => {
  const a = capture(t, { supported: [], mimeType: "" });
  a.recorder.data("sound", "audio/mp4");
  a.controller.stop();
  a.recorder.finish();
  assert.equal(a.completed[0].type, "audio/mp4");
});

test("empty data reports an error instead of completing an unusable recording", (t) => {
  const a = capture(t);
  a.recorder.data("");
  a.controller.stop();
  a.recorder.finish();
  assert.equal(a.completed.length, 0);
  assert.equal(a.errors.length, 1);
  assert.match(a.errors[0].message, /녹음된 소리가 없습니다/);
  t.mock.timers.tick(10000);
  assert.equal(a.errors.length, 1);
});

test("repeated stop requests call the recorder once and complete only once", (t) => {
  const a = capture(t);
  a.controller.stop();
  a.controller.stop();
  assert.equal(a.recorder.stopCalls, 1);
  assert.equal(a.completed.length, 0);
  a.recorder.data("sound");
  a.recorder.finish();
  a.controller.stop();
  a.recorder.finish();
  t.mock.timers.tick(10000);
  assert.equal(a.recorder.stopCalls, 1);
  assert.equal(a.completed.length, 1);
  assert.equal(a.errors.length, 0);
});

test("delayed stop events retain final chunks without adding callback delay to duration", async (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const a = capture(t);
  now = 3500;
  a.controller.stop();
  setTimeout(() => {
    now = 8500;
    a.recorder.data("final chunk");
    a.recorder.finish();
  }, 5000);
  t.mock.timers.tick(4999);
  assert.equal(a.completed.length, 0);
  t.mock.timers.tick(1);
  assert.equal(a.completed.length, 1);
  assert.equal(await a.completed[0].text(), "final chunk");
  assert.equal(a.completed[0].duration, 2.5);
  t.mock.timers.tick(10000);
  assert.equal(a.errors.length, 0);
});

test("device errors settle once, discard late data, and allow a fresh capture", (t) => {
  const a = capture(t);
  const error = new Error("microphone disconnected");
  a.recorder.data("partial");
  a.recorder.error(error);
  a.recorder.error(error);
  a.recorder.data("late");
  a.recorder.finish();
  a.controller.stop();
  assert.deepEqual(a.errors, [error]);
  assert.equal(a.completed.length, 0);
  assert.equal(a.recorder.state, "inactive");
  const retry = startCapture(a.stream, a.callbacks, a.Recorder);
  const recorder = a.instances[1];
  recorder.data("retry");
  retry.stop();
  recorder.finish();
  t.mock.timers.tick(10000);
  assert.equal(a.completed.length, 1);
  assert.deepEqual(a.errors, [error]);
});

test("a missing stop event fails at ten seconds and cannot complete afterward", (t) => {
  const a = capture(t);
  a.recorder.data("partial");
  a.controller.stop();
  t.mock.timers.tick(9999);
  assert.equal(a.errors.length, 0);
  t.mock.timers.tick(1);
  assert.equal(a.errors.length, 1);
  assert.match(a.errors[0].message, /녹음 정지를 완료하지 못했습니다/);
  a.recorder.data("late");
  a.recorder.finish();
  a.controller.stop();
  t.mock.timers.tick(10000);
  assert.equal(a.errors.length, 1);
  assert.equal(a.completed.length, 0);
});

test("a synchronous stop failure invokes the error callback once", (t) => {
  const a = capture(t);
  const error = new Error("stop failed");
  a.recorder.stop = () => { throw error; };
  assert.doesNotThrow(() => a.controller.stop());
  a.controller.stop();
  t.mock.timers.tick(10000);
  assert.deepEqual(a.errors, [error]);
  assert.equal(a.completed.length, 0);
});

test("missing recorder support fails before starting capture", () => {
  assert.throws(() => startCapture({}, {}, null), /녹음을 지원하지 않습니다/);
});
