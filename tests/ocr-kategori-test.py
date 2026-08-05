"""Gemini kategori atamasi gercekten calisiyor mu?

Onceki anahtar kelime listesi Almanca'ydi ve gercek veride kalemlerin
%56'sini "diger"e dusuruyordu — cunku evin alisverisinin yarisi Turk
marketinden ve urun adlari Turkce. Bu test tam da o kalemleri iceren
sentetik bir fis uretip modelin dogru siniflandirip siniflandirmadigina
bakar.
"""
import base64
import io
import sys
import uuid

import httpx
from PIL import Image, ImageDraw, ImageFont

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
TAG = uuid.uuid4().hex[:8]

# (fisteki yazi, beklenen kategori) — hicbiri Almanca anahtar kelimeyle bulunamaz
BEKLENEN = [
    ("TUNA DILIM SUCUK    4,20", "et_balik"),
    ("YOREM DILIM KASAR   3,80", "sut_urunleri"),
    ("CAYKUR FILIZ CAY    5,50", "icecek"),
    ("PIYALE ARPA SEHRIYE 1,90", "temel_gida"),
    ("Goldaehren Brot     2,49", "firin"),
    ("Bingo TEMIZLIK HAVL 3,20", "ev_urunleri"),
    ("YAYLA CIG KOFTE     4,00", "temel_gida"),
    ("Snack-Mandeln       2,80", "atistirmalik"),
]


def fis_b64():
    img = Image.new("RGB", (560, 620), (252, 250, 246))
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 19)
        fb = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", 22)
    except Exception:
        f = fb = ImageFont.load_default()
    y = 20
    d.text((20, y), "ANKARA SUPERMARKT", fill=(20, 20, 20), font=fb); y += 34
    d.text((20, y), "Hauptstr. 5, Berlin", fill=(20, 20, 20), font=f); y += 30
    d.text((20, y), "-" * 34, fill=(20, 20, 20), font=f); y += 28
    for satir, _ in BEKLENEN:
        d.text((20, y), satir, fill=(20, 20, 20), font=f); y += 30
    d.text((20, y), "-" * 34, fill=(20, 20, 20), font=f); y += 28
    d.text((20, y), "Summe EUR          27,89", fill=(20, 20, 20), font=fb); y += 32
    d.text((20, y), "Datum: 04.08.2026", fill=(20, 20, 20), font=f)
    buf = io.BytesIO(); img.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode("ascii")


c = httpx.Client(timeout=180.0)
tok = c.post(f"{API}/auth/register", json={
    "email": f"okat_{TAG}@odahesap-e2e.com", "password": "sifre123", "name": "OCR Kat"}
).json()["session_token"]
h = {"Authorization": f"Bearer {tok}"}

r = c.post(f"{API}/ocr/receipt", headers=h, json={"image_base64": fis_b64()})
print("HTTP", r.status_code)
if r.status_code != 200:
    print(r.text[:400]); sys.exit(1)

body = r.json()
print("market:", body.get("merchant"), "| tarih:", body.get("date"), "\n")

okunan = {it["name"].upper(): it["category"] for it in body.get("items", [])}
dogru = yanlis = bulunamadi = 0
for satir, beklenen in BEKLENEN:
    ad = satir.rsplit(" ", 1)[0].strip().upper()
    esles = next((v for k, v in okunan.items() if k[:10] in ad or ad[:10] in k), None)
    if esles is None:
        print(f"  [?]    {ad[:26]:<26} okunamadi")
        bulunamadi += 1
    elif esles == beklenen:
        print(f"  [OK]   {ad[:26]:<26} -> {esles}")
        dogru += 1
    else:
        print(f"  [FARK] {ad[:26]:<26} -> {esles}  (beklenen {beklenen})")
        yanlis += 1

diger = sum(1 for v in okunan.values() if v == "diger")
print(f"\ndogru: {dogru}/{len(BEKLENEN)} · farkli: {yanlis} · okunamayan: {bulunamadi}")
print(f"'diger'e dusen: {diger}/{len(okunan)}  (eski sistemde bu oran %56'ydi)")

c.post(f"{API}/auth/logout", headers=h)
# Ceyregi bile yanlissa gecmemis sayilir; model tam isabet garanti etmez ama
# eski %56'lik "diger" oranindan belirgin sekilde iyi olmali.
sys.exit(0 if dogru >= len(BEKLENEN) * 0.75 else 1)
