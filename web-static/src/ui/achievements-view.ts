// The Achievements view: every trophy, locked or unlocked, with real progress from the local game
// store. Loaded on first use.

import type { Achievement } from "../game/game.ts";
import { el } from "./dom.ts";
import { hydrateIcons, pixelIcon } from "./icons.ts";

let dialog: HTMLDialogElement | null = null;
let opener: HTMLElement | null = null;

export function openAchievements(list: readonly Achievement[], unlocked: Readonly<Record<string, number>>, counts: Readonly<Record<string, number>>): void {
  opener = document.activeElement as HTMLElement | null;
  if (!dialog) {
    dialog = el("dialog", "dialog achievements");
    dialog.setAttribute("aria-labelledby", "ach-title");
    const head = el("header", "dialog-head");
    const h = el("h2", null, "Achievements");
    h.id = "ach-title";
    const close = el("button", "icon-btn");
    close.type = "button";
    close.dataset.icon = "close";
    close.setAttribute("aria-label", "Close Achievements");
    close.addEventListener("click", () => dialog?.close());
    head.append(h, close);
    dialog.append(head, el("div", "dialog-body"));
    dialog.addEventListener("close", () => {
      if (opener && document.body.contains(opener)) opener.focus();
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog?.close();
    });
    hydrateIcons(dialog);
    document.body.appendChild(dialog);
  }
  const body = dialog.querySelector(".dialog-body") as HTMLElement;
  body.textContent = "";
  const done = list.filter((a) => unlocked[a.id]).length;
  body.appendChild(el("p", null, `${done} of ${list.length} unlocked. Progress is kept in this browser only.`));
  const ul = el("ul", "trophy-grid");
  for (const a of list) {
    const on = Boolean(unlocked[a.id]);
    const li = el("li", `trophy frame${on ? " is-unlocked" : ""}`);
    const icon = el("span", "trophy-icon");
    icon.appendChild(pixelIcon(on ? a.icon : "lock", 32));
    li.append(icon, el("span", "trophy-name", a.name), el("span", "trophy-desc", a.desc));
    const n = Math.min(a.goal, counts[a.id] ?? 0);
    li.appendChild(el("span", "trophy-state", on ? `Unlocked ${new Date(unlocked[a.id] as number).toLocaleDateString()}` : a.goal > 1 ? `Locked · ${n}/${a.goal}` : "Locked"));
    li.setAttribute("aria-label", `${a.name}: ${on ? "unlocked" : "locked"}. ${a.desc}`);
    ul.appendChild(li);
  }
  body.appendChild(ul);
  dialog.showModal();
}

export function closeAchievements(): boolean {
  if (dialog?.open) {
    dialog.close();
    return true;
  }
  return false;
}
