"""Veritabaninin tamamini tek bir JSON dosyasina yedekler.

Atlas'in ucretsiz M0 katmaninda otomatik yedekleme yok: yanlis bir silme ya
da Atlas tarafinda bir sorun, biriken tum harcama gecmisini geri donusu
olmadan goturur. Bu betik disariya bagimli degil, elle veya bir zamanlayici
ile calistirilabilir.

Kullanim:
    cd backend
    .venv/Scripts/python.exe ../tests/yedekle.py
    .venv/Scripts/python.exe ../tests/yedekle.py D:/yedekler

Ciktiyi paylasma: icinde herkesin e-postasi ve tum harcama gecmisi var.
Sifre ozetleri (bcrypt) de dahildir; bunlar kirilamaz ama yine de gizli
tutulmali. Profil fotograflari boyutu sisirmemek icin haric tutulur.
"""
import base64
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / "backend" / ".env")

OUT_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "yedekler"

# Fotograflar ikili veri ve yedegi gereksiz sisirir; kaybolurlarsa kullanici
# yenisini yukler. Geri kalan her sey yeri doldurulamaz.
SKIP = {"avatars"}


def encode(value):
    """JSON'a sigmayan tipleri (datetime, ObjectId, bytes) cevir."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return base64.b64encode(value).decode("ascii")
    return str(value)


def main() -> int:
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M")
    out = OUT_DIR / f"kasa-yedek-{stamp}.json"

    dump = {"alindi": datetime.now(timezone.utc).isoformat(), "veritabani": os.environ["DB_NAME"]}
    total = 0
    for name in sorted(db.list_collection_names()):
        if name in SKIP:
            print(f"  {name:<16} atlandi")
            continue
        rows = list(db[name].find({}, {"_id": 0}))
        dump[name] = rows
        total += len(rows)
        print(f"  {name:<16} {len(rows)} kayit")

    out.write_text(json.dumps(dump, ensure_ascii=False, indent=1, default=encode), encoding="utf-8")
    mb = out.stat().st_size / 1024 / 1024
    print(f"\n{total} kayit yazildi -> {out}  ({mb:.2f} MB)")

    # Son 10 yedegi tut, gerisini sil.
    eski = sorted(OUT_DIR.glob("kasa-yedek-*.json"))[:-10]
    for f in eski:
        f.unlink()
    if eski:
        print(f"{len(eski)} eski yedek silindi")
    return 0


if __name__ == "__main__":
    sys.exit(main())
