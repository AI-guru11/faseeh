# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Faseeh (فصيح) is an Arabic TTS Studio with a Tashkeel (diacritization) Editor. It combines Arabic text diacritization using Mishkal with text-to-speech via ElevenLabs. The backend is a Python FastAPI service; the frontend is a React component designed for Next.js integration.

## Development Commands

```bash
# Backend
source fasenv/bin/activate
uvicorn api_service:app --reload --port 8000
# Swagger docs at http://localhost:8000/docs

# Install dependencies
pip install -r requirements.txt
```

Environment variables are configured via `.env` (see `.env.example`): `ELEVENLABS_API_KEY`, `DEFAULT_VOICE_ID`, `CORS_ORIGINS`, `MAX_INPUT_LENGTH`.

## Architecture

**Backend (`api_service.py`)** — Single-file FastAPI service (port 8000):
- `POST /api/v1/diacritize` — Auto-diacritize Arabic text via Mishkal (async wrapper using `asyncio.to_thread()`)
- `POST /api/v1/render` — TTS proxy to ElevenLabs; caches by SHA-256 hash of text+voice_id (in-memory dict)
- `POST /api/v1/shortcut/render` — One-shot endpoint for iOS Shortcuts (diacritize → render → MP3 URL)
- `GET /health` — Health check
- Input sanitization via regex allowing only Arabic Unicode ranges (U+0600-U+06FF, U+0750-U+077F, etc.)
- In-memory sliding-window rate limiter (10 req/min per IP)

**Frontend (`TashkeelEditor.jsx`)** — Single React component with embedded CSS-in-JS:
- RTL layout, dark theme (navy #0B1220, teal accent #2DD4BF), IBM Plex Sans Arabic font
- Two modes: text input mode → interactive character tile editing mode
- `parseArabicText(text)` splits text into segments (`{ base, marks[] }`); `segmentsToText()` reconstructs Unicode
- `DiacriticPopover` sub-component handles 8 Arabic diacritics; Shadda (U+0651) can stack with one vowel, other marks replace each other
- Auto-diacritize calls backend `/api/v1/diacritize` (currently mocked with delay)

**Pydantic models** define all request/response schemas: `DiacritizeRequest`, `RenderRequest`, `ShortcutRequest`, etc.

## Key Technical Details

- Mishkal's synchronous API is wrapped with `asyncio.to_thread()` for async compatibility
- TTS audio storage is a placeholder — needs S3/GCS integration to persist MP3 bytes from ElevenLabs
- Cache and rate limiter are in-memory dicts — need Redis for multi-instance production deployments
- CORS configured for `http://localhost:3000` by default (frontend dev server)
- Frontend responsive breakpoint at 900px (grid → single column)
