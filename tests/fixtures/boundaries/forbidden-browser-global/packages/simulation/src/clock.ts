export function elapsed() {
  return window.performance.now();
}

export function label() {
  return document.getElementById('hud')?.textContent ?? '';
}
