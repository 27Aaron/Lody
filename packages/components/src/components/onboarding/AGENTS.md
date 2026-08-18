# Desktop Onboarding

- Electron opens `/onboarding` in the primary product renderer. Do not add a second window, renderer entry, provider tree, or runtime lease for onboarding.
- The Electron main process owns the durable completion marker. Renderer storage owns only resumable phase and draft state; clear it after the completion IPC acknowledges success.
- Build the flow from platform capabilities. Local builds must not import or call cloud auth, workspace, or GitHub implementations.
- Provider and local-project selections carry exact IDs. The first session may start only when the selected provider and project belong to the same machine.
- Completion stays in the existing router and navigates to the created session when one exists. Reload recovery must target the normal product root after completion.
- `ceremony/intro-sequence.tsx` owns the four-beat illustrated intro. Keep its approved assets and direction in `intro-illustration-direction.md`; setup screens must not replace it with a generic welcome card.
- Setup screens use the real `TourStill` product composition. Its Browser beat includes the production Visual Annotation surfaces; do not replace the tour with a hand-built mock.
