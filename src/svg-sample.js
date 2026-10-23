export const SVG_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- A deliberately editable, verbose SVG with gradient, mask and grouped paths. -->
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480">
  <title>山间日落 · SGAO</title>
  <desc>暖色天空、层叠山峦与透明边角，用于比较 SVG 优化效果。</desc>
  <metadata>SGAO editable sample — exported for web, 2026</metadata>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.0000" stop-color="#f5cba6"/>
      <stop offset="1.0000" stop-color="#ef8669"/>
    </linearGradient>
    <linearGradient id="front" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#427c72"/>
      <stop offset="1" stop-color="#254a48"/>
    </linearGradient>
    <clipPath id="frame"><rect x="24.0000" y="24.0000" width="672.0000" height="432.0000" rx="32.0000"/></clipPath>
  </defs>
  <g clip-path="url(#frame)">
    <rect x="24.0000" y="24.0000" width="672.0000" height="432.0000" fill="url(#sky)"/>
    <circle cx="526.0000" cy="151.0000" r="46.0000" fill="#fff4d9"/>
    <g fill="none" stroke="#ffffff" stroke-width="2.0000" opacity="0.3500">
      <path d="M 70.0000 112.0000 L 235.0000 112.0000"/>
      <path d="M 104.0000 126.0000 L 196.0000 126.0000"/>
    </g>
    <path d="M 24 327 L 163 176 L 321 337 L 454 211 L 696 389 L 696 456 L 24 456 Z" fill="#d3806d"/>
    <path d="M 24 371 L 196 257 L 364 388 L 529 292 L 696 377 L 696 456 L 24 456 Z" fill="#7a9182"/>
    <path d="M 24 419 Q 180 305 349 399 Q 529 303 696 424 L 696 456 L 24 456 Z" fill="url(#front)"/>
    <g fill="#ffffff" opacity="0.75">
      <circle cx="82" cy="398" r="2"/><circle cx="91" cy="394" r="1.5"/>
      <circle cx="621" cy="422" r="2"/><circle cx="632" cy="426" r="1.5"/>
    </g>
  </g>
</svg>`;
