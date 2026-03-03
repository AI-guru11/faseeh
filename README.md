# فصيح — Fasseeh
### Arabic TTS Studio with Tashkeel Editor

---

## Project Structure

```
fasseeh/
├── backend/
│   ├── api_service.py          # FastAPI app — all routes, middleware, proxy logic
│   ├── requirements.txt        # Python dependencies
│   ├── .env.example            # Environment variable template
│   ├── services/
│   │   ├── __init__.py
│   │   ├── diacritizer.py      # Mishkal/RDI integration (next step)
│   │   ├── tts_proxy.py        # ElevenLabs proxy + S3 upload (next step)
│   │   └── cache.py            # Redis cache adapter (next step)
│   └── tests/
│       ├── test_sanitization.py
│       └── test_rate_limiter.py
│
├── frontend/
│   ├── components/
│   │   ├── TashkeelEditor.jsx  # ✅ Core editor — diacritic popover, char tiles
│   │   ├── VoiceSelector.jsx   # Voice card list (extract from editor next)
│   │   ├── AudioPlayer.jsx     # wavesurfer.js integration (next step)
│   │   └── SkeletonLoader.jsx  # Loading states
│   ├── hooks/
│   │   ├── useArabicParser.ts  # parseArabicText / segmentsToText
│   │   └── useFasseehAPI.ts    # API client hooks
│   ├── styles/
│   │   └── globals.css         # Tailwind + CSS variables
│   ├── app/
│   │   ├── layout.tsx          # Next.js root layout (RTL, IBM Plex Sans Arabic)
│   │   └── page.tsx            # Dashboard page
│   └── next.config.js
│
└── README.md                   # ← You are here
```

---

## Quick Start

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Fill in your ElevenLabs key
uvicorn api_service:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs` (Swagger UI).

### Frontend

```bash
cd frontend
npx create-next-app@latest . --typescript --tailwind --app
# Copy TashkeelEditor.jsx into components/
npm run dev
```

---

## Architecture Decisions

### Security
- **API Proxy**: ElevenLabs key never touches the frontend. All TTS calls route through `/api/v1/render`.
- **Rate Limiting**: 10 req/min per IP via sliding-window middleware (upgrade to Redis in prod).
- **Input Sanitization**: Regex strips non-Arabic characters before any processing.

### Performance
- **Caching**: SHA-256 hash of `(text + voice_id)` → cached audio URL. Prevents duplicate renders.
- **Skeleton Loaders**: Shown during diacritization and TTS processing.

### Tashkeel Editor (Core Feature)
- Arabic text parsed into `{ base, marks[] }` segments using Unicode combining marks.
- Clicking a letter opens a popover to toggle diacritics (Fatha, Damma, Kasra, Sukun, Shadda, Tanween).
- Shadda can stack with one vowel mark (linguistically correct).
- Final output is the reconstructed Unicode string sent to TTS.

### Edge Cases Handled
- **Empty/non-Arabic input**: Rejected at sanitization with 400 error.
- **Diacritic stacking**: Shadda + vowel allowed; multiple vowels replaced (not stacked).
- **Rate limit exceeded**: Returns 429 with clear message.
- **TTS service down**: Returns 502 with descriptive error, doesn't expose internals.
- **Cache miss on iOS Shortcut**: Falls through to full diacritize + render pipeline.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health check |
| `POST` | `/api/v1/diacritize` | Auto-diacritize raw Arabic text |
| `POST` | `/api/v1/render` | Render diacritized text to speech (secure proxy) |
| `POST` | `/api/v1/shortcut/render` | iOS Shortcut one-shot: diacritize → render → MP3 URL |

---

## Next Steps

1. **Integrate Mishkal** — Replace the placeholder in `_diacritize_with_mishkal()`
2. **S3/GCS Audio Storage** — Save ElevenLabs MP3 output to cloud storage
3. **Redis Cache** — Replace in-memory dict with Redis for multi-instance deployments
4. **wavesurfer.js** — Wire up the audio player with waveform visualization
5. **Mobile Bottom Sheet** — Voice settings as a slide-up panel on mobile
6. **Next.js API Routes** — Optional: mirror the FastAPI endpoints for serverless deployment
