#!/usr/bin/env python3
"""Upload audio to OpenRouter and display the transcript in a simple desktop UI."""

from __future__ import annotations

import base64
import json
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk

import requests

OPENROUTER_API_BASE = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "xiaomi/mimo-v2.5"
CONFIG_PATH = Path(__file__).with_name(".openrouter_transcribe_config.json")
MAX_AUDIO_BYTES = 25 * 1024 * 1024

AUDIO_MIME_TYPES = {
    "webm": "audio/webm",
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
    "aac": "audio/aac",
}

TRANSCRIBE_PROMPT = (
    "Listen to this audio and respond with exactly two sections:\n\n"
    "Transcript:\n"
    "Write exactly what was spoken, verbatim. No extra commentary in this section.\n\n"
    "Pronunciation feedback:\n"
    "Comment on pronunciation quality. Note any mispronounced or unclear words, "
    "stress, rhythm, or intonation issues, and give brief constructive tips. "
    "If pronunciation is generally good, say so and mention any small improvements."
)
TEST_PROMPT = "Reply with exactly: OK"


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_config(api_key: str, model: str) -> None:
    CONFIG_PATH.write_text(
        json.dumps({"api_key": api_key, "model": model}, indent=2),
        encoding="utf-8",
    )


def audio_format_from_path(path: Path) -> tuple[str, str]:
    ext = path.suffix.lower().lstrip(".")
    if not ext:
        ext = "webm"
    mime = AUDIO_MIME_TYPES.get(ext, f"audio/{ext}")
    return ext, mime


def build_data_url(audio_bytes: bytes, mime_type: str) -> str:
    encoded = base64.b64encode(audio_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def openrouter_error_message(data: dict | None, status: int) -> str:
    if not data:
        return f"OpenRouter API returned {status}."
    if isinstance(data.get("error"), dict):
        return data["error"].get("message") or f"OpenRouter API returned {status}."
    return data.get("message") or f"OpenRouter API returned {status}."


def openrouter_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/openrouter-audio-transcribe",
        "X-Title": "OpenRouter Audio Transcribe",
    }


def extract_message_text(data: dict) -> str:
    choices = data.get("choices") or []
    if not choices:
        return ""
    content = choices[0].get("message", {}).get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text", "")).strip())
        return " ".join(p for p in parts if p).strip()
    return ""


def test_openrouter_api(api_key: str, model: str) -> dict:
    api_key = api_key.strip()
    model = model.strip() or DEFAULT_MODEL
    if not api_key:
        raise ValueError("Enter your OpenRouter API key.")

    started = time.time()
    response = requests.post(
        f"{OPENROUTER_API_BASE}/chat/completions",
        headers=openrouter_headers(api_key),
        json={
            "model": model,
            "messages": [{"role": "user", "content": TEST_PROMPT}],
            "max_tokens": 16,
        },
        timeout=60,
    )

    try:
        data = response.json()
    except ValueError:
        data = {"message": response.text or response.reason}

    if not response.ok:
        raise RuntimeError(
            f"LLM ({model}): {openrouter_error_message(data, response.status_code)}"
        )

    reply = extract_message_text(data)[:200]
    return {
        "ok": True,
        "model": model,
        "latencyMs": int((time.time() - started) * 1000),
        "reply": reply,
    }


def transcribe_audio(api_key: str, model: str, audio_path: Path) -> str:
    api_key = api_key.strip()
    model = model.strip() or DEFAULT_MODEL
    if not api_key:
        raise ValueError("Enter your OpenRouter API key.")

    audio_bytes = audio_path.read_bytes()
    if not audio_bytes:
        raise ValueError("The selected audio file is empty.")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise ValueError("Audio file is too large (max 25 MB).")

    audio_format, mime_type = audio_format_from_path(audio_path)
    data_url = build_data_url(audio_bytes, mime_type)

    response = requests.post(
        f"{OPENROUTER_API_BASE}/chat/completions",
        headers=openrouter_headers(api_key),
        json={
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": data_url,
                                "format": audio_format,
                            },
                        },
                        {
                            "type": "text",
                            "text": TRANSCRIBE_PROMPT,
                        },
                    ],
                }
            ],
            "max_tokens": 1024,
        },
        timeout=120,
    )

    try:
        data = response.json()
    except ValueError:
        data = {"message": response.text or response.reason}

    if not response.ok:
        raise RuntimeError(
            f"Transcription ({model}): {openrouter_error_message(data, response.status_code)}"
        )

    text = extract_message_text(data)
    if not text:
        raise RuntimeError("Could not transcribe the audio. Try another file or model.")

    return text


class TranscribeApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("OpenRouter Audio Transcribe & Pronunciation")
        self.geometry("760x680")
        self.minsize(640, 520)

        config = load_config()
        self.api_key_var = tk.StringVar(value=config.get("api_key", ""))
        self.model_var = tk.StringVar(value=config.get("model", DEFAULT_MODEL))
        self.audio_path_var = tk.StringVar(value="")
        self.status_var = tk.StringVar(
            value="Choose an audio file, then click Transcribe for transcript and pronunciation feedback."
        )
        self.show_key_var = tk.BooleanVar(value=False)
        self._busy = False

        self._build_ui()

    def _build_ui(self) -> None:
        padding = {"padx": 12, "pady": 6}

        header = ttk.Label(
            self,
            text="Upload audio for transcription and pronunciation feedback",
            font=("Segoe UI", 12, "bold"),
        )
        header.pack(anchor="w", **padding)

        hint = ttk.Label(
            self,
            text="Get an API key at https://openrouter.ai/keys",
            foreground="#555555",
        )
        hint.pack(anchor="w", padx=12, pady=(0, 8))

        form = ttk.Frame(self)
        form.pack(fill="x", padx=12, pady=4)
        form.columnconfigure(1, weight=1)

        ttk.Label(form, text="OpenRouter API key").grid(row=0, column=0, sticky="w", pady=4)
        key_row = ttk.Frame(form)
        key_row.grid(row=0, column=1, sticky="ew", pady=4)
        key_row.columnconfigure(0, weight=1)
        self.api_key_entry = ttk.Entry(key_row, textvariable=self.api_key_var, show="*")
        self.api_key_entry.grid(row=0, column=0, sticky="ew")
        ttk.Checkbutton(
            key_row,
            text="Show",
            variable=self.show_key_var,
            command=self._toggle_key_visibility,
        ).grid(row=0, column=1, padx=(8, 0))

        ttk.Label(form, text="Model").grid(row=1, column=0, sticky="w", pady=4)
        ttk.Entry(form, textvariable=self.model_var).grid(row=1, column=1, sticky="ew", pady=4)
        ttk.Label(
            form,
            text=f"Default: {DEFAULT_MODEL}",
            foreground="#666666",
        ).grid(row=2, column=1, sticky="w")

        ttk.Label(form, text="Audio file").grid(row=3, column=0, sticky="w", pady=4)
        file_row = ttk.Frame(form)
        file_row.grid(row=3, column=1, sticky="ew", pady=4)
        file_row.columnconfigure(0, weight=1)
        ttk.Entry(file_row, textvariable=self.audio_path_var, state="readonly").grid(
            row=0, column=0, sticky="ew"
        )
        ttk.Button(file_row, text="Browse…", command=self._browse_audio).grid(
            row=0, column=1, padx=(8, 0)
        )

        actions = ttk.Frame(self)
        actions.pack(fill="x", padx=12, pady=8)
        self.transcribe_btn = ttk.Button(actions, text="Transcribe", command=self._start_transcribe)
        self.transcribe_btn.pack(side="left")
        self.test_btn = ttk.Button(actions, text="Test API", command=self._start_test_api)
        self.test_btn.pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="Save settings", command=self._save_settings).pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="Copy result", command=self._copy_transcript).pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="Clear", command=self._clear_output).pack(side="left", padx=(8, 0))

        ttk.Label(self, text="Transcript & pronunciation feedback").pack(anchor="w", padx=12, pady=(8, 4))
        self.output = scrolledtext.ScrolledText(self, wrap="word", height=16, font=("Consolas", 11))
        self.output.pack(fill="both", expand=True, padx=12, pady=(0, 8))

        status = ttk.Label(self, textvariable=self.status_var, foreground="#444444")
        status.pack(anchor="w", padx=12, pady=(0, 12))

    def _toggle_key_visibility(self) -> None:
        self.api_key_entry.configure(show="" if self.show_key_var.get() else "*")

    def _browse_audio(self) -> None:
        path = filedialog.askopenfilename(
            title="Select audio file",
            filetypes=[
                ("Audio files", "*.mp3 *.wav *.webm *.m4a *.ogg *.flac *.aac"),
                ("All files", "*.*"),
            ],
        )
        if path:
            self.audio_path_var.set(path)

    def _save_settings(self) -> None:
        save_config(self.api_key_var.get().strip(), self.model_var.get().strip() or DEFAULT_MODEL)
        self.status_var.set(f"Settings saved to {CONFIG_PATH.name}.")

    def _copy_transcript(self) -> None:
        text = self.output.get("1.0", "end").strip()
        if not text:
            messagebox.showinfo("Copy result", "Nothing to copy yet.")
            return
        self.clipboard_clear()
        self.clipboard_append(text)
        self.status_var.set("Result copied to clipboard.")

    def _clear_output(self) -> None:
        self.output.delete("1.0", "end")
        self.status_var.set("Output cleared.")

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        state = "disabled" if busy else "normal"
        self.transcribe_btn.configure(state=state)
        self.test_btn.configure(state=state)

    def _start_test_api(self) -> None:
        if self._busy:
            return

        api_key = self.api_key_var.get().strip()
        model = self.model_var.get().strip() or DEFAULT_MODEL

        if not api_key:
            messagebox.showerror("Missing API key", "Enter your OpenRouter API key.")
            return

        self._set_busy(True)
        self.status_var.set("Testing API with text-only request…")
        self.output.delete("1.0", "end")

        def worker() -> None:
            try:
                result = test_openrouter_api(api_key, model)
            except Exception as exc:  # noqa: BLE001
                self.after(0, lambda: self._on_test_error(str(exc)))
            else:
                self.after(0, lambda: self._on_test_success(result))

        threading.Thread(target=worker, daemon=True).start()

    def _on_test_success(self, result: dict) -> None:
        self.output.insert("1.0", json.dumps(result, indent=2))
        self.status_var.set(f"API test succeeded ({result['latencyMs']} ms).")
        save_config(self.api_key_var.get().strip(), self.model_var.get().strip() or DEFAULT_MODEL)
        self._set_busy(False)

    def _on_test_error(self, message: str) -> None:
        self.status_var.set("API test failed.")
        messagebox.showerror("API test failed", message)
        self._set_busy(False)

    def _start_transcribe(self) -> None:
        if self._busy:
            return

        api_key = self.api_key_var.get().strip()
        model = self.model_var.get().strip() or DEFAULT_MODEL
        audio_path = self.audio_path_var.get().strip()

        if not api_key:
            messagebox.showerror("Missing API key", "Enter your OpenRouter API key.")
            return
        if not audio_path:
            messagebox.showerror("Missing audio", "Choose an audio file first.")
            return

        path = Path(audio_path)
        if not path.is_file():
            messagebox.showerror("Missing audio", "The selected audio file was not found.")
            return

        self._set_busy(True)
        self.status_var.set("Transcribing and reviewing pronunciation…")
        self.output.delete("1.0", "end")

        def worker() -> None:
            try:
                transcript = transcribe_audio(api_key, model, path)
            except Exception as exc:  # noqa: BLE001 - show any failure in the UI
                self.after(0, lambda: self._on_transcribe_error(str(exc)))
            else:
                self.after(0, lambda: self._on_transcribe_success(transcript))

        threading.Thread(target=worker, daemon=True).start()

    def _on_transcribe_success(self, transcript: str) -> None:
        self.output.insert("1.0", transcript)
        save_config(self.api_key_var.get().strip(), self.model_var.get().strip() or DEFAULT_MODEL)
        self.status_var.set("Transcription and pronunciation feedback complete.")
        self._set_busy(False)

    def _on_transcribe_error(self, message: str) -> None:
        self.status_var.set("Transcription failed.")
        messagebox.showerror("Transcription failed", message)
        self._set_busy(False)


def main() -> None:
    app = TranscribeApp()
    app.mainloop()


if __name__ == "__main__":
    main()
