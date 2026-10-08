export function initNumberCombobox(input, list) {
  let active = -1;
  const doc = input.ownerDocument;
  const options = Array.from({ length: 40 }, (_, i) => {
    const option = doc.createElement("li");
    option.id = `${list.id}-${i + 1}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.textContent = String(i + 1);
    option.addEventListener("pointerdown", (event) => event.preventDefault());
    option.addEventListener("click", () => { active = i; commit(); input.focus(); });
    list.append(option);
    return option;
  });
  function validate() {
    const valid = /^(?:[1-9]|[1-3][0-9]|40)$/.test(input.value);
    input.setCustomValidity(!input.value || valid ? "" : "번호는 1부터 40까지 입력하세요.");
  }
  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    options.forEach((option) => option.setAttribute("aria-selected", "false"));
    active = -1;
  }
  function open() {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function highlight(index) {
    active = index;
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === active)));
    input.setAttribute("aria-activedescendant", options[active].id);
    options[active].scrollIntoView?.({ block: "nearest" });
  }
  function commit() {
    if (active >= 0) input.value = String(active + 1);
    validate();
    close();
  }
  input.addEventListener("click", () => {
    if (list.hidden) {
      open();
      if (/^(?:[1-9]|[1-3][0-9]|40)$/.test(input.value)) highlight(Number(input.value) - 1);
    }
  });
  input.addEventListener("input", () => { close(); validate(); });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (list.hidden) {
        open();
        highlight(/^(?:[1-9]|[1-3][0-9]|40)$/.test(input.value) ? Number(input.value) - 1 : step === 1 ? 0 : 39);
      } else {
        highlight(active < 0 ? step === 1 ? 0 : 39 : Math.max(0, Math.min(39, active + step)));
      }
    } else if (event.key === "Enter" && !list.hidden && active >= 0) {
      event.preventDefault(); commit();
    } else if (event.key === "Escape" && !list.hidden) {
      event.preventDefault(); close();
    } else if (event.key === "Tab") {
      commit();
    } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      close();
    }
  });
  input.addEventListener("blur", close);
  input.form?.addEventListener("reset", () => { close(); input.setCustomValidity(""); });
}
