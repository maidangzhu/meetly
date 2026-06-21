# Project

`Meetly` is a local-first Tauri desktop meeting assistant.

Project rules:

- Build in small, verifiable changes.
- Keep P0 login-free and BYOK-only.
- Match Pluely-style interaction for the floating island.
- Keep native capabilities in Rust.
- Keep React focused on presentation.
- Use Tailwind utility classes for React UI styling by default.
- Keep `src/styles.css` limited to Tailwind imports, global app/window baselines, design tokens, and keyframes that are impractical as inline utilities.
- Do not add new component-scoped semantic CSS classes for ordinary layout, spacing, color, typography, borders, or hover states.
- Do not store complete audio, screenshots, or meeting transcripts by default.
- Do not claim absolute recording invisibility.
