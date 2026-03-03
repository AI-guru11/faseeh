"use client";
import { useState, useRef, useCallback, useEffect } from "react";

// ─── Unicode Constants ────────────────────────────────────────────────
const DIACRITICS = {
  fatha:    { char: "\u064E", label: "فَتحة",   preview: "َ" },
  damma:    { char: "\u064F", label: "ضَمّة",   preview: "ُ" },
  kasra:    { char: "\u0650", label: "كَسرة",   preview: "ِ" },
  sukun:    { char: "\u0652", label: "سُكون",   preview: "ْ" },
  shadda:   { char: "\u0651", label: "شَدّة",   preview: "ّ" },
  fathatan: { char: "\u064B", label: "فتحتان", preview: "ً" },
  dammatan: { char: "\u064C", label: "ضمتان",  preview: "ٌ" },
  kasratan: { char: "\u064D", label: "كسرتان", preview: "ٍ" },
};

const DIACRITIC_CHARS = new Set(Object.values(DIACRITICS).map((d) => d.char));
const ARABIC_RANGE = /[\u0600-\u06FF]/;

// ─── Helpers ──────────────────────────────────────────────────────────

/** Parse raw Arabic string into structured segments: { base, marks[] } */
function parseArabicText(text) {
  const segments = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (DIACRITIC_CHARS.has(ch)) {
      // Attach mark to the previous segment
      if (segments.length > 0) {
        segments[segments.length - 1].marks.push(ch);
      }
    } else {
      segments.push({ base: ch, marks: [] });
    }
  }
  return segments;
}

/** Reconstruct plain text from segments */
function segmentsToText(segments) {
  return segments.map((s) => s.base + s.marks.join("")).join("");
}

// ─── Popover Component ───────────────────────────────────────────────
function DiacriticPopover({ segment, position, onSelect, onRemove, onClose }) {
  const popoverRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Determine which diacritics are already applied
  const activeMarks = new Set(segment.marks);

  return (
    <div
      ref={popoverRef}
      className="diacritic-popover"
      style={{
        position: "fixed",
        top: position.y,
        left: position.x,
        transform: "translateX(-50%)",
        zIndex: 1000,
      }}
    >
      <div className="popover-header">
        <span className="popover-preview-letter">
          {segment.base}
        </span>
        <span className="popover-title">تشكيل الحرف</span>
      </div>
      <div className="popover-grid">
        {Object.entries(DIACRITICS).map(([key, { char, label, preview }]) => {
          const isActive = activeMarks.has(char);
          return (
            <button
              key={key}
              className={`popover-btn ${isActive ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(char);
              }}
              title={label}
            >
              <span className="popover-btn-char">ـ{preview}</span>
              <span className="popover-btn-label">{label}</span>
            </button>
          );
        })}
      </div>
      <button
        className="popover-remove-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        إزالة كل التشكيل
      </button>
    </div>
  );
}

// ─── Character Tile ──────────────────────────────────────────────────
function CharTile({ segment, index, isSelected, onClick }) {
  const isArabicLetter = ARABIC_RANGE.test(segment.base) && segment.base.trim() !== "";
  const isSpace = segment.base === " ";
  const hasMarks = segment.marks.length > 0;

  return (
    <span
      className={`char-tile ${isArabicLetter ? "arabic" : "non-arabic"} ${
        isSelected ? "selected" : ""
      } ${isSpace ? "space" : ""} ${hasMarks ? "has-marks" : ""}`}
      onClick={(e) => {
        if (isArabicLetter) onClick(index, e);
      }}
      data-index={index}
    >
      {segment.base}
      {segment.marks.map((m, i) => (
        <span key={i} className="mark">
          {m}
        </span>
      ))}
    </span>
  );
}

// ─── Main Editor Component ───────────────────────────────────────────
export default function TashkeelEditor() {
  const [rawText, setRawText] = useState(
    "بسم الله الرحمن الرحيم"
  );
  const [segments, setSegments] = useState(() => parseArabicText("بسم الله الرحمن الرحيم"));
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const [isEditMode, setIsEditMode] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);
  const errorTimerRef = useRef(null);

  const voices = [
    { name: "أحمد", desc: "صوت رجالي — رسمي", emoji: "🎙", voiceId: "pNInz6obpgDQGcFmaJgB" },
    { name: "فاطمة", desc: "صوت نسائي — دافئ", emoji: "🎤", voiceId: "EXAVITQu4vr4xnSDxMaL" },
    { name: "يوسف", desc: "صوت رجالي — شبابي", emoji: "🎧", voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
  ];

  // Show error with auto-dismiss after 6 seconds
  const showError = useCallback((msg) => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 6000);
  }, []);

  // Parse error detail from API response or fallback to generic message
  const parseApiError = async (res, fallback) => {
    try {
      const data = await res.json();
      return data.detail || fallback;
    } catch {
      if (res.status === 429) return "تم تجاوز حد الطلبات. حاول مرة أخرى بعد دقيقة.";
      if (res.status >= 500) return "خطأ في الخادم. تأكد من تشغيل الخدمة الخلفية.";
      return fallback;
    }
  };

  // Sync character count
  useEffect(() => {
    const plainText = segmentsToText(segments).replace(/[\u064B-\u0652]/g, "");
    setCharCount(plainText.length);
  }, [segments]);

  // Switch from raw input to structured editor
  const handleActivateEditor = useCallback(() => {
    const parsed = parseArabicText(rawText);
    setSegments(parsed);
    setIsEditMode(true);
    setSelectedIndex(null);
  }, [rawText]);

  // Handle clicking a character tile
  const handleCharClick = useCallback((index, event) => {
    const rect = event.target.getBoundingClientRect();
    setPopoverPos({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
    });
    setSelectedIndex(index);
  }, []);

  // Apply a diacritic to the selected character
  const handleSelectDiacritic = useCallback(
    (diacriticChar) => {
      if (selectedIndex === null) return;
      setSegments((prev) => {
        const next = prev.map((s, i) => {
          if (i !== selectedIndex) return s;
          const marks = [...s.marks];
          const existingIdx = marks.indexOf(diacriticChar);
          if (existingIdx >= 0) {
            // Toggle off if already present
            marks.splice(existingIdx, 1);
          } else {
            // Replace non-shadda marks (allow shadda to stack with one vowel)
            const isShadda = diacriticChar === DIACRITICS.shadda.char;
            const filtered = isShadda
              ? marks
              : marks.filter((m) => m === DIACRITICS.shadda.char);
            filtered.push(diacriticChar);
            return { ...s, marks: filtered };
          }
          return { ...s, marks };
        });
        return next;
      });
    },
    [selectedIndex]
  );

  // Remove all diacritics from the selected character
  const handleRemoveMarks = useCallback(() => {
    if (selectedIndex === null) return;
    setSegments((prev) =>
      prev.map((s, i) => (i === selectedIndex ? { ...s, marks: [] } : s))
    );
    setSelectedIndex(null);
  }, [selectedIndex]);

  // Auto-diacritize via backend API
  const handleAutoDiacritize = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const plainText = segmentsToText(segments).replace(/[\u064B-\u0652]/g, "");
      const res = await fetch("/api/v1/diacritize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: plainText }),
      });
      if (!res.ok) {
        const msg = await parseApiError(res, "فشل التشكيل التلقائي. حاول مرة أخرى.");
        showError(msg);
        setIsProcessing(false);
        return;
      }
      const data = await res.json();
      setSegments(parseArabicText(data.diacritized));
    } catch (err) {
      console.error("Auto-diacritize error:", err);
      showError("تعذر الاتصال بالخادم. تأكد من تشغيل الخدمة الخلفية.");
    }
    setIsProcessing(false);
  }, [segments, showError]);

  // Generate audio via backend
  const handleGenerateAudio = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const text = segmentsToText(segments);
      const res = await fetch("/api/v1/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice_id: voices[selectedVoice].voiceId }),
      });
      if (!res.ok) {
        const msg = await parseApiError(res, "فشل توليد الصوت. حاول مرة أخرى.");
        showError(msg);
        setIsGenerating(false);
        return;
      }
      const data = await res.json();
      setAudioUrl(data.audio_url);
      setIsPlaying(false);
    } catch (err) {
      console.error("Generate audio error:", err);
      showError("تعذر الاتصال بالخادم. تأكد من تشغيل الخدمة الخلفية.");
    }
    setIsGenerating(false);
  }, [segments, selectedVoice, showError]);

  // Play / pause toggle
  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  }, [audioUrl, isPlaying]);

  // Get final output text
  const outputText = segmentsToText(segments);

  return (
    <div className="fasseeh-root" dir="rtl">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap');

        .fasseeh-root {
          --navy: #0B1220;
          --navy-light: #111B2E;
          --navy-mid: #162236;
          --teal: #2DD4BF;
          --teal-dim: rgba(45, 212, 191, 0.15);
          --teal-glow: rgba(45, 212, 191, 0.3);
          --text-primary: #E2E8F0;
          --text-secondary: #94A3B8;
          --text-muted: #64748B;
          --border: rgba(45, 212, 191, 0.12);
          --danger: #F87171;

          font-family: 'IBM Plex Sans Arabic', sans-serif;
          line-height: 1.9;
          background: var(--navy);
          color: var(--text-primary);
          min-height: 100vh;
          padding: 0;
          margin: 0;
        }

        /* ── App Shell ────────────────────────────── */
        .app-container {
          max-width: 1280px;
          margin: 0 auto;
          padding: 32px 24px;
        }

        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 32px;
          padding-bottom: 20px;
          border-bottom: 1px solid var(--border);
        }

        .app-logo {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .app-logo-icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--teal), #06B6D4);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
          color: var(--navy);
        }

        .app-logo-text {
          font-size: 24px;
          font-weight: 700;
          background: linear-gradient(135deg, var(--teal), #06B6D4);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .app-logo-sub {
          font-size: 13px;
          color: var(--text-muted);
          font-weight: 400;
        }

        /* ── Dashboard Layout ─────────────────────── */
        .dashboard {
          display: grid;
          grid-template-columns: 1fr 380px;
          gap: 24px;
        }

        @media (max-width: 900px) {
          .dashboard {
            grid-template-columns: 1fr;
          }
        }

        /* ── Card ─────────────────────────────────── */
        .card {
          background: var(--navy-light);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 24px;
          position: relative;
          overflow: hidden;
        }

        .card::before {
          content: '';
          position: absolute;
          top: 0;
          right: 0;
          left: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--teal-glow), transparent);
        }

        .card-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--teal);
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .card-title-icon {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--teal);
          box-shadow: 0 0 8px var(--teal-glow);
        }

        /* ── Textarea ─────────────────────────────── */
        .input-area {
          width: 100%;
          min-height: 140px;
          background: var(--navy-mid);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          color: var(--text-primary);
          font-family: 'IBM Plex Sans Arabic', sans-serif;
          font-size: 18px;
          line-height: 1.9;
          resize: vertical;
          direction: rtl;
          outline: none;
          transition: border-color 0.2s;
        }

        .input-area:focus {
          border-color: var(--teal);
          box-shadow: 0 0 0 3px var(--teal-dim);
        }

        .input-area::placeholder {
          color: var(--text-muted);
        }

        /* ── Editor Surface ───────────────────────── */
        .editor-surface {
          background: var(--navy-mid);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px;
          min-height: 140px;
          line-height: 2.2;
          font-size: 24px;
          cursor: default;
          position: relative;
        }

        .editor-surface .char-tile {
          display: inline;
          cursor: pointer;
          padding: 2px 1px;
          border-radius: 4px;
          transition: background 0.15s, color 0.15s;
          position: relative;
        }

        .char-tile.arabic:hover {
          background: var(--teal-dim);
        }

        .char-tile.selected {
          background: var(--teal-dim);
          outline: 2px solid var(--teal);
          outline-offset: 1px;
          border-radius: 4px;
        }

        .char-tile.has-marks {
          color: var(--teal);
        }

        .char-tile.space {
          display: inline;
          width: 8px;
        }

        .char-tile.non-arabic {
          cursor: default;
        }

        .char-tile .mark {
          color: var(--teal);
        }

        /* ── Popover ──────────────────────────────── */
        .diacritic-popover {
          background: var(--navy-light);
          border: 1px solid var(--teal);
          border-radius: 14px;
          padding: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 30px var(--teal-dim);
          min-width: 280px;
          animation: popover-in 0.18s ease-out;
        }

        @keyframes popover-in {
          from { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(0.96); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }

        .popover-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border);
        }

        .popover-preview-letter {
          font-size: 28px;
          font-weight: 700;
          color: var(--teal);
          min-width: 36px;
          text-align: center;
        }

        .popover-title {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .popover-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
          margin-bottom: 10px;
        }

        .popover-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 8px 4px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--navy-mid);
          color: var(--text-primary);
          cursor: pointer;
          transition: all 0.15s;
          font-family: 'IBM Plex Sans Arabic', sans-serif;
        }

        .popover-btn:hover {
          border-color: var(--teal);
          background: var(--teal-dim);
        }

        .popover-btn.active {
          border-color: var(--teal);
          background: var(--teal-dim);
          box-shadow: 0 0 8px var(--teal-dim);
        }

        .popover-btn-char {
          font-size: 20px;
          line-height: 1.2;
        }

        .popover-btn-label {
          font-size: 10px;
          color: var(--text-muted);
        }

        .popover-remove-btn {
          width: 100%;
          padding: 8px;
          border-radius: 8px;
          border: 1px solid rgba(248, 113, 113, 0.2);
          background: rgba(248, 113, 113, 0.08);
          color: var(--danger);
          cursor: pointer;
          font-family: 'IBM Plex Sans Arabic', sans-serif;
          font-size: 12px;
          transition: background 0.15s;
        }

        .popover-remove-btn:hover {
          background: rgba(248, 113, 113, 0.15);
        }

        /* ── Buttons ──────────────────────────────── */
        .btn-row {
          display: flex;
          gap: 10px;
          margin-top: 16px;
          flex-wrap: wrap;
        }

        .btn {
          padding: 10px 20px;
          border-radius: 10px;
          border: none;
          font-family: 'IBM Plex Sans Arabic', sans-serif;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .btn-primary {
          background: linear-gradient(135deg, var(--teal), #06B6D4);
          color: var(--navy);
        }

        .btn-primary:hover {
          box-shadow: 0 4px 20px var(--teal-glow);
          transform: translateY(-1px);
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .btn-secondary {
          background: var(--navy-mid);
          border: 1px solid var(--border);
          color: var(--text-primary);
        }

        .btn-secondary:hover {
          border-color: var(--teal);
        }

        .btn-ghost {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-secondary);
        }

        .btn-ghost:hover {
          border-color: var(--teal);
          color: var(--text-primary);
        }

        /* ── Char counter ─────────────────────────── */
        .char-counter {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 12px;
          font-size: 12px;
          color: var(--text-muted);
        }

        .char-counter-badge {
          background: var(--navy-mid);
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
        }

        /* ── Sidebar ──────────────────────────────── */
        .sidebar-section {
          margin-bottom: 16px;
        }

        .sidebar-section:last-child {
          margin-bottom: 0;
        }

        .voice-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--navy-mid);
          cursor: pointer;
          transition: all 0.15s;
          margin-bottom: 8px;
        }

        .voice-card:hover, .voice-card.active {
          border-color: var(--teal);
          background: var(--teal-dim);
        }

        .voice-avatar {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--teal-dim), var(--navy));
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
        }

        .voice-info {
          flex: 1;
        }

        .voice-name {
          font-size: 14px;
          font-weight: 600;
        }

        .voice-desc {
          font-size: 11px;
          color: var(--text-muted);
        }

        .voice-check {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          transition: all 0.15s;
        }

        .voice-card.active .voice-check {
          border-color: var(--teal);
          background: var(--teal);
          color: var(--navy);
        }

        /* ── Audio Player Placeholder ─────────────── */
        .audio-player {
          background: var(--navy-mid);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .waveform-placeholder {
          flex: 1;
          height: 40px;
          background: repeating-linear-gradient(
            90deg,
            var(--teal-dim) 0px,
            var(--teal-dim) 2px,
            transparent 2px,
            transparent 5px
          );
          border-radius: 6px;
          opacity: 0.4;
        }

        .play-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--teal);
          border: none;
          color: var(--navy);
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: box-shadow 0.2s;
          flex-shrink: 0;
        }

        .play-btn:hover {
          box-shadow: 0 0 16px var(--teal-glow);
        }

        /* ── Skeleton Loader ──────────────────────── */
        .skeleton {
          background: linear-gradient(90deg, var(--navy-mid) 25%, var(--navy-light) 50%, var(--navy-mid) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
          border-radius: 8px;
        }

        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        .skeleton-line {
          height: 20px;
          margin-bottom: 10px;
          border-radius: 6px;
        }

        .skeleton-line:last-child {
          width: 60%;
        }

        /* ── Output Box ───────────────────────────── */
        .output-box {
          background: var(--navy-mid);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 14px;
          font-size: 13px;
          color: var(--text-secondary);
          word-break: break-all;
          max-height: 100px;
          overflow-y: auto;
          margin-top: 12px;
          font-family: 'IBM Plex Sans Arabic', monospace;
        }

        .mode-toggle {
          display: flex;
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid var(--border);
          margin-bottom: 16px;
        }

        .mode-toggle-btn {
          flex: 1;
          padding: 8px;
          border: none;
          background: var(--navy-mid);
          color: var(--text-secondary);
          font-family: 'IBM Plex Sans Arabic', sans-serif;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .mode-toggle-btn.active {
          background: var(--teal-dim);
          color: var(--teal);
          font-weight: 600;
        }

        /* ── Error Banner ────────────────────────── */
        .error-banner {
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.3);
          border-radius: 10px;
          padding: 12px 16px;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          animation: error-in 0.25s ease-out;
        }

        @keyframes error-in {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .error-banner-text {
          font-size: 13px;
          color: var(--danger);
          flex: 1;
        }

        .error-banner-close {
          background: none;
          border: none;
          color: var(--danger);
          cursor: pointer;
          font-size: 16px;
          padding: 2px 6px;
          border-radius: 4px;
          opacity: 0.7;
          transition: opacity 0.15s;
          flex-shrink: 0;
        }

        .error-banner-close:hover {
          opacity: 1;
        }
      `}</style>

      <div className="app-container">
        {/* ── Header ──────────────────────────────── */}
        <header className="app-header">
          <div className="app-logo">
            <div className="app-logo-icon">ف</div>
            <div>
              <div className="app-logo-text">فصيح</div>
              <div className="app-logo-sub">Fasseeh — Arabic TTS Studio</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            v0.1.0 — Tashkeel Editor
          </div>
        </header>

        {/* ── Error Banner ─────────────────────────── */}
        {error && (
          <div className="error-banner">
            <span className="error-banner-text">{error}</span>
            <button className="error-banner-close" onClick={() => setError(null)}>
              ✕
            </button>
          </div>
        )}

        {/* ── Dashboard ──────────────────────────── */}
        <div className="dashboard">
          {/* ─ RIGHT: Editor Panel ─────────────── */}
          <div>
            <div className="card">
              <div className="card-title">
                <span className="card-title-icon" />
                محرر التشكيل — Tashkeel Editor
              </div>

              <div className="mode-toggle">
                <button
                  className={`mode-toggle-btn ${!isEditMode ? "active" : ""}`}
                  onClick={() => setIsEditMode(false)}
                >
                  إدخال النص
                </button>
                <button
                  className={`mode-toggle-btn ${isEditMode ? "active" : ""}`}
                  onClick={handleActivateEditor}
                >
                  تحرير التشكيل
                </button>
              </div>

              {!isEditMode ? (
                <textarea
                  className="input-area"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="اكتب النص العربي هنا..."
                />
              ) : isProcessing ? (
                <div className="editor-surface">
                  <div className="skeleton skeleton-line" style={{ width: "90%" }} />
                  <div className="skeleton skeleton-line" style={{ width: "75%" }} />
                  <div className="skeleton skeleton-line" />
                </div>
              ) : (
                <div className="editor-surface">
                  {segments.map((seg, i) => (
                    <CharTile
                      key={i}
                      segment={seg}
                      index={i}
                      isSelected={selectedIndex === i}
                      onClick={handleCharClick}
                    />
                  ))}
                </div>
              )}

              <div className="char-counter">
                <span>{isEditMode ? "اضغط على أي حرف لتعديل تشكيله" : "أدخل النص ثم انتقل لوضع التحرير"}</span>
                <span className="char-counter-badge">{charCount} حرف</span>
              </div>

              <div className="btn-row">
                {!isEditMode ? (
                  <button className="btn btn-primary" onClick={handleActivateEditor}>
                    ✦ تحرير التشكيل
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={handleAutoDiacritize}
                      disabled={isProcessing}
                    >
                      {isProcessing ? "⏳ جارٍ التشكيل..." : "✦ تشكيل تلقائي"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setIsEditMode(false)}
                    >
                      ← العودة للإدخال
                    </button>
                  </>
                )}
              </div>

              {isEditMode && (
                <div className="output-box">
                  <strong style={{ color: "var(--teal)", fontSize: 11 }}>
                    النص النهائي (Unicode):
                  </strong>
                  <br />
                  {outputText}
                </div>
              )}
            </div>
          </div>

          {/* ─ LEFT: Sidebar ──────────────────── */}
          <div>
            {/* Voice Selection */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-title">
                <span className="card-title-icon" />
                اختيار الصوت
              </div>

              {voices.map((voice, i) => (
                <div
                  key={voice.name}
                  className={`voice-card ${i === selectedVoice ? "active" : ""}`}
                  onClick={() => setSelectedVoice(i)}
                >
                  <div className="voice-avatar">{voice.emoji}</div>
                  <div className="voice-info">
                    <div className="voice-name">{voice.name}</div>
                    <div className="voice-desc">{voice.desc}</div>
                  </div>
                  <div className="voice-check">{i === selectedVoice ? "✓" : ""}</div>
                </div>
              ))}
            </div>

            {/* Audio Player */}
            <div className="card">
              <div className="card-title">
                <span className="card-title-icon" />
                مشغل الصوت
              </div>

              <audio
                ref={audioRef}
                src={audioUrl || undefined}
                onEnded={() => setIsPlaying(false)}
                style={{ display: "none" }}
              />
              <div className="audio-player">
                <button
                  className="play-btn"
                  onClick={handlePlayPause}
                  disabled={!audioUrl}
                  style={{ opacity: audioUrl ? 1 : 0.4 }}
                >
                  {isPlaying ? "⏸" : "▶"}
                </button>
                <div className="waveform-placeholder" />
              </div>

              <div className="btn-row" style={{ marginTop: 14 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleGenerateAudio}
                  disabled={isGenerating}
                >
                  {isGenerating ? "⏳ جارٍ التوليد..." : "🔊 توليد الصوت"}
                </button>
              </div>
              <div className="btn-row">
                {audioUrl ? (
                  <a
                    href={audioUrl}
                    download="faseeh-audio.mp3"
                    className="btn btn-ghost"
                    style={{ flex: 1, fontSize: 12, textDecoration: "none", textAlign: "center", justifyContent: "center" }}
                  >
                    ↓ تحميل MP3
                  </a>
                ) : (
                  <button className="btn btn-ghost" style={{ flex: 1, fontSize: 12 }} disabled>
                    ↓ تحميل MP3
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Popover (Portal-like) ─────────────── */}
      {selectedIndex !== null && isEditMode && (
        <DiacriticPopover
          segment={segments[selectedIndex]}
          position={popoverPos}
          onSelect={handleSelectDiacritic}
          onRemove={handleRemoveMarks}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </div>
  );
}
