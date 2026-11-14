// DOM helpers: element lookup and creation (never from markup strings), the press feedback every
// pixel button gets on pointerdown, and the platform's modifier key.

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing`);
  return node as T;
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | null): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** Pixel buttons click down on pointerdown (not on release), on every pointer type. */
export function pressFeedback(root: Document | HTMLElement = document): void {
  const SEL = ".btn, .icon-btn, .act, .quest, .md-copy, .src-chip, .trace-btn";
  let pressed: HTMLElement | null = null;
  const release = (): void => {
    pressed?.classList.remove("is-pressed");
    pressed = null;
  };
  root.addEventListener("pointerdown", (e) => {
    const t = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(SEL);
    if (!t || (t as HTMLButtonElement).disabled) return;
    pressed = t;
    t.classList.add("is-pressed");
  });
  for (const type of ["pointerup", "pointercancel", "dragstart"]) root.addEventListener(type, release);
  root.addEventListener("pointerout", (e) => {
    if (pressed && !pressed.contains((e as PointerEvent).relatedTarget as Node | null)) release();
  });
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";

/** Text for Silkscreen labels: its "&" reads like "$", so the ampersand is set in the body face. */
export function ampText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  text.split("&").forEach((part, i) => {
    if (i > 0) frag.appendChild(el("span", "amp", "&"));
    if (part) frag.appendChild(document.createTextNode(part));
  });
  return frag;
}
