"""OCR kotasi ve hiz siniri — BIRIM testi, modele hic dokunmuyor.

Neden HTTP degil: `/ocr/receipt` ucu kotayi gectikten sonra GERCEKTEN Gemini'yi
cagiriyor. Ucundan uca test yazmak, her calistirmada ucretsiz katman kotasini
yakmak demek -- ve bu bir kez yasandi: test 20 istek atmaya calisti, 7.
istekte Gemini'nin kendi 429'u dondu ve testin olctugu sey bizim sinirimiz
degil saglayicinin siniri oldu. Yani hem kota yandi hem test yanlis seyi
olctu.

Kota mantigi zaten ucun ONUNDE, ayri bir fonksiyonda duruyor; dogru test
yeri orasi.

Kullanim:
    DB_NAME=odahesap_test .venv/Scripts/python.exe ../tests/kota-test.py
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
os.environ.setdefault("DB_NAME", "odahesap_test")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", ".env"))

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402

ok = fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  [OK]   {label}")
    else:
        fail += 1
        print(f"  [FAIL] {label}  {detail}")


async def main():
    if server.DB_NAME != "odahesap_test":
        print(f"DURDURULDU: uretim veritabanina baglaniliyor ({server.DB_NAME}). "
              "DB_NAME=odahesap_test ile calistirin.")
        return 1

    uid = f"kota_{uuid.uuid4().hex[:10]}"
    uid2 = f"kota_{uuid.uuid4().hex[:10]}"

    print("== saatlik sinir tam yerinde uyguluyor ==")
    gecen = 0
    try:
        for _ in range(server.OCR_SAATLIK_SINIR + 5):
            await server._ocr_kota_kontrol(uid)
            gecen += 1
    except HTTPException as e:
        check("429 donuyor", e.status_code == 429, str(e.status_code))
        check("mesaj SAATLIK oldugunu soyluyor", "saatlik" in e.detail.lower(), e.detail)
    check(f"tam {server.OCR_SAATLIK_SINIR} cagri gecti, {server.OCR_SAATLIK_SINIR + 1}. durdu",
          gecen == server.OCR_SAATLIK_SINIR, f"gecen={gecen}")

    print()
    print("== sinir KISI BASINA, herkese degil ==")
    try:
        await server._ocr_kota_kontrol(uid2)
        check("ikinci kullanici etkilenmiyor", True)
    except HTTPException as e:  # noqa: BLE001
        check("ikinci kullanici etkilenmiyor", False, e.detail)

    print()
    print("== BASARISIZ cagri da kotadan dusuyor ==")
    # Kayit modele gitmeden ONCE atiliyor. Aksi halde bozuk goruntu gonderip
    # sinirsiz cagri yapilabilirdi: maliyet dogar, sayac donmezdi.
    n = await server.db.ocr_calls.count_documents({"user_id": uid})
    check("her deneme kaydedildi", n == server.OCR_SAATLIK_SINIR, f"{n} kayit")

    print()
    print("== aylik sinir saatlikten BUYUK olmali ==")
    # Aksi halde saatlik sinir hic devreye giremez ve kural anlamsizlasir.
    check("aylik > saatlik", server.OCR_AYLIK_SINIR > server.OCR_SAATLIK_SINIR,
          f"{server.OCR_AYLIK_SINIR} / {server.OCR_SAATLIK_SINIR}")

    print()
    print("== temizlik ==")
    await server.db.ocr_calls.delete_many({"user_id": {"$in": [uid, uid2]}})
    print(f"\n===== {ok} basarili, {fail} basarisiz =====")
    return 1 if fail else 0


sys.exit(asyncio.run(main()))
