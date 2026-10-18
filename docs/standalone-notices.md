# Standalone package notices

The standalone npm package includes this project's MIT license in `LICENSE`.
It distributes JavaScript and project assets; Bun is a separately installed
runtime dependency. No Bun executable or embedded JavaScriptCore runtime is
included in this package.

The former compiled-binary distribution audit does not apply to this artifact.
Any future package embedding Bun must complete its own exact-runtime license,
notice and rebuild/relink-material review before publication.

The package manifest records application version, frontend build identity and
asset hashes. Hashes detect damaged assets; they are not publisher authentication.
Registry publication and registry credentials are separate from local packaging.
