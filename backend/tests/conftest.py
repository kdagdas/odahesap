"""Shared fixtures for OdaHesap backend tests: seeds test users + sessions."""
import os
import io
import base64
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient
from PIL import Image, ImageDraw, ImageFont

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8000").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TEST_USERS = [
    {"user_id": "user_test_alice", "email": "TEST_alice@test.local", "name": "Alice Test", "token": "test_token_alice"},
    {"user_id": "user_test_bob",   "email": "TEST_bob@test.local",   "name": "Bob Test",   "token": "test_token_bob"},
    {"user_id": "user_test_carol", "email": "TEST_carol@test.local", "name": "Carol Test", "token": "test_token_carol"},
    # An extra "outsider" user to test cross-household visibility
    {"user_id": "user_test_dave",  "email": "TEST_dave@test.local",  "name": "Dave Test",  "token": "test_token_dave"},
]


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="session", autouse=True)
def seed_users(mongo):
    """Wipe TEST_ users/households/expenses/periods and seed users+sessions."""
    now = datetime.now(timezone.utc)
    # cleanup previous test data
    test_user_ids = [u["user_id"] for u in TEST_USERS]
    mongo.users.delete_many({"user_id": {"$in": test_user_ids}})
    mongo.user_sessions.delete_many({"user_id": {"$in": test_user_ids}})
    hhs = list(mongo.households.find({"member_ids": {"$in": test_user_ids}}))
    hh_ids = [h["household_id"] for h in hhs]
    if hh_ids:
        mongo.expenses.delete_many({"household_id": {"$in": hh_ids}})
        mongo.periods.delete_many({"household_id": {"$in": hh_ids}})
        mongo.households.delete_many({"household_id": {"$in": hh_ids}})

    # cleanup by email too (previous test rows may collide on unique email)
    mongo.users.delete_many({"email": {"$in": [u["email"] for u in TEST_USERS]}})
    mongo.user_sessions.delete_many({"session_token": {"$in": [u["token"] for u in TEST_USERS]}})
    for u in TEST_USERS:
        mongo.users.insert_one({
            "user_id": u["user_id"], "email": u["email"], "name": u["name"],
            "picture": None, "created_at": now,
        })
        mongo.user_sessions.insert_one({
            "session_token": u["token"], "user_id": u["user_id"],
            "expires_at": now + timedelta(days=7), "created_at": now,
        })
    yield
    # teardown
    mongo.users.delete_many({"user_id": {"$in": test_user_ids}})
    mongo.user_sessions.delete_many({"user_id": {"$in": test_user_ids}})
    hhs = list(mongo.households.find({"member_ids": {"$in": test_user_ids}}))
    hh_ids = [h["household_id"] for h in hhs]
    if hh_ids:
        mongo.expenses.delete_many({"household_id": {"$in": hh_ids}})
        mongo.periods.delete_many({"household_id": {"$in": hh_ids}})
        mongo.households.delete_many({"household_id": {"$in": hh_ids}})


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture()
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def auth():
    return _auth


@pytest.fixture(scope="session")
def receipt_image_b64():
    """Synthesize a small German receipt-like JPEG and return base64."""
    W, H = 480, 640
    img = Image.new("RGB", (W, H), (250, 248, 240))
    d = ImageDraw.Draw(img)
    # Try default PIL font
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
        fontb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
    except Exception:
        font = ImageFont.load_default()
        fontb = ImageFont.load_default()
    lines = [
        ("REWE Markt GmbH", fontb),
        ("Hauptstr. 12, 10115 Berlin", font),
        ("--------------------------------", font),
        ("Milch 3,5%          1,49 A", font),
        ("Brot Vollkorn       2,99 A", font),
        ("Butter              2,29 A", font),
        ("Apfel 1kg           1,89 B", font),
        ("Kaese Gouda         3,49 A", font),
        ("RABATT             -0,50", font),
        ("--------------------------------", font),
        ("MwSt 7%             0,84", font),
        ("Summe EUR          11,65", fontb),
        ("Bar                12,00", font),
        ("Rueckgeld           0,35", font),
        ("Datum: 12.01.2026 14:22", font),
    ]
    y = 20
    for text, f in lines:
        d.text((20, y), text, fill=(30, 30, 30), font=f)
        y += 34
    # Add some texture so it's not uniform
    for i in range(0, W, 40):
        d.line([(i, 0), (i, 4)], fill=(200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")
