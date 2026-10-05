/**
 * Whether a keydown fired while an IME composition is in progress (confirming
 * a Chinese/Japanese/Korean candidate). Three independent signals are checked
 * because browsers are inconsistent about which one fires: the spec
 * `event.isComposing`, a component-tracked `composing` signal (Safari drops
 * `isComposing` on some composition-end paths), and the legacy `keyCode ===
 * 229` sentinel some older WebKit builds still emit. Any one being true means
 * the keypress belongs to the IME, not the user's intended key action.
 */
export function isImeComposing(event: Pick<KeyboardEvent, "isComposing" | "keyCode">, composing: boolean): boolean {
  return event.isComposing || composing || event.keyCode === 229
}

export * as Ime from "./ime"
