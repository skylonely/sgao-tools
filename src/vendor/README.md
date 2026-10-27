# Vendored browser libraries

These libraries are served from this site, without a CDN or third-party requests.
The application still builds and runs without an npm install.

- `qrcodegen.js`: Project Nayuki's compiled QR Code generator, retrieved 2026-10-23 from
  <https://www.nayuki.io/res/qr-code-generator-library/qrcodegen.js>.
  MIT license is preserved in its header. The only local change is an appended ESM export.
  Adapted file SHA-256: `9c22b1ea5e664f984a3abe36ef41c28b03aa6e5108b04e5c72ac2523482f2fa5`.
- `jsqr.js`: jsQR **1.4.0**, `dist/jsQR.js` from
  <https://registry.npmjs.org/jsqr/-/jsqr-1.4.0.tgz>, project <https://github.com/cozmo/jsQR>.
  Apache-2.0 license is retained in `jsqr.LICENSE.txt`. Local additions only wrap the
  unchanged UMD bundle in an ESM module without adding a browser global.
  Adapted file SHA-256: `d1217c112b7987facd43f10d5998fefea2f853123d32c054a6731f16c4df69c7`.

The encoder loads with the QR UI. The decoder loads only in short-lived QR workers,
for output verification or image recognition; workers terminate on completion or timeout.

## SVG optimizer

- `svgo.browser.js`: unchanged browser ESM bundle from **SVGO 4.1.0**,
  <https://registry.npmjs.org/svgo/-/svgo-4.1.0.tgz>, retrieved 2026-10-23.
  Archive integrity was checked against the registry SHA-512 value before extraction.
  Bundle SHA-256: `76a415be3ead7a8b0e109c77b7b20cec478c46fe8a09a1b1ad42a80ecd91b0ee`.
  MIT license: `svgo.LICENSE.txt`. Production dependency notices: `svgo.NOTICES.txt`;
  exact versions follow <https://github.com/svg/svgo/blob/v4.1.0/pnpm-lock.yaml>.
  The upstream bundle includes SVGO's patched SAX parser. We add no modifications
  to the bundle; application validation and optimization options live in `svg-optimizer.js`.

SVGO loads only inside a short-lived Worker after opening the SVG tool or starting
an optimization. It does not add a bundle download to other tools or use a CDN.

## Image-to-PDF writer

- `pdf-lib.esm.min.js`: unchanged browser ESM bundle from **pdf-lib 1.17.1**,
  <https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz>, retrieved 2026-10-27.
  Archive SHA-512 matches the official registry integrity value.
  Bundle SHA-256: `72c052d97b4d5d9fa6cdbdcb7ad709f03d4ddb1122390cb3afeba4d88651d969`.
  MIT license: `pdf-lib.LICENSE.txt`. Bundled dependency licenses and copyright
  notices: `pdf-lib.NOTICES.txt`; exact versions follow the upstream v1.17.1
  `yarn.lock` (pako 1.0.10/1.0.11, @pdf-lib/upng 1.0.1,
  @pdf-lib/standard-fonts 1.0.0 and tslib 1.11.1). Dependency archives were also
  verified against that lock file's integrity values before extracting notices.

The PDF library loads only when PDF generation starts, normally in a short-lived
Worker. Browsers without OffscreenCanvas use a sequential main-thread fallback.
No PDF input is parsed, and no external fonts, services or CDN requests are used.
