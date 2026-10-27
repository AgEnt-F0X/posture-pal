// plant.js — hero plant mascot.
// Responsive SVG with terracotta pot, hand-drawn organic leaves, window highlight on the right,
// contact shadow shifting with scene lighting, 5-stage growth, and droop with desaturation.
//
// Public API:
//   STAGE_THRESHOLDS, stageForMinutes, createPlant(container) -> { setStage, setDroop, captionFor }

export const STAGE_THRESHOLDS = [0, 5, 12, 20, 30];

export function stageForMinutes(goodMinutes) {
  let stage = 0;
  for (let i = 0; i < STAGE_THRESHOLDS.length; i++) {
    if (goodMinutes >= STAGE_THRESHOLDS[i]) stage = i;
  }
  return stage;
}

const STAGE_SCALES = [0.65, 0.76, 0.86, 0.94, 1.0];

const CAPTIONS = [
  'A seedling breaks the soil.',
  'First leaves reach for the light.',
  'Steady growth. Keep sitting well.',
  'Full and healthy. Your spine thanks you.',
  'In bloom. This is what good posture earns.',
];

function svgMarkup() {
  const uid = 'pp' + Math.random().toString(36).slice(2, 8);
  const leafFillId = `${uid}-leaf`;
  const leafDimId = `${uid}-dim`;
  const potRimId = `${uid}-potrim`;
  const potBodyId = `${uid}-potbody`;
  const flowerId = `${uid}-flower`;

  return `
  <svg class="plant-svg" viewBox="0 0 300 360" width="300" height="360" role="img" aria-label="Posture plant">
    <defs>
      <!-- Leaf highlights face right towards the window -->
      <linearGradient id="${leafFillId}" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stop-color="#246743"/>
        <stop offset="55%" stop-color="#3c8e5f"/>
        <stop offset="100%" stop-color="#60b980"/>
      </linearGradient>

      <!-- Backside/shadowed leaf surface -->
      <linearGradient id="${leafDimId}" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stop-color="#1b5235"/>
        <stop offset="100%" stop-color="#29754b"/>
      </linearGradient>

      <!-- Warm terracotta pot body: shaded on left, window highlight on right -->
      <linearGradient id="${potBodyId}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#8a3d1f"/>
        <stop offset="30%" stop-color="#ad5229"/>
        <stop offset="75%" stop-color="#c96b3f"/>
        <stop offset="100%" stop-color="#dd7e52"/>
      </linearGradient>

      <!-- Pot rim with light catch on right -->
      <linearGradient id="${potRimId}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#964322"/>
        <stop offset="40%" stop-color="#b8592e"/>
        <stop offset="85%" stop-color="#d47346"/>
        <stop offset="100%" stop-color="#e3895e"/>
      </linearGradient>

      <!-- Blossom petals -->
      <linearGradient id="${flowerId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f5b379"/>
        <stop offset="100%" stop-color="#d9743c"/>
      </linearGradient>
    </defs>

    <!-- Soft contact shadow on the sill -->
    <ellipse class="plant-shadow" cx="150" cy="345" rx="56" ry="7" fill="rgba(15, 8, 4, 0.6)"/>

    <!-- Terracotta Pot -->
    <g class="pot">
      <!-- Dark rich potting soil -->
      <ellipse cx="150" cy="272" rx="46" ry="6" fill="#241711"/>

      <!-- Pot Rim -->
      <path d="M 98 263 L 202 263 Q 206 263 206 268 L 204 277 Q 203 281 198 281 L 102 281 Q 97 281 96 277 L 94 268 Q 94 263 98 263 Z" fill="url(#${potRimId})"/>

      <!-- Pot Body -->
      <path d="M 104 281 L 196 281 L 178 340 Q 176 345 170 345 L 130 345 Q 124 345 122 340 Z" fill="url(#${potBodyId})"/>

      <!-- Subtle window light catch on right rim edge -->
      <path d="M 194 281 L 196 281 L 178 340 L 174 340 Z" fill="rgba(255, 235, 210, 0.22)"/>
    </g>

    <!-- Growing plant elements -->
    <g class="grow">
      <!-- Main upright stem -->
      <path class="stem-main" d="M 150 274 C 148 230, 153 175, 150 115" fill="none" stroke="#2e6f4a" stroke-width="6.5" stroke-linecap="round"/>

      <!-- Swaying leaves group (sway applies to leaves only, keeping pot and stem base rooted) -->
      <g class="sway">

        <!-- Stage 0: Initial seedling shoot (2 small cotyledon leaves) -->
        <g class="part leaf" data-min="0">
          <path d="M 150 120 C 138 114, 132 102, 134 88 C 146 94, 152 106, 150 120 Z" fill="url(#${leafFillId})"/>
          <path d="M 150 120 C 162 114, 168 102, 166 88 C 154 94, 148 106, 150 120 Z" fill="url(#${leafDimId})"/>
          <!-- Window light edge on right leaf -->
          <path d="M 156 102 C 164 96, 166 89, 166 88 C 162 96, 156 101, 153 108" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.2" stroke-linecap="round"/>
        </g>

        <!-- Stage 1: First true broad leaves -->
        <g class="part leaf" data-min="1">
          <!-- Left leaf -->
          <path d="M 148 195 C 114 192, 92 174, 85 145 C 115 147, 139 166, 148 190 Z" fill="url(#${leafFillId})"/>
          <path d="M 144 186 C 127 182, 109 168, 98 152" fill="none" stroke="rgba(236,233,244,0.25)" stroke-width="1.8" stroke-linecap="round"/>

          <!-- Right leaf (facing window) -->
          <path d="M 152 178 C 184 175, 208 157, 215 128 C 184 130, 160 148, 152 174 Z" fill="url(#${leafFillId})"/>
          <path d="M 156 170 C 173 166, 191 152, 202 136" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1.8" stroke-linecap="round"/>
        </g>

        <!-- Stage 2: Lush mid-height leaves -->
        <g class="part leaf" data-min="2">
          <!-- Left mid leaf -->
          <path d="M 149 152 C 122 147, 104 130, 99 106 C 125 110, 143 128, 149 148 Z" fill="url(#${leafDimId})"/>
          <!-- Right mid leaf (sunlit) -->
          <path d="M 151 142 C 178 138, 202 120, 209 95 C 179 98, 158 118, 151 138 Z" fill="url(#${leafFillId})"/>
          <path d="M 155 135 C 170 128, 186 114, 196 101" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1.6" stroke-linecap="round"/>
        </g>

        <!-- Stage 3: Upper canopy foliage -->
        <g class="part leaf" data-min="3">
          <!-- Left top leaf -->
          <path d="M 149 116 C 128 108, 115 92, 112 72 C 132 76, 145 92, 149 112 Z" fill="url(#${leafFillId})"/>
          <!-- Right top leaf (sunlit) -->
          <path d="M 151 108 C 174 100, 189 82, 193 60 C 171 65, 157 84, 151 104 Z" fill="url(#${leafFillId})"/>
          <path d="M 154 102 C 168 94, 179 81, 184 68" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-linecap="round"/>
        </g>

        <!-- Stage 4: Flowering bloom & buds -->
        <g class="part leaf bloom" data-min="4">
          <!-- Petals -->
          <circle cx="150" cy="88" r="9" fill="url(#${flowerId})"/>
          <circle cx="150" cy="72" r="8" fill="url(#${flowerId})"/>
          <circle cx="163" cy="82" r="8" fill="url(#${flowerId})"/>
          <circle cx="158" cy="98" r="8" fill="url(#${flowerId})"/>
          <circle cx="142" cy="98" r="8" fill="url(#${flowerId})"/>
          <circle cx="137" cy="82" r="8" fill="url(#${flowerId})"/>
          <!-- Warm golden blossom centre -->
          <circle cx="150" cy="85" r="7" fill="#f5c26b"/>
          <circle cx="150" cy="85" r="4.5" fill="#8f4c2f"/>
        </g>

      </g>
    </g>
  </svg>`;
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 3-5 gentle sparkles rising from the top of the plant on stage growth (only place sparkles are allowed)
function sparkles(svg) {
  if (reduceMotion()) return;
  const NS = 'http://www.w3.org/2000/svg';
  const count = 3 + Math.floor(Math.random() * 3); // 3 to 5 sparkles
  for (let i = 0; i < count; i++) {
    const c = document.createElementNS(NS, 'circle');
    const x = 150 + (Math.random() * 80 - 40);
    const y = 110 + (Math.random() * 40 - 20);
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', 2 + Math.random() * 1.8);
    c.setAttribute('fill', i % 2 ? '#e6935c' : '#86efac');
    svg.appendChild(c);
    const duration = 650 + Math.random() * 200; // max 850ms <= 900ms
    if (typeof c.animate === 'function') {
      c.animate(
        [
          { transform: 'translateY(0) scale(0.6)', opacity: 0.95 },
          { transform: `translateY(${-28 - Math.random() * 20}px) scale(1)`, opacity: 0 },
        ],
        { duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      ).onfinish = () => c.remove();
    } else {
      setTimeout(() => c.remove(), 850);
    }
  }
}

export function createPlant(container) {
  if (!container) return { setStage: () => '', setDroop: () => {}, captionFor: () => '' };
  container.innerHTML = svgMarkup();
  const svg = container.querySelector('.plant-svg');
  const grow = svg.querySelector('.grow');
  const parts = [...svg.querySelectorAll('.part')];
  let lastStage = -1;

  function setStage(stage) {
    const s = Math.max(0, Math.min(4, stage));
    grow.style.transform = `scale(${STAGE_SCALES[s]})`;
    parts.forEach(p => {
      const on = Number(p.dataset.min) <= s;
      p.classList.toggle('on', on);
      if (on && Number(p.dataset.min) === s && s > lastStage && !p.classList.contains('unfurl')) {
        p.classList.add('unfurl');
        setTimeout(() => p.classList.remove('unfurl'), 900);
      }
    });
    if (s > lastStage) sparkles(svg);
    lastStage = s;
    return CAPTIONS[s];
  }

  function setDroop(drooping) {
    svg.classList.toggle('drooping', drooping);
  }

  return { setStage, setDroop, captionFor: s => CAPTIONS[Math.max(0, Math.min(4, s))] };
}
