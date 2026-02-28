#!/usr/bin/env python3
import argparse
import json
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe audio via faster-whisper")
    parser.add_argument("--input", required=True, help="Path to WAV file")
    parser.add_argument("--model", required=True, help="Model name or path")
    parser.add_argument("--device", default="auto", help="auto|cpu|cuda")
    parser.add_argument("--compute-type", default="int8", help="int8|float16|float32|...")
    parser.add_argument("--language", default=None, help="ru|en|...")
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--best-of", type=int, default=5)
    parser.add_argument("--cpu-threads", type=int, default=0)
    parser.add_argument("--initial-prompt", default=None)
    parser.add_argument("--vad-filter", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # noqa: BLE001
        print(f"faster-whisper import failed: {exc}", file=sys.stderr)
        return 2

    model_kwargs = {
        "device": args.device,
        "compute_type": args.compute_type,
    }
    if args.cpu_threads and args.cpu_threads > 0:
        model_kwargs["cpu_threads"] = args.cpu_threads

    try:
        model = WhisperModel(args.model, **model_kwargs)
    except Exception as exc:  # noqa: BLE001
        print(f"WhisperModel init failed: {exc}", file=sys.stderr)
        return 3

    transcribe_kwargs = {
        "beam_size": max(1, args.beam_size),
        "best_of": max(1, args.best_of),
        "vad_filter": bool(args.vad_filter),
    }
    if args.language and args.language.lower() != "auto":
        transcribe_kwargs["language"] = args.language
    if args.initial_prompt:
        transcribe_kwargs["initial_prompt"] = args.initial_prompt

    try:
        segments, info = model.transcribe(args.input, **transcribe_kwargs)
        text = " ".join(segment.text.strip() for segment in segments if segment.text).strip()
    except Exception as exc:  # noqa: BLE001
        print(f"faster-whisper transcribe failed: {exc}", file=sys.stderr)
        return 4

    payload = {
        "text": text,
        "language": getattr(info, "language", None),
        "duration": getattr(info, "duration", None),
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
