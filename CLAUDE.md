# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Dev/Lint

```bash
pnpm dev          # Start dev server on http://localhost:3000
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # Run ESLint
```

## Tech Stack

- **Next.js 16** with App Router (React 19, TypeScript 5)
- **Tailwind CSS v4** — uses `@import "tailwindcss"` in CSS and `@tailwindcss/postcss` as a PostCSS plugin (no `tailwind.config.ts`)
- **pnpm** as package manager (see `pnpm-workspace.yaml`)

## Path Aliases

`@/*` maps to the project root (`./*`). Import components as `import Foo from "@/components/foo"`.

## Architecture

- `app/layout.tsx` — Root layout with Geist fonts, `h-full antialiased` on `<html>`, `flex flex-col min-h-full` on `<body>`
- `app/page.tsx` — Home page (Next.js starter content)
- `app/globals.css` — Tailwind v4 `@import "tailwindcss"`, CSS custom properties for `--background`/`--foreground`, dark mode via `prefers-color-scheme`
- `public/` — Static assets (SVGs, favicon)
