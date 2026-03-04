# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Faseeh (فصيح)** is an Arabic TTS Studio with an interactive Tashkeel (diacritization) editor. It combines:
- **Arabic diacritization** via the Mishkal library
- **Text-to-speech** via the ElevenLabs API
- **Backend**: Python FastAPI service (port 8000)
- **Frontend**: React/Next.js single-page app (port 3000)

---

## Repository Structure

```
faseeh/
├── api_service.py               # FastAPI backend — all routes, middleware, models
├── requirements.txt             # Python dependencies (pinned versions)
├── .env.example                 # Environment variable template
├── .gitignore
├── CLAUDE.md                    # This file
├── README.md                    # Project overview and architecture decisions
├── TashkeelEditor.jsx           # Standalone copy of the component (NOT canonical)
├── tashkeel-editor-preview.html # Static HTML preview/demo
└── frontend/                    # Next.js application
    ├── package.json             # next@16.1.6, react@19.2.3
    ├── next.config.mjs          # API proxy rewrites to backend
    ├── jsconfig.json            # Path alias: @/* → ./*
    └── app/
        ├── layout.js            # Root layout: lang="ar" dir="rtl", Arabic metadata
        ├── page.js              # Home page — renders <TashkeelEditor />
        ├── globals.css          # Body reset + navy background (#0b1220)
        └── components/
            └── TashkeelEditor.jsx  # ← CANONICAL component (edit this one)
```

> **Important:** There are two copies of `TashkeelEditor.jsx`. The **canonical** version is
> `frontend/app/components/TashkeelEditor.jsx`. The root-level `TashkeelEditor.jsx` is a
> standalone/duplicate kept for reference — do not edit it directly.

---

## Development Commands

### Backend

```bash
# One-time setup
python -m venv fasenv
source fasenv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then add your ElevenLabs API key

# Run dev server
source fasenv/bin/activate
uvicorn api_service:app --reload --port 8000

# Swagger UI
open http://localhost:8000/docs
```

### Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:3000

# Production build
npm run build && npm run start
```

Both servers must run simultaneously for the full app to work. The Next.js dev server proxies all `/api/*` and `/static/*` requests to `http://localhost:8000`.

---

## Environment Variables

Configured via `.env` (copy from `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `ELEVENLABS_API_KEY` | *(required)* | ElevenLabs API credentials |
| `DEFAULT_VOICE_ID` | `pNInz6obpgDQGcFmaJgB` | Default TTS voice (Adam) |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed CORS origin(s) |
| `MAX_INPUT_LENGTH` | `5000` | Max Arabic text characters accepted |

---

## Backend Architecture (`api_service.py`)

Single-file FastAPI service. App metadata: title "Fasseeh API", version "0.1.1".

### Python Dependencies (pinned in `requirements.txt`)

| Package | Version |
|---------|---------|
| `fastapi` | 0.109.2 |
| `uvicorn[standard]` | 0.27.1 |
| `httpx` | 0.27.0 |
| `pydantic` | 2.6.1 |
| `python-dotenv` | 1.0.1 |
| `mishkal` | 0.4.1 |

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check → `{ status, version }` |
| `POST` | `/api/v1/diacritize` | Auto-diacritize raw Arabic text via Mishkal |
| `POST` | `/api/v1/render` | TTS proxy to ElevenLabs with caching |
| `POST` | `/api/v1/shortcut/render` | iOS Shortcut one-shot: diacritize → render → MP3 URL |

Static audio files served at `/static/audio/*.mp3` from `./static/audio/` directory.

### Pydantic Models

```python
# Request models
DiacritizeRequest:  text: str (min=1, max=5000)
RenderRequest:      text: str (min=1, max=5000)
                    voice_id: Optional[str]         # defaults to DEFAULT_VOICE_ID
                    stability: Optional[float]       # 0.0–1.0, default 0.5
                    similarity_boost: Optional[float] # 0.0–1.0, default 0.75
ShortcutRequest:    text: str (min=1, max=5000)

# Response models
DiacritizeResponse: original: str, diacritized: str, char_count: int
RenderResponse:     audio_url: str, cached: bool, text_hash: str
ShortcutResponse:   audio_url: str, diacritized_text: str
HealthResponse:     status: str, version: str
```

### Helper Functions

```python
sanitize_arabic(text: str) -> str
    # Strips non-Arabic chars, collapses whitespace
    # Allowed: U+0600–06FF, U+0750–077F, U+FB50–FDFF, U+FE70–FEFF
    # Allowed: spaces, Arabic punctuation (،؛؟), newlines, basic punctuation

_diacritize_with_mishkal(text: str) -> str   # async
    # Wraps synchronous mishkal.tashkeel.TashkeelClass().tashkeel(txt)
    # Uses asyncio.to_thread() for async compatibility

_call_elevenlabs(text, voice_id, stability, similarity_boost) -> str   # async
    # POST to ElevenLabs text-to-speech/{voice_id}
    # Model: eleven_multilingual_v2
    # Saves MP3 to static/audio/{hash}.mp3, returns relative URL

cache_key(text: str, voice_id: str) -> str
    # SHA-256 of "{text}::{voice_id}"
```

### Middleware & Security

**Rate Limiter** (`RateLimiter` class):
- Strategy: sliding-window, 10 requests/minute per IP
- `is_allowed(key: str) -> bool` — prunes old timestamps, checks count
- Applied as FastAPI middleware to all `/api/` routes
- Returns HTTP 429 when limit exceeded

**Input Sanitization**: `sanitize_arabic()` called at every route before processing.

**CORS**: Configured for `CORS_ORIGINS` env var (default: `http://localhost:3000`).

**Cache**: In-memory dict `audio_cache: dict[str, str]` keyed by `cache_key()`. Returns cached URL with `cached: true` on hit.

---

## Frontend Architecture (`frontend/app/components/TashkeelEditor.jsx`)

Single React component with all CSS embedded as template literals. No external CSS dependencies beyond IBM Plex Sans Arabic (Google Fonts).

### Two-Mode Editing Flow

```
Input Mode                    Edit Mode
──────────────────────────────────────────────
Textarea (raw Arabic text)  → Interactive char tiles
[Auto-diacritize] button    → Calls POST /api/v1/diacritize
[Edit diacritics] button    → Parses text into segments
                              Click tile → DiacriticPopover
                              Toggle diacritics per character
                              [Generate Audio] → POST /api/v1/render
```

### State Variables

```javascript
rawText        // raw Arabic string in the textarea (default: "بسم الله الرحمن الرحيم")
segments       // parsed array of { base, marks[] } objects (default: parseArabicText of rawText)
selectedIndex  // index of clicked CharTile (null if none)
popoverPos     // { x, y } for DiacriticPopover positioning
isEditMode     // boolean: textarea vs char-tile view
charCount      // character count (excludes diacritics)
isProcessing   // boolean: diacritize API call in-flight
selectedVoice  // index into voices[] array (0, 1, or 2)
audioUrl       // string URL of rendered MP3 (null if none yet)
isGenerating   // boolean: render API call in-flight
isPlaying      // boolean: audio element play state
error          // string error message (null if none); auto-clears after 6s
```

### Sub-components

**`DiacriticPopover`** — Fixed-position panel for editing diacritics on one character
- Props: `segment, position, onSelect, onRemove, onClose`
- 8 diacritic buttons in 4×2 grid; "Remove all" button
- Click-outside detection closes it

**`CharTile`** — One Arabic character with its marks
- Props: `segment, index, isSelected, onClick`
- Only Arabic base characters are clickable
- Classes: `.char-tile`, `.arabic`, `.selected`, `.space`, `.has-marks`

### Available Voices

```javascript
const voices = [
  { name: "أحمد",  desc: "صوت رجالي — رسمي",   emoji: "🎙", voiceId: "pNInz6obpgDQGcFmaJgB" },
  { name: "فاطمة", desc: "صوت نسائي — دافئ",   emoji: "🎤", voiceId: "EXAVITQu4vr4xnSDxMaL" },
  { name: "يوسف",  desc: "صوت رجالي — شبابي",  emoji: "🎧", voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
];
```

---

## Data Structures

### Segment Format

`parseArabicText(text)` splits a Unicode Arabic string into:

```javascript
[
  { base: "ب", marks: ["\u064E"] },   // بَ
  { base: "س", marks: [] },            // س
  { base: "م", marks: ["\u0651", "\u064E"] },  // سَ with shadda
  ...
]
```

`segmentsToText(segments)` reconstructs the Unicode string: `segment.base + segment.marks.join("")`.

### Arabic Diacritics (8 total)

| Name | Unicode | Arabic Label | Preview |
|------|---------|-------------|---------|
| fatha | U+064E | فَتحة | َ |
| damma | U+064F | ضَمّة | ُ |
| kasra | U+0650 | كَسرة | ِ |
| sukun | U+0652 | سُكون | ْ |
| shadda | U+0651 | شَدّة | ّ |
| fathatan | U+064B | فتحتان | ً |
| dammatan | U+064C | ضمتان | ٌ |
| kasratan | U+064D | كسرتان | ٍ |

**Stacking rule**: Shadda (U+0651) can coexist with one vowel mark. All other vowels are mutually exclusive — adding one replaces the other (but never replaces Shadda).

---

## Next.js Configuration

**API Proxy** (`frontend/next.config.mjs`): All frontend requests to `/api/*` and `/static/*` are rewritten to the FastAPI backend at `http://localhost:8000`.

```javascript
rewrites: [
  { source: "/api/:path*",    destination: "http://localhost:8000/api/:path*" },
  { source: "/static/:path*", destination: "http://localhost:8000/static/:path*" },
]
```

**Path alias** (`frontend/jsconfig.json`): `@/*` maps to `./` (frontend root).

---

## Styling Reference

CSS is embedded as template literals in `TashkeelEditor.jsx`. The component uses a single root class `.fasseeh-root` with CSS custom properties.

| Token | Value | Usage |
|-------|-------|-------|
| Navy bg | `#0B1220` | Main background |
| Navy card | `#111B2E` | Card/surface bg |
| Navy border | `#162236` | Card borders |
| Teal accent | `#2DD4BF` | Buttons, highlights, glows |
| Text primary | `#E2E8F0` | Body text |
| Text secondary | `#94A3B8` | Subtext |
| Text muted | `#64748B` | Placeholders |
| Danger | `#F87171` | Error states |
| Font | IBM Plex Sans Arabic | All text (Google Fonts) |
| RTL breakpoint | 900px | Grid collapses to single column |

---

## Known Limitations / Production TODOs

| Area | Current State | Production Need |
|------|--------------|-----------------|
| Audio storage | MP3s saved to local `./static/audio/` | S3 or GCS for persistence |
| Cache | In-memory Python dict | Redis (shared across instances) |
| Rate limiter | In-memory per-process | Redis (shared across instances) |
| Mishkal | Synchronous, wrapped with `asyncio.to_thread()` | Consider async-native alternative |
| Audio player | Basic HTML audio element | wavesurfer.js waveform visualization |
| CORS | Hardcoded localhost:3000 | Set `CORS_ORIGINS` env var for production domain |
| ElevenLabs model | `eleven_multilingual_v2` | Review available models for quality/cost |
