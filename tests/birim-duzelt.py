"""Kesirli "adet" birimlerini duzeltir.

### Hata neydi

`unit` alani Tur 1+2'de eklendi ("adet / kg / lt / paket") ama fis okuma
uzun sure her kaleme varsayilan `adet` yaziyordu. Sonuc: TARTILAN urunler
dogru miktarla ama yanlis birimle kaydedildi -- 7,105 kg tavuk gogsu
"7,105 adet" olarak duruyor.

### Neden bu bir TAHMIN degil DUZELTME

Kesirli bir adet **imkansizdir**: 7,105 adet tavuk, 0,834 adet lahana diye
bir sey yok. Sayinin kendisi zaten dogru, yalnizca etiketi yanlis. Gercek
evde bulunan 12 kaydin hepsi tartilan gida (et_balik / meyve_sebze) ve
birinin adi fiste zaten "OBST/GEMUSE **Kg** div." yaziyor.

### Kural

  kesirli miktar + birim "adet"  ->  icecek kategorisi ise "lt", degilse "kg"

Icecek ayrimi ihtiyat: sivi tartilmaz ama litreyle satilir. Tam sayili
"adet"lere DOKUNULMUYOR -- 3 adet yumurta kutusu dogru kayittir.

### Kullanim

    cd backend
    .venv/Scripts/python.exe ../tests/birim-duzelt.py            # sadece gosterir
    .venv/Scripts/python.exe ../tests/birim-duzelt.py --yaz      # uygular

Yazmadan once yedek alin: `.venv/Scripts/python.exe ../tests/yedekle.py`
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

import server as S  # noqa: E402

YAZ = "--yaz" in sys.argv


def hedef_birim(kategori: str) -> str:
    # Sivi tartilmaz ama litreyle satilir; digerleri kilo.
    return "lt" if kategori == "icecek" else "kg"


async def main():
    exps = await S.db.expenses.find(
        {"items": {"$exists": True, "$ne": []}}, {"_id": 0, "expense_id": 1, "items": 1,
                                                  "merchant": 1, "household_id": 1}
    ).to_list(20000)

    duzeltilecek = []
    for e in exps:
        yeni = []
        degisti = False
        for i in e.get("items") or []:
            birim = (i.get("unit") or "adet")
            try:
                q = float(i.get("quantity") or 1)
            except (TypeError, ValueError):
                q = 1.0
            if birim == "adet" and abs(q - round(q)) > 1e-9:
                hedef = hedef_birim(i.get("category") or "diger")
                duzeltilecek.append((e.get("merchant"), i.get("name"), q, hedef))
                yeni.append({**i, "unit": hedef})
                degisti = True
            else:
                yeni.append(i)
        if degisti:
            e["_yeni_items"] = yeni

    print(f"\nKesirli 'adet' kalem sayisi: {len(duzeltilecek)}")
    for market, ad, q, hedef in duzeltilecek:
        print(f"  {q:>8.3f} adet -> {hedef:<3}  {ad:<26} ({market})")

    if not duzeltilecek:
        print("\nDuzeltilecek bir sey yok.")
        S.client.close()
        return

    if not YAZ:
        print("\nSADECE GOSTERILDI. Uygulamak icin: --yaz")
        print("Once yedek alin: .venv/Scripts/python.exe ../tests/yedekle.py")
        S.client.close()
        return

    n = 0
    for e in exps:
        if "_yeni_items" not in e:
            continue
        await S.db.expenses.update_one(
            {"expense_id": e["expense_id"]}, {"$set": {"items": e["_yeni_items"]}}
        )
        n += 1
    print(f"\n{n} harcama kaydi guncellendi.")
    S.client.close()


asyncio.run(main())
