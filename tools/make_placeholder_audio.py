"""Generate placeholder audio for local development.

No encoder dependencies: silent MP3s are emitted as raw MPEG-1 Layer III
frames (128 kbps, 44.1 kHz, mono) whose side info and main data are zeroed,
which every decoder renders as digital silence. The tone files are WAV,
since synthesising an audible signal would require a real MP3 encoder.

Placeholders only. Real audio is pre-generated with ElevenLabs Voice Design
and committed by hand. Run: python tools/make_placeholder_audio.py
"""

import math
import os
import struct
import wave

AUDIO_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "audio")

# MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono, no CRC, no padding.
#   ff       sync
#   fb       sync + MPEG-1 + Layer III + no CRC
#   90       bitrate index 1001 (128 kbps), sample rate 00 (44.1 kHz), no padding
#   c0       channel mode 11 (mono)
FRAME_HEADER = b"\xff\xfb\x90\xc0"
FRAME_BYTES = 417
FRAME_SECONDS = 1152 / 44100.0

SILENT_FILES = [
    "sample_a_flat.mp3",
    "sample_a_designed.mp3",
    "sample_b_flat.mp3",
    "sample_b_designed.mp3",
    "sample_hero_flat.mp3",
    "sample_hero_designed.mp3",
    # Hero stay-slider stops — Week 1 / Month 1 / Month 4 / Year 2 (§6.3).
    "sample_hero_d003.mp3",
    "sample_hero_d030.mp3",
    "sample_hero_d120.mp3",
    "sample_hero_d730.mp3",
]

# Audible pair so the timestamp-preserving swap can be verified by ear.
TONE_FILES = [("test_tone_low.wav", 220.0), ("test_tone_high.wav", 660.0)]

DURATION = 10.0


def write_silent_mp3(path, seconds):
    frames = int(round(seconds / FRAME_SECONDS))
    frame = FRAME_HEADER + b"\x00" * (FRAME_BYTES - len(FRAME_HEADER))
    with open(path, "wb") as fh:
        fh.write(frame * frames)


def write_tone_wav(path, seconds, freq, rate=44100):
    n = int(seconds * rate)
    fade = int(0.01 * rate)  # de-click the ends
    samples = bytearray()
    for i in range(n):
        gain = min(1.0, i / fade, (n - i) / fade)
        value = int(12000 * gain * math.sin(2 * math.pi * freq * i / rate))
        samples += struct.pack("<h", value)
    with wave.open(path, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(rate)
        fh.writeframes(bytes(samples))


def main():
    os.makedirs(AUDIO_DIR, exist_ok=True)
    for name in SILENT_FILES:
        path = os.path.join(AUDIO_DIR, name)
        write_silent_mp3(path, DURATION)
        print("silent  ", name, os.path.getsize(path), "bytes")
    for name, freq in TONE_FILES:
        path = os.path.join(AUDIO_DIR, name)
        write_tone_wav(path, DURATION, freq)
        print("tone    ", name, int(freq), "Hz")


if __name__ == "__main__":
    main()
