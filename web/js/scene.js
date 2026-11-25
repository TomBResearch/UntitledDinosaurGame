// The animated valley behind the login card, drawn as one SVG (1920 x 1080, anchored to the
// bottom and cropped at the sides on narrow screens). Layers from far to near, each with a
// parallax depth: sky, clouds, mountains and the volcano, far hills with forest and a herd,
// mid hills with trees and dinosaurs, the ground (a cut-away of rock with fossils), and
// foreground ferns. Detail that repeats (grass, needles, leaflets) is generated, with a fixed
// seed so the valley is the same on every visit.

import { rng, smooth, ridgePoints, hill, sway, bob, tuft, rock, cloud, conifer, cycad, treeFern, fernClump, INK } from "./svg.js";
import { brachiosaurus, stegosaurus, triceratops, pteranodon, birdV, dragonfly, nest, fossilSkeleton, ammonite, bone } from "./critters.js";

const W = 1920, H = 1080;
const at = (x, y, s, inner, extra = "") => `<g transform="translate(${x} ${y})${s !== 1 ? ` scale(${s})` : ""}"${extra}>${inner}</g>`;
const layer = (depth, inner) => `<g class="layer" data-depth="${depth}">${inner}</g>`;

function defs() {
  return `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6fc0dc"/><stop offset=".38" stop-color="#a9dfe0"/>
      <stop offset=".62" stop-color="#dff0c6"/><stop offset=".78" stop-color="#f7dc95"/><stop offset="1" stop-color="#f2b866"/>
    </linearGradient>
    <radialGradient id="sunGlow"><stop offset="0" stop-color="#fff6c8" stop-opacity=".95"/><stop offset=".35" stop-color="#ffe58a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd36a" stop-opacity="0"/></radialGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6e2a8" stop-opacity="0"/><stop offset="1" stop-color="#f6e2a8" stop-opacity=".75"/></linearGradient>
    <linearGradient id="lava" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe46b"/><stop offset=".5" stop-color="#ff9a2a"/><stop offset="1" stop-color="#e2431f"/></linearGradient>
    <radialGradient id="craterGlow"><stop offset="0" stop-color="#ffd25a" stop-opacity=".95"/><stop offset=".5" stop-color="#ff7a1a" stop-opacity=".5"/><stop offset="1" stop-color="#ff5a10" stop-opacity="0"/></radialGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfeaf2"/><stop offset="1" stop-color="#6fc4d8"/></linearGradient>
    <linearGradient id="dirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b5a2b"/><stop offset=".3" stop-color="#734820"/><stop offset=".65" stop-color="#5c391a"/><stop offset="1" stop-color="#3f2711"/></linearGradient>
    <linearGradient id="rays" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4c2" stop-opacity=".5"/><stop offset="1" stop-color="#fff4c2" stop-opacity="0"/></linearGradient>
  </defs>`;
}

function sky() {
  let rays = "";
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 360;
    rays += `<path d="M0 -150 L14 -250 L-14 -250Z" fill="#fff2b0" opacity=".55" transform="rotate(${a})"/>`;
  }
  const sun = at(1620, 150, 1,
    `<circle r="330" fill="url(#sunGlow)"/>`
    + `<g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="120s" repeatCount="indefinite"/>${rays}</g>`
    + `<circle r="104" fill="#ffe27a" stroke="#f3b63a" stroke-width="6"/>`
    + `<circle r="84" fill="#fff0a6"/><circle cx="-34" cy="-30" r="20" fill="#fffbe0" opacity=".8"/>`);
  // Soft beams of light falling from the sun across the valley.
  let beams = "";
  [[-24, 260, 9], [-34, 180, 12], [-46, 220, 10]].forEach(([a, w, d], i) => {
    beams += `<path d="M0 0 L${-w / 2} 1400 L${w / 2} 1400Z" fill="url(#rays)" transform="translate(1620 150) rotate(${a})" opacity=".35">`
      + `<animate attributeName="opacity" values=".15;.4;.15" dur="${d}s" begin="${-i * 3}s" repeatCount="indefinite"/></path>`;
  });
  return `<rect width="${W}" height="${H}" fill="url(#sky)"/>${sun}${beams}`;
}

function clouds(rnd) {
  let out = "";
  const list = [[90, 330, 180], [200, 240, 220], [150, 420, 260], [300, 200, 160], [60, 260, 300], [250, 300, 200]];
  list.forEach(([y, w, dur], i) => {
    const start = -w - 60, end = W + 60;
    const offset = (i / list.length) * dur;
    out += `<g opacity="${(0.75 + rnd() * 0.25).toFixed(2)}"><animateTransform attributeName="transform" type="translate" from="${start} ${y}" to="${end} ${y}" dur="${dur}s" begin="${-offset}s" repeatCount="indefinite"/>${cloud(rnd, w)}</g>`;
  });
  return out;
}

function mountains(rnd) {
  const far = ridgePoints(rnd, -100, W + 100, 560, 110, 40);
  const near = ridgePoints(rnd, -100, W + 100, 640, 80, 46);
  // Snow-free hazy ranges with a lighter sunlit edge on the left of each peak.
  return `<path d="${hill(far, 760)}" fill="#a9c9b4"/>`
    + `<path d="${smooth(far)}" fill="none" stroke="#c9e0c6" stroke-width="4" opacity=".8"/>`
    + `<path d="${hill(near, 780)}" fill="#8fb79d"/>`
    + `<path d="${smooth(near)}" fill="none" stroke="#b5d4b4" stroke-width="4" opacity=".8"/>`
    + `<rect y="520" width="${W}" height="260" fill="url(#haze)"/>`;
}

function volcano(rnd) {
  const g = [];
  const body = `M-330 290 C-250 200 -150 40 -64 -150 C-52 -170 -36 -176 -20 -170 L20 -170 C36 -178 54 -170 64 -150 C150 30 250 200 340 290Z`;
  g.push(`<path d="${body}" fill="#7a5a46" ${`stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"`}/>`);
  // Shadowed right flank and rock strata.
  g.push(`<path d="M20 -170 C36 -178 54 -170 64 -150 C150 30 250 200 340 290 L120 290 C100 160 70 20 20 -170Z" fill="#5c4234"/>`);
  for (let i = 0; i < 7; i++) {
    const y = -90 + i * 52;
    const half = 70 + i * 40;
    g.push(`<path d="M${-half} ${y} q${half * 0.5} ${-10 + (i % 2) * 14} ${half} ${4} q${half * 0.5} ${8} ${half} ${-6}" stroke="#4a3428" stroke-width="3" fill="none" opacity=".55" stroke-linecap="round"/>`);
  }
  g.push(`<path d="M-56 -140 C-110 -10 -170 120 -230 230" stroke="#9a7860" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>`);
  // Lava channels with flowing dashes, and a glowing crater.
  const flows = [
    "M-14 -166 C-30 -100 -40 -40 -80 30 C-100 70 -120 120 -150 170",
    "M10 -166 C20 -110 40 -60 30 0 C24 50 50 110 60 160",
    "M-4 -166 C-8 -120 -20 -90 -10 -40",
  ];
  flows.forEach((d, i) => {
    g.push(`<path d="${d}" stroke="#4a2414" stroke-width="${16 - i * 3}" fill="none" stroke-linecap="round"/>`);
    g.push(`<path d="${d}" stroke="url(#lava)" stroke-width="${10 - i * 2}" fill="none" stroke-linecap="round"/>`);
    g.push(`<path d="${d}" stroke="#fff2a0" stroke-width="${4 - i}" fill="none" stroke-linecap="round" stroke-dasharray="14 22" opacity=".9"><animate attributeName="stroke-dashoffset" from="0" to="-72" dur="${3 + i * 1.4}s" repeatCount="indefinite"/></path>`);
  });
  g.push(`<ellipse cx="0" cy="-172" rx="62" ry="16" fill="#3a1d10" stroke="${INK}" stroke-width="3"/>`);
  g.push(`<ellipse cx="0" cy="-172" rx="140" ry="90" fill="url(#craterGlow)"><animate attributeName="opacity" values="1;.55;1" dur="2.6s" repeatCount="indefinite"/></ellipse>`);
  g.push(`<ellipse cx="0" cy="-170" rx="48" ry="10" fill="#ffb23a"/>`);
  // Smoke: puffs rise, drift left, grow and fade, staggered so the plume never empties.
  let smoke = "";
  for (let i = 0; i < 9; i++) {
    const dur = 9 + (i % 3) * 2;
    const begin = -(i * dur) / 9;
    const r = 30 + (i % 4) * 8;
    smoke += `<g><animateTransform attributeName="transform" type="translate" values="0 -180;-60 -360;-150 -560" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`
      + `<g><animateTransform attributeName="transform" type="scale" values=".4;1.2;2" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`
      + `<g stroke="${INK}" stroke-width="2.6"><circle r="${r}" fill="#8c7d74"/><circle cx="${r * 0.7}" cy="${r * 0.2}" r="${r * 0.6}" fill="#8c7d74"/><circle cx="${-r * 0.75}" cy="${r * 0.25}" r="${r * 0.55}" fill="#8c7d74"/></g>`
      + `<circle r="${r - 1.5}" fill="#8c7d74"/><circle cx="${r * 0.7}" cy="${r * 0.2}" r="${r * 0.6 - 1.5}" fill="#8c7d74"/><circle cx="${-r * 0.75}" cy="${r * 0.25}" r="${r * 0.55 - 1.5}" fill="#8c7d74"/>`
      + `<circle cx="${-r * 0.2}" cy="${-r * 0.25}" r="${r * 0.62}" fill="#b2a59b"/><circle cx="${-r * 0.35}" cy="${-r * 0.42}" r="${r * 0.26}" fill="#d8cfc6"/>`
      + `<animate attributeName="opacity" values="0;.85;.6;0" keyTimes="0;.15;.6;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></g></g>`;
  }
  // Fireballs now and then.
  let embers = "";
  [[-40, -120, 7, 0], [50, -140, 9, 3.5], [10, -150, 11, 6]].forEach(([dx, dy, dur, delay]) => {
    embers += `<circle r="7" fill="#ffd24a" stroke="#c2410c" stroke-width="2.4" opacity="0">`
      + `<animateMotion path="M0 -172 Q${dx} ${-172 + dy} ${dx * 2.4} -60" dur="${dur}s" begin="${-delay}s" repeatCount="indefinite" keyPoints="0;0;1" keyTimes="0;.8;1" calcMode="linear"/>`
      + `<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.8;.82;.97;1" dur="${dur}s" begin="${-delay}s" repeatCount="indefinite"/></circle>`;
  });
  return at(420, 520, 0.95, smoke + g.join("") + embers);
}

function waterfall(rnd) {
  // A stepped rock cliff with ledges and moss, the falls pouring from a notch into a pool.
  const cliff = `M-170 230 L-176 140 C-170 100 -150 80 -150 50 C-150 20 -130 0 -120 -24 C-110 -50 -80 -66 -54 -64 L-30 -70 C-10 -76 20 -74 34 -66 L60 -62 C90 -66 118 -50 126 -24 C140 6 150 30 152 60 C158 96 170 120 172 150 L176 230Z`;
  const blocks = [
    "M-150 50 C-120 46 -90 52 -60 48", "M-176 140 C-140 132 -110 140 -70 134", "M60 40 C90 36 120 42 150 40",
    "M80 120 C110 114 140 122 170 118", "M-120 -24 C-96 -30 -70 -24 -54 -30", "M70 -20 C90 -26 110 -22 126 -24",
    "M-110 90 l-8 30", "M-80 170 l6 40", "M120 70 l6 30", "M100 160 l-4 40",
  ].map((d) => `<path d="${d}" stroke="#4a5640" stroke-width="3" fill="none" stroke-linecap="round"/>`).join("");
  let streams = "";
  [-18, -4, 10, 24].forEach((x, i) => {
    streams += `<path d="M${x} -62 C${x + 2} 20 ${x - 4} 100 ${x + 2} 196" stroke="#e9fbff" stroke-width="${i % 2 ? 4 : 6}" stroke-dasharray="26 18" fill="none" stroke-linecap="round" opacity=".9"><animate attributeName="stroke-dashoffset" from="0" to="-88" dur="${1 + i * 0.15}s" repeatCount="indefinite"/></path>`;
  });
  let splash = "";
  for (let i = 0; i < 5; i++) {
    splash += `<circle cx="${-30 + i * 15}" cy="200" r="${10 + (i % 2) * 6}" fill="#ffffff" stroke="${INK}" stroke-width="2"><animate attributeName="r" values="${8 + (i % 3) * 3};${16 + (i % 2) * 5};${8 + (i % 3) * 3}" dur="${1.2 + i * 0.2}s" repeatCount="indefinite"/></circle>`;
  }
  // Moss and little plants along the top.
  let moss = `<path d="M-124 -26 C-110 -56 -80 -70 -54 -66 L-30 -72 C-10 -78 20 -76 34 -68 L60 -64 C90 -68 118 -52 128 -26 C110 -36 90 -40 60 -44 L-60 -46 C-90 -44 -110 -36 -124 -26Z" fill="#5f9f4a" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`;
  for (let x = -110; x <= 110; x += 22) moss += tuft(rnd, x, -48 - Math.cos(x / 80) * 14, 18, ["#4c8c3c", "#6fb04e"]);
  moss += at(-96, -40, 0.5, fernClump(rnd, { count: 5, length: 70, spread: 2.2, bendSpread: 1.6, leaf: 16, leaflets: 10, colors: { dark: "#2f7a36", mid: "#48a043", light: "#9bd36a", rib: "#5b8a2a" }, outline: true }));
  moss += at(104, -38, 0.45, fernClump(rnd, { count: 5, length: 70, spread: 2.2, bendSpread: 1.6, leaf: 16, leaflets: 10, colors: { dark: "#2f7a36", mid: "#48a043", light: "#9bd36a", rib: "#5b8a2a" }, outline: true }));
  return at(1600, 520, 0.85,
    `<path d="${cliff}" fill="#8c9878" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`
    + `<path d="M40 -66 L60 -62 C90 -66 118 -50 126 -24 C140 6 150 30 152 60 C158 96 170 120 172 150 L176 230 L70 230 C80 140 70 40 40 -66Z" fill="#6d7a5c"/>`
    + `<path d="M-150 50 C-150 20 -130 0 -120 -24 M-176 140 C-170 100 -150 80 -150 50" stroke="#b5c2a0" stroke-width="5" fill="none" stroke-linecap="round"/>`
    + blocks
    + `<path d="M-36 -66 C-38 20 -42 120 -42 200 L42 200 C42 120 40 20 38 -66Z" fill="url(#water)" stroke="${INK}" stroke-width="2.6"/>`
    + streams + moss + splash
    + `<ellipse cx="0" cy="216" rx="130" ry="20" fill="#6fc4d8" stroke="${INK}" stroke-width="2.6"/>`
    + `<path d="M-80 214 h40 M10 219 h50 M-20 226 h30" stroke="#e9fbff" stroke-width="3" stroke-linecap="round"><animate attributeName="opacity" values="1;.4;1" dur="2s" repeatCount="indefinite"/></path>`);
}

function farHills(rnd) {
  const pts = ridgePoints(rnd, -100, W + 100, 735, 40, 50);
  let out = `<path d="${hill(pts, 900)}" fill="#7db26a"/>`
    + `<path d="${smooth(pts)}" fill="none" stroke="#a6d08a" stroke-width="5"/>`;
  // A forest of small conifers standing on the ridge, darker and without outlines (distance).
  const yAt = (x) => {
    for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return pts[pts.length - 1][1];
  };
  for (let x = -40; x < W + 40; x += 22 + rnd() * 30) {
    if (x > 230 && x < 640) continue; // keep the volcano's foot clear
    const h = 50 + rnd() * 60;
    out += at(x.toFixed(0), (yAt(x) + 16).toFixed(0), 1, conifer(rnd, h, { trunk: "#4d6e45", dark: "#4f8a4e", mid: "#5f9a57", light: "#7db26a" }, false));
  }
  return out;
}

function herd() {
  // A few distant brachiosaurs walking slowly along the far hills.
  const one = (s, d) => `<g transform="scale(${s})">${`<animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="${d}s" repeatCount="indefinite" additive="sum"/>`}`
    + `<path d="M-40 -20 C-30 -44 10 -48 34 -34 C46 -28 60 -20 80 -16 C64 -12 50 -12 36 -14 L34 0 L26 0 L24 -12 L-14 -12 L-16 0 L-24 0 L-26 -14 C-34 -16 -40 -18 -40 -20Z M-34 -30 C-44 -60 -54 -84 -66 -96 L-58 -100 C-44 -86 -34 -64 -24 -36Z" fill="#5d8f5c"/>`
    + `<ellipse cx="-64" cy="-98" rx="8" ry="5" fill="#5d8f5c"/></g>`;
  return `<g><animateTransform attributeName="transform" type="translate" from="2100 742" to="-300 742" dur="260s" repeatCount="indefinite"/>`
    + at(0, 0, 1, one(0.9, 1.6)) + at(120, 6, 1, one(0.7, 1.4)) + at(210, 2, 1, one(0.8, 1.7)) + `</g>`;
}

function midHills(rnd) {
  const pts = ridgePoints(rnd, -100, W + 100, 832, 34, 46);
  let out = `<path d="${hill(pts, 1000)}" fill="#5f9f4a" stroke="${INK}" stroke-width="3"/>`
    + `<path d="${smooth(pts.map(([x, y]) => [x, y + 10]))}" fill="none" stroke="#7fbf5a" stroke-width="10" stroke-linecap="round" opacity=".8"/>`;
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W;
    out += tuft(rnd, x, 850 + rnd() * 60, 14 + rnd() * 10, ["#4c8c3c", "#6fb04e", "#3f7c35"]);
  }
  return out;
}

function midTrees(rnd) {
  const conC = { trunk: "#6b4524", dark: "#2f6b36", mid: "#3f8a3f", light: "#6cb257" };
  const fernC = { trunk: "#7a4e28", trunkDark: "#4e3016", leaves: { dark: "#2f7a36", mid: "#48a043", light: "#9bd36a", rib: "#5b8a2a" } };
  const cycC = { trunk: "#8a5a2e", trunkDark: "#5b3a1a", leaves: { dark: "#2c7234", mid: "#4f9f3f", light: "#a6d870", rib: "#5c7a28" } };
  let out = "";
  out += at(1330, 880, 1, conifer(rnd, 470, conC));
  out += at(120, 870, 1, conifer(rnd, 360, conC));
  out += at(1820, 880, 1, conifer(rnd, 300, conC));
  out += at(640, 870, 1, treeFern(rnd, 200, fernC));
  out += at(1210, 878, 1, treeFern(rnd, 170, fernC));
  out += at(560, 890, 1, cycad(rnd, 120, cycC));
  out += at(1740, 900, 1, cycad(rnd, 100, cycC));
  return out;
}

function ground(rnd) {
  const pts = ridgePoints(rnd, -100, W + 100, 912, 12, 40);
  let out = `<path d="${hill(pts, H + 10)}" fill="url(#dirt)" stroke="${INK}" stroke-width="3.2"/>`;
  // Strata: wavy bands of darker and lighter rock.
  [950, 990, 1030, 1066].forEach((y, i) => {
    const band = ridgePoints(rnd, -100, W + 100, y, 6, 30);
    out += `<path d="${smooth(band)}" fill="none" stroke="${i % 2 ? "#9b6a38" : "#3f2711"}" stroke-width="${i % 2 ? 3 : 4}" opacity=".6"/>`;
  });
  // Pebbles in the rock.
  for (let i = 0; i < 60; i++) {
    const x = rnd() * W, y = 930 + rnd() * 150, r = 3 + rnd() * 6;
    out += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${r.toFixed(1)}" ry="${(r * 0.7).toFixed(1)}" fill="${rnd.pick(["#a07a52", "#8c6440", "#b8936a"])}" opacity=".85"/>`;
  }
  // Fossils.
  out += at(1340, 1010, 0.85, fossilSkeleton());
  out += at(420, 1020, 1, ammonite(26));
  out += at(1760, 1046, 1, ammonite(18));
  out += at(860, 1056, 1, ammonite(14, "#cfb27c", "#86683a"));
  // Roots reaching down from the grass.
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W;
    out += `<path d="M${x.toFixed(0)} 916 q${(rnd() * 30 - 15).toFixed(0)} 30 ${(rnd() * 40 - 20).toFixed(0)} ${(40 + rnd() * 40).toFixed(0)}" stroke="#4a2d14" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>`;
  }
  // A grass fringe on top of the dirt.
  const fringe = pts.map(([x, y]) => [x, y + 2]);
  out += `<path d="${smooth(fringe)}" stroke="#5aa33f" stroke-width="16" fill="none" stroke-linecap="round"/>`;
  out += `<path d="${smooth(fringe.map(([x, y]) => [x, y - 4]))}" stroke="#8fd060" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  for (let x = -20; x < W + 20; x += 9 + rnd() * 10) {
    const y = pts.find((p) => p[0] >= x)?.[1] ?? 912;
    out += tuft(rnd, x, y + 6, 16 + rnd() * 16, ["#4f9a39", "#6cb84a", "#3d8231", "#7fc556"]);
  }
  // Rocks and bones on the ground.
  const rockC = { mid: "#a8a08c", dark: "#7d7563", light: "#d6cfba" };
  out += at(250, 924, 1, rock(rnd, 90, 46, rockC));
  out += at(1110, 922, 1, rock(rnd, 60, 30, rockC));
  out += at(1500, 930, 1, rock(rnd, 120, 54, rockC));
  out += `<g transform="translate(700 930) rotate(8)">${bone(80)}</g>`;
  out += `<g transform="translate(980 934) rotate(-14)">${bone(64)}</g>`;
  out += `<g transform="translate(1680 940) rotate(18)">${bone(56)}</g>`;
  return out;
}

function foreground(rnd) {
  const leaves = { dark: "#1f5d2a", mid: "#2f8a3a", light: "#8fd06a", rib: "#4a7a22" };
  const leaves2 = { dark: "#24652d", mid: "#3a9a3f", light: "#a6dc73", rib: "#5a8a2a" };
  let out = "";
  out += at(40, 1100, 1, fernClump(rnd, { count: 10, length: 330, spread: 2.4, bendSpread: 2.2, leaf: 66, leaflets: 26, colors: leaves, outline: true, light: true, animate: true, swayDeg: 2.2, ribWidth: 4 }));
  out += at(1890, 1110, 1, fernClump(rnd, { count: 10, length: 360, spread: 2.4, bendSpread: 2.2, leaf: 70, leaflets: 26, colors: leaves2, outline: true, light: true, animate: true, swayDeg: 2.2, ribWidth: 4 }));
  out += at(330, 1100, 1, fernClump(rnd, { count: 5, length: 170, spread: 2, bendSpread: 1.6, leaf: 40, leaflets: 20, colors: leaves2, outline: true, light: true, animate: true }));
  out += at(1620, 1100, 1, fernClump(rnd, { count: 5, length: 190, spread: 2, bendSpread: 1.6, leaf: 42, leaflets: 20, colors: leaves, outline: true, light: true, animate: true }));
  // Fronds hanging into the top corners.
  out += at(-30, -40, 1, `<g transform="rotate(180)">${fernClump(rnd, { count: 5, length: 260, spread: 1.6, bendSpread: 1.4, leaf: 44, leaflets: 16, colors: leaves, outline: true, light: true, animate: true, swayDeg: 1.6 })}</g>`);
  out += at(1950, -40, 1, `<g transform="rotate(180)">${fernClump(rnd, { count: 5, length: 240, spread: 1.6, bendSpread: 1.4, leaf: 42, leaflets: 16, colors: leaves2, outline: true, light: true, animate: true, swayDeg: 1.6 })}</g>`);
  return out;
}

function spores(rnd) {
  let out = "";
  for (let i = 0; i < 34; i++) {
    const x = rnd() * W, dur = 14 + rnd() * 18, r = 2 + rnd() * 3.5;
    out += `<circle cx="${x.toFixed(0)}" cy="${H + 20}" r="${r.toFixed(1)}" fill="#fff8d6">`
      + `<animateTransform attributeName="transform" type="translate" values="0 0;${(rnd() * 80 - 40).toFixed(0)} ${-H * 0.55};${(rnd() * 120 - 20).toFixed(0)} ${-H - 60}" dur="${dur.toFixed(1)}s" begin="${(-rnd() * dur).toFixed(1)}s" repeatCount="indefinite"/>`
      + `<animate attributeName="opacity" values="0;.9;.7;0" keyTimes="0;.12;.7;1" dur="${dur.toFixed(1)}s" begin="${(-rnd() * dur).toFixed(1)}s" repeatCount="indefinite"/></circle>`;
  }
  return out;
}

export function buildScene() {
  const rnd = rng(66);
  const flock = [[760, 220], [800, 250], [840, 230], [720, 260], [880, 270]].map(([x, y], i) => at(x, y, 0.8, birdV(0.8 + i * 0.07))).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">`
    + defs()
    + layer(0, sky())
    + layer(0.04, clouds(rnd) + `<g>${`<animateTransform attributeName="transform" type="translate" values="0 0;-40 -20;0 0" dur="40s" repeatCount="indefinite"/>`}${flock}</g>`)
    + layer(0.08, mountains(rnd))
    + layer(0.12, volcano(rnd) + waterfall(rnd))
    + layer(0.18, farHills(rnd) + herd())
    + layer(0.3, `<g><animateTransform attributeName="transform" type="translate" values="-260 300;2200 220" dur="46s" repeatCount="indefinite"/>${`<g transform="scale(.9)">${pteranodon()}</g>`}</g>`)
    + layer(0.32, midHills(rnd) + midTrees(rnd)
      + at(215, 916, 0.82, stegosaurus())
      + at(470, 916 - 166 * 0.95, 0.95, triceratops())
      + at(1660, 914, 0.86, brachiosaurus()))
    + layer(0.5, ground(rnd) + at(1560, 936, 0.85, nest())
      + `<g><animateMotion path="M1440 800 C1500 760 1560 800 1520 840 C1480 880 1400 850 1440 800Z" dur="9s" repeatCount="indefinite"/>${`<g transform="scale(.6) rotate(-80)">${dragonfly()}</g>`}</g>`)
    + layer(0.8, foreground(rnd))
    + layer(0.6, spores(rnd))
    + `</svg>`;
  return svg;
}

/** A pterodactyl carrying a letter, for the "check your inbox" panel. */
export function letterBird() {
  return `<svg viewBox="-140 -90 280 160">`
    + `<g>${bob(-10, 2.4)}${pteranodon()}`
    + `<g transform="translate(6 18)"><path d="M0 0 v14" stroke="${INK}" stroke-width="2"/>`
    + `<rect x="-26" y="14" width="52" height="34" rx="4" fill="#fbf3dd" stroke="${INK}" stroke-width="2.6"/>`
    + `<path d="M-26 16 L0 34 L26 16" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`
    + `<circle cx="0" cy="34" r="6" fill="#d9483b" stroke="${INK}" stroke-width="2"/></g></g></svg>`;
}

/** A vine along a card's top corner and down its side (side: 1 = left, -1 = right). */
export function cornerVine(side, seed) {
  const rnd = rng(seed);
  const pts = [[124, 2], [86, -3], [48, 1], [14, 8], [2, 34], [5, 72], [0, 112]];
  const d = smooth(pts);
  let leaves = "";
  const n = 15;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const seg = t * (pts.length - 1);
    const idx = Math.min(pts.length - 2, Math.floor(seg));
    const lt = seg - idx;
    const x = pts[idx][0] + (pts[idx + 1][0] - pts[idx][0]) * lt;
    const y = pts[idx][1] + (pts[idx + 1][1] - pts[idx][1]) * lt;
    // Leaves hang down from the top run and outwards from the side run.
    const base = idx < 3 ? 90 : 160;
    const a = base + (i % 2 ? -38 : 38) + (rnd() - 0.5) * 24;
    const s = 0.65 + rnd() * 0.45;
    leaves += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.toFixed(0)}) scale(${s.toFixed(2)})">`
      + `<path d="M0 0 C6 -10 20 -12 28 -2 C20 8 6 8 0 0Z" fill="${i % 3 ? "#4ea644" : "#3a8c3a"}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
      + `<path d="M3 -1 L22 -3" stroke="#a6dc73" stroke-width="1.6" stroke-linecap="round"/></g>`;
  }
  return `<svg viewBox="-20 -20 160 160" ${side < 0 ? `style="transform: scaleX(-1)"` : ""}>`
    + `<g>${sway(1.2, 6, seed % 5)}`
    + `<path d="${d}" stroke="${INK}" stroke-width="7" fill="none" stroke-linecap="round"/>`
    + `<path d="${d}" stroke="#6b8a2a" stroke-width="4" fill="none" stroke-linecap="round"/>`
    + leaves
    + `<circle cx="0" cy="118" r="7" fill="#e86a3c" stroke="${INK}" stroke-width="2"/><circle cx="9" cy="108" r="5" fill="#f6a35a" stroke="${INK}" stroke-width="1.8"/>`
    + `</g></svg>`;
}
