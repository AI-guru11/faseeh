"""
Fasseeh (فصيح) — Backend API Service
=====================================
A secure FastAPI backend that proxies TTS and diacritization requests.
Handles rate limiting, input sanitization, caching, and the iOS Shortcut endpoint.

Tech: FastAPI + Python 3.11+
External: ElevenLabs TTS, Mishkal/RDI Diacritization
"""

import hashlib
import os
import re
import time
from typing import Optional

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ─── App Init ─────────────────────────────────────────────────────────
app = FastAPI(
    title="Fasseeh API",
    description="Arabic TTS Studio — Secure Backend Proxy",
    version="0.1.1",
)

# ─── Static file serving ──────────────────────────────────────────────
AUDIO_DIR = Path(__file__).parent / "static" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

# CORS — lock down in production
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ─── Config (from .env) ──────────────────────────────────────────────
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"
DEFAULT_VOICE_ID = os.getenv("DEFAULT_VOICE_ID", "pNInz6obpgDQGcFmaJgB")  # "Adam"
MAX_INPUT_LENGTH = int(os.getenv("MAX_INPUT_LENGTH", "5000"))


# ─── Rate Limiter (In-Memory — swap for Redis in production) ─────────
class RateLimiter:
    """Simple sliding-window rate limiter. 10 req/min per IP."""

    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self._store: dict[str, list[float]] = {}

    def is_allowed(self, key: str) -> bool:
        now = time.time()
        timestamps = self._store.get(key, [])
        # Prune expired entries
        timestamps = [t for t in timestamps if now - t < self.window]
        if len(timestamps) >= self.max_requests:
            return False
        timestamps.append(now)
        self._store[key] = timestamps
        return True


rate_limiter = RateLimiter(max_requests=10, window_seconds=60)


# ─── Cache (In-Memory — swap for Redis/S3 in production) ─────────────
audio_cache: dict[str, str] = {}


def cache_key(text: str, voice_id: str) -> str:
    """Generate a deterministic hash for text + voice combination."""
    raw = f"{text}::{voice_id}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ─── Input Sanitization ──────────────────────────────────────────────
ARABIC_PATTERN = re.compile(
    r"[^\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF"
    r"\u0020\u060C\u061B\u061F\u0640\u200C\u200D\u200E\u200F"
    r"\n\r\.\,\!\?]"
)


def sanitize_arabic(text: str) -> str:
    """Strip non-Arabic and non-punctuation characters. Prevent TTS injection."""
    cleaned = ARABIC_PATTERN.sub("", text)
    # Collapse multiple spaces / newlines
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


# ─── Request / Response Models ────────────────────────────────────────
class DiacritizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_INPUT_LENGTH, description="Raw Arabic text")


class DiacritizeResponse(BaseModel):
    original: str
    diacritized: str
    char_count: int


class RenderRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_INPUT_LENGTH, description="Diacritized Arabic text")
    voice_id: Optional[str] = Field(default=None, description="ElevenLabs voice ID")
    stability: Optional[float] = Field(default=0.5, ge=0.0, le=1.0)
    similarity_boost: Optional[float] = Field(default=0.75, ge=0.0, le=1.0)


class RenderResponse(BaseModel):
    audio_url: str
    cached: bool
    text_hash: str


class ShortcutRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_INPUT_LENGTH)


class ShortcutResponse(BaseModel):
    audio_url: str
    diacritized_text: str


class HealthResponse(BaseModel):
    status: str
    version: str


# ─── Middleware: Rate Limiting ────────────────────────────────────────
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Apply rate limiting to all /api/ routes."""
    if request.url.path.startswith("/api/"):
        client_ip = request.client.host if request.client else "unknown"
        if not rate_limiter.is_allowed(client_ip):
            return Response(
                content='{"detail":"Rate limit exceeded. Max 10 requests per minute."}',
                status_code=429,
                media_type="application/json",
            )
    return await call_next(request)


# ─── Routes ──────────────────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Service health check."""
    return HealthResponse(status="ok", version="0.1.0")


# ── 1. Diacritization Endpoint ────────────────────────────────────────
@app.post("/api/v1/diacritize", response_model=DiacritizeResponse)
async def diacritize_text(body: DiacritizeRequest):
    """
    Accept raw Arabic text → return auto-diacritized version.
    Uses Mishkal library (or RDI API) under the hood.
    """
    cleaned = sanitize_arabic(body.text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid Arabic text found after sanitization.")

    # ── Diacritization Logic ──
    # In production: call Mishkal or the RDI API
    # For now, this is a placeholder that returns the cleaned text.
    try:
        diacritized = await _diacritize_with_mishkal(cleaned)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Diacritization service error: {str(exc)}")

    return DiacritizeResponse(
        original=cleaned,
        diacritized=diacritized,
        char_count=len(cleaned),
    )


async def _diacritize_with_mishkal(text: str) -> str:
    """Diacritize the provided Arabic text using the Mishkal library.

    This helper wraps the synchronous Mishkal API in an asynchronous
    coroutine so that it can be awaited within FastAPI endpoints without
    blocking the event loop. If the Mishkal package is not installed,
    a descriptive exception is raised. See the Mishkal documentation for
    details on the ``TashkeelClass`` API【184419036022414†L232-L243】.

    Args:
        text: Raw, unvocalized Arabic text that has already been
            sanitized and validated.

    Returns:
        The diacritized version of ``text`` produced by Mishkal.

    Raises:
        RuntimeError: If the Mishkal library is unavailable.
        Exception: Propagates any other errors from the Mishkal library.
    """
    import asyncio
    try:
        # Import mishkal lazily to avoid an ImportError at module import time
        import mishkal.tashkeel  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Mishkal library is not installed. Please add 'mishkal' to your requirements.txt and install it."
        ) from exc

    # Instantiate the vocalizer once per call. Mishkal maintains internal
    # caches for morphology and syntax, so repeated calls will benefit from
    # warm caches. Running this in a separate thread prevents blocking the
    # event loop.
    def _vocalize(txt: str) -> str:
        vocalizer = mishkal.tashkeel.TashkeelClass()
        return vocalizer.tashkeel(txt)

    # Use asyncio.to_thread (Python 3.9+) to offload the CPU-bound work
    return await asyncio.to_thread(_vocalize, text)


# ── 2. TTS Render Endpoint (Secure Proxy) ────────────────────────────
@app.post("/api/v1/render", response_model=RenderResponse)
async def render_audio(body: RenderRequest):
    """
    Accept diacritized text + voice settings → return audio URL.
    Proxies to ElevenLabs. Never exposes API key to frontend.
    Implements caching: same text+voice = cached audio.
    """
    cleaned = sanitize_arabic(body.text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid Arabic text found.")

    voice_id = body.voice_id or DEFAULT_VOICE_ID
    ck = cache_key(cleaned, voice_id)

    # ── Check cache ──
    if ck in audio_cache:
        return RenderResponse(audio_url=audio_cache[ck], cached=True, text_hash=ck)

    # ── Call ElevenLabs ──
    if not ELEVENLABS_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="TTS service not configured. Set ELEVENLABS_API_KEY.",
        )

    try:
        audio_url = await _call_elevenlabs(
            text=cleaned,
            voice_id=voice_id,
            stability=body.stability,
            similarity_boost=body.similarity_boost,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"TTS service error: {str(exc)}")

    # ── Cache the result ──
    audio_cache[ck] = audio_url

    return RenderResponse(audio_url=audio_url, cached=False, text_hash=ck)


async def _call_elevenlabs(
    text: str,
    voice_id: str,
    stability: float = 0.5,
    similarity_boost: float = 0.75,
) -> str:
    """
    Call ElevenLabs TTS API and return the audio URL.
    In production, save the audio bytes to S3/GCS and return the public URL.
    """
    import httpx

    url = f"{ELEVENLABS_BASE_URL}/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": stability,
            "similarity_boost": similarity_boost,
        },
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()

    # Save MP3 bytes to local static directory
    ck = cache_key(text, voice_id)
    audio_path = AUDIO_DIR / f"{ck}.mp3"
    audio_path.write_bytes(resp.content)
    return f"/static/audio/{ck}.mp3"


# ── 3. iOS Shortcut Endpoint ─────────────────────────────────────────
@app.post("/api/v1/shortcut/render", response_model=ShortcutResponse)
async def shortcut_render(body: ShortcutRequest):
    """
    One-shot endpoint for iOS Shortcuts:
      1. Auto-diacritize
      2. Render audio with default settings
      3. Return direct MP3 link
    """
    cleaned = sanitize_arabic(body.text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid Arabic text.")

    # Step 1: Diacritize
    diacritized = await _diacritize_with_mishkal(cleaned)

    # Step 2: Render with defaults
    voice_id = DEFAULT_VOICE_ID
    ck = cache_key(diacritized, voice_id)

    if ck in audio_cache:
        audio_url = audio_cache[ck]
    else:
        if not ELEVENLABS_API_KEY:
            raise HTTPException(status_code=503, detail="TTS not configured.")
        audio_url = await _call_elevenlabs(text=diacritized, voice_id=voice_id)
        audio_cache[ck] = audio_url

    return ShortcutResponse(audio_url=audio_url, diacritized_text=diacritized)


# ─── Startup ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api_service:app", host="0.0.0.0", port=8000, reload=True)
