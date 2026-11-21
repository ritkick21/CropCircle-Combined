# CropCircle demo guidance

CropCircle is a demonstration app, not a production launch. Prioritize a working, reviewable user flow and fast iteration. Keep the existing Next.js/NestJS/Prisma/PostGIS architecture, but avoid production-scale infrastructure, exhaustive hardening, or broad refactoring unless a current demo feature depends on it.

For each stage, inspect the relevant code, implement the requested end-to-end behavior, run focused tests plus typechecks/builds, and stop once the demo behavior is verified. Use local test fixtures only; do not hardcode credentials or private data. Record genuine limitations briefly and move to the next requested stage.

The Stage 4 map uses MapLibre GL JS (the user chose it over the original Mapbox request), OpenFreeMap tiles, and configurable Photon/OSRM URLs. Browser verification of tiles, a database marker, detail panel, layers, nearby search, place search, route, and mobile layout was completed on 2026-11-21.
