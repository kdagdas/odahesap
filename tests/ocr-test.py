"""Synthesize a German receipt and run it through the real OCR prompt on
several Gemini models, so we can pick one before baking it into the config."""
import base64
import io
import json
import os
import sys
import time

import httpx
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "OdaHesap", "backend"))

KEY = os.environ["GEMINI_API_KEY"]
LINES = [
    "REWE Markt GmbH",
    "Hauptstr. 12, 10115 Berlin",
    "--------------------------------",
    "Milch 3,5%          1,49 A",
    "Brot Vollkorn       2,99 A",
    "Butter              2,29 A",
    "Apfel 1kg           1,89 B",
    "Kaese Gouda         3,49 A",
    "2 x Joghurt 0,89    1,78 A",
    "RABATT             -0,50",
    "--------------------------------",
    "MwSt 7%             0,84",
    "Summe EUR          13,43",
    "Bar                15,00",
    "Rueckgeld           1,57",
    "Datum: 12.01.2026 14:22",
]


def receipt_b64() -> str:
    img = Image.new("RGB", (520, 700), (250, 248, 240))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 20)
    except Exception:
        font = ImageFont.load_default()
    y = 20
    for text in LINES:
        d.text((20, y), text, fill=(25, 25, 25), font=font)
        y += 40
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> None:
    # Import the prompt straight from the server so we test what ships.
    import re
    src = open(os.path.join(os.path.dirname(__file__), "..", "OdaHesap", "backend", "server.py"),
               encoding="utf-8").read()
    prompt = re.search(r'OCR_SYSTEM_PROMPT = """(.*?)"""', src, re.S).group(1)

    b64 = receipt_b64()
    for model in sys.argv[1:]:
        payload = {
            "systemInstruction": {"parts": [{"text": prompt}]},
            "contents": [{
                "role": "user",
                "parts": [
                    {"text": "Parse this German receipt and return the strict JSON as specified."},
                    {"inline_data": {"mime_type": "image/jpeg", "data": b64}},
                ],
            }],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
        }
        t0 = time.time()
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": KEY},
            json=payload,
            timeout=120.0,
        )
        dt = time.time() - t0
        print(f"\n===== {model}  HTTP {r.status_code}  {dt:.1f}s =====")
        if r.status_code != 200:
            print(r.text[:400])
            continue
        text = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
        try:
            parsed = json.loads(text[text.find("{"): text.rfind("}") + 1])
        except Exception as e:
            print("JSON parse hatasi:", e, text[:300])
            continue
        print("merchant:", parsed.get("merchant"), "| date:", parsed.get("date"),
              "| total:", parsed.get("total"))
        for it in parsed.get("items", []):
            print(f"   {it.get('name'):<24} qty={it.get('quantity')} price={it.get('price')}")


if __name__ == "__main__":
    main()
