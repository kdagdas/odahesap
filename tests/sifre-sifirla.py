"""Bir kullanicinin sifresini sunucudan sifirlar.

Uygulamada "sifremi unuttum" YOK. Uc kisilik, herkesin birbirini tanidigi bir
evde bu betik gecici cozum: yeni sifreyi siz belirleyip kisiye soyluyorsunuz,
o da girdikten sonra kendi sifresini koyuyor.

Genele acilirken bu kabul edilemez -- uygulamayi dagitan kisinin herkesin
hesabina erisebildigi anlamina geliyor. O gun e-posta ile gercek sifirlama
sart olacak.

Kullanim:
    cd backend
    .venv/Scripts/python.exe ../tests/sifre-sifirla.py kadirdagdas9@gmail.com
    .venv/Scripts/python.exe ../tests/sifre-sifirla.py kadir@ornek.com --sifre yeniSifre123
"""
import os
import secrets
import sys
from pathlib import Path

import bcrypt
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / "backend" / ".env")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("Kullanim: sifre-sifirla.py <e-posta> [--sifre <yeni>]")
        return 2
    email = args[0].strip().lower()

    yeni = None
    if "--sifre" in sys.argv:
        i = sys.argv.index("--sifre")
        if i + 1 < len(sys.argv):
            yeni = sys.argv[i + 1]
    if not yeni:
        # Okunabilir ama tahmin edilemez: kisiye telefonda soylenecek.
        yeni = "kasa-" + secrets.token_hex(3)
    if len(yeni) < 6:
        print("Sifre en az 6 karakter olmali.")
        return 2

    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    user = db.users.find_one({"email": email}, {"_id": 0, "user_id": 1, "name": 1})
    if not user:
        print(f"Kullanici bulunamadi: {email}")
        return 1

    hashed = bcrypt.hashpw(yeni.encode(), bcrypt.gensalt()).decode()
    db.users.update_one({"user_id": user["user_id"]}, {"$set": {"password_hash": hashed}})

    # Acik kalan oturumlar da kapansin: sifreyi degistirmenin anlami, eski
    # sifreyi bilen ya da acik telefonu olan birinin disarida kalmasi.
    silinen = db.user_sessions.delete_many({"user_id": user["user_id"]}).deleted_count

    print(f"{user.get('name')} <{email}> icin sifre degistirildi.")
    print(f"Yeni sifre: {yeni}")
    print(f"{silinen} oturum kapatildi -- tum cihazlarda yeniden giris gerekiyor.")
    print("\nBu sifreyi kisiye iletin ve girdikten sonra kendi sifresini koymasini soyleyin.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
