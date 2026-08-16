"""Fis kucultme esigini OLCER -- tahminle dusurmemek icin.

`src/photo.ts` icindeki `RECEIPT_MAX_EDGE` bugun 2000. Daha asagisi (1600,
1200) muhtemelen calisir ve daha hizlidir, ama **tahminle dusurmek fisin
yarisini sessizce kaybettirebilir**: cikan kalem sayisi azalir, kimse fark
etmez, harcama eksik kaydedilir. Bu betik ayni fisi birden fazla boyutta
taratip sureyi ve cikan kalem sayisini yan yana koyuyor.

    cd backend
    .venv/Scripts/python.exe ../tests/fis-olcum.py <fis.jpg> [BASE] [--boyut 2000,1600,1200]

BASE verilmezse yerel sunucu (http://127.0.0.1:8099) kullanilir.

## UYARI -- kota

Her boyut BIR Gemini istegi demektir ve o kota **evin gunluk kullanimindan
calinir**. Ucretsiz katman arka arkaya iki taramayi kaldirmiyor (olculdu:
1. istek 200, 2. istek 429), o yuzden betik istekler arasinda **varsayilan
70 saniye bekliyor**. Uc boyutluk bir olcum ~2,5 dakika surer ve 3 istek
harcar. Faturalandirma acilirsa `--bekle 0` ile hizlandirilabilir.

Kararı VERI ile verin: en kucuk boyut, kalem sayisi buyugunkiyle AYNI kalan
boyuttur. Bir kalem bile eksiliyorsa bir ust boyutta kalin.
"""
import io
import sys
import time
import base64
from pathlib import Path

import httpx
from PIL import Image

args = [a for a in sys.argv[1:]]


def flag(ad, varsayilan):
    if ad in args:
        i = args.index(ad)
        deger = args[i + 1]
        del args[i:i + 2]
        return deger
    return varsayilan


boyutlar = [int(x) for x in flag("--boyut", "2000,1600,1200").split(",")]
bekle = int(flag("--bekle", "70"))

if not args:
    print(__doc__)
    sys.exit(2)

fis = Path(args[0])
if not fis.exists():
    print(f"Dosya yok: {fis}")
    sys.exit(2)

BASE = (args[1] if len(args) > 1 else "http://127.0.0.1:8099").rstrip("/")
API = f"{BASE}/api"

EPOSTA = "olcum@odahesap-e2e.com"
SIFRE = "sifre123"

c = httpx.Client(timeout=180.0)

# Olcum icin kendi hesabini kurar; uretim hesabina dokunmaz.
r = c.post(f"{API}/auth/register", json={"email": EPOSTA, "password": SIFRE, "name": "Olcum"})
if r.status_code >= 400:
    r = c.post(f"{API}/auth/login", json={"email": EPOSTA, "password": SIFRE})
    r.raise_for_status()
tok = r.json()["session_token"]
hdr = {"Authorization": f"Bearer {tok}"}

ham = Image.open(fis)
print(f"Kaynak: {fis.name} · {ham.width}x{ham.height} · {fis.stat().st_size // 1024} KB")
print(f"Boyutlar: {boyutlar} · istekler arasi bekleme {bekle} sn\n")

sonuc = []
for i, hedef in enumerate(boyutlar):
    im = ham.copy()
    if im.mode != "RGB":
        im = im.convert("RGB")
    uzun = max(im.width, im.height)
    if uzun > hedef:
        oran = hedef / uzun
        im = im.resize((round(im.width * oran), round(im.height * oran)), Image.LANCZOS)
    buf = io.BytesIO()
    # Uygulamadaki ayarin aynisi: kucultulmus goruntude 0.8 kalite.
    im.save(buf, format="JPEG", quality=80)
    b64 = base64.b64encode(buf.getvalue()).decode()

    bas = time.time()
    r = c.post(f"{API}/ocr/receipt", headers=hdr, json={"image_base64": b64})
    sure = time.time() - bas

    if r.status_code != 200:
        print(f"  {hedef:>5} px · {len(buf.getvalue())//1024:>5} KB · HATA {r.status_code} "
              f"· {r.text[:90]}")
        sonuc.append((hedef, len(buf.getvalue()) // 1024, sure, None, None))
    else:
        d = r.json()
        kalemler = d.get("items") or []
        toplam = d.get("total")
        print(f"  {hedef:>5} px · {len(buf.getvalue())//1024:>5} KB · {sure:>5.1f} sn "
              f"· {len(kalemler):>3} kalem · toplam {toplam}")
        sonuc.append((hedef, len(buf.getvalue()) // 1024, sure, len(kalemler), toplam))

    if bekle and i < len(boyutlar) - 1:
        print(f"        (kota icin {bekle} sn bekleniyor…)")
        time.sleep(bekle)

print("\n--- karsilastirma ---")
temel = next((s for s in sonuc if s[3] is not None), None)
if temel:
    print(f"Referans {temel[0]} px: {temel[3]} kalem, {temel[1]} KB, {temel[2]:.1f} sn")
    for hedef, kb, sure, n, _ in sonuc:
        if n is None:
            print(f"  {hedef:>5} px · okunamadi")
        elif n == temel[3]:
            print(f"  {hedef:>5} px · AYNI kalem sayisi · %{100 - kb * 100 // temel[1]} daha kucuk "
                  f"· {temel[2] - sure:+.1f} sn")
        else:
            print(f"  {hedef:>5} px · {n} kalem ({n - temel[3]:+d}) · KULLANMAYIN")

print("\nEn kucuk GUVENLI boyut: kalem sayisi referansla ayni kalan en kucuk deger.")
print("Karari `frontend/src/photo.ts` -> RECEIPT_MAX_EDGE icine yazin.")

c.post(f"{API}/auth/logout", headers=hdr)
