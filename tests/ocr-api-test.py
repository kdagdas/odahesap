"""Hit the real /api/ocr/receipt endpoint with a synthesized German receipt."""
import base64
import io
import sys
import uuid

import httpx
from PIL import Image, ImageDraw, ImageFont

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]

LINES = [
    "EDEKA Suedwest",
    "Bahnhofstr. 4, 79098 Freiburg",
    "--------------------------------",
    "Vollmilch 1L        1,19 A",
    "Gouda jung          2,79 A",
    "3 x Broetchen 0,45  1,35 A",
    "Tomaten 500g        1,99 B",
    "Spuelmittel         1,49 A",
    "PAYBACK Rabatt     -1,00",
    "--------------------------------",
    "Summe EUR           7,81",
    "Datum: 28.07.2026",
]


def receipt_b64() -> str:
    img = Image.new("RGB", (520, 560), (252, 250, 245))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 20)
    except Exception:
        font = ImageFont.load_default()
    y = 20
    for line in LINES:
        d.text((20, y), line, fill=(25, 25, 25), font=font)
        y += 40
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> int:
    c = httpx.Client(timeout=180.0)
    mail = f"ocr_{TAG}@odahesap-e2e.com"
    r = c.post(f"{API}/auth/register", json={"email": mail, "password": "sifre123", "name": "OCR Test"})
    r.raise_for_status()
    token = r.json()["session_token"]
    hdr = {"Authorization": f"Bearer {token}"}

    b64 = receipt_b64()
    print(f"gorsel: {len(b64) / 1024:.0f} KB base64")

    r = c.post(f"{API}/ocr/receipt", headers=hdr, json={"image_base64": b64})
    print("HTTP", r.status_code)
    if r.status_code != 200:
        print(r.text[:600])
        return 1

    body = r.json()
    print("merchant :", body.get("merchant"))
    print("date     :", body.get("date"))
    print("total    :", body.get("total"))
    print("currency :", body.get("currency"))
    print("kalemler :")
    for it in body.get("items", []):
        print(f"   {it['name']:<22} qty={it['quantity']:<5} price={it['price']:<7} kategori={it['category']}")

    cats = {it["category"] for it in body.get("items", [])}
    print("\nkategori tespiti:", sorted(cats))
    c.post(f"{API}/auth/logout", headers=hdr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
