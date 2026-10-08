import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initNumberCombobox } from "../../lib/number-combobox.js";

function setup(t) {
  const dom = new JSDOM('<form><label for="number">번호</label><input id="number" required role="combobox" aria-controls="options" aria-expanded="false"><ul id="options" role="listbox" hidden></ul></form>');
  t.after(() => dom.window.close());
  const input = dom.window.document.querySelector("input"), list = dom.window.document.querySelector("ul");
  initNumberCombobox(input, list); input.focus();
  const key = (key) => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const type = (value) => { input.value = value; input.dispatchEvent(new dom.window.Event("input")); };
  return { dom, input, list, key, type };
}

test("Down navigates 1 then 2 and Enter selects without submitting", (t) => {
  const { input, list, key, dom } = setup(t);
  key("ArrowDown"); assert.equal(list.hidden, false); assert.equal(input.getAttribute("aria-activedescendant"), "options-1");
  key("ArrowDown"); assert.equal(input.getAttribute("aria-activedescendant"), "options-2");
  assert.equal(key("Enter"), false);
  assert.equal(input.value, "2"); assert.equal(list.hidden, true);
  assert.equal(dom.window.document.activeElement, input);
});

test("typed input, Escape, Tab, boundaries and reset preserve normal editing", (t) => {
  const { input, list, key, type } = setup(t);
  type("39"); assert.equal(input.checkValidity(), true);
  key("ArrowDown"); key("ArrowDown"); key("Escape"); assert.equal(input.value, "39");
  key("ArrowDown"); key("ArrowDown"); key("ArrowDown"); key("Tab"); assert.equal(input.value, "40");
  type("1"); key("ArrowUp"); key("ArrowUp"); key("Enter"); assert.equal(input.value, "1");
  type("41"); assert.equal(input.checkValidity(), false);
  type("2e1"); assert.equal(input.checkValidity(), false);
  type("20"); assert.equal(input.checkValidity(), true);
  assert.equal(key("ArrowLeft"), true);
  key("ArrowDown"); input.form.reset(); assert.equal(list.hidden, true); assert.equal(input.value, "");
  assert.equal(input.validity.customError, false);
});

test("pointer selection picks the number and keeps focus in the editable combobox", (t) => {
  const { input, list, dom } = setup(t);
  input.click(); list.children[38].click();
  assert.equal(input.value, "39"); assert.equal(list.hidden, true);
  assert.equal(dom.window.document.activeElement, input);
});
