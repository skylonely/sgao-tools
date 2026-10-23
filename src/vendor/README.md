# Vendored QR libraries

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
