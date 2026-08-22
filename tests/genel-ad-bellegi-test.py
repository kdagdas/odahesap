"""Genel ad bellegi — BIRIM testi, modele hic dokunmuyor.

`/ocr/receipt` ucu gercekten Gemini'yi cagiriyor; ucundan uca test yazmak her
calistirmada ucretsiz kotayi yakmak demek (bkz. kota-test.py, ayni gerekce).
Bellek mantigi zaten ucun ONUNDE ayri bir fonksiyonda: `_genel_ad_bellegi`.

Neden bu bellek var: ev sahibi "Rinder Gulasch"i fis ekraninda elle "kusbasi"
diye duzeltti; ayni urunu bir sonraki taramada model "et" dedi ve duzeltme
kayboldu. Kullanicinin verdigi cevabi unutan bir uygulama her seferinde ayni
soruyu soruyor demektir.

Kullanim:
    DB_NAME=odahesap_test .venv/Scripts/python.exe ../tests/genel-ad-bellegi-test.py
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
os.environ.setdefault("DB_NAME", "odahesap_test")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", ".env"))

import server  # noqa: E402

ok = fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  [OK]   {label}")
    else:
        fail += 1
        print(f"  [FAIL] {label}  {detail}")


async def harcama(hh, uid, items, gun_once=0, split_with=None):
    """Test harcamasi. `split_with` verilmezse yalnizca ekleyene gorunur."""
    at = datetime.now(timezone.utc) - timedelta(days=gun_once)
    await server.db.expenses.insert_one({
        "expense_id": f"exp_{uuid.uuid4().hex[:10]}",
        "household_id": hh,
        "added_by": uid,
        "split_with": split_with if split_with is not None else {uid: 1},
        "items": items,
        "total": 1.0,
        "created_at": at,
        "expense_date": at.date().isoformat(),
    })


async def main():
    if server.DB_NAME != "odahesap_test":
        print(f"DURDURULDU: uretim veritabanina baglaniliyor ({server.DB_NAME}). "
              "DB_NAME=odahesap_test ile calistirin.")
        return 1

    hh = f"hh_{uuid.uuid4().hex[:10]}"
    ben = f"u_{uuid.uuid4().hex[:10]}"
    oteki = f"u_{uuid.uuid4().hex[:10]}"

    print("== ham ad -> genel ad hatirlaniyor ==")
    await harcama(hh, ben, [{"name": "RINDER GULASCH 1KG", "generic": "et"}], gun_once=9)
    bellek = await server._genel_ad_bellegi(hh, ben)
    anahtar = server.product_key("RINDER GULASCH 1KG")
    check("ham ad bellekte", bellek.get(anahtar) == "et", str(bellek))

    print()
    print("== EN YENI duzeltme kazaniyor ==")
    # Bellek kendi kendini onarmali: ilk taramada kabul edilen yanlis genel ad,
    # ikinci duzeltmeyle yerini birakiyor. Sabit bir sozluk olsaydi yanlis
    # giren madde orada kalirdi.
    await harcama(hh, ben, [{"name": "RINDER GULASCH 1KG", "generic": "kusbasi"}], gun_once=1)
    bellek = await server._genel_ad_bellegi(hh, ben)
    check("son duzeltme geciyor", bellek.get(anahtar) == "kusbasi", str(bellek))

    print()
    print("== BOYUT anahtarin disinda: ayni urun tek kayit ==")
    # `product_key` boyutu ayikliyor; 500 gramlik ile 1 kiloluk ayni urun.
    check("boyutsuz ad ayni anahtara dusuyor",
          server.product_key("RINDER GULASCH 500G") == anahtar,
          server.product_key("RINDER GULASCH 500G"))

    print()
    print("== isaretli adlar (@depozito) bellege GIRMIYOR ==")
    # Urun degil, fisin muhasebe satiri. Bellege girseydi bir sonraki taramada
    # gercek bir urunun genel adi "@depozito" olabilirdi.
    await harcama(hh, ben, [{"name": "PFAND 0,25 EURO", "generic": "@depozito"}])
    bellek = await server._genel_ad_bellegi(hh, ben)
    check("depozito bellekte yok",
          server.product_key("PFAND 0,25 EURO") not in bellek, str(bellek))

    print()
    print("== bos genel ad bellege girmiyor ==")
    await harcama(hh, ben, [{"name": "LEBENSMITTEL div.", "generic": None}])
    bellek = await server._genel_ad_bellegi(hh, ben)
    check("bos genel ad yok",
          server.product_key("LEBENSMITTEL div.") not in bellek, str(bellek))

    print()
    print("== GORUNURLUK SUZGECI atlanmiyor ==")
    # Baskasinin kisisel harcamasindan ogrenilmis bir ad, o harcamanin
    # VARLIGINI sizdirirdi. Bu, projenin tek gecidi olan `_visible_filter`in
    # burada da gecerli olmasi demek.
    await harcama(hh, oteki, [{"name": "GIZLI URUN X", "generic": "sampuan"}],
                  split_with={oteki: 1})
    bellek = await server._genel_ad_bellegi(hh, ben)
    check("baskasinin kisisel kalemi bellege girmiyor",
          server.product_key("GIZLI URUN X") not in bellek, str(bellek))
    bellek_o = await server._genel_ad_bellegi(hh, oteki)
    check("sahibinin bellegine ise giriyor",
          bellek_o.get(server.product_key("GIZLI URUN X")) == "sampuan", str(bellek_o))

    print()
    print("== YAKIN esleme: OCR ayni satiri farkli okuyunca ==")
    # Cihazda olculdu: ayni fisin iki taramasi ayni satiri farkli okudu.
    #   16 Agustos: ALTAPH.  FIXIERBND  -> sargi bezi
    #   22 Agustos: ALTRAPH. FIXIERBIND
    # Tam esleme iskaliyor; yakin esleme yakalamali. Burada iki urunu
    # BIRLESTIRMIYORUZ -- kullanicinin ekranda gorup duzeltebilecegi bir
    # oneri uretiyoruz.
    await harcama(hh, ben, [{"name": "ALTAPH. FIXIERBND", "generic": "sargi bezi"}])
    bellek = await server._genel_ad_bellegi(hh, ben)
    check("tam esleme calisiyor",
          server.bellekten_genel_ad(bellek, "ALTAPH. FIXIERBND") == "sargi bezi")
    check("OCR farki yakalandi",
          server.bellekten_genel_ad(bellek, "ALTRAPH. FIXIERBIND") == "sargi bezi",
          str(server.bellekten_genel_ad(bellek, "ALTRAPH. FIXIERBIND")))

    print()
    print("== YAKIN esleme ALAKASIZ adi yakalamamali ==")
    # Esik gercekten koruyor mu: benzemeyen bir ad bellekten cevap almamali.
    # Yanlis bir genel ad, genel ad olmamasindan pahali.
    check("alakasiz ad bos donuyor",
          server.bellekten_genel_ad(bellek, "COCA COLA 1L") is None,
          str(server.bellekten_genel_ad(bellek, "COCA COLA 1L")))
    check("kisa anahtarda yakin esleme kapali",
          server.bellekten_genel_ad(bellek, "un") is None,
          str(server.bellekten_genel_ad(bellek, "un")))

    print()
    print("== evsiz kullanicida bellek BOS, sorgu bile atilmiyor ==")
    check("evsiz -> bos sozluk", await server._genel_ad_bellegi("", ben) == {})

    print()
    print("== temizlik ==")
    await server.db.expenses.delete_many({"household_id": hh})
    print(f"\n===== {ok} basarili, {fail} basarisiz =====")
    return 1 if fail else 0


sys.exit(asyncio.run(main()))
