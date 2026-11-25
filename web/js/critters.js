// Hand-drawn creatures and props, as SVG strings. Each is drawn in its own coordinates with its
// feet (or base) at y = 0, so the scene can place and scale it. Style: a dark ink outline,
// a flat base colour, a shadow shape on the far side and a few highlights.

import { INK, sway, bob } from "./svg.js";

const ink = (w = 3) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

function blink(cx, cy, rx, ry, lidColor, period, delay) {
  // An eyelid that drops over the eye for a moment every `period` seconds.
  const k = (0.12 / period).toFixed(4);
  return `<ellipse cx="${cx}" cy="${cy - ry}" rx="${rx + 1}" ry="0" fill="${lidColor}" ${ink(2)}>`
    + `<animate attributeName="ry" values="0;0;${ry + 1};0;0" keyTimes="0;${(1 - 3 * k).toFixed(4)};${(1 - 1.5 * k).toFixed(4)};1;1" dur="${period}s" begin="${-delay}s" repeatCount="indefinite"/>`
    + `<animate attributeName="cy" values="${cy - ry};${cy - ry};${cy};${cy - ry};${cy - ry}" keyTimes="0;${(1 - 3 * k).toFixed(4)};${(1 - 1.5 * k).toFixed(4)};1;1" dur="${period}s" begin="${-delay}s" repeatCount="indefinite"/>`
    + `</ellipse>`;
}

function eye(cx, cy, r, lid, period = 5, delay = 0, pupilId = "") {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fffbea" ${ink(2.4)}/>`
    + `<g${pupilId ? ` id="${pupilId}"` : ""}><circle cx="${cx - r * 0.12}" cy="${cy + r * 0.05}" r="${r * 0.55}" fill="${INK}"/>`
    + `<circle cx="${cx - r * 0.32}" cy="${cy - r * 0.2}" r="${r * 0.2}" fill="#fff"/></g>`
    + blink(cx, cy, r, r, lid, period, delay);
}

/** A leg from a thigh at `top` down to a flared foot at y = 0, centred on x, width w. */
function leg(x, top, w, fill, shade) {
  const d = `M${x - w / 2} ${top} C${x - w * 0.66} ${top * 0.5} ${x - w * 0.44} -26 ${x - w * 0.4} -13 `
    + `C${x - w * 0.62} -7 ${x - w * 0.66} 0 ${x - w * 0.52} 0 L${x + w * 0.56} 0 C${x + w * 0.66} 0 ${x + w * 0.5} -7 ${x + w * 0.4} -13 `
    + `C${x + w * 0.44} -26 ${x + w * 0.66} ${top * 0.5} ${x + w / 2} ${top}Z`;
  const back = `M${x + w * 0.2} ${top * 0.9} C${x + w * 0.42} ${top * 0.5} ${x + w * 0.28} -26 ${x + w * 0.26} -13 L${x + w * 0.4} -13 C${x + w * 0.44} -26 ${x + w * 0.66} ${top * 0.5} ${x + w / 2} ${top}Z`;
  const nails = [0, 1, 2].map((i) => `<path d="M${x - w * 0.42 + i * w * 0.32} 0 q${w * 0.1} -${w * 0.2} ${w * 0.2} 0" fill="#efe2bd" ${ink(1.8)}/>`).join("");
  return `<path d="${d}" fill="${fill}"/><path d="${back}" fill="${shade}" opacity=".7"/><path d="${d}" fill="none" ${ink()}/>`
    + `<path d="M${x - w * 0.36} -13 q${w * 0.36} 5 ${w * 0.74} 0" stroke="${INK}" stroke-width="2" fill="none" opacity=".55"/>` + nails;
}

/** Brachiosaurus facing left, about 420 wide and 500 tall, chewing a sprig. */
export function brachiosaurus() {
  const c = { body: "#7fae7d", dark: "#5f8f63", belly: "#c4dca6", spot: "#5c8a60", far: "#5d8a5f" };
  const body = `M-96 -196 C-70 -262 10 -276 70 -252 C120 -232 150 -206 176 -176 C216 -150 262 -120 312 -100 C320 -96 316 -90 306 -92 C256 -98 200 -112 150 -126 C110 -112 40 -104 -20 -108 C-70 -112 -104 -140 -96 -196Z`;
  const spots = [[10, -230, 14, 8], [52, -238, 10, 6], [92, -220, 12, 7], [-30, -236, 9, 6], [130, -196, 9, 5], [200, -150, 8, 5], [240, -128, 6, 4]]
    .map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c.spot}" opacity=".75"/>`).join("");
  const neck = `M-96 -186 C-130 -260 -168 -360 -190 -440 L-150 -452 C-138 -380 -84 -282 -36 -246Z`;
  const head = `<g transform="translate(-178 -452)">`
    + `${sway(3, 3.2)}`
    + `<path d="M28 6 C26 -14 10 -30 -14 -30 C-30 -30 -40 -24 -50 -18 C-64 -14 -78 -10 -82 2 C-84 12 -74 20 -60 20 C-40 22 -12 24 10 22 C22 20 30 16 28 6Z" fill="${c.body}" ${ink()}/>`
    + `<path d="M-14 -30 C-8 -46 12 -46 16 -30 C10 -26 -4 -26 -14 -30Z" fill="${c.dark}" ${ink(2.6)}/>`
    + `<path d="M-80 8 C-60 14 -30 15 -4 12" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    + `<g>${`<animateTransform attributeName="transform" type="rotate" values="0 -60 10;-8 -60 10;0 -60 10" dur="0.9s" repeatCount="indefinite"/>`}`
    + `<path d="M-74 10 C-92 0 -104 -6 -112 2 M-82 12 C-98 18 -108 26 -104 34" stroke="#3e7a32" stroke-width="3" fill="none" stroke-linecap="round"/>`
    + `<ellipse cx="-110" cy="0" rx="9" ry="4" fill="#79b84a" ${ink(1.8)} transform="rotate(-20 -110 0)"/>`
    + `<ellipse cx="-104" cy="34" rx="9" ry="4" fill="#5fa23f" ${ink(1.8)} transform="rotate(30 -104 34)"/></g>`
    + `<ellipse cx="-70" cy="-8" rx="4" ry="2.6" fill="${INK}"/>`
    + eye(-26, -10, 8, c.body, 6.5, 2)
    + `<ellipse cx="4" cy="10" rx="9" ry="5" fill="#e79a8a" opacity=".45"/>`
    + `</g>`;
  return `<g>`
    + leg(-48, -130, 34, c.far, c.dark) + leg(118, -132, 36, c.far, c.dark)
    + leg(-4, -124, 42, c.body, c.dark) + leg(160, -128, 44, c.body, c.dark)
    + `<path d="${body}" fill="${c.body}" ${ink()}/>`
    + `<path d="M-20 -108 C40 -104 110 -112 150 -126 C110 -140 40 -142 -40 -136 C-70 -132 -84 -120 -20 -108Z" fill="${c.belly}"/>`
    + `<path d="M70 -252 C120 -232 150 -206 176 -176 C150 -196 110 -214 60 -224Z" fill="${c.dark}" opacity=".6"/>`
    + spots
    + `<path d="${body}" fill="none" ${ink()}/>`
    + `<g>${`<animateTransform attributeName="transform" type="rotate" values="0 -70 -210;-2.2 -70 -210;0 -70 -210" dur="6s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>`}`
    + `<path d="${neck}" fill="${c.body}" ${ink()}/>`
    + `<path d="M-60 -220 C-98 -270 -130 -350 -150 -440 L-160 -440 C-140 -350 -110 -270 -84 -214Z" fill="${c.belly}" opacity=".9"/>`
    + [-250, -290, -330, -370, -410].map((y, i) => `<path d="M${-104 - i * 14} ${y} q10 -2 18 4" stroke="${c.dark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`).join("")
    + head + `</g>`
    + `<path d="M-30 -150 C-6 -170 24 -160 30 -130" stroke="${c.dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    + `<path d="M126 -170 C160 -184 196 -160 190 -128" stroke="${c.dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    + `</g>`;
}

/** Stegosaurus facing right, about 330 wide, grazing (the head dips). */
export function stegosaurus() {
  const c = { body: "#d08a45", dark: "#a8662d", belly: "#ecc58e", plate: "#c9563a", plateLt: "#ec8a5c", plateFar: "#9b3f2b" };
  const plate = (x, y, s, fill, rot = 0) => `<path d="M${x - 14 * s} ${y} C${x - 16 * s} ${y - 26 * s} ${x - 4 * s} ${y - 44 * s} ${x} ${y - 50 * s} C${x + 6 * s} ${y - 42 * s} ${x + 16 * s} ${y - 24 * s} ${x + 14 * s} ${y}Z" fill="${fill}" ${ink(2.4)} transform="rotate(${rot} ${x} ${y})"/>`;
  const backPts = [[-100, -96, .7, -24], [-70, -122, .9, -16], [-36, -140, 1.1, -8], [2, -148, 1.25, 0], [40, -144, 1.15, 8], [74, -128, 1, 16], [104, -108, .8, 24], [130, -88, .6, 32]];
  const farPlates = backPts.map(([x, y, s, r]) => plate(x + 14, y + 6, s * 0.9, c.plateFar, r)).join("");
  const nearPlates = backPts.filter((_, i) => i % 2 === 0).map(([x, y, s, r]) => plate(x, y + 4, s, c.plate, r)
    + `<path d="M${x - 2} ${y - 8} l2 -${30 * s}" stroke="${c.plateLt}" stroke-width="3" stroke-linecap="round" transform="rotate(${r} ${x} ${y})"/>`).join("");
  const body = `M-150 -64 C-130 -110 -60 -150 10 -150 C80 -150 140 -110 170 -70 C196 -56 230 -50 260 -54 C268 -55 270 -48 262 -44 C232 -32 196 -34 160 -40 C120 -34 60 -30 0 -32 C-60 -34 -110 -40 -150 -64Z`;
  const head = `<g transform="translate(-150 -66)">`
    + `<animateTransform attributeName="transform" type="rotate" values="0;14;14;0;0" keyTimes="0;.25;.55;.8;1" dur="7s" repeatCount="indefinite" additive="sum"/>`
    + `<path d="M8 -6 C-14 -10 -30 -2 -44 8 C-58 14 -66 22 -62 30 C-56 38 -38 34 -24 30 C-8 26 6 14 10 6Z" fill="${c.body}" ${ink()}/>`
    + `<path d="M-58 26 C-44 28 -30 24 -18 20" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    + eye(-30, 10, 5, c.body, 4.5, 1)
    + `<path d="M-66 32 l-8 10 M-60 34 l-4 12 M-70 28 l-12 6" stroke="#4f9a3a" stroke-width="3" stroke-linecap="round"/>`
    + `</g>`;
  // Legs first, then the body lifted onto them, so it stands rather than lies in the grass.
  return `<g>`
    + leg(-80, -66, 26, c.dark, "#8a5122") + leg(110, -64, 30, c.dark, "#8a5122")
    + leg(-54, -62, 30, c.body, c.dark) + leg(136, -60, 34, c.body, c.dark)
    + `<g transform="translate(0 -24)">`
    + farPlates
    + `<path d="${body}" fill="${c.body}" ${ink()}/>`
    + `<path d="M-130 -50 C-60 -36 60 -34 160 -40 C120 -54 0 -60 -110 -60Z" fill="${c.belly}"/>`
    + [[-60, -110], [-10, -122], [40, -116], [90, -96], [-100, -82], [140, -78], [10, -86], [60, -70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${5 + (x % 3)}" fill="${c.dark}" opacity=".7"/>`).join("")
    + `<path d="${body}" fill="none" ${ink()}/>`
    + `<path d="M-74 -46 C-60 -62 -36 -60 -30 -38" stroke="${c.dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    + `<path d="M108 -60 C130 -76 162 -64 162 -40" stroke="${c.dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    + `<g transform="translate(250 -50)">${sway(4, 3.5)}`
    + [[-8, -6, -40], [6, -4, -60], [10, 4, 60], [-4, 6, 40]].map(([x, y, a]) => `<path d="M${x - 4} ${y} L${x} ${y - 24} L${x + 4} ${y}Z" fill="#f4e7c3" ${ink(2)} transform="rotate(${a} ${x} ${y})"/>`).join("")
    + `</g>`
    + nearPlates
    + head
    + `</g></g>`;
}

/**
 * A triceratops facing left (its head at the left, tail at the right), in a 240 x 180 box with
 * its feet at y = 162. The head is drawn facing right and mirrored, so the frill sits behind
 * the face, against the body.
 */
export function triceratops() {
  const c = { body: "#d6904c", dark: "#ad6a30", belly: "#f0cd96", frill: "#e7a35e", frillIn: "#f6c48a", spot: "#b76a2e", rim: "#9b5a28" };
  const scallops = [[30, 52], [24, 76], [28, 100], [42, 120], [44, 32], [62, 18], [84, 14]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" fill="${c.rim}" ${ink(2.6)}/>`).join("");
  return `<g>`
    + `<g transform="translate(0 4)">`
    + `<g transform="translate(206 104)">${sway(7, 1.8)}<path d="M-14 -10 C10 -14 26 -2 34 18 C24 10 8 6 -12 12Z" fill="${c.dark}" ${ink()}/></g>`
    + `<path d="M150 128 l-2 30 h26 l-2 -30z M196 124 l0 34 h24 l-2 -34z" fill="${c.dark}" ${ink()}/>`
    + `<path d="M98 76 C120 52 190 50 214 80 C230 100 226 132 200 138 C170 146 120 146 104 132 C92 120 88 96 98 76Z" fill="${c.body}" ${ink()}/>`
    + `<path d="M108 128 C130 140 180 140 204 130 C180 120 130 118 108 128Z" fill="${c.belly}"/>`
    + [[150, 72, 9], [178, 76, 7], [196, 92, 6], [130, 80, 6], [166, 96, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.spot}" opacity=".7"/>`).join("")
    + `<path d="M98 76 C120 52 190 50 214 80 C230 100 226 132 200 138 C170 146 120 146 104 132 C92 120 88 96 98 76Z" fill="none" ${ink()}/>`
    + `<path d="M112 132 l-2 30 h28 l-2 -30z M168 134 l0 28 h26 l-2 -30z" fill="${c.body}" ${ink()}/>`
    + [112, 168].map((x) => [0, 1, 2].map((i) => `<path d="M${x + 1 + i * 9} 162 q3 -6 7 0" fill="#f4e7c3" ${ink(1.8)}/>`).join("")).join("")
    + `<g transform="translate(118 92)">${`<animateTransform attributeName="transform" type="rotate" values="0;4;0;-3;0" dur="5s" repeatCount="indefinite" additive="sum"/>`}<g transform="translate(-118 -92)">`
    + `<g transform="translate(190 0) scale(-1 1)">`
    + scallops
    + `<path d="M84 14 C120 18 134 60 128 92 C122 120 96 134 70 128 C44 122 24 96 26 70 C28 40 52 12 84 14Z" fill="${c.frill}" ${ink()}/>`
    + `<path d="M82 30 C106 34 116 62 112 86 C106 108 88 116 70 112 C52 108 40 90 42 72 C44 50 62 28 82 30Z" fill="${c.frillIn}"/>`
    + [[66, 48], [92, 46], [100, 72], [58, 74], [76, 98]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${c.frill}"/>`).join("")
    + `<path d="M96 98 C120 92 150 98 160 112 C166 124 158 138 140 140 C120 142 98 138 90 126 C84 116 86 102 96 98Z" fill="${c.body}" ${ink()}/>`
    + `<path d="M104 92 C102 70 104 50 112 30 C120 48 122 70 120 92Z" fill="#fbf3dd" ${ink(2.6)}/>`
    + `<path d="M110 88 L113 40" stroke="#d8c391" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="M130 94 C132 74 138 56 150 40 C152 60 148 78 144 96Z" fill="#fbf3dd" ${ink(2.6)}/>`
    + `<path d="M154 110 C160 104 168 100 176 100 C172 108 166 114 158 118Z" fill="#fbf3dd" ${ink(2.4)}/>`
    + `<path d="M158 118 C172 118 182 126 180 134 C176 142 162 142 152 138Z" fill="#7a4b22" ${ink(2.6)}/>`
    + `<path d="M120 132 C132 138 146 138 154 134" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
    + `<ellipse cx="118" cy="122" rx="8" ry="5" fill="#ef8f7a" opacity=".55"/>`
    + eye(128, 110, 8, c.body, 4.2, 0.5)
    + `</g></g></g></g></g>`;
}

/** The raptor peeking over the card's top-right corner, facing left, in a 210 x 160 box. */
export function raptorPeek() {
  const c = { body: "#5fae4e", dark: "#3f8a3a", belly: "#b7e07a", stripe: "#2f6f33", crest: "#e86a3c", crestLt: "#f6a35a" };
  return `<svg viewBox="0 0 210 160">`
    + `<g id="raptorHead">`
    + `<path d="M150 160 C152 126 146 100 130 80 L170 70 C188 96 194 128 192 160Z" fill="${c.body}" ${ink()}/>`
    + `<path d="M160 160 C160 130 156 108 146 90 L158 88 C168 108 172 132 172 160Z" fill="${c.belly}"/>`
    + [100, 116, 132].map((y) => `<path d="M${178 - (y - 100) * 0.2} ${y} q-10 4 -16 12" stroke="${c.stripe}" stroke-width="5" fill="none" stroke-linecap="round"/>`).join("")
    + `<g>${`<animateTransform attributeName="transform" type="rotate" values="0 150 90;-5 150 90;0 150 90;3 150 90;0 150 90" dur="6s" repeatCount="indefinite"/>`}`
    + [[118, 28, -40], [132, 22, -20], [146, 22, 0], [158, 28, 20]].map(([x, y, a]) => `<path d="M${x} ${y + 12} C${x - 6} ${y - 6} ${x + 2} ${y - 18} ${x + 6} ${y - 22} C${x + 10} ${y - 10} ${x + 10} ${y + 4} ${x + 6} ${y + 12}Z" fill="${c.crest}" ${ink(2.4)} transform="rotate(${a} ${x + 4} ${y + 12})"/>`).join("")
    + `<path d="M174 64 C176 40 156 28 132 30 C110 32 94 40 76 48 C52 52 26 58 14 70 C6 80 12 92 26 96 C50 102 84 104 112 102 C140 100 170 90 174 64Z" fill="${c.body}" ${ink()}/>`
    + `<path d="M132 30 C150 30 166 38 172 52 C156 44 138 42 120 44Z" fill="${c.dark}"/>`
    + `<path d="M118 48 l14 -6 M136 42 l14 -2 M100 52 l12 -6" stroke="${c.stripe}" stroke-width="4" stroke-linecap="round"/>`
    + `<path d="M18 84 C46 92 86 94 116 90" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    + [30, 44, 58, 72, 86, 100].map((x, i) => `<path d="M${x} ${86 + i * 0.6} l4 8 l4 -7.5" fill="#fffbea" ${ink(1.6)}/>`).join("")
    + `<path d="M26 96 C50 102 84 104 112 102" stroke="${INK}" stroke-width="2" fill="none" opacity=".5"/>`
    + `<ellipse cx="24" cy="70" rx="5" ry="3.4" fill="${INK}"/>`
    + `<path d="M100 54 C108 46 126 44 136 50" stroke="${INK}" stroke-width="4.4" fill="none" stroke-linecap="round"/>`
    + eye(118, 66, 11, c.body, 4.8, 1.2, "raptorPupil")
    + `<ellipse cx="146" cy="84" rx="9" ry="5" fill="#ef8f7a" opacity=".45"/>`
    + `</g></g>`
    + `<g transform="translate(120 150)">`
    + `<ellipse cx="0" cy="0" rx="14" ry="10" fill="${c.body}" ${ink()}/>`
    + [-10, -2, 7].map((x) => `<path d="M${x} 4 q-3 10 -9 12" stroke="#fffbea" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M${x} 4 q-3 10 -9 12" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".6"/>`).join("")
    + `</g>`
    + `</svg>`;
}

/** A pteranodon flying left to right, wings flapping, about 220 wide. */
export function pteranodon(color = "#c9774a", dark = "#9a5530", wing = "#e0a172") {
  const wingL = `<g><animateTransform attributeName="transform" type="scale" values="1 1;1 -0.3;1 1" dur="1.2s" repeatCount="indefinite" calcMode="spline" keySplines=".5 0 .5 1;.5 0 .5 1"/>`
    + `<path d="M-6 -2 C-30 -40 -70 -62 -108 -58 C-92 -40 -70 -20 -40 -6 C-30 -2 -16 2 -6 2Z" fill="${wing}" ${ink(2.6)}/>`
    + `<path d="M-12 -6 C-40 -36 -70 -52 -100 -55" stroke="${dark}" stroke-width="2.4" fill="none"/></g>`;
  const wingR = `<g><animateTransform attributeName="transform" type="scale" values="1 1;1 -0.3;1 1" dur="1.2s" repeatCount="indefinite" calcMode="spline" keySplines=".5 0 .5 1;.5 0 .5 1"/>`
    + `<path d="M6 -2 C30 -40 70 -62 108 -58 C92 -40 70 -20 40 -6 C30 -2 16 2 6 2Z" fill="${wing}" ${ink(2.6)}/>`
    + `<path d="M12 -6 C40 -36 70 -52 100 -55" stroke="${dark}" stroke-width="2.4" fill="none"/></g>`;
  return `<g>${wingL}`
    + `<path d="M-22 4 C-10 -8 14 -8 26 2 C14 12 -10 14 -22 4Z" fill="${color}" ${ink(2.6)}/>`
    + `<g transform="translate(24 0)"><path d="M0 0 C10 -8 20 -10 28 -8 L66 -2 L28 4 C20 6 8 6 0 0Z" fill="${color}" ${ink(2.4)}/>`
    + `<path d="M16 -8 C8 -22 -6 -30 -20 -32 C-8 -22 0 -14 6 -6Z" fill="${dark}" ${ink(2.2)}/>`
    + `<circle cx="20" cy="-3" r="2.4" fill="${INK}"/></g>`
    + `${wingR}</g>`;
}

/** A tiny far-off pterosaur: a flapping V. */
export function birdV(dur = 0.9) {
  return `<path stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round" d="M-12 -4 Q-6 -8 0 0 Q6 -8 12 -4">`
    + `<animate attributeName="d" values="M-12 -4 Q-6 -8 0 0 Q6 -8 12 -4;M-12 4 Q-6 -2 0 0 Q6 -2 12 4;M-12 -4 Q-6 -8 0 0 Q6 -8 12 -4" dur="${dur}s" repeatCount="indefinite"/></path>`;
}

/**
 * Meganeura, a giant dragonfly, hovering, with its head up (y < 0). Each wing hinges at its own
 * root on the thorax: the forewings sweep forward and the hindwings back, so no two wings
 * cross, and they flicker by narrowing. About 120 wide.
 */
export function dragonfly() {
  const wing = (side, rootY, len, sweep, delay) => {
    const rx = len / 2, ry = len * 0.15;
    const cx = side * (4 + rx);
    return `<g transform="rotate(${side * sweep} ${side * 4} ${rootY})">`
      + `<ellipse cx="${cx}" cy="${rootY}" rx="${rx}" ry="${ry}" fill="#dff4ff" fill-opacity=".6" ${ink(1.6)}>`
      + `<animate attributeName="ry" values="${ry};${(ry * 0.3).toFixed(1)};${ry}" dur="0.12s" begin="${delay}s" repeatCount="indefinite"/></ellipse>`
      + `<path d="M${side * 6} ${rootY} H${side * (2 + len)}" stroke="#7fb8c8" stroke-width="1.2"/></g>`;
  };
  return `<g>${bob(-6, 2.2)}`
    + wing(-1, 0, 52, -14, 0) + wing(1, 0, 52, -14, 0.03)
    + wing(-1, 12, 46, 12, 0.06) + wing(1, 12, 46, 12, 0.09)
    + `<path d="M0 -2 L0 56" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`
    + `<path d="M0 -2 L0 56" stroke="#3aa0a8" stroke-width="4" stroke-linecap="round"/>`
    + [18, 26, 34, 42, 50].map((y) => `<path d="M-2 ${y} h4" stroke="${INK}" stroke-width="1.4"/>`).join("")
    + `<ellipse cx="0" cy="6" rx="5" ry="9" fill="#2f7f86" ${ink(2)}/>`
    + `<circle cx="0" cy="-8" r="7" fill="#2f7f86" ${ink(2)}/><circle cx="-3" cy="-10" r="2" fill="#fff"/>`
    + `</g>`;
}

/** A nest of twigs with three eggs; the middle one wobbles and shows a crack. About 150 wide. */
export function nest() {
  let twigs = "";
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI;
    const x1 = -70 + i * 10, y1 = -6 + Math.sin(a) * 6;
    twigs += `<path d="M${x1} ${y1} q${30 - i * 4} ${-8 + (i % 3) * 5} ${60 - i * 7} ${2}" stroke="${i % 2 ? "#8a5a2b" : "#6b4220"}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  }
  const egg = (x, s, fill, spots, extra = "") => `<g transform="translate(${x} -14)">${extra}`
    + `<path d="M0 ${-46 * s} C${18 * s} ${-46 * s} ${26 * s} ${-14 * s} ${24 * s} 0 C${22 * s} ${12 * s} ${-22 * s} ${12 * s} ${-24 * s} 0 C${-26 * s} ${-14 * s} ${-18 * s} ${-46 * s} 0 ${-46 * s}Z" fill="${fill}" ${ink(2.6)}/>`
    + spots.map(([sx, sy, r]) => `<circle cx="${sx * s}" cy="${sy * s}" r="${r * s}" fill="#b98a4a" opacity=".6"/>`).join("")
    + `<path d="M${-12 * s} ${-30 * s} q4 -8 10 -10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>`
    + `</g>`;
  const wobble = `<animateTransform attributeName="transform" type="rotate" values="0;0;-9;8;-6;4;0;0" keyTimes="0;.6;.66;.72;.78;.84;.9;1" dur="6s" repeatCount="indefinite" additive="sum"/>`;
  return `<g>`
    + `<ellipse cx="0" cy="-4" rx="78" ry="16" fill="#5a3818" ${ink(2.6)}/>`
    + egg(-40, 0.85, "#f5ecd2", [[-6, -24, 3], [8, -10, 4], [-10, -4, 2]])
    + egg(36, 0.8, "#e9f0d4", [[6, -26, 3], [-8, -12, 3]])
    + egg(0, 1, "#fbf3dd", [[8, -30, 4], [-10, -18, 3], [10, -6, 3]], wobble + `<path d="M-14 -20 l6 -6 l4 6 l6 -7 l5 6" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linejoin="round"/>`)
    + twigs
    + `<path d="M-78 -4 C-60 12 60 12 78 -4" stroke="${INK}" stroke-width="2.6" fill="none"/>`
    + `</g>`;
}

/** A fossil skeleton lying in the rock, drawn in bone colour. About 360 wide. */
export function fossilSkeleton() {
  const bone = "#efe0b9", line = "#a48a5f";
  let spine = "";
  const pts = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const x = -150 + t * 330;
    const y = -40 + Math.sin(t * Math.PI * 1.1 - 0.3) * -26 + t * 30;
    pts.push([x, y]);
  }
  pts.forEach(([x, y], i) => { spine += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(6 - i * 0.15).toFixed(1)}" ry="${(4.5 - i * 0.1).toFixed(1)}" fill="${bone}" stroke="${line}" stroke-width="1.6"/>`; });
  let ribs = "";
  for (let i = 5; i < 13; i++) {
    const [x, y] = pts[i];
    ribs += `<path d="M${x.toFixed(1)} ${(y + 4).toFixed(1)} q${6 + i} ${18 + i} ${-4 + i * 0.6} ${34 - Math.abs(i - 9) * 2.5}" stroke="${bone}" stroke-width="4.2" fill="none" stroke-linecap="round"/>`;
  }
  const [hx, hy] = pts[0];
  const skull = `<g transform="translate(${hx - 10} ${hy - 6}) rotate(-12)">`
    + `<path d="M0 0 C-10 -16 -36 -20 -58 -12 C-70 -8 -76 2 -70 10 C-60 18 -30 18 -10 14 C0 12 4 6 0 0Z" fill="${bone}" stroke="${line}" stroke-width="2"/>`
    + `<circle cx="-22" cy="-4" r="5" fill="#6b4a2a"/><path d="M-60 6 h40" stroke="${line}" stroke-width="2"/>`
    + [-56, -48, -40, -32].map((x) => `<path d="M${x} 6 l2 5 l2 -5" stroke="${line}" stroke-width="1.4" fill="${bone}"/>`).join("")
    + `</g>`;
  const legBones = `<path d="M${pts[13][0]} ${pts[13][1] + 6} l10 30 l-14 26 l12 2" stroke="${bone}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M${pts[6][0]} ${pts[6][1] + 10} l-6 22 l8 12" stroke="${bone}" stroke-width="4.6" fill="none" stroke-linecap="round"/>`;
  return `<g opacity=".92">${ribs}${legBones}${spine}${skull}</g>`;
}

/** An ammonite (spiral shell) of radius r. */
export function ammonite(r, color = "#d9c08c", line = "#8f7444") {
  let d = "";
  const turns = 3.2;
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const a = t * turns * Math.PI * 2;
    const rr = r * Math.pow(t, 0.9);
    d += `${i ? "L" : "M"}${(Math.cos(a) * rr).toFixed(1)} ${(Math.sin(a) * rr).toFixed(1)}`;
  }
  let ribs = "";
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    ribs += `<path d="M${(Math.cos(a) * r * 0.55).toFixed(1)} ${(Math.sin(a) * r * 0.55).toFixed(1)} L${(Math.cos(a) * r * 0.95).toFixed(1)} ${(Math.sin(a) * r * 0.95).toFixed(1)}" stroke="${line}" stroke-width="1.3"/>`;
  }
  return `<g><circle r="${r}" fill="${color}" stroke="${line}" stroke-width="2"/>${ribs}<path d="${d}" stroke="${line}" stroke-width="2" fill="none"/></g>`;
}

/** A loose bone, about 90 wide. */
export function bone(len = 90, color = "#f6ecd0") {
  const h = len / 2;
  return `<g><path d="M${-h + 10} -5 L${h - 10} -5 M${-h + 10} 5 L${h - 10} 5" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`
    + `<rect x="${-h + 8}" y="-6" width="${len - 16}" height="12" fill="${color}"/>`
    + [[-h + 8, -7], [-h + 8, 7], [h - 8, -7], [h - 8, 7]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="${color}" ${ink(2.6)}/>`).join("")
    + `<rect x="${-h + 8}" y="-6" width="${len - 16}" height="12" fill="${color}"/>`
    + `<path d="M${-h + 14} -2 H${h - 20}" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`
    + `</g>`;
}
