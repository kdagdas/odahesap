"""Kapanmis donemlere katilimci listesini geriye donuk yazar.

Bu alan yeni eklendi. Alani olmayan eski kapali donemlerde katilimci listesi
her seferinde evin BUGUNKU uyelerinden turetiliyordu; yani bugun eve katilan
biri aylar once kapanmis bir donemin bolusmesine giriyordu.

Dogru liste zaten elimizde: donem kapanirken alinan `final_balances.net`
sozlugunun anahtarlari, o an hesaba katilan kisilerin ta kendisi. Bu betik
onu `participant_ids` alanina tasir.

Sadece kapali ve alani olmayan donemlere dokunur; iki kez calistirmak
zararsizdir. Once --kuru ile ne yapacagini gosterir.

Kullanim:
    cd backend
    .venv/Scripts/python.exe ../tests/donem-katilimci-doldur.py --kuru
    .venv/Scripts/python.exe ../tests/donem-katilimci-doldur.py
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / "backend" / ".env")

KURU = "--kuru" in sys.argv


def main() -> int:
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    hedef = list(db.periods.find(
        {"status": "closed", "participant_ids": {"$exists": False}}, {"_id": 0}
    ))
    if not hedef:
        print("Doldurulacak donem yok.")
        return 0

    yazilan = atlanan = 0
    for p in hedef:
        net = (p.get("final_balances") or {}).get("net") or {}
        katilimci = sorted(net.keys())
        if not katilimci:
            # Kapanista anlik goruntu alinmamis cok eski bir donem. Turetme
            # yolu calismaya devam etsin diye elle bir liste uydurmuyoruz.
            print(f"  {p['period_id']}  ATLANDI (final_balances yok)")
            atlanan += 1
            continue
        print(f"  {p['period_id']}  {len(katilimci)} katilimci")
        if not KURU:
            db.periods.update_one(
                {"period_id": p["period_id"]},
                {"$set": {"participant_ids": katilimci}},
            )
        yazilan += 1

    kip = "yazilacak" if KURU else "yazildi"
    print(f"\n{yazilan} donem {kip}, {atlanan} atlandi.")
    if KURU:
        print("Gercekten yazmak icin --kuru olmadan calistirin.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
