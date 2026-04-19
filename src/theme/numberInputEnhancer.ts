/**
 * Site-wide number-input enhancer.
 *
 * Wraps every <input type="number"> in the document with a stepper
 * containing two large clickable halves (up / down) that each fill the
 * full height of the field. Uses a MutationObserver so React-rendered
 * inputs picked up automatically as routes change.
 *
 * The stepper drives values through React's controlled inputs by going
 * through HTMLInputElement's prototype `value` setter (which lets React's
 * internal value tracker notice the change) and dispatching a real
 * `input` bubbling event.
 *
 * Opt out per-input by adding the `data-no-stepper` attribute or the
 * `bella-no-stepper` class.
 */

const ENHANCED_FLAG = "bellaStepper";
const SKIP_ATTR = "data-no-stepper";
const SKIP_CLASS = "bella-no-stepper";

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value"
)?.set;

function setNativeValue(input: HTMLInputElement, value: string) {
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function step(input: HTMLInputElement, dir: 1 | -1) {
  const stepAttr = input.getAttribute("step");
  const stepSize =
    stepAttr && stepAttr !== "any" && Number.isFinite(parseFloat(stepAttr))
      ? parseFloat(stepAttr)
      : 1;

  const current =
    input.value === "" || Number.isNaN(parseFloat(input.value))
      ? 0
      : parseFloat(input.value);

  const minAttr = input.getAttribute("min");
  const maxAttr = input.getAttribute("max");
  const min = minAttr && Number.isFinite(parseFloat(minAttr))
    ? parseFloat(minAttr)
    : -Infinity;
  const max = maxAttr && Number.isFinite(parseFloat(maxAttr))
    ? parseFloat(maxAttr)
    : Infinity;

  const next = Math.min(max, Math.max(min, current + dir * stepSize));

  // Round away floating-point dust (so 0.1+0.2 doesn't render as
  // 0.30000000000000004 in price fields).
  const decimals = Math.max(
    decimalsOf(stepSize),
    decimalsOf(current)
  );
  const rounded = decimals > 0 ? Number(next.toFixed(decimals)) : next;

  setNativeValue(input, String(rounded));
}

function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

function shouldSkip(input: HTMLInputElement): boolean {
  if (input.type !== "number") return true;
  if (input.dataset[ENHANCED_FLAG] === "on") return true;
  if (input.hasAttribute(SKIP_ATTR)) return true;
  if (input.classList.contains(SKIP_CLASS)) return true;
  // Avoid wrapping inputs that the developer already wrapped manually.
  if (input.parentElement?.classList.contains("bella-number-stepper")) {
    input.dataset[ENHANCED_FLAG] = "on";
    return true;
  }
  return false;
}

function buildButtons(input: HTMLInputElement): HTMLSpanElement {
  const buttons = document.createElement("span");
  buttons.className = "bella-number-stepper__buttons";
  buttons.setAttribute("aria-hidden", "true");

  const up = document.createElement("button");
  up.type = "button";
  up.className = "bella-number-stepper__btn bella-number-stepper__btn--up";
  up.tabIndex = -1;
  up.innerHTML = svgChevron("up");

  const down = document.createElement("button");
  down.type = "button";
  down.className = "bella-number-stepper__btn bella-number-stepper__btn--down";
  down.tabIndex = -1;
  down.innerHTML = svgChevron("down");

  for (const [btn, dir] of [
    [up, 1],
    [down, -1],
  ] as const) {
    // mousedown so the input keeps focus and the value changes feel snappy.
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (input.disabled || input.readOnly) return;
      input.focus({ preventScroll: true });
      step(input, dir);
    });
    // Allow click for touch / keyboard activation paths that mousedown
    // misses; guarded so we don't double-step.
    btn.addEventListener("click", (e) => {
      e.preventDefault();
    });
  }

  buttons.appendChild(up);
  buttons.appendChild(down);
  return buttons;
}

function svgChevron(dir: "up" | "down"): string {
  // 10x10 viewBox, currentColor so theme tokens drive the tint.
  const points =
    dir === "up" ? "2,7 5,3 8,7" : "2,3 5,7 8,3";
  return `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function enhance(input: HTMLInputElement) {
  if (shouldSkip(input)) return;

  const wrapper = document.createElement("span");
  wrapper.className = "bella-number-stepper";

  const parent = input.parentNode;
  if (!parent) return;
  parent.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  wrapper.appendChild(buildButtons(input));

  input.dataset[ENHANCED_FLAG] = "on";
}

function enhanceAllIn(root: ParentNode) {
  const inputs = root.querySelectorAll<HTMLInputElement>('input[type="number"]');
  inputs.forEach(enhance);
}

let started = false;

export function startNumberInputEnhancer() {
  if (started || typeof document === "undefined") return;
  started = true;

  const run = () => {
    enhanceAllIn(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node instanceof HTMLInputElement) {
            enhance(node);
          } else {
            enhanceAllIn(node);
          }
        });
        // Catch <input type="text"> being switched to type="number" later.
        if (
          m.type === "attributes" &&
          m.target instanceof HTMLInputElement &&
          m.attributeName === "type"
        ) {
          enhance(m.target);
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["type"],
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
