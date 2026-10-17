# Standalone runtime distribution audit

This local test package includes this project's MIT license in `LICENSE`.
The executable embeds Bun 1.4.3. Bun's own license is MIT; its statically
linked JavaScriptCore/WebKit components carry LGPL terms. The upstream
notice also lists other linked libraries and embedded polyfills.

- review the pinned [Bun 1.4.3 notice](https://github.com/oven-sh/bun/blob/bun-v1.4.3/LICENSE.md)
- retain the corresponding runtime sources, full dependency licenses and
  required rebuild/relink materials before public binary distribution
- verify those materials against the exact compiler revision, not Bun main
- record compiler version, frontend source fingerprint, asset hashes and
  ELF GLIBC requirement in the package manifest

Public binary distribution remains blocked on assembling and checking the
complete runtime notices and rebuild/relink materials. CI builds and tests the
package without uploading it; release workflows publish only the Millennium
`.star`. Restore standalone upload/publication wiring only after this audit is
complete and the materials are included in the package. This file records
the remaining work; it is not a substitute for those materials.
