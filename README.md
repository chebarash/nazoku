# Nazoku

Multiplayer Sudoku built with Next.js for Vercel.

## Stack

- Next.js App Router
- Server routes for room lifecycle and game actions
- Vercel Blob for persistent room state in production
- Local filesystem fallback for development

## Scripts

- `npm run dev`
- `npm run lint`
- `npm run build`
- `npm run start`

## Environment

- `BLOB_READ_WRITE_TOKEN`: required for persistent multiplayer state on Vercel and optional for local development if you want to use the same Blob store locally
