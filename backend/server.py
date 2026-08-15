"""OdaHesap — Roommate Household Expense Splitter Backend."""
from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from typing import Iterable, List, Literal, Optional, Dict
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
import asyncio
import base64
import difflib
import os
import re
import uuid
import random
import secrets
import string
import logging
import json
import bcrypt
import httpx

import push

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
# Google AI Studio key (free tier) — https://aistudio.google.com/apikey
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "90"))

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="OdaHesap API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("odahesap")


# ---------- Models ----------
class RegisterReq(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=60)


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class ProfileUpdate(BaseModel):
    avatar_id: Optional[int] = None
    name: Optional[str] = None


class ChangeEmailReq(BaseModel):
    new_email: EmailStr
    password: str


class ChangePasswordReq(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


class PhotoUploadReq(BaseModel):
    # ~400 KB of base64 is a generous ceiling for a 256px avatar; the app
    # downscales before sending, this only stops a malformed upload.
    image_base64: str = Field(min_length=16, max_length=400_000)


# Bir ev = bir para birimi. Ulke secimi varsayilani belirler; donusum yok.
COUNTRY_CURRENCY = {"DE": "EUR", "TR": "TRY"}


class HouseholdCreate(BaseModel):
    name: str
    country: Literal["DE", "TR"] = "DE"


class HouseholdJoin(BaseModel):
    invite_code: str


class HouseholdRename(BaseModel):
    """Ev ayarları. Ad, ülke ve para birimi aynı uçtan güncellenir."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    country: Optional[Literal["DE", "TR"]] = None
    currency: Optional[Literal["EUR", "TRY"]] = None


class ShoppingItemCreate(BaseModel):
    text: str = Field(min_length=1, max_length=120)
    scope: Literal["household", "self"] = "household"
    note: Optional[str] = Field(default=None, max_length=200)


class ShoppingItemUpdate(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=120)
    done: Optional[bool] = None
    note: Optional[str] = Field(default=None, max_length=200)


class DeviceRegisterReq(BaseModel):
    token: str = Field(min_length=10, max_length=4096)
    platform: str = "android"


class NotificationPrefs(BaseModel):
    """Per-user switches. Expense pushes are the chatty ones, so they get
    their own toggle — a busy household can fire a dozen a day."""
    new_expense: Optional[bool] = None
    join_request: Optional[bool] = None
    period_closed: Optional[bool] = None


class MemberActionReq(BaseModel):
    user_id: str


class ApproveReq(BaseModel):
    user_id: str
    # Bölüşme listesi kayıt anında donduğu için yeni üye kendiliğinden geçmiş
    # harcamalara girmiyor. Ama gerçek hayatta girmesi gereken bir durum var:
    # kişi fiziksel olarak dönem başından beri evde, uygulamaya sonradan
    # katıldı. Karar kullanıcınındır, varsayılan "katılmasın".
    include_open_period: bool = False


class ExpenseItem(BaseModel):
    name: str
    price: float  # unit price in EUR
    quantity: float = 1  # allow fractional (e.g. 0.5 kg produce)
    # Fişte tartılan ürünün altında "0,590 kg x 10,99 EUR/kg" yazıyor. Birim
    # kaydedilmediği için bu "590 adet" olarak görünüyordu — hem saçma, hem de
    # "kaç kez süt alındı" gibi bir sayım yapılamaz hale getiriyordu.
    unit: Literal["adet", "kg", "lt", "paket"] = "adet"
    # Paket boyutu kilogram ya da litre cinsinden. Fiyat karsilastirmasi birim
    # fiyata dayaniyor ve miktar cogu zaman urun adinin icinde sikismis durumda
    # ("ZWIEBELN 2KG"); bu alan onu ayri tutuyor.
    size_amount: Optional[float] = None
    size_unit: Optional[Literal["kg", "lt"]] = None
    category: str = "diger"


TargetType = Literal["self", "household", "roommate", "custom"]


class ExpenseCreate(BaseModel):
    # `target_type` artık kural değil etiket: parayı `split_with` belirliyor.
    # Yine de girdi olarak kabul ediliyor — eski uygulama sürümleri ve testler
    # bunu gönderiyor, sunucu ondan bir katılımcı listesi türetiyor.
    target_type: Optional[TargetType] = None
    target_user_id: Optional[str] = None
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    items: List[ExpenseItem] = []
    total: float
    source: Literal["manual", "receipt"] = "manual"
    category: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    currency: str = "EUR"
    expense_date: Optional[str] = None  # ISO YYYY-MM-DD


class ExpenseUpdate(BaseModel):
    target_type: Optional[TargetType] = None
    target_user_id: Optional[str] = None
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    items: Optional[List[ExpenseItem]] = None
    total: Optional[float] = None
    category: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    expense_date: Optional[str] = None


class SettlementCreate(BaseModel):
    """A real-world payment between two housemates."""
    from_user_id: str
    to_user_id: str
    amount: float = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=200)


class OCRRequest(BaseModel):
    image_base64: str


# ---------- Helpers ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def gen_invite_code() -> str:
    # secrets, not random: this is the only thing standing between a stranger
    # and a request to join your household.
    return "".join(secrets.choice(string.digits) for _ in range(6))


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False


def norm_email(email: str) -> str:
    return email.strip().lower()


def public_user(user: dict) -> dict:
    """Strip internal/sensitive fields before returning a user to the client.

    `photo_version` is a cache-buster, not the photo itself. Avatars live in
    their own collection behind GET /users/{id}/photo — inlining them here
    would re-download every member's image on every household refresh, and
    that refresh now runs each time a screen gains focus.
    """
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "avatar_id": user.get("avatar_id", 0),
        "photo_version": user.get("photo_version"),
    }


async def issue_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one(
        {
            "session_token": token,
            "user_id": user_id,
            "expires_at": now_utc() + timedelta(days=SESSION_DAYS),
            "created_at": now_utc(),
        }
    )
    return token


def make_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def parse_date(s: Optional[str]) -> Optional[str]:
    """Normalize date to YYYY-MM-DD. Accepts YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY."""
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# Marks the 401s that actually mean "this session is dead, sign in again", as
# opposed to "the password you just typed is wrong". The app clears its stored
# token only on the former — without the distinction, mistyping your current
# password while changing it silently logged you out.
SESSION_INVALID = {"X-Session-Invalid": "1"}


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Oturum bulunamadı",
                            headers=SESSION_INVALID)
    token = authorization.replace("Bearer ", "", 1).strip()
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="Oturum geçersiz",
                            headers=SESSION_INVALID)
    expires_at = make_aware(sess["expires_at"])
    if expires_at < now_utc():
        raise HTTPException(status_code=401, detail="Oturum süresi doldu",
                            headers=SESSION_INVALID)
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı",
                            headers=SESSION_INVALID)

    # Sliding expiry: someone who keeps using the app is never logged out.
    # Only written once the session is past its halfway point, so normal
    # requests stay read-only instead of writing on every call.
    if expires_at - now_utc() < timedelta(days=SESSION_DAYS / 2):
        await db.user_sessions.update_one(
            {"session_token": token},
            {"$set": {"expires_at": now_utc() + timedelta(days=SESSION_DAYS)}},
        )
    return user


# Fields safe to return for *other* users (never password_hash).
PUBLIC_USER_PROJECTION = {
    "_id": 0, "user_id": 1, "email": 1, "name": 1, "avatar_id": 1,
    "photo_version": 1,
}


async def get_user_household(user_id: str) -> Optional[dict]:
    return await db.households.find_one({"member_ids": user_id}, {"_id": 0})


def admin_id(hh: dict) -> str:
    """Who runs this household.

    `admin_id` was added after the first households existed, so fall back to
    `created_by` — every household has it, and the creator is the right admin.
    """
    return hh.get("admin_id") or hh["created_by"]


DEFAULT_PREFS = {"new_expense": True, "join_request": True, "period_closed": True}


async def notify(user_ids: Iterable[str], title: str, body: str,
                 kind: str, data: Optional[dict] = None) -> None:
    """Push to these users, honouring their per-kind switches.

    Never raises: a failed notification must not fail the action that caused
    it. Dead tokens are pruned using what FCM reports back.
    """
    ids = [u for u in dict.fromkeys(user_ids) if u]
    if not ids:
        return

    # Bildirim kaydı push'tan bağımsız yazılıyor: telefon kapalıysa, jeton
    # ölmüşse ya da FCM hiç yapılandırılmamışsa bile "ben yokken ne oldu"
    # sorusunun bir cevabı olmalı. Push kaybolur, kayıt kalır.
    now = now_utc()
    await db.notifications.insert_many([{
        "notification_id": new_id("ntf"),
        "user_id": uid,
        "title": title,
        "body": body,
        "kind": kind,
        "data": data or {},
        "read": False,
        "created_at": now,
    } for uid in ids])

    try:
        if not push.is_configured():
            return

        users = await db.users.find(
            {"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "notif_prefs": 1}
        ).to_list(50)
        allowed = {
            u["user_id"] for u in users
            if {**DEFAULT_PREFS, **(u.get("notif_prefs") or {})}.get(kind, True)
        }
        if not allowed:
            return

        devices = await db.devices.find(
            {"user_id": {"$in": list(allowed)}}, {"_id": 0, "token": 1}
        ).to_list(200)
        tokens = [d["token"] for d in devices]
        if not tokens:
            return

        result = await push.send_to_tokens(tokens, title, body, {**(data or {}), "kind": kind})
        if result["invalid_tokens"]:
            await db.devices.delete_many({"token": {"$in": result["invalid_tokens"]}})
    except Exception:
        logger.exception("Bildirim gonderilemedi (islem etkilenmedi)")


@api.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    """Ben yokken ne oldu.

    Bildirim gelip kaçırıldığında geriye bakacak bir yer yoktu; telefonu
    kapalı olan ya da bildirimleri kapatmış biri olan bitenden habersiz
    kalıyordu.
    """
    rows = await db.notifications.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(60)
    unread = sum(1 for r in rows if not r.get("read"))
    return {"notifications": rows, "unread": unread}


@api.post("/notifications/read")
async def mark_notifications_read(user=Depends(get_current_user)):
    await db.notifications.update_many(
        {"user_id": user["user_id"], "read": False}, {"$set": {"read": True}}
    )
    return {"ok": True}


async def require_admin(user_id: str) -> dict:
    """Return the caller's household, or 403 if they don't run it."""
    hh = await get_user_household(user_id)
    if not hh:
        raise HTTPException(status_code=400, detail="Ev bulunamadı")
    if admin_id(hh) != user_id:
        raise HTTPException(status_code=403, detail="Bu işlemi sadece ev yöneticisi yapabilir")
    return hh


async def get_pending_household(user_id: str) -> Optional[dict]:
    return await db.households.find_one({"pending_member_ids": user_id}, {"_id": 0})


async def get_active_period(household_id: str) -> Optional[dict]:
    return await db.periods.find_one(
        {"household_id": household_id, "status": "active"}, {"_id": 0}
    )


# ---------- Auth ----------
@api.post("/auth/register")
async def auth_register(body: RegisterReq):
    email = norm_email(body.email)
    if await db.users.find_one({"email": email}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="Bu e-posta zaten kayıtlı")

    user = {
        "user_id": new_id("user"),
        "email": email,
        "name": body.name.strip(),
        "password_hash": hash_password(body.password),
        "avatar_id": 0,
        "created_at": now_utc(),
    }
    try:
        await db.users.insert_one(user.copy())
    except Exception:
        # unique index race — another request registered the same email first
        raise HTTPException(status_code=409, detail="Bu e-posta zaten kayıtlı")

    token = await issue_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api.post("/auth/login")
async def auth_login(body: LoginReq):
    email = norm_email(body.email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="E-posta veya şifre hatalı")
    token = await issue_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api.patch("/auth/profile")
async def update_profile(body: ProfileUpdate, user=Depends(get_current_user)):
    patch: dict = {}
    if body.avatar_id is not None:
        if body.avatar_id < 0 or body.avatar_id > 7:
            raise HTTPException(status_code=400, detail="Geçersiz avatar")
        patch["avatar_id"] = int(body.avatar_id)
    if body.name is not None and body.name.strip():
        patch["name"] = body.name.strip()
    if not patch:
        return {"user": public_user(user)}
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": patch})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(updated)}


@api.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    u = public_user(user)
    u["notif_prefs"] = {**DEFAULT_PREFS, **(user.get("notif_prefs") or {})}
    return {"user": u, "push_enabled": push.is_configured()}


@api.post("/auth/change-email")
async def change_email(body: ChangeEmailReq, user=Depends(get_current_user)):
    """Requires the password: an unattended phone must not be enough to move
    the account to an address the owner does not control."""
    if not verify_password(body.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Şifre hatalı")
    new_email = norm_email(body.new_email)
    if new_email == user["email"]:
        raise HTTPException(status_code=400, detail="Bu zaten mevcut e-postanız")
    if await db.users.find_one({"email": new_email}, {"_id": 0}):
        raise HTTPException(status_code=409, detail="Bu e-posta başka bir hesapta kayıtlı")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"email": new_email}})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(updated)}


@api.post("/auth/change-password")
async def change_password(
    body: ChangePasswordReq,
    authorization: Optional[str] = Header(None),
    user=Depends(get_current_user),
):
    if not verify_password(body.current_password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Mevcut şifre hatalı")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=400, detail="Yeni şifre eskisiyle aynı olamaz")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(body.new_password)}},
    )
    # Changing a password should evict anyone else who was signed in — that is
    # the whole point if the old one leaked. The current phone keeps its session.
    keep = authorization.replace("Bearer ", "", 1).strip() if authorization else ""
    await db.user_sessions.delete_many(
        {"user_id": user["user_id"], "session_token": {"$ne": keep}}
    )
    return {"ok": True}


@api.put("/auth/photo")
async def upload_photo(body: PhotoUploadReq, user=Depends(get_current_user)):
    b64 = body.image_base64
    mime = "image/jpeg"
    if b64.startswith("data:"):
        header, b64 = b64.split(",", 1)
        if ";" in header and ":" in header:
            mime = header.split(":", 1)[1].split(";", 1)[0] or mime
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Görsel çözümlenemedi")
    if len(raw) > 300_000:
        raise HTTPException(status_code=413, detail="Görsel çok büyük")

    version = uuid.uuid4().hex[:12]
    await db.avatars.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "data": raw, "mime": mime, "updated_at": now_utc()}},
        upsert=True,
    )
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"photo_version": version}})
    return {"photo_version": version}


@api.delete("/auth/photo")
async def delete_photo(user=Depends(get_current_user)):
    await db.avatars.delete_one({"user_id": user["user_id"]})
    await db.users.update_one({"user_id": user["user_id"]}, {"$unset": {"photo_version": ""}})
    return {"ok": True}


@api.get("/users/{user_id}/photo")
async def get_photo(user_id: str, user=Depends(get_current_user)):
    """Only yourself and people you actually share a household with."""
    if user_id != user["user_id"]:
        hh = await get_user_household(user["user_id"])
        if not hh or user_id not in hh.get("member_ids", []):
            raise HTTPException(status_code=404, detail="Bulunamadı")

    row = await db.avatars.find_one({"user_id": user_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Fotoğraf yok")
    return Response(
        content=row["data"],
        media_type=row.get("mime", "image/jpeg"),
        # Immutable: the URL carries a version that changes on every upload.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@api.post("/devices/register")
async def register_device(body: DeviceRegisterReq, user=Depends(get_current_user)):
    """Store this phone's FCM token.

    Keyed on the token, not the user: reinstalls mint a new token, and the same
    phone can be handed to a different account. Upserting on the token keeps
    exactly one row per device and re-points it at whoever logged in last.
    """
    await db.devices.update_one(
        {"token": body.token},
        {"$set": {
            "token": body.token,
            "user_id": user["user_id"],
            "platform": body.platform,
            "updated_at": now_utc(),
        }},
        upsert=True,
    )
    return {"ok": True}


@api.post("/devices/unregister")
async def unregister_device(body: DeviceRegisterReq, user=Depends(get_current_user)):
    await db.devices.delete_one({"token": body.token, "user_id": user["user_id"]})
    return {"ok": True}


@api.patch("/auth/notifications")
async def update_notification_prefs(body: NotificationPrefs, user=Depends(get_current_user)):
    prefs = {**DEFAULT_PREFS, **(user.get("notif_prefs") or {})}
    for key, value in body.model_dump(exclude_none=True).items():
        prefs[key] = bool(value)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"notif_prefs": prefs}})
    return {"notif_prefs": prefs}


@api.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "", 1).strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Households ----------
async def _generate_unique_invite() -> str:
    for _ in range(20):
        code = gen_invite_code()
        if not await db.households.find_one({"invite_code": code}, {"_id": 0}):
            return code
    raise HTTPException(status_code=500, detail="Could not generate unique invite code")


@api.post("/households")
async def create_household(body: HouseholdCreate, user=Depends(get_current_user)):
    if await get_user_household(user["user_id"]):
        raise HTTPException(status_code=400, detail="Zaten bir evdesiniz")
    if await get_pending_household(user["user_id"]):
        # remove pending status if creating own
        await db.households.update_many(
            {"pending_member_ids": user["user_id"]},
            {"$pull": {"pending_member_ids": user["user_id"]}},
        )

    hh_id = new_id("hh")
    period_id = new_id("per")
    invite_code = await _generate_unique_invite()

    household = {
        "household_id": hh_id,
        "name": body.name,
        # Bir ev = bir para birimi. Karışırsa toplama işlemi anlamsızlaşır:
        # 40 € ile 500 ₺ toplanamaz, bölünemez, "kim kime borçlu" hesaplanamaz.
        # Fişten okunan sembol kaynak değil, denetim olarak kullanılıyor.
        "country": body.country,
        "currency": COUNTRY_CURRENCY[body.country],
        "invite_code": invite_code,
        "created_by": user["user_id"],
        "admin_id": user["user_id"],
        "member_ids": [user["user_id"]],
        "pending_member_ids": [],
        "current_period_id": period_id,
        "created_at": now_utc(),
    }
    period = {
        "period_id": period_id,
        "household_id": hh_id,
        "started_at": now_utc(),
        "closed_at": None,
        "status": "active",
        "participant_ids": [user["user_id"]],
    }
    await db.households.insert_one(household.copy())
    await db.periods.insert_one(period.copy())
    return {"household": household, "period": period}


@api.post("/households/join")
async def join_household(body: HouseholdJoin, user=Depends(get_current_user)):
    if await get_user_household(user["user_id"]):
        raise HTTPException(status_code=400, detail="Zaten bir evdesiniz")
    already_pending = await get_pending_household(user["user_id"])
    if already_pending:
        return {"pending": True, "household": already_pending}

    hh = await db.households.find_one({"invite_code": body.invite_code.strip()}, {"_id": 0})
    if not hh:
        raise HTTPException(status_code=404, detail="Geçersiz davet kodu")
    if user["user_id"] in hh.get("member_ids", []):
        raise HTTPException(status_code=400, detail="Zaten bu evdesiniz")

    await db.households.update_one(
        {"household_id": hh["household_id"]},
        {"$addToSet": {"pending_member_ids": user["user_id"]}},
    )
    hh = await db.households.find_one({"household_id": hh["household_id"]}, {"_id": 0})
    await notify(
        [admin_id(hh)],
        "Yeni katılma isteği",
        f"{user['name']} \"{hh['name']}\" evine katılmak istiyor.",
        "join_request",
        {"household_id": hh["household_id"]},
    )
    return {"pending": True, "household": hh}


@api.patch("/households")
async def rename_household(body: HouseholdRename, user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    patch: dict = {}
    if body.name is not None:
        patch["name"] = body.name.strip()

    # Ülke ve para birimi evin kuralı. Kur çevrimi yapmıyoruz; para birimini
    # değiştirmek "40 €" yazan kaydı "40 ₺" diye göstermek demek — tutar aynı
    # kalır, anlamı değişir ve geçmiş bütün hesaplaşmalar sessizce yanlış
    # okunur. Ülkeyi tek başına değiştirmek de yarım bir taşınma olurdu.
    # İkisi de yalnızca evde henüz harcama yokken değişebilir.
    #
    # Ülke para birimini YALNIZCA ev kurulurken belirliyor. Burada türetmek,
    # zararsız bir ülke değişikliğini gizlice para birimi değişikliğine
    # çeviriyor ve kullanıcıya alakasız bir hata gösteriyordu.
    changing = (
        (body.country is not None and body.country != hh.get("country", "DE"))
        or (body.currency is not None and body.currency != hh.get("currency", "EUR"))
    )
    if changing:
        used = await db.expenses.count_documents({"household_id": hh["household_id"]})
        if used:
            raise HTTPException(
                status_code=400,
                detail="Ülke ve para birimi yalnızca hiç harcama yapılmamış "
                       "evlerde değiştirilebilir. Farklı bir para birimi için "
                       "yeni bir ev kurun.",
            )
        if hh.get("created_by") != user["user_id"]:
            raise HTTPException(
                status_code=403,
                detail="Bu ayarı yalnızca evi kuran kişi değiştirebilir.",
            )

    if body.country is not None:
        patch["country"] = body.country
    if body.currency is not None:
        patch["currency"] = body.currency

    if not patch:
        raise HTTPException(status_code=400, detail="Değiştirilecek bir şey yok")
    await db.households.update_one({"household_id": hh["household_id"]}, {"$set": patch})
    updated = await db.households.find_one({"household_id": hh["household_id"]}, {"_id": 0})
    return {"household": updated}


@api.post("/households/regenerate-invite")
async def regenerate_invite(user=Depends(get_current_user)):
    """Mint a fresh invite code.

    The old one never expires on its own, so anyone who has ever seen it —
    including someone who has since moved out — can keep asking to join.
    """
    hh = await require_admin(user["user_id"])
    code = await _generate_unique_invite()
    await db.households.update_one(
        {"household_id": hh["household_id"]}, {"$set": {"invite_code": code}}
    )
    return {"invite_code": code}


@api.post("/households/transfer-admin")
async def transfer_admin(body: MemberActionReq, user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    if body.user_id not in hh.get("member_ids", []):
        raise HTTPException(status_code=404, detail="Bu kişi evin üyesi değil")
    if body.user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Yöneticilik zaten sizde")
    await db.households.update_one(
        {"household_id": hh["household_id"]}, {"$set": {"admin_id": body.user_id}}
    )
    return {"ok": True, "admin_id": body.user_id}


@api.post("/households/remove-member")
async def remove_member(body: MemberActionReq, user=Depends(get_current_user)):
    """Kick a member out — for people who moved out and deleted the app
    without leaving the household themselves.

    Guarded on purpose: member_ids drives how household expenses are split, so
    removing someone mid-period silently re-splits every expense in it and
    erases what they owed. Settle and close the period first, then remove.
    """
    hh = await require_admin(user["user_id"])
    if body.user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Kendinizi çıkaramazsınız, 'Evden ayrıl'ı kullanın")
    if body.user_id not in hh.get("member_ids", []):
        raise HTTPException(status_code=404, detail="Bu kişi evin üyesi değil")

    period = await get_active_period(hh["household_id"])
    if period:
        involved = await db.expenses.count_documents({
            "household_id": hh["household_id"],
            "period_id": period["period_id"],
            "$or": [{"added_by": body.user_id}, {"target_user_id": body.user_id}],
        })
        if involved:
            raise HTTPException(
                status_code=400,
                detail=f"Bu kişinin açık dönemde {involved} harcaması var. Çıkarmadan önce "
                       "ödeşip dönemi kapatın, yoksa herkesin payı yeniden hesaplanır.",
            )

    await db.households.update_one(
        {"household_id": hh["household_id"]}, {"$pull": {"member_ids": body.user_id}}
    )
    return {"ok": True, "removed": body.user_id}


@api.post("/households/approve")
async def approve_member(body: ApproveReq, user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    if body.user_id not in hh.get("pending_member_ids", []):
        raise HTTPException(status_code=404, detail="Bekleyen üye bulunamadı")

    active = await get_active_period(hh["household_id"])
    joined = 0
    if active:
        # Listesi yazılmamış eski kayıtlar burada dondurulıyor — ÜYE EKLENMEDEN
        # ÖNCE, yani liste katılımdan önceki kadroyu gösteriyor. Yapılmazsa
        # bu kayıtlar her hesaplamada o günkü üye listesine bölünmeye devam
        # eder ve "kat / katma" sorusunun cevabı onlarda hiç uygulanmazdı.
        legacy = await db.expenses.find(
            {"household_id": hh["household_id"], "period_id": active["period_id"],
             "split_with": {"$in": [None, {}]}},
            {"_id": 0, "expense_id": 1, "added_by": 1, "total": 1,
             "target_type": 1, "target_user_id": 1},
        ).to_list(5000)
        for e in legacy:
            mode, sw = split_of(e, hh["member_ids"])
            await db.expenses.update_one(
                {"expense_id": e["expense_id"]},
                {"$set": {"split_mode": mode, "split_with": sw}},
            )

        if body.include_open_period:
            # Yalnızca eşit bölüşülen EV harcamaları. Kişiye özel tutarlara
            # dokunmak toplamı bozar; ikili ve kişisel harcamalar zaten yeni
            # üyeyi ilgilendirmiyor.
            res = await db.expenses.update_many(
                {"household_id": hh["household_id"], "period_id": active["period_id"],
                 "target_type": "household", "split_mode": "equal"},
                {"$set": {f"split_with.{body.user_id}": 1.0}},
            )
            joined = res.modified_count

    await db.households.update_one(
        {"household_id": hh["household_id"]},
        {
            "$pull": {"pending_member_ids": body.user_id},
            "$addToSet": {"member_ids": body.user_id},
        },
    )
    # Yeni üye yalnızca AÇIK döneme yazılır. Kapalı dönemlerin listesi dondu;
    # bugün eve katılan biri aylar önce kapanmış bir hesaba karışmamalı.
    if active:
        await db.periods.update_one(
            {"period_id": active["period_id"]},
            {"$addToSet": {"participant_ids": body.user_id}},
        )
    await notify(
        [body.user_id],
        "İsteğin onaylandı",
        f"Artık \"{hh['name']}\" evindesin. Harcamaları görebilirsin.",
        "join_request",
        {"household_id": hh["household_id"]},
    )
    return {"ok": True, "joined_expenses": joined}


@api.post("/households/reject")
async def reject_member(body: MemberActionReq, user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    await db.households.update_one(
        {"household_id": hh["household_id"]},
        {"$pull": {"pending_member_ids": body.user_id}},
    )
    return {"ok": True}


@api.get("/households/me")
async def my_household(user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if hh:
        members = await db.users.find(
            {"user_id": {"$in": hh["member_ids"]}}, PUBLIC_USER_PROJECTION
        ).to_list(50)
        pending = await db.users.find(
            {"user_id": {"$in": hh.get("pending_member_ids", [])}}, PUBLIC_USER_PROJECTION
        ).to_list(50)
        active_period = await get_active_period(hh["household_id"])
        # Approving someone mid-period re-splits every expense already in it,
        # so the UI warns when there is anything to re-split.
        open_expense_count = 0
        if active_period:
            open_expense_count = await db.expenses.count_documents({
                "household_id": hh["household_id"],
                "period_id": active_period["period_id"],
                "target_type": "household",
            })
        return {
            "household": hh,
            "members": members,
            "pending_members": pending,
            "active_period": active_period,
            "pending": False,
            "admin_id": admin_id(hh),
            "is_admin": admin_id(hh) == user["user_id"],
            "open_expense_count": open_expense_count,
        }
    # user might be pending on another household
    pending_hh = await get_pending_household(user["user_id"])
    if pending_hh:
        return {
            "household": None,
            "pending_household": {
                "household_id": pending_hh["household_id"],
                "name": pending_hh["name"],
            },
            "members": [],
            "pending_members": [],
            "active_period": None,
            "pending": True,
        }
    return {"household": None, "members": [], "pending_members": [], "active_period": None, "pending": False}


@api.post("/households/leave")
async def leave_household(user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if hh:
        await db.households.update_one(
            {"household_id": hh["household_id"]}, {"$pull": {"member_ids": user["user_id"]}}
        )
        # If the admin walks out, hand the household to whoever is left —
        # otherwise nobody can approve joins or close periods ever again.
        if admin_id(hh) == user["user_id"]:
            remaining = [m for m in hh.get("member_ids", []) if m != user["user_id"]]
            if remaining:
                await db.households.update_one(
                    {"household_id": hh["household_id"]},
                    {"$set": {"admin_id": remaining[0]}},
                )
    # also cancel any pending
    await db.households.update_many(
        {"pending_member_ids": user["user_id"]},
        {"$pull": {"pending_member_ids": user["user_id"]}},
    )
    return {"ok": True}


# ---------- OCR (Gemini 3 Flash Vision) ----------
UNIT_KEYS = ("adet", "kg", "lt", "paket")

CATEGORY_KEYS = (
    "sut_urunleri", "meyve_sebze", "et_balik", "firin",
    "icecek", "atistirmalik", "temel_gida", "ev_urunleri", "diger",
)

CATEGORY_KEYWORDS = {
    "sut_urunleri": [
        "milch", "käse", "joghurt", "jogurt", "quark", "sahne", "butter", "kefir",
        "gouda", "camembert", "mozzarella", "feta", "frischkäse", "schmand", "eier",
    ],
    "meyve_sebze": [
        "obst", "gemüse", "apfel", "banane", "tomate", "gurke", "salat", "zwiebel",
        "karotte", "möhre", "kartoffel", "paprika", "zitrone", "orange", "birne",
        "trauben", "beere", "avocado", "brokkoli", "spinat", "pilze", "champignon",
    ],
    "et_balik": [
        "fleisch", "wurst", "schinken", "hähnchen", "rind", "schwein", "fisch",
        "lachs", "puten", "salami", "hack", "steak", "thunfisch", "garnelen", "speck",
    ],
    "firin": [
        "brot", "brötchen", "semmel", "gebäck", "kuchen", "toast", "backwaren",
        "baguette", "croissant", "brezel",
    ],
    "icecek": [
        "wasser", "saft", "cola", "limo", "bier", "wein", "kaffee", "tee",
        "sprudel", "schorle", "energy", "milchgetränk",
    ],
    "atistirmalik": [
        "schokolade", "chips", "keks", "riegel", "eis", "süß", "bonbon",
        "gummibär", "nuss", "erdnuss", "popcorn", "waffel", "praline",
    ],
    "ev_urunleri": [
        "papier", "reiniger", "spül", "waschmittel", "seife", "shampoo", "zahnpasta",
        "duschgel", "putz", "müllbeutel", "schwamm", "windel", "taschentuch",
        "weichspüler", "allzweck", "toiletten",
    ],
}


def _fold_german(s: str) -> str:
    """Fold German text to a plain-ASCII form for keyword matching.

    Receipts (and OCR) spell umlauts either way — "Brötchen" or "Broetchen",
    "Spülmittel" or "Spuelmittel" — so both must land on the same string.
    Keywords are folded with this same function at import time.
    """
    s = s.lower()
    for src, dst in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        s = s.replace(src, dst)
    for src, dst in (("ae", "a"), ("oe", "o"), ("ue", "u")):
        s = s.replace(src, dst)
    return s


# Longest keyword first, so the most specific match wins regardless of category
# order: "Fleischsalat" must hit "fleisch" (meat), not "salat" (vegetables).
_FOLDED_KEYWORDS: List[tuple] = sorted(
    ((_fold_german(kw), cat) for cat, kws in CATEGORY_KEYWORDS.items() for kw in kws),
    key=lambda pair: len(pair[0]),
    reverse=True,
)


def categorize_item(name: str) -> str:
    n = _fold_german(name)
    for kw, cat in _FOLDED_KEYWORDS:
        if kw in n:
            return cat
    return "diger"


OCR_SYSTEM_PROMPT = """You are an expert at reading grocery receipts from Germany (Kassenbon: Rewe, Edeka, Aldi, Lidl, Penny, Kaufland, Netto, DM, Rossmann, Bauhaus, Obi, Hornbach, IKEA, Action, Tedi) and from Turkey (fiş: BİM, A101, ŞOK, Migros, CarrefourSA, Macrocenter, Tarım Kredi, File, Hakmar, Metro).

Extract information from the receipt image and return STRICT JSON only (no prose, no markdown, no code fences).

Rules:
1. German and Turkish number formats both use comma as decimal separator: "3,49" means 3.49. Convert to a float with dot.
2. Extract the merchant/store name from the top of the receipt (e.g. "REWE", "EDEKA", "ALDI", "BİM", "A101", "ŞOK", "MİGROS"). Turkish receipts print the full legal name ("BİM BİRLEŞİK MAĞAZALAR A.Ş."); return it as printed, the server shortens it. If unknown, use null.
3. Extract the purchase date. Look for "Datum" or "TARİH", or a date-like line at the top or bottom. Return as ISO string "YYYY-MM-DD". Ignore any time.
3b. Currency: "EUR" if the receipt shows EUR or the euro sign, "TRY" if it shows TL, TRY or the lira sign. Read it from the receipt; do not guess from the language.
4. Line items: each product line typically has a name and a price. Return one entry per item.
   - Quantity: if you see "2 x 1,49" or "3 Stk" or "2X" style, set quantity accordingly and use the unit price. If unclear, quantity = 1 and price = total for that line.
   - Unit: weighed goods print a separate line under the item, e.g. "0,590 kg x 10,99 EUR/kg" or "0,284 kg" — that line belongs to the item ABOVE it, never to a new item. When you see one, set "unit":"kg", "quantity":0.590 and "price":10.99 (the per-kilo price). Same for litres ("1,5 l", "0,75 L") with "unit":"lt". Multi-packs counted in pieces stay "unit":"adet". Never turn a weight into a piece count: 0,590 kg is not 590 pieces.
   - German items often have "A" or "B" (VAT class) at end — strip it.
   - Package size: if the printed name carries a pack size ("ZWIEBELN 2KG",
     "PAPRIKA ROT 500G", "6x0,33L", "Milch 1,5L"), ALSO return it separately as
     "size_amount" (a number in kilograms or litres, so 500 g is 0.5) and
     "size_unit" ("kg" or "lt"). Keep the size in "name" as printed — do not
     rewrite the name. If the item is weighed at the till, leave size_amount
     null and set "unit":"kg" as described above; the per-kilo price is already
     in "price". If there is no size anywhere, leave both null.
     This is used to compare prices per kilo between shops, so a wrong size is
     worse than a missing one: when unsure, return null.
5. Discount lines: markers include "Rabatt", "RABATT", "-%", "Preisnachlass", "PAYBACK Rabatt", lines starting with "-", or negative prices. If a discount is clearly associated with an item, subtract from that item's price. Otherwise return as a separate item with negative price.
6. Ignore non-item lines: "MwSt", "Summe", "Zwischensumme", "Gesamtsumme", "Bar", "EC", "Karte", "Rueckgeld", and their Turkish equivalents "TOPLAM", "ARA TOPLAM", "KDV", "NAKİT", "KREDİ KARTI", "PARA ÜSTÜ", "FİŞ NO", store address, times, cashier numbers, "vielen Dank", "teşekkür ederiz".
7. Item names stay in the language printed on the receipt — do NOT translate.

8. Classify every line item into exactly one category. Use your own knowledge
   of the product, not the wording: receipts print brand names, not product
   types ("Goldähren" is bread, "TUNA DILIM SUCUK" is sausage), and this
   household also shops at Turkish supermarkets, so items may be in Turkish,
   German or English. Allowed values:
     "sut_urunleri"  milk, cheese, yoghurt, butter, cream, eggs (süt, kaşar, peynir, yumurta)
     "meyve_sebze"   fresh fruit and vegetables (meyve, sebze, salça değil)
     "et_balik"      meat, poultry, fish, sausage, charcuterie (et, tavuk, balık, sucuk, salam)
     "firin"         bread, pastry, cake, biscuits-as-bakery (ekmek, poğaça, börek)
     "icecek"        any drink incl. water, juice, tea, coffee, beer, wine (çay, kahve, ayran)
     "atistirmalik"  sweets, crisps, chocolate, nuts, ice cream (çikolata, cips, kuruyemiş)
     "temel_gida"    pasta, rice, flour, sugar, oil, legumes, spices, tinned goods
                     (makarna, pirinç, un, şeker, yağ, bakliyat, baharat, salça, konserve)
     "ev_urunleri"   cleaning, hygiene, paper goods, bags, batteries (deterjan, şampuan, poşet)
     "diger"         only when genuinely none of the above fits
   Discount lines take the category "diger".

Return JSON EXACTLY in this schema:
{
  "merchant": "REWE" | "EDEKA" | "ALDI" | "LIDL" | "PENNY" | "KAUFLAND" | "NETTO" | "DM" | "ROSSMANN" | string | null,
  "date": "YYYY-MM-DD" | null,
  "total": number | null,
  "currency": "EUR" | "TRY",
  "items": [
    { "name": string, "price": number, "quantity": number, "unit": "adet" | "kg" | "lt" | "paket",
      "size_amount": number | null, "size_unit": "kg" | "lt" | null, "category": string }
  ]
}

If nothing is legible, return empty items array."""


GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


async def gemini_vision(system_prompt: str, user_text: str, image_b64: str, mime: str = "image/jpeg") -> str:
    """Call the Google Generative Language REST API directly (free-tier API key)."""
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": user_text},
                    {"inline_data": {"mime_type": mime, "data": image_b64}},
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            # Reading a receipt is transcription, not reasoning. Left on, the
            # model spent ~1000 thinking tokens per scan and they come out of
            # the same output budget — long receipts had their JSON cut off
            # mid-array and failed to parse.
            "thinkingConfig": {"thinkingBudget": 0},
            "maxOutputTokens": 8192,
        },
    }
    url = GEMINI_ENDPOINT.format(model=GEMINI_MODEL)

    # The free tier returns 503/429 under load often enough that a single
    # attempt shows up to the user as "fiş okunamadı" for a perfectly good
    # photo. Retry the transient ones; a scan is worth a few extra seconds.
    last_status, last_body = None, ""
    for attempt in range(1, 4):
        try:
            async with httpx.AsyncClient(timeout=120.0) as http:
                r = await http.post(url, params={"key": GEMINI_API_KEY}, json=payload)
        except Exception as e:
            logger.warning("Gemini ağ hatası (deneme %s): %s", attempt, e)
            if attempt == 3:
                raise HTTPException(status_code=502, detail="OCR servisine ulaşılamadı")
            await asyncio.sleep(attempt * 2)
            continue

        if r.status_code == 200:
            data = r.json()
            candidates = data.get("candidates") or []
            finish = candidates[0].get("finishReason") if candidates else None
            parts = (candidates[0].get("content", {}).get("parts") or []) if candidates else []
            text = "".join(p.get("text", "") for p in parts).strip()
            if finish == "MAX_TOKENS":
                # Truncated JSON is unparseable; say so plainly in the log
                # instead of leaving a "parse hatası" mystery behind.
                logger.warning("Gemini çıktı bütçesi doldu (deneme %s), yanıt kesildi", attempt)
                text = ""
            if text:
                return text
            # Empty completion happens on a hiccup too — worth one more go.
            logger.warning("Gemini boş yanıt (deneme %s), finish=%s", attempt,
                           candidates[0].get("finishReason") if candidates else None)
            last_status, last_body = 200, "boş yanıt"
        else:
            last_status, last_body = r.status_code, r.text[:300]
            logger.warning("Gemini %s (deneme %s): %s", r.status_code, attempt, last_body)
            if r.status_code == 429:
                raise HTTPException(status_code=429,
                                    detail="Ücretsiz OCR kotası doldu, birazdan tekrar deneyin")
            if r.status_code < 500 and r.status_code != 408:
                break  # kalıcı hata, tekrar denemenin anlamı yok

        if attempt < 3:
            await asyncio.sleep(attempt * 2)

    logger.error("Gemini başarısız: %s %s", last_status, last_body)
    raise HTTPException(status_code=502, detail="Fiş okunamadı, lütfen tekrar deneyin")


@api.post("/ocr/receipt")
async def ocr_receipt(body: OCRRequest, user=Depends(get_current_user)):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY tanımlı değil")

    hh = await get_user_household(user["user_id"])
    b64 = body.image_base64
    mime = "image/jpeg"
    if b64.startswith("data:"):
        header, b64 = b64.split(",", 1)
        if ";" in header and ":" in header:
            mime = header.split(":", 1)[1].split(";", 1)[0] or mime

    try:
        text = await gemini_vision(
            OCR_SYSTEM_PROMPT,
            "Parse this German receipt and return the strict JSON as specified.",
            b64,
            mime,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("OCR call failed")
        raise HTTPException(status_code=502, detail=f"OCR başarısız: {e}")

    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        logger.error("OCR yanıtı JSON değil: %s", text[:300])
        raise HTTPException(status_code=502, detail="Fiş okunamadı, lütfen tekrar deneyin")
    try:
        parsed = json.loads(text[start : end + 1])
    except Exception:
        logger.error("OCR JSON parse edilemedi: %s", text[:300])
        raise HTTPException(status_code=502, detail="Fiş okunamadı, lütfen tekrar deneyin")

    items = []
    for it in parsed.get("items", []) or []:
        try:
            name = str(it.get("name", "")).strip()
            price = float(it.get("price", 0) or 0)
            qty = float(it.get("quantity", 1) or 1)
        except Exception:
            continue
        if not name:
            continue
        # The model classifies from product knowledge; the keyword matcher is
        # only a net for when it returns something unexpected. Keywords alone
        # missed 56% of real items — they are German-only and half this
        # household's shopping is Turkish brands.
        cat = str(it.get("category", "") or "").strip().lower()
        if cat not in CATEGORY_KEYS:
            cat = categorize_item(name)
        unit = str(it.get("unit", "") or "").strip().lower()
        if unit not in UNIT_KEYS:
            # Model birim vermediyse tartıya benzeyen miktarı adet saymayalım:
            # tam sayı olmayan bir miktar fişte neredeyse her zaman kilogramdır.
            unit = "kg" if 0 < qty < 1 or (qty % 1) else "adet"
        # Modelin verdigi boyut, ada bakan ayristiriciya tercih edilir; ikisi de
        # yoksa alan bos kalir ve kalem yine normal kaydedilir. Bos boyut, yanlis
        # boyuttan iyidir: yanlis olan dogrudan yanlis birim fiyat demek.
        size_amount, size_unit = None, None
        try:
            sa = it.get("size_amount")
            su = str(it.get("size_unit") or "").strip().lower()
            if sa is not None and su in ("kg", "lt") and float(sa) > 0:
                size_amount, size_unit = round(float(sa), 4), su
        except (TypeError, ValueError):
            pass
        if size_amount is None:
            got = parse_size(name)
            if got:
                size_amount, size_unit = got[0], got[1]
        items.append(
            {
                "name": name,
                "price": round(price, 2),
                "quantity": qty if qty > 0 else 1,
                "unit": unit,
                "size_amount": size_amount,
                "size_unit": size_unit,
                "category": cat,
            }
        )

    return {
        "merchant": parsed.get("merchant"),
        "date": parse_date(parsed.get("date")),
        "total": parsed.get("total"),
        # Fisin para birimi KAYNAK degil, DENETIM: evin para birimi neyse
        # kayit ona gore tutuluyor. Fis baska bir birimdeyse istemci uyarir --
        # 500 TL'yi sessizce euro toplamina eklemek en kotu sonuc olurdu.
        "currency": (parsed.get("currency") or "").upper() or None,
        "household_currency": (hh or {}).get("currency", "EUR"),
        "items": items,
    }


# ---------- Bölüşme ----------
# Üç ayrı özel durum (`household` / `self` / `roommate`) tek mekanizmaya indi:
# her harcama kendi katılımcı listesini taşır.
#
#     split_mode "equal"  → split_with = {user_id: ağırlık}   (bugün hep 1)
#     split_mode "exact"  → split_with = {user_id: tutar}
#
# Liste yalnızca parayı değil, **görünürlüğü ve bildirimi de** belirliyor:
# harcamayı ekleyen ve listede olanlar görür, listede olanlara haber gider.
# Böylece eski üç durum kendiliğinden çıkıyor — herkes listede = ev, sadece
# ben = kişisel, tek başkası = ona ait.
#
# Liste kayıt anında donuyor. Sonradan eve katılan biri geçmiş harcamaların
# payını kendiliğinden üstlenmiyor; katılım onayında açıkça soruluyor.


def _split_from_target(target_type: Optional[str], target_user_id: Optional[str],
                       payer: str, total: float, member_ids: List[str]) -> tuple:
    """Eski `target_type` girdisinden katılımcı listesi türet.

    İki yerde lazım: `split_with` göndermeyen bir istemci (eski APK, testler)
    ve `split_with` alanı hiç yazılmamış eski kayıtlar.
    """
    if target_type == "roommate" and target_user_id:
        return "exact", {target_user_id: round(float(total), 2)}
    if target_type == "self":
        return "exact", {payer: round(float(total), 2)}
    # Varsayılan ev harcaması. Ağırlıklar 1: "eşit bölüş" demenin yolu.
    return "equal", {m: 1.0 for m in member_ids} or {payer: 1.0}


def split_of(e: dict, participants: List[str]) -> tuple:
    """Bir harcamanın bölüşme kipi ve listesi.

    `split_with` yazılmamış eski kayıtlar için `target_type`'tan türetiliyor.
    Bu yedek yol kalıcıdır: tek seferlik bir göç betiği kaçırdığı her kaydı
    sessizce dengeden düşürürdü, burada böyle bir kayıp mümkün değil.
    """
    sw = e.get("split_with")
    if isinstance(sw, dict) and sw:
        mode = e.get("split_mode") or "equal"
        return mode, {u: float(v) for u, v in sw.items()}
    return _split_from_target(
        e.get("target_type"), e.get("target_user_id"),
        e["added_by"], float(e.get("total") or 0), participants,
    )


def expense_shares(e: dict, participants: List[str]) -> Dict[str, float]:
    """Kim bu harcamadan ne kadar borçlandı.

    Eşit bölüşmede paylar yuvarlanmadan dağıtılıyor; yuvarlama en sonda, net
    bakiye üzerinde bir kez yapılıyor. Kişi başına yuvarlamak 10,00 €'yu üç
    kişide 9,99 ya da 10,02 yapar ve toplam ödenen ile bölüşülen tutmaz.
    """
    mode, sw = split_of(e, participants)
    total = float(e.get("total") or 0)
    if mode == "exact":
        return {u: float(a) for u, a in sw.items() if float(a) != 0}
    weights = {u: float(w) for u, w in sw.items() if float(w) > 0}
    denom = sum(weights.values())
    if denom <= 0:
        return {}
    return {u: total * w / denom for u, w in weights.items()}


def derive_target_type(payer: str, split_with: Dict[str, float], member_ids: List[str]) -> str:
    """Listeden okunan etiket. Süzgeçler ve ekrandaki rozet bunu kullanıyor.

    Sıra önemli: tek kişilik bir evde "herkes" ile "sadece ben" aynı listedir,
    ve orada doğru cevap ev harcamasıdır — kişisel harcama kimseden gizlenmiyor.
    """
    keys = set(split_with)
    if keys and keys == set(member_ids):
        return "household"
    if keys == {payer}:
        return "self"
    if len(keys) == 1:
        return "roommate"
    return "custom"


def validate_split(mode: str, split_with: Dict[str, float], total: float,
                   allowed: List[str]) -> Dict[str, float]:
    """Kaydetmeden önce listeyi doğrula ve temizle."""
    if not split_with:
        raise HTTPException(status_code=400, detail="Bölüşülecek kişi seçilmedi")
    clean: Dict[str, float] = {}
    for uid, val in split_with.items():
        if uid not in allowed:
            raise HTTPException(status_code=400, detail="Bölüşme listesinde evin üyesi olmayan biri var")
        v = round(float(val), 2)
        if v <= 0:
            continue
        clean[uid] = v
    if not clean:
        raise HTTPException(status_code=400, detail="Bölüşülecek kişi seçilmedi")
    if mode == "exact":
        # 0,01 tolerans: kullanıcı 1200'ü 400/400/400 diye böldüğünde sorun yok
        # ama 1000'i üçe bölerken 333,33 × 3 = 999,99 kalıyor.
        if abs(sum(clean.values()) - round(float(total), 2)) > 0.01 + 1e-9:
            raise HTTPException(
                status_code=400,
                detail="Girilen tutarların toplamı harcama tutarını tutmuyor",
            )
    return clean


def resolve_split(body, payer: str, total: float, member_ids: List[str],
                  fallback: Optional[dict] = None) -> tuple:
    """İstekten bölüşme kipi ve listesini çıkar.

    `split_with` geldiyse o kullanılır; gelmediyse `target_type`'tan türetilir.
    """
    if body.split_with is not None:
        mode = body.split_mode or "equal"
        allowed = list(dict.fromkeys(list(member_ids) + [payer]))
        return mode, validate_split(mode, body.split_with, total, allowed)
    # `target_type` yalnızca harcama gövdelerinde var. Düzenli gider şablonu
    # gibi yalnızca `split_with` taşıyan gövdelerde alan hiç bulunmuyor.
    tt = getattr(body, "target_type", None)
    tu = getattr(body, "target_user_id", None)
    if tt is not None or fallback is None:
        return _split_from_target(tt, tu, payer, total, member_ids)
    # Ne liste ne etiket geldi: düzenlemede bölüşmeye dokunulmamış demektir.
    stored = fallback.get("split_with")
    if not (isinstance(stored, dict) and stored):
        # Eski kayıt: liste `target_type`'tan türetiliyor, yani tutarı takip eder.
        return _split_from_target(
            fallback.get("target_type"), fallback.get("target_user_id"),
            payer, total, member_ids,
        )
    mode, sw = split_of(fallback, member_ids)
    if mode == "exact" and abs(sum(sw.values()) - round(float(total), 2)) > 0.01 + 1e-9:
        # Kişiye özel tutarlar toplamı tutmuyor. Oransal olarak yeniden
        # dağıtmak sessizce yanlış borç üretir — 1200 €'luk kirada A'nın 350'si
        # kimsenin onaylamadığı bir sayıya kayar. Kullanıcı yeniden bölüştürsün.
        raise HTTPException(
            status_code=400,
            detail="Tutar değişti, kişiye özel bölüşüm artık tutmuyor. Bölüşümü yeniden düzenleyin.",
        )
    return mode, sw


# ---------- Expenses ----------
@api.post("/expenses")
async def create_expense(body: ExpenseCreate, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=400, detail="Önce bir eve katılın")
    period = await get_active_period(hh["household_id"])
    if not period:
        raise HTTPException(status_code=400, detail="Aktif dönem bulunamadı")

    if body.target_type == "roommate":
        if not body.target_user_id or body.target_user_id not in hh["member_ids"]:
            raise HTTPException(status_code=400, detail="Geçersiz oda arkadaşı")
        if body.target_user_id == user["user_id"]:
            raise HTTPException(status_code=400, detail="Kendinize atayamazsınız")

    split_mode, split_with = resolve_split(
        body, user["user_id"], body.total, hh["member_ids"]
    )
    target_type = derive_target_type(user["user_id"], split_with, hh["member_ids"])

    expense_id = new_id("exp")
    doc = {
        "expense_id": expense_id,
        "household_id": hh["household_id"],
        "period_id": period["period_id"],
        "added_by": user["user_id"],
        "target_type": target_type,
        # Tek kişiye ait harcamalarda korunuyor: eski kayıtlarla aynı şekilde
        # süzülebilsin ve eski APK sürümleri hedefi okumaya devam edebilsin.
        # Listeden okunuyor, gövdeden değil — istemci `split_with` gönderip
        # `target_user_id` göndermemiş olabilir.
        "target_user_id": next(iter(split_with)) if target_type == "roommate" else None,
        "split_mode": split_mode,
        "split_with": split_with,
        "items": [i.model_dump() for i in body.items],
        "total": round(body.total, 2),
        "source": body.source,
        "category": body.category,
        "merchant": await resolve_merchant(hh["household_id"], body.merchant),
        "notes": body.notes,
        "currency": hh.get("currency", "EUR"),
        "expense_date": parse_date(body.expense_date) or now_utc().strftime("%Y-%m-%d"),
        "created_at": now_utc(),
    }
    await db.expenses.insert_one(doc.copy())
    # Fiyat kaydi harcamadan SONRA ve tamamen ayri: icerideki her sey yutuluyor,
    # yazilamamasi harcamanin kaydedilmesini engellemiyor.
    await record_price_points(doc, hh)

    # Kimin haberi olacağı, kimin payı olduğundan çıkıyor: listede olan herkes
    # (ekleyen hariç) duyar. Kişisel harcamada liste yalnızca ekleyeni içerdiği
    # için kimseye gitmez — gizli olması gereken şey varlığını da duyurmamalı.
    audience = [u for u in split_with if u != user["user_id"]]
    if audience:
        label = body.merchant or body.category or ("Fiş" if body.source == "receipt" else "Harcama")
        amount = f"{doc['total']:.2f}".replace(".", ",")
        if target_type == "household":
            title, msg = "Yeni ev harcaması", f"{user['name']} · {label} · {amount} €"
        elif target_type == "roommate":
            title, msg = "Senin için bir harcama", f"{user['name']} senin için {label} aldı · {amount} €"
        else:
            title = "Ortak bir harcama"
            msg = f"{user['name']} · {label} · {amount} € · {len(split_with)} kişi bölüşüyor"
        await notify(audience, title, msg, "new_expense", {"expense_id": expense_id})
    return {"expense": doc}


def _visible_filter(user_id: str) -> dict:
    """Bu kişinin görebileceği harcamalar: eklediği ya da payı olduğu.

    Kural bölüşme listesinden okunuyor. `split_with` yazılmamış eski kayıtlar
    için eski `target_type` maddeleri duruyor — sorgu veritabanında çalıştığı
    için `split_of()` yedek yolu burada kullanılamıyor.
    """
    legacy = {"split_with": {"$in": [None, {}]}}
    return {
        "$or": [
            {"added_by": user_id},
            {f"split_with.{user_id}": {"$exists": True}},
            {**legacy, "target_type": "household"},
            {**legacy, "target_type": "roommate", "target_user_id": user_id},
        ]
    }


@api.get("/expenses")
async def list_expenses(
    period_id: Optional[str] = None,
    member_id: Optional[str] = None,
    target_type: Optional[str] = None,
    user=Depends(get_current_user),
):
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"expenses": []}
    q: dict = {"household_id": hh["household_id"]}
    if period_id:
        q["period_id"] = period_id
    else:
        active = await get_active_period(hh["household_id"])
        if active:
            q["period_id"] = active["period_id"]
    q.update(_visible_filter(user["user_id"]))
    if member_id:
        q["added_by"] = member_id
    if target_type:
        q["target_type"] = target_type
    exps = await db.expenses.find(q, {"_id": 0}).sort("expense_date", -1).to_list(1000)
    # secondary sort by created_at desc for same date
    exps.sort(key=lambda e: (e.get("expense_date") or "", e.get("created_at")), reverse=True)
    return {"expenses": exps}


@api.get("/members/{member_id}/expenses")
async def member_expenses(
    member_id: str,
    period_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Drill-down: expenses added by a given member visible to the caller.
    Used on Denge (settle-up) screen to show what they bought for the household."""
    hh = await get_user_household(user["user_id"])
    if not hh or member_id not in hh["member_ids"]:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    q: dict = {"household_id": hh["household_id"], "added_by": member_id}
    if period_id:
        q["period_id"] = period_id
    else:
        active = await get_active_period(hh["household_id"])
        if active:
            q["period_id"] = active["period_id"]
    q.update(_visible_filter(user["user_id"]))
    exps = await db.expenses.find(q, {"_id": 0}).to_list(1000)
    exps.sort(key=lambda e: (e.get("expense_date") or "", e.get("created_at")), reverse=True)
    total = sum(float(e["total"]) for e in exps if e["target_type"] == "household")
    total_roommate = sum(float(e["total"]) for e in exps if e["target_type"] == "roommate")
    return {"expenses": exps, "household_total": round(total, 2), "roommate_total": round(total_roommate, 2)}


async def _get_editable_expense(expense_id: str, user: dict) -> dict:
    """Fetch an expense the caller is allowed to change.

    Closed periods are off limits. Their balances are what everyone settled
    on; editing or deleting inside one rewrites history after the fact and the
    numbers people already paid against would silently stop matching. To fix
    something in a closed period, reopen it first.
    """
    doc = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Harcama bulunamadı")
    if doc["added_by"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Sadece ekleyen kişi değiştirebilir")

    period = await db.periods.find_one({"period_id": doc["period_id"]}, {"_id": 0})
    if period and period.get("status") == "closed":
        raise HTTPException(
            status_code=400,
            detail="Bu harcama kapatılmış bir döneme ait. Değiştirmek için önce dönemi yeniden açın.",
        )
    return doc


# Kimin payını değiştiren alanlar. Nottaki bir yazım hatası kimseyi
# ilgilendirmiyor; telefon her düzeltmede titrerse insanlar bildirimleri
# kapatır ve asıl önemli olanı da kaçırır.
MATERIAL_FIELDS = ("total", "target_type", "target_user_id", "split_with")


# Fişin üstündeki ticari unvan ekleri. "BIM BIRLESIK MAGAZALAR A.Ş." ile
# "BİM" aynı market; bunlar temizlenmezse istatistikte iki ayrı satır oluyor.
LEGAL_SUFFIXES = (
    "a.ş.", "a.ş", "as", "aş", "ltd. şti.", "ltd.şti.", "ltd şti", "ltd.", "ltd",
    "şti.", "şti", "san. ve tic.", "san.ve tic.", "san. tic.", "sanayi ve ticaret",
    "ticaret", "tic.", "tic", "gmbh & co. kg", "gmbh & co kg", "gmbh", "mbh",
    "kg", "ag", "e.k.", "ek", "ohg", "gbr", "se", "inc.", "inc", "b.v.", "bv",
)


# Bilinen zincirler. Fişin üstünde tam ticari unvan yazıyor
# ("BİM BİRLEŞİK MAĞAZALAR A.Ş."), insanların kullandığı ad ise kısa olanı.
# Benzerlik ölçümü bunu çözemez — iki metin gerçekten farklı; markayı bilmek
# gerekiyor. Ekrandaki marka renkleri de bu adlarla eşleşiyor.
KNOWN_MERCHANTS = (
    # Türkiye
    "BİM", "A101", "ŞOK", "Migros", "CarrefourSA", "Macrocenter", "Tarım Kredi",
    "File", "Hakmar", "Onur Market", "Metro",
    # Almanya
    "REWE", "EDEKA", "ALDI", "LIDL", "PENNY", "KAUFLAND", "NETTO", "NORMA",
    "DM", "ROSSMANN", "ACTION", "TEDi", "BAUHAUS", "OBI", "HORNBACH", "IKEA",
)

# Türkçe harfleri karşılaştırma için sadeleştir. `.lower()` Türkçe'de
# güvenilmez ("İ" iki kod noktasına açılıyor) ve OCR aynı harfi her seferinde
# aynı yazmıyor; katlayınca "BİM" ile "BIM" aynı anahtara düşüyor.
_FOLD = str.maketrans({
    "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ş": "s", "Ş": "s",
    "ı": "i", "I": "i", "İ": "i", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c",
    "ä": "a", "Ä": "a", "ß": "ss",
})


def normalize_merchant(name: Optional[str]) -> Optional[str]:
    """Fiş üstündeki market adını karşılaştırılabilir bir anahtara indirger.

    Yalnızca eşleştirme için kullanılır; kullanıcıya gösterilen ad bozulmaz.
    """
    if not name:
        return None
    s = str(name).translate(_FOLD).lower()
    s = s.replace("&", " ").replace(".", ". ")
    s = " ".join(s.split())
    changed = True
    while changed:
        changed = False
        for suf in LEGAL_SUFFIXES:
            if s.endswith(" " + suf):
                s = s[: -len(suf) - 1].strip()
                changed = True
    s = "".join(ch for ch in s if ch.isalnum() or ch.isspace())
    return " ".join(s.split()) or None


def canonical_brand(name: Optional[str]) -> Optional[str]:
    """Ad bilinen bir zincirle başlıyorsa markanın kendi yazımını döndür."""
    key = normalize_merchant(name)
    if not key:
        return None
    for brand in KNOWN_MERCHANTS:
        bk = normalize_merchant(brand)
        if bk and (key == bk or key.startswith(bk + " ")):
            return brand
    return None


def match_known_merchant(name: Optional[str], known: List[str]) -> Optional[str]:
    """Evde daha önce kullanılmış bir markete yeterince benziyorsa onu döndür.

    "Bizim Fleisher GmbH" ile "Bizim Fleischer" tek harf farkıyla aynı yer.
    Yapay zekâya sormuyoruz: bu iş kütüphanesiz, bedava ve her seferinde aynı
    sonucu veriyor — kullanıcı sayısı arttıkça jeton maliyeti de doğurmuyor.
    """
    if not name:
        return None
    key = normalize_merchant(name)
    if not key:
        return None
    best, best_score = None, 0.0
    for k in known:
        other = normalize_merchant(k)
        if not other:
            continue
        if other == key:
            return k
        score = difflib.SequenceMatcher(None, key, other).ratio()
        if score > best_score:
            best, best_score = k, score
    # 0.88: "bizim fleisher" ↔ "bizim fleischer" 0.96 veriyor, "rewe" ↔ "penny"
    # 0.2'de kalıyor. Eşiği düşürmek gerçekten farklı dükkânları birleştirir.
    return best if best_score >= 0.88 else None


async def resolve_merchant(household_id: str, name: Optional[str]) -> Optional[str]:
    """Girilen market adını tek bir yazıma indirger.

    Önce bilinen zincir listesi, sonra evin kendi geçmişi. Sıra önemli: zincir
    listesi kesin bilgi, benzerlik ölçümü tahmin.
    """
    clean = (name or "").strip() or None
    if not clean:
        return None
    brand = canonical_brand(clean)
    if brand:
        return brand
    known = await db.expenses.distinct("merchant", {"household_id": household_id})
    return match_known_merchant(clean, [k for k in known if k]) or clean


# ---------- Fiyat normalleştirme ----------
# Fiyat karşılaştırmasının tamamı BİRİM fiyata dayanır. Fişte ham fiyat var
# ama miktar çoğu zaman ürün adının içinde sıkışmış:
#
#     ZWIEBELN 2KG      1,69   ->  0,85 EUR/kg
#     PAPRIKA ROT 500G  1,59   ->  3,18 EUR/kg
#
# Ham fiyatları toplamak hiçbir işe yaramaz: "soğan 1,69" ile "soğan 1,11"
# karşılaştırılamaz, biri iki kilo diğeri belli değil.

# Çoklu paket önce denenir: "6x0,33L" tek başına "0,33 L" değil 1,98 L.
_MULTI_SIZE_RE = re.compile(
    r"(?<![a-z0-9])(\d+)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|lt|l)(?![a-z])",
    re.IGNORECASE,
)
_SIZE_RE = re.compile(
    r"(?<![a-z0-9])(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|lt|l)(?![a-z])",
    re.IGNORECASE,
)
# Her şey kg ve lt'ye indirgeniyor; iki farklı ölçekte seri tutmak
# karşılaştırmayı yine imkânsız kılardı.
_SIZE_FACTORS = {
    "kg": (1.0, "kg"), "g": (0.001, "kg"), "gr": (0.001, "kg"),
    "lt": (1.0, "lt"), "l": (1.0, "lt"), "ml": (0.001, "lt"), "cl": (0.01, "lt"),
}


def parse_size(name: str) -> Optional[tuple]:
    """Ürün adından paket boyutunu ayıkla → (miktar, "kg"|"lt", eşleşen metin).

    Kütüphanesiz ve belirlenimci: aynı ad her zaman aynı sonucu verir ve
    kullanıcı sayısı arttıkça jeton maliyeti doğurmaz — market ismi
    birleştirmede kullanılan yaklaşımın aynısı.
    """
    if not name:
        return None
    for rx, multi in ((_MULTI_SIZE_RE, True), (_SIZE_RE, False)):
        m = rx.search(name)
        if not m:
            continue
        try:
            count = float(m.group(1).replace(",", ".")) if multi else 1.0
            amount = float(m.group(2 if multi else 1).replace(",", "."))
        except ValueError:
            continue
        factor, base = _SIZE_FACTORS[m.group(3 if multi else 2).lower()]
        total = count * amount * factor
        if total <= 0:
            continue
        return round(total, 4), base, m.group(0)
    return None


def product_key(name: str) -> Optional[str]:
    """Ürün adını karşılaştırılabilir bir anahtara indirger.

    Boyut anahtarın DIŞINDA bırakılıyor. İçeri alınsaydı 1 kg'lık file ile
    2 kg'lık file ayrı seriler olur ve az veriyle her ikisi de anlamsız
    kalırdı; boyut ayrı alanda durup birim fiyata dönüşüyor.
    """
    if not name:
        return None
    s = name
    got = parse_size(s)
    if got:
        s = s.replace(got[2], " ")
    s = _fold_german(s).translate(_FOLD)
    s = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in s)
    return " ".join(s.split()) or None


def price_of_item(item: dict) -> Optional[dict]:
    """Bir fiş kaleminden karşılaştırılabilir birim fiyat çıkar.

    Üç durum var ve ayrımı korumak şart:

    - **açık**: kasada tartılan ürün. Fiş `0,590 kg x 10,99 EUR/kg` yazar,
      yani `price` zaten kilo fiyatıdır.
    - **paketli**: boyut adın içinde. `price` paketin fiyatı, kilo fiyatı
      bölmeyle çıkar. `quantity` sadeleşir — üç paket almak birim fiyatı
      değiştirmez.
    - **adet**: boyutu bilinmeyen sayılabilir ürün. Kilo fiyatı üretilemez,
      adet fiyatı olarak saklanır ve yalnızca kendi sınıfıyla karşılaştırılır.

    Açık ile paketliyi aynı seride toplamak "fiyat iki katına çıktı" gibi
    yanlış uyarılar üretir: değişen fiyat değil ambalajdır.
    """
    name = str(item.get("name") or "").strip()
    key = product_key(name)
    if not key:
        return None
    try:
        price = float(item.get("price") or 0)
    except (TypeError, ValueError):
        return None
    if price <= 0:
        return None

    # Önce kalemin kendi alanı (OCR'ın verdiği), sonra addan ayıklama. Sıra
    # önemli: model fişin tamamını görüyor, ayrıştırıcı yalnızca adı.
    size = None
    try:
        sa, su = item.get("size_amount"), str(item.get("size_unit") or "").lower()
        if sa is not None and su in ("kg", "lt") and float(sa) > 0:
            size = (round(float(sa), 4), su, "")
    except (TypeError, ValueError):
        size = None
    if size is None:
        size = parse_size(name)
    unit = str(item.get("unit") or "").strip().lower()

    if size:
        amount, base, _ = size
        return {"product_key": key, "product": name, "pack_type": "paketli",
                "size_amount": amount, "size_unit": base,
                "unit_price": round(price / amount, 4), "price_unit": base}
    if unit in ("kg", "lt"):
        return {"product_key": key, "product": name, "pack_type": "acik",
                "size_amount": None, "size_unit": unit,
                "unit_price": round(price, 4), "price_unit": unit}
    return {"product_key": key, "product": name, "pack_type": "adet",
            "size_amount": None, "size_unit": "adet",
            "unit_price": round(price, 4), "price_unit": "adet"}


def _iso_week(day: Optional[str]) -> str:
    """"2026-08-15" → "2026-W33". Gün değil hafta kaydediliyor.

    Gün + nadir bir ürün + market üçlüsü tek bir fişe kadar izlenebilir;
    hafta izlenemez. Fiyat eğilimi için hafta zaten yeterli çözünürlük.
    """
    try:
        d = date.fromisoformat((day or "")[:10])
    except ValueError:
        d = now_utc().date()
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


async def record_price_points(expense: dict, household: dict) -> None:
    """Bir harcamanın kalemlerinden anonim fiyat kayıtları üret.

    **Kimlikten yazma anında kopuk.** `household_id`, `user_id`, `expense_id`
    hiç yazılmıyor — sonradan temizlenen değil, hiç var olmayan alanlar. Bu
    ikisi arasındaki fark hem teknik hem hukuki olarak belirleyici: sonradan
    silinen bir alan yedeklerde ve günlüklerde yaşamaya devam eder.

    Ham ürün adı da saklanıyor: yarın daha iyi bir normalleştirici yazılırsa
    anahtarlar yeniden üretilebilsin, veri kaybolmasın.

    **Asla istisna fırlatmaz.** `notify()` ile aynı kural — fiyat kaydının
    tutmaması bir harcamanın kaydedilmesini engellememeli.
    """
    try:
        if expense.get("source") != "receipt" or not expense.get("merchant"):
            return
        merchant = expense["merchant"]
        mkey = normalize_merchant(merchant)
        if not mkey:
            return
        week = _iso_week(expense.get("expense_date"))
        rows = []
        for item in expense.get("items") or []:
            p = price_of_item(item)
            if not p:
                continue
            rows.append({
                "price_id": new_id("prc"),
                "merchant_key": mkey,
                "merchant": merchant,
                "country": household.get("country") or "DE",
                "currency": expense.get("currency") or household.get("currency") or "EUR",
                "week": week,
                "category": item.get("category") or "diger",
                "source": "receipt",
                "created_at": now_utc(),
                **p,
            })
        if rows:
            await db.price_points.insert_many(rows)
    except Exception as exc:      # noqa: BLE001 — bilerek yutuluyor
        logger.warning("fiyat kaydi yazilamadi: %s", exc)


async def _record_revision(before: dict, patch: dict, user: dict, action: str) -> None:
    """Harcamanın eski hâlini sakla. Kayıtlar küçük, geçmiş geri gelmez."""
    changes = {
        k: {"eski": before.get(k), "yeni": patch[k]}
        for k in patch
        if k != "updated_at" and before.get(k) != patch[k]
    }
    if action == "edit" and not changes:
        return
    await db.expense_revisions.insert_one({
        "revision_id": new_id("rev"),
        "expense_id": before["expense_id"],
        "household_id": before["household_id"],
        "period_id": before.get("period_id"),
        "action": action,
        "by": user["user_id"],
        "by_name": user.get("name"),
        "changes": changes,
        # Silmede eski hâlin tamamı lazım: kayıt gitti, geriye yalnızca bu kalıyor.
        "snapshot": before if action == "delete" else None,
        "created_at": now_utc(),
    })


async def _notify_expense_change(before: dict, patch: dict, user: dict, action: str) -> None:
    """Tutarı ya da kime ait olduğunu değiştiren düzenlemeyi ilgililere duyur."""
    if action == "edit" and not any(
        k in patch and patch[k] != before.get(k) for k in MATERIAL_FIELDS
    ):
        return

    hh = await db.households.find_one({"household_id": before["household_id"]}, {"_id": 0})
    if not hh:
        return

    after = {**before, **patch}
    # Kişisel harcama kimseyi ilgilendirmez — ne eski ne yeni hâlinde.
    was = set() if before.get("target_type") == "self" else set(
        expense_shares(before, hh["member_ids"]))
    now = set() if after.get("target_type") == "self" else set(
        expense_shares(after, hh["member_ids"]))
    me = user["user_id"]

    label = before.get("merchant") or before.get("category") or "Harcama"
    total = patch.get("total", before.get("total", 0))
    amount = f"{float(total):.2f}".replace(".", ",")
    data = {"expense_id": before["expense_id"]}

    if action == "delete":
        await notify(
            [a for a in was if a != me],
            "Harcama silindi",
            f"{user['name']} · {label} · {amount} € kaydını sildi",
            "new_expense", data,
        )
        return

    # Üç ayrı kitle, üç ayrı cümle. Hepsine "harcama güncellendi" demek en
    # önemli iki durumu gizler: bölüşüme yeni giren kişinin borcu arttı,
    # çıkarılanınki düştü. Bunu ancak kendisi ekrana bakıp fark ederse
    # öğrenirdi — ve "artık 90 €" mesajı ikisine de yanlış okunuyordu.
    for people, title, msg in (
        ([a for a in now - was if a != me], "Bir harcamaya eklendin",
         f"{user['name']} · {label} · {amount} € · artık sen de bölüşüyorsun"),
        ([a for a in was - now if a != me], "Bir harcamadan çıkarıldın",
         f"{user['name']} · {label} · {amount} € · bu harcamada payın kalmadı"),
        ([a for a in now & was if a != me], "Harcama güncellendi",
         f"{user['name']} · {label} · artık {amount} €"),
    ):
        if people:
            await notify(people, title, msg, "new_expense", data)


@api.patch("/expenses/{expense_id}")
async def update_expense(expense_id: str, body: ExpenseUpdate, user=Depends(get_current_user)):
    doc = await _get_editable_expense(expense_id, user)
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=400, detail="Ev bulunamadı")

    patch: dict = {}
    if body.target_type == "roommate":
        target_user = body.target_user_id if body.target_user_id is not None else doc.get("target_user_id")
        if not target_user or target_user not in hh["member_ids"]:
            raise HTTPException(status_code=400, detail="Geçersiz oda arkadaşı")
        if target_user == user["user_id"]:
            raise HTTPException(status_code=400, detail="Kendinize atayamazsınız")

    # Tutar bölüşmeden önce çözülüyor: eşit bölüşmede paylar tutarın kendisinden,
    # kişiye özel bölüşmede ise doğrulama yeni tutara karşı yapılıyor.
    new_total = round(body.total, 2) if body.total is not None else float(doc["total"])
    if body.total is not None and body.total <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı")

    touches_split = (
        body.split_with is not None or body.target_type is not None
        or body.target_user_id is not None or body.total is not None
    )
    if touches_split:
        split_mode, split_with = resolve_split(
            body, doc["added_by"], new_total, hh["member_ids"], fallback=doc
        )
        target_type = derive_target_type(doc["added_by"], split_with, hh["member_ids"])
        patch["split_mode"] = split_mode
        patch["split_with"] = split_with
        patch["target_type"] = target_type
        patch["target_user_id"] = next(iter(split_with)) if target_type == "roommate" else None

    if body.items is not None:
        patch["items"] = [i.model_dump() for i in body.items]
    if body.total is not None:
        patch["total"] = new_total
    if body.merchant is not None:
        # Düzenleme yolunda da çalışması şart: yalnızca kayıtta normalleştirseydik
        # aynı adı elle yazan kullanıcı yine ayrı bir market yaratırdı.
        patch["merchant"] = await resolve_merchant(hh["household_id"], body.merchant)
    if body.category is not None:
        patch["category"] = body.category.strip() or None
    if body.notes is not None:
        patch["notes"] = body.notes.strip() or None
    if body.expense_date is not None:
        parsed = parse_date(body.expense_date)
        if not parsed:
            raise HTTPException(status_code=400, detail="Tarih formatı geçersiz")
        patch["expense_date"] = parsed

    if patch:
        patch["updated_at"] = now_utc()
        await db.expenses.update_one({"expense_id": expense_id}, {"$set": patch})
        await _record_revision(doc, patch, user, "edit")
        await _notify_expense_change(doc, patch, user, "edit")
    updated = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    return {"expense": updated}


@api.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(get_current_user)):
    doc = await _get_editable_expense(expense_id, user)
    await db.expenses.delete_one({"expense_id": expense_id})
    await _record_revision(doc, {}, user, "delete")
    await _notify_expense_change(doc, {}, user, "delete")
    return {"ok": True}


@api.get("/expenses/duplicate-check")
async def duplicate_check(
    total: float,
    expense_date: Optional[str] = None,
    merchant: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Bu fiş zaten kayıtlı mı?

    Dosya karşılaştırması işe yaramıyor: aynı fişi iki kez çeken kişi iki
    farklı fotoğraf üretir. Fişin kendisine bakmak gerekiyor.

    Ölçüt TUTAR DEĞİL, market + tarih. Sebebi şu: taslağın toplamı kalemlerin
    toplamı, ve OCR aynı fişin iki fotoğrafından farklı kalem listesi
    çıkarabiliyor — indirim satırını bir seferinde ayrı kalem yapıp öbüründe
    ürüne işleyince toplam birkaç kuruş kayıyor ve tam eşleşme kaçıyordu.
    Aynı gün aynı marketten alışveriş zaten seyrek; tutarı kullanıcıya
    gösterip kararı ona bırakmak, sessizce kaçırmaktan iyi.

    Engellemiyor, uyarıyor: aynı gün aynı marketten iki alışveriş olabilir.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"duplicates": []}
    day = parse_date(expense_date) if expense_date else None
    q: dict = {"household_id": hh["household_id"]}
    if day:
        q["expense_date"] = day
    rows = await db.expenses.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)

    if merchant and merchant.strip():
        # Kayıtlı adlar zaten tek yazıma indirgenmiş; sorguyu da aynı yoldan
        # geçirmezsek "Bizim Fleisher GmbH" ile "Bizim Fleischer" eşleşmiyordu.
        key = normalize_merchant(await resolve_merchant(hh["household_id"], merchant))
        rows = [r for r in rows if normalize_merchant(r.get("merchant")) == key]
    else:
        # Market yoksa elimizde yalnızca tarih kalıyor; o tek başına çok geniş.
        # Tutara geri dönüyoruz ama gevşek bir payla.
        rows = [r for r in rows if abs(float(r.get("total", 0)) - total) <= 0.5]

    return {"duplicates": rows[:5]}


@api.get("/expenses/{expense_id}/revisions")
async def expense_revisions(expense_id: str, user=Depends(get_current_user)):
    """Bir harcamanın düzenleme geçmişi.

    Ev harcamasını yalnızca ekleyen kişi değiştirebiliyor; herkesin payını
    etkileyen bir tutar sessizce büyümesin diye kim neyi ne zaman değiştirdi
    kayıtta duruyor.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=404, detail="Ev bulunamadı")
    rows = await db.expense_revisions.find(
        {"expense_id": expense_id, "household_id": hh["household_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"revisions": rows}


# ---------- Shopping list ----------
# Two scopes, mirroring how expenses already work so there is nothing new to
# learn: "household" is shared with everyone in the house, "self" is private
# to whoever wrote it and never leaves their own list.
def _shopping_filter(user_id: str, household_id: Optional[str], scope: Optional[str]) -> dict:
    visible = [{"scope": "self", "added_by": user_id}]
    if household_id:
        visible.append({"scope": "household", "household_id": household_id})
    q: dict = {"$or": visible}
    if scope == "self":
        q = {"scope": "self", "added_by": user_id}
    elif scope == "household":
        if not household_id:
            return {"_id": None}  # no household -> nothing to show
        q = {"scope": "household", "household_id": household_id}
    return q


@api.get("/shopping")
async def list_shopping(scope: Optional[str] = None, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    hh_id = hh["household_id"] if hh else None
    q = _shopping_filter(user["user_id"], hh_id, scope)
    items = await db.shopping_items.find(q, {"_id": 0}).to_list(500)
    # Outstanding first, then newest — the point of the screen is what is
    # still missing, not a history of what was bought.
    items.sort(key=lambda i: (bool(i.get("done")), -(i.get("created_at").timestamp() if i.get("created_at") else 0)))
    return {"items": items}


@api.post("/shopping")
async def add_shopping(body: ShoppingItemCreate, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if body.scope == "household" and not hh:
        raise HTTPException(status_code=400, detail="Önce bir eve katılın")

    doc = {
        "item_id": new_id("itm"),
        "household_id": hh["household_id"] if hh else None,
        "scope": body.scope,
        "text": body.text.strip(),
        "note": (body.note or "").strip() or None,
        "added_by": user["user_id"],
        "done": False,
        "done_by": None,
        "done_at": None,
        "created_at": now_utc(),
    }
    await db.shopping_items.insert_one(doc.copy())
    return {"item": doc}


async def _get_writable_item(item_id: str, user: dict) -> dict:
    item = await db.shopping_items.find_one({"item_id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    if item["scope"] == "self":
        if item["added_by"] != user["user_id"]:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    else:
        hh = await get_user_household(user["user_id"])
        if not hh or hh["household_id"] != item.get("household_id"):
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return item


@api.patch("/shopping/{item_id}")
async def update_shopping(item_id: str, body: ShoppingItemUpdate, user=Depends(get_current_user)):
    item = await _get_writable_item(item_id, user)
    patch: dict = {}
    if body.text is not None and body.text.strip():
        patch["text"] = body.text.strip()
    if body.note is not None:
        patch["note"] = body.note.strip() or None
    if body.done is not None:
        patch["done"] = bool(body.done)
        patch["done_by"] = user["user_id"] if body.done else None
        patch["done_at"] = now_utc() if body.done else None
    if patch:
        await db.shopping_items.update_one({"item_id": item_id}, {"$set": patch})
    updated = await db.shopping_items.find_one({"item_id": item_id}, {"_id": 0})
    return {"item": updated}


@api.delete("/shopping/{item_id}")
async def delete_shopping(item_id: str, user=Depends(get_current_user)):
    await _get_writable_item(item_id, user)
    await db.shopping_items.delete_one({"item_id": item_id})
    return {"ok": True}


@api.post("/shopping/clear-done")
async def clear_done_shopping(scope: str = "household", user=Depends(get_current_user)):
    """Sweep the ticked-off items away in one go."""
    hh = await get_user_household(user["user_id"])
    if scope == "self":
        q = {"scope": "self", "added_by": user["user_id"], "done": True}
    else:
        if not hh:
            return {"deleted": 0}
        q = {"scope": "household", "household_id": hh["household_id"], "done": True}
    res = await db.shopping_items.delete_many(q)
    return {"deleted": res.deleted_count}


# ---------- Settlements ----------
# Marking a payment records that money actually changed hands. It feeds the
# balance maths exactly like a roommate expense in reverse: paying off what
# you owe moves your net back towards zero. Without this, "Dönemi Kapat" is
# all-or-nothing — it assumes everyone squared up at the same moment.
@api.get("/settlements")
async def list_settlements(period_id: Optional[str] = None, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"settlements": []}
    pid = period_id
    if not pid:
        active = await get_active_period(hh["household_id"])
        pid = active["period_id"] if active else None
    if not pid:
        return {"settlements": []}
    rows = await db.settlements.find(
        {"household_id": hh["household_id"], "period_id": pid}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return {"settlements": rows}


@api.post("/settlements")
async def create_settlement(body: SettlementCreate, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=400, detail="Ev bulunamadı")
    period = await get_active_period(hh["household_id"])
    if not period:
        raise HTTPException(status_code=400, detail="Aktif dönem bulunamadı")

    members = hh["member_ids"]
    if body.from_user_id not in members or body.to_user_id not in members:
        raise HTTPException(status_code=400, detail="Geçersiz üye")
    if body.from_user_id == body.to_user_id:
        raise HTTPException(status_code=400, detail="Ödeme aynı kişiye olamaz")
    # Either side may record it — the payer knows they sent it, the receiver
    # knows it arrived. A bystander marking other people's debts settled is
    # not something anyone asked for.
    if user["user_id"] not in (body.from_user_id, body.to_user_id):
        raise HTTPException(status_code=403, detail="Sadece ödemenin taraflarından biri işaretleyebilir")

    doc = {
        "settlement_id": new_id("stl"),
        "household_id": hh["household_id"],
        "period_id": period["period_id"],
        "from_user_id": body.from_user_id,
        "to_user_id": body.to_user_id,
        "amount": round(body.amount, 2),
        "note": (body.note or "").strip() or None,
        "recorded_by": user["user_id"],
        "created_at": now_utc(),
    }
    await db.settlements.insert_one(doc.copy())

    other = body.to_user_id if user["user_id"] == body.from_user_id else body.from_user_id
    amount = f"{doc['amount']:.2f}".replace(".", ",")
    await notify(
        [other],
        "Ödeme kaydedildi",
        f"{user['name']} {amount} € tutarında bir ödeme işaretledi.",
        "new_expense",
        {"settlement_id": doc["settlement_id"]},
    )
    return {"settlement": doc}


@api.delete("/settlements/{settlement_id}")
async def delete_settlement(settlement_id: str, user=Depends(get_current_user)):
    row = await db.settlements.find_one({"settlement_id": settlement_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    hh = await get_user_household(user["user_id"])
    if not hh or hh["household_id"] != row["household_id"]:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    if user["user_id"] not in (row["from_user_id"], row["to_user_id"]):
        raise HTTPException(status_code=403, detail="Sadece ödemenin taraflarından biri kaldırabilir")

    period = await db.periods.find_one({"period_id": row["period_id"]}, {"_id": 0})
    if period and period.get("status") == "closed":
        raise HTTPException(status_code=400, detail="Kapatılmış dönemdeki ödeme kaydı değiştirilemez")

    await db.settlements.delete_one({"settlement_id": settlement_id})
    return {"ok": True}


# ---------- Balances (Debt Simplification) ----------
def simplify_debts(net: Dict[str, float]) -> List[dict]:
    creditors = [(u, round(a, 2)) for u, a in net.items() if a > 0.01]
    debtors = [(u, round(-a, 2)) for u, a in net.items() if a < -0.01]
    creditors.sort(key=lambda x: -x[1])
    debtors.sort(key=lambda x: -x[1])
    ci = di = 0
    transfers: List[dict] = []
    while ci < len(creditors) and di < len(debtors):
        cu, ca = creditors[ci]
        du, da = debtors[di]
        pay = round(min(ca, da), 2)
        if pay > 0.01:
            transfers.append({"from": du, "to": cu, "amount": pay})
        ca -= pay
        da -= pay
        creditors[ci] = (cu, ca)
        debtors[di] = (du, da)
        if ca < 0.01:
            ci += 1
        if da < 0.01:
            di += 1
    return transfers


async def period_participants(household_id: str, period_id: str, member_ids: List[str]) -> List[str]:
    """Who this period's expenses are split between.

    A closed period carries its own frozen list (`participant_ids`) and that
    list wins. Without it the answer was computed from the household's *current*
    members, so somebody joining today changed the split of a period closed
    months ago — their share appeared retroactively in settled books.

    While a period is open the list is still derived, so that members joining
    or leaving mid-period are picked up without a write on every membership
    change. Anyone who actually took part is always included: a member who has
    since been removed still belongs in the maths for the periods they lived
    through.
    """
    period = await db.periods.find_one(
        {"period_id": period_id}, {"_id": 0, "participant_ids": 1, "status": 1}
    )
    if period and period.get("status") == "closed" and period.get("participant_ids"):
        return list(period["participant_ids"])

    # Açık dönemde liste yapışkan: dönem boyunca üye olmuş herkes içeride kalır.
    # Hiç harcama yapmamış, kimseye hedef olmamış, hiç ödeşmemiş bir üye evden
    # çıkarılınca aşağıdaki türetme onu bulamıyordu ve payı kalanlara dağılıyordu.
    sticky = list((period or {}).get("participant_ids") or [])

    rows = await db.expenses.find(
        {"household_id": household_id, "period_id": period_id},
        {"_id": 0, "added_by": 1, "target_user_id": 1, "split_with": 1},
    ).to_list(5000)
    extra = set()
    for r in rows:
        extra.add(r["added_by"])
        if r.get("target_user_id"):
            extra.add(r["target_user_id"])
        # Bölüşme listesindekiler de katılımcıdır. Evden çıkarılmış biri hâlâ
        # bir harcamanın listesinde olabilir; payı o kayda yazılı olduğu için
        # hesaba katılmazsa harcamanın toplamı bölüşülenden büyük kalırdı.
        extra.update((r.get("split_with") or {}).keys())
    # Someone can settle up and only then be removed from the household; their
    # payment still has to count in that period's maths.
    for s in await db.settlements.find(
        {"household_id": household_id, "period_id": period_id},
        {"_id": 0, "from_user_id": 1, "to_user_id": 1},
    ).to_list(1000):
        extra.add(s["from_user_id"])
        extra.add(s["to_user_id"])

    out = list(member_ids)
    for u in sticky + sorted(extra):
        if u not in out:
            out.append(u)
    return out


async def _compute_balances(household_id: str, period_id: str) -> dict:
    hh = await db.households.find_one({"household_id": household_id}, {"_id": 0})
    if not hh:
        return {"net": {}, "transfers": [], "totals_paid": {}}
    members = await period_participants(household_id, period_id, hh["member_ids"])
    net: Dict[str, float] = {m: 0.0 for m in members}
    totals_paid: Dict[str, float] = {m: 0.0 for m in members}
    roommate_paid: Dict[str, float] = {m: 0.0 for m in members}

    # Kişisel harcamalar dışında hepsi geliyor. Süzgeç `target_type` değil
    # etiket üzerinden: bölüşme listesi artık tek doğru kaynak ve "custom"
    # gibi yeni etiketler sorguya eklenmeyi unutulacak bir yer bırakmamalı.
    exps = await db.expenses.find(
        {"household_id": household_id, "period_id": period_id},
        {"_id": 0},
    ).to_list(5000)

    for e in exps:
        payer = e["added_by"]
        total = float(e["total"])
        shares = expense_shares(e, members)
        if not shares:
            continue
        # Kişisel harcama dengeye hiç girmez. Ödeyenin kendi payı zaten tutarın
        # tamamı — net etkisi sıfır — ama "ödenen toplam" gibi göstergelerde de
        # görünmemeli: kimseyi ilgilendirmiyor.
        if set(shares) == {payer} and e.get("target_type") == "self":
            continue
        # Ödeyen listede yoksa harcamanın tamamı başkaları için yapılmış demek.
        if payer in shares:
            totals_paid[payer] = totals_paid.get(payer, 0) + total
        else:
            roommate_paid[payer] = roommate_paid.get(payer, 0) + total
        net[payer] = net.get(payer, 0) + total
        for m, amount in shares.items():
            net[m] = net.get(m, 0) - amount

    # Recorded payments move the payer back towards zero and the receiver away
    # from it — the exact inverse of a roommate expense. Applied after the
    # expenses so the suggested transfers only cover what is still outstanding.
    settlements = await db.settlements.find(
        {"household_id": household_id, "period_id": period_id}, {"_id": 0}
    ).to_list(1000)
    settled_paid: Dict[str, float] = {m: 0.0 for m in members}
    for s in settlements:
        payer, receiver, amount = s["from_user_id"], s["to_user_id"], float(s["amount"])
        if payer not in net or receiver not in net:
            continue
        net[payer] = net.get(payer, 0) + amount
        net[receiver] = net.get(receiver, 0) - amount
        settled_paid[payer] = settled_paid.get(payer, 0) + amount

    net = {k: round(v, 2) for k, v in net.items()}
    totals_paid = {k: round(v, 2) for k, v in totals_paid.items()}
    roommate_paid = {k: round(v, 2) for k, v in roommate_paid.items()}
    settled_paid = {k: round(v, 2) for k, v in settled_paid.items()}
    transfers = simplify_debts(dict(net))
    return {
        "net": net, "transfers": transfers, "totals_paid": totals_paid,
        "roommate_paid": roommate_paid, "settled_paid": settled_paid,
        "settlements": settlements,
    }


@api.get("/balances")
async def balances(period_id: Optional[str] = None, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"net": {}, "transfers": [], "totals_paid": {}, "members": []}
    if period_id:
        period = await db.periods.find_one({"period_id": period_id, "household_id": hh["household_id"]}, {"_id": 0})
    else:
        period = await get_active_period(hh["household_id"])
    if not period:
        return {"net": {}, "transfers": [], "totals_paid": {}, "members": []}

    # Kapalı dönem kapanışta ne yazdıysa onu gösterir, yeniden hesaplanmaz.
    # Anlık görüntü kapanışta zaten alınıyordu ama hiç okunmuyordu; her açılışta
    # baştan hesaplanınca bugünkü üye listesi geçmişi değiştirebiliyordu.
    # Kapalı dönemde harcama ve ödeme kaydı zaten değiştirilemiyor, yani
    # kayıtlı görüntü ile veri her zaman tutarlı.
    snap = period.get("final_balances") if period.get("status") == "closed" else None
    # dict(...) şart: `snap` doğrudan `period` içindeki alt sözlük. Kopyalamadan
    # kullanırsak aşağıdaki `result["period"] = period` kendine dönen bir halka
    # kurar ve yanıt JSON'a çevrilirken sonsuz özyinelemeye giriyor.
    result = dict(snap) if snap else await _compute_balances(hh["household_id"], period["period_id"])
    # Include former members who took part in this period, so archived views
    # show their name instead of an unresolved id.
    participants = await period_participants(
        hh["household_id"], period["period_id"], hh["member_ids"]
    )
    members = await db.users.find(
        {"user_id": {"$in": participants}}, PUBLIC_USER_PROJECTION
    ).to_list(50)
    result["members"] = members
    result["period"] = period
    return result


# ---------- Düzenli ödemeler ----------
# Kira, elektrik, internet: her ay tekrar eden giderler.
#
# **Takvim tarihli, dönem değil.** Dönem üç hafta da sürebilir yedi hafta da;
# elektrik faturası hep ayın 15'inde gelir. Şablon `day_of_month` taşır.
#
# **Kapatmak asla sessizce eklemez.** Vadesi gelen şablon bir *öneri* üretir,
# kayıt değil. Yanlış eklenen bir kira, arkadaşlar arasında yanlış borç demek;
# ve kimsenin görmediği bir borç en kötüsüdür. Onay hep insandan gelir.


class RecurringCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0)
    day_of_month: int = Field(ge=1, le=31)
    # Kira sabittir, elektrik değildir. Sabit olanda tutar hazır gelir ama
    # onay yine de istenir — "sabit" demek "sormadan ekle" demek değil.
    amount_fixed: bool = True
    scope: Literal["household", "self"] = "household"
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    category: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None


class RecurringUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    amount: Optional[float] = Field(default=None, gt=0)
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    amount_fixed: Optional[bool] = None
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    category: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


class RecurringConfirm(BaseModel):
    """Vadesi gelen bir şablonu harcamaya çevirir.

    Tutar ve bölüşüm burada değiştirilebilir: elektrik her ay farklı gelir ve
    kullanıcıyı önce şablonu düzenlemeye zorlamak, faturayı girmenin önüne
    fazladan bir ekran koyar.
    """
    period_key: str            # "2026-08" — hangi ay için
    # Onaylamak izin vermek değil, "bu ödendi" demek: oluşan harcamanın
    # ödeyeni bakiyede alacaklı çıkıyor. Uygulamayı açan kişi ile parayı veren
    # kişi çoğu zaman farklı ("kirayı Salih ödüyor, uygulamayı ben giriyorum"),
    # o yüzden ödeyen ayrıca seçilebiliyor. Boşsa onaylayan kişidir.
    paid_by: Optional[str] = None
    amount: Optional[float] = Field(default=None, gt=0)
    split_mode: Optional[Literal["equal", "exact"]] = None
    split_with: Optional[Dict[str, float]] = None
    expense_date: Optional[str] = None
    notes: Optional[str] = None


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def due_date_in(year: int, month: int, day_of_month: int) -> date:
    """Ayın kaçında vadesi geldiği — kısa aylarda son güne kırpılır.

    Ayın 31'i seçilmiş bir şablon şubatta hiç vadesi gelmemiş sayılırdı.
    """
    if month == 12:
        first_next = date(year + 1, 1, 1)
    else:
        first_next = date(year, month + 1, 1)
    last_day = (first_next - timedelta(days=1)).day
    return date(year, month, min(day_of_month, last_day))


def recurring_due_for(tpl: dict, today: date) -> Optional[str]:
    """Bu şablonun bekleyen ayı — yoksa None.

    Yalnızca **içinde bulunulan ay** bakılıyor. Geriye dönük kaçırılmış aylar
    üretilmiyor: iki ay uygulamayı açmayan bir eve girdiğinde altı tane onay
    kartı çıkması yardım değil, gürültü. Kaçırılan ay elle girilir.
    """
    if not tpl.get("active", True):
        return None
    key = month_key(today)
    if tpl.get("last_confirmed") == key or key in (tpl.get("skipped") or []):
        return None
    if today < due_date_in(today.year, today.month, int(tpl["day_of_month"])):
        return None
    return key


def _public_recurring(tpl: dict, today: date) -> dict:
    out = {k: v for k, v in tpl.items() if k != "_id"}
    out["due_period"] = recurring_due_for(tpl, today)
    return out


async def _visible_recurring(user_id: str, household_id: str) -> dict:
    """Ortak şablonları herkes görür, kişisel olanı yalnızca sahibi."""
    return {
        "household_id": household_id,
        "$or": [{"scope": "household"}, {"scope": "self", "created_by": user_id}],
    }


@api.get("/recurring")
async def list_recurring(user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"recurring": [], "due": []}
    today = now_utc().date()
    rows = await db.recurring.find(
        await _visible_recurring(user["user_id"], hh["household_id"]), {"_id": 0}
    ).sort("day_of_month", 1).to_list(200)
    items = [_public_recurring(r, today) for r in rows]
    return {"recurring": items, "due": [r for r in items if r["due_period"]]}


@api.post("/recurring")
async def create_recurring(body: RecurringCreate, user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=400, detail="Önce bir eve katılın")

    if body.scope == "self":
        # Kişisel gider dengeye girmez; listesi de yalnızca sahibinden oluşur.
        split_mode, split_with = "exact", {user["user_id"]: round(body.amount, 2)}
    else:
        split_mode, split_with = resolve_split(
            body, user["user_id"], body.amount, hh["member_ids"]
        )
    doc = {
        "recurring_id": new_id("rec"),
        "household_id": hh["household_id"],
        "created_by": user["user_id"],
        "scope": body.scope,
        "name": body.name.strip(),
        "amount": round(body.amount, 2),
        "amount_fixed": body.amount_fixed,
        "day_of_month": body.day_of_month,
        "split_mode": split_mode,
        "split_with": split_with,
        "category": (body.category or "").strip() or None,
        "merchant": await resolve_merchant(hh["household_id"], body.merchant),
        "notes": (body.notes or "").strip() or None,
        "currency": hh.get("currency", "EUR"),
        "active": True,
        "last_confirmed": None,
        "skipped": [],
        "created_at": now_utc(),
    }
    await db.recurring.insert_one(doc.copy())
    if body.scope == "household":
        await notify(
            [m for m in hh["member_ids"] if m != user["user_id"]],
            "Yeni düzenli gider",
            f"{user['name']} · {doc['name']} · her ayın {doc['day_of_month']}'i",
            "recurring", {"recurring_id": doc["recurring_id"]},
        )
    return {"recurring": _public_recurring(doc, now_utc().date())}


async def _own_recurring(recurring_id: str, user: dict) -> dict:
    doc = await db.recurring.find_one({"recurring_id": recurring_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Düzenli gider bulunamadı")
    hh = await get_user_household(user["user_id"])
    if not hh or doc["household_id"] != hh["household_id"]:
        raise HTTPException(status_code=404, detail="Düzenli gider bulunamadı")
    if doc["scope"] == "self" and doc["created_by"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Düzenli gider bulunamadı")
    return doc


@api.patch("/recurring/{recurring_id}")
async def update_recurring(recurring_id: str, body: RecurringUpdate,
                           user=Depends(get_current_user)):
    doc = await _own_recurring(recurring_id, user)
    # Harcamalardaki kuralın aynısı: şablonu yalnızca kuran değiştirir.
    # Kirayı bir başkasının sessizce 50 € artırması, kimsenin fark etmediği
    # bir borç üretirdi.
    if doc["created_by"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Sadece kuran kişi değiştirebilir")
    hh = await get_user_household(user["user_id"])

    patch: dict = {}
    for field in ("name", "day_of_month", "amount_fixed", "category", "notes", "active"):
        val = getattr(body, field)
        if val is not None:
            patch[field] = val.strip() if isinstance(val, str) else val
    if body.amount is not None:
        patch["amount"] = round(body.amount, 2)
    if body.merchant is not None:
        patch["merchant"] = await resolve_merchant(hh["household_id"], body.merchant)
    if body.split_with is not None or body.split_mode is not None:
        if doc["scope"] == "self":
            raise HTTPException(status_code=400, detail="Kişisel gider bölüşülmez")
        mode, sw = resolve_split(
            body, doc["created_by"], patch.get("amount", doc["amount"]),
            hh["member_ids"], fallback=doc,
        )
        patch["split_mode"], patch["split_with"] = mode, sw
    elif doc["scope"] == "self" and "amount" in patch:
        patch["split_with"] = {doc["created_by"]: patch["amount"]}
    elif "amount" in patch and doc.get("split_mode") == "exact":
        # Kişiye özel bölüşüm eski toplama göre girilmişti. Bırakılsaydı şablon
        # bozuk kalır ve hata ancak aylar sonra, onay anında görünürdü.
        if abs(sum(doc["split_with"].values()) - patch["amount"]) > 0.01:
            raise HTTPException(
                status_code=400,
                detail="Tutar değişti, kişiye özel bölüşüm artık tutmuyor. Bölüşümü yeniden düzenleyin.",
            )

    if patch:
        patch["updated_at"] = now_utc()
        await db.recurring.update_one({"recurring_id": recurring_id}, {"$set": patch})
    updated = await db.recurring.find_one({"recurring_id": recurring_id}, {"_id": 0})
    return {"recurring": _public_recurring(updated, now_utc().date())}


@api.delete("/recurring/{recurring_id}")
async def delete_recurring(recurring_id: str, user=Depends(get_current_user)):
    doc = await _own_recurring(recurring_id, user)
    if doc["created_by"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Sadece kuran kişi silebilir")
    await db.recurring.delete_one({"recurring_id": recurring_id})
    # Üretilmiş harcamalar duruyor: geçmiş ay gerçekten ödendi, şablonun
    # silinmesi onu geri almaz.
    return {"ok": True}


@api.post("/recurring/{recurring_id}/confirm")
async def confirm_recurring(recurring_id: str, body: RecurringConfirm,
                            user=Depends(get_current_user)):
    """Onayla → harcama oluşur. Tek yazma yolu burasıdır."""
    doc = await _own_recurring(recurring_id, user)
    hh = await get_user_household(user["user_id"])
    period = await get_active_period(hh["household_id"])
    if not period:
        raise HTTPException(status_code=400, detail="Aktif dönem bulunamadı")
    # Aynı ayı iki kez onaylamak iki kira demek. Kontrol sunucuda: iki telefon
    # aynı anda bildirimi görüp ikisi de onaylayabilir.
    if doc.get("last_confirmed") == body.period_key:
        raise HTTPException(status_code=409, detail="Bu ay zaten onaylanmış")

    payer = body.paid_by or user["user_id"]
    if payer not in hh["member_ids"]:
        raise HTTPException(status_code=400, detail="Ödeyen bu evin üyesi değil")
    if doc["scope"] == "self" and payer != user["user_id"]:
        # Kişisel gider başkası adına kaydedilemez: kimse görmüyor, dolayısıyla
        # yanlış girildiğinde düzeltecek kimse de yok.
        raise HTTPException(status_code=400, detail="Kişisel gider başkası adına kaydedilemez")

    amount = round(body.amount if body.amount is not None else doc["amount"], 2)
    if doc["scope"] == "self":
        split_mode, split_with = "exact", {user["user_id"]: amount}
    elif body.split_with is not None:
        split_mode = body.split_mode or "equal"
        split_with = validate_split(
            split_mode, body.split_with, amount,
            list(dict.fromkeys(list(hh["member_ids"]) + [payer])),
        )
    else:
        split_mode, split_with = doc["split_mode"], dict(doc["split_with"])
        # Şablondaki kişiye özel tutarlar eski toplama göre girilmişti.
        if split_mode == "exact" and abs(sum(split_with.values()) - amount) > 0.01:
            raise HTTPException(
                status_code=400,
                detail="Tutar şablondakinden farklı, bölüşümü bu ay için düzenleyin",
            )
    target_type = derive_target_type(payer, split_with, hh["member_ids"])

    expense_id = new_id("exp")
    exp = {
        "expense_id": expense_id,
        "household_id": hh["household_id"],
        "period_id": period["period_id"],
        # Parayi veren kisi. Bakiyede alacakli cikan bu.
        "added_by": payer,
        "target_type": target_type,
        "target_user_id": next(iter(split_with)) if target_type == "roommate" else None,
        "split_mode": split_mode,
        "split_with": split_with,
        "items": [{"name": doc["name"], "price": amount, "quantity": 1,
                   "unit": "adet", "size_amount": None, "size_unit": None,
                   "category": "diger"}],
        "total": amount,
        "source": "manual",
        "category": doc.get("category"),
        "merchant": doc.get("merchant"),
        "notes": body.notes if body.notes is not None else doc.get("notes"),
        "currency": hh.get("currency", "EUR"),
        "expense_date": parse_date(body.expense_date) or now_utc().strftime("%Y-%m-%d"),
        "created_at": now_utc(),
        # Hangi şablondan geldiği kayıtta duruyor: "bu kirayı kim ekledi"
        # sorusunun cevabı aylar sonra da bulunabilsin.
        "recurring_id": recurring_id,
        "recurring_period": body.period_key,
        # Kaydı giren, ödeyenden farklı olabilir. Ödeyen `added_by`; bu alan
        # yalnızca izlenebilirlik için ve farklıysa yazılıyor.
        "recorded_by": user["user_id"] if payer != user["user_id"] else None,
    }
    await db.expenses.insert_one(exp.copy())
    await db.recurring.update_one(
        {"recurring_id": recurring_id},
        {"$set": {"last_confirmed": body.period_key, "last_amount": amount}},
    )

    # Ödeyen de haber almalı: başkası onun adına bir ödeme kaydetti ve bakiyesi
    # değişti. Bunu ancak kendisi ekrana bakıp fark ederse öğrenirdi.
    audience = [u for u in dict.fromkeys(list(split_with) + [payer])
                if u != user["user_id"]]
    if audience:
        txt = f"{doc['amount']:.2f}".replace(".", ",")
        got = f"{amount:.2f}".replace(".", ",")
        extra = "" if abs(amount - doc["amount"]) < 0.01 else f" (şablonda {txt} €)"
        if payer == user["user_id"]:
            body_txt = f"{user['name']} ödedi · {doc['name']} · {got} €{extra}"
        else:
            payer_doc = await db.users.find_one({"user_id": payer}, {"_id": 0, "name": 1})
            who = (payer_doc or {}).get("name", "biri")
            body_txt = f"{who} ödedi · {doc['name']} · {got} €{extra} · {user['name']} kaydetti"
        await notify(audience, "Düzenli gider eklendi", body_txt,
                     "recurring", {"expense_id": expense_id})
    return {"expense": exp}


@api.post("/recurring/{recurring_id}/skip")
async def skip_recurring(recurring_id: str, body: RecurringConfirm,
                         user=Depends(get_current_user)):
    """Bu ay atla. "Sonra" değil — o istemcide kalır, kart yine çıkar."""
    doc = await _own_recurring(recurring_id, user)
    await db.recurring.update_one(
        {"recurring_id": recurring_id},
        {"$addToSet": {"skipped": body.period_key}},
    )
    return {"ok": True}


# ---------- Fiyat hafızası ----------
class PriceMemoryReq(BaseModel):
    # Market ZORUNLU: karşılaştırma yalnızca aynı marketin içinde yapılıyor.
    merchant: str
    # Kalemin tamamı geliyor, sadece adı değil: birim fiyat hesabı burada
    # kalmalı. İstemcide ikinci bir kopyası olsaydı iki taraf farklı sonuç
    # verdiğinde kullanıcı yanlış bir "fiyat arttı" uyarısı görürdü.
    items: List[ExpenseItem] = Field(default_factory=list, max_length=200)


@api.post("/price-memory")
async def price_memory(body: PriceMemoryReq, user=Depends(get_current_user)):
    """Bu evin KENDİ fişlerinden ürün fiyatı geçmişi — **aynı market içinde.**

    Anonim `price_points` koleksiyonuna dokunmuyor: kaynak evin kendi
    harcamaları, yani kullanıcı zaten görebildiği veriyi derlenmiş hâlde
    görüyor.

    ### Neden marketler arası karşılaştırma yok

    "REWE'de 2 €, ALDI'de 1 €" cümlesi çoğu zaman fiyat farkını değil **ürün
    farkını** ölçer. Süt her markette kendi markası altında satılıyor
    (`MILSANI`, `MILBONA`, `JA!`) — bunlar farklı ürünler. Aynı gramajlı biber
    birinde tepside, ötekinde açık. Fiş metinleri de her kasa sisteminde başka
    türlü yazılıyor.

    Aynı marketin içinde ise metni o marketin kendi kasası üretiyor:
    `MILSANI H-MILCH 3,5% 1L` bu hafta da gelecek hafta da aynı dizgi. Yani
    karşılaştırılan şey gerçekten aynı ürün, tahmin değil.

    Marketler arası karşılaştırma ancak barkod (EAN) ile sağlam olurdu; Alman
    fişleri onu genelde basmıyor. Yapısal olarak zor, bilerek yapılmıyor.

    Ayrıca **paket sınıfı** da ayrı tutuluyor: açık alınan üzümle paketli
    üzümü aynı seriye koymak "fiyat iki katına çıktı" der, oysa değişen
    ambalajdır.
    """
    hh = await get_user_household(user["user_id"])
    mkey = normalize_merchant(body.merchant)
    if not hh or not mkey:
        return {"memory": {}}

    # Sorulan kalemlerin kendi birim fiyatı da aynı fonksiyondan geçiyor,
    # böylece karşılaştırma elma ile elma.
    asked: Dict[str, list] = {}
    now_price: Dict[str, dict] = {}
    for it in body.items[:200]:
        p = price_of_item(it.model_dump())
        if not p:
            continue
        asked.setdefault(p["product_key"], []).append(it.name)
        now_price[it.name] = p
    if not asked:
        return {"memory": {}}
    wanted = asked

    exps = await db.expenses.find(
        {"household_id": hh["household_id"], "source": "receipt",
         "merchant": {"$ne": None}},
        {"_id": 0, "merchant": 1, "expense_date": 1, "items": 1},
    ).sort("expense_date", -1).to_list(2000)
    # Aynı markete ait fişler — yazım farkları normalleştiriliyor
    # ("Bizim Fleisher GmbH" ile "Bizim Fleischer" aynı yer).
    exps = [e for e in exps if normalize_merchant(e.get("merchant")) == mkey]

    found: Dict[str, list] = {}
    for e in exps:
        for item in e.get("items") or []:
            p = price_of_item(item)
            if not p or p["product_key"] not in wanted:
                continue
            found.setdefault(p["product_key"], []).append({
                "merchant": e["merchant"],
                "expense_date": e.get("expense_date"),
                "unit_price": p["unit_price"],
                "price_unit": p["price_unit"],
                "pack_type": p["pack_type"],
                "product": p["product"],
            })

    memory: Dict[str, dict] = {}
    for key, rows in found.items():
        rows.sort(key=lambda r: r["expense_date"] or "", reverse=True)
        for raw in wanted[key]:
            cur = now_price.get(raw)
            if not cur:
                continue
            # Karşılaştırma yalnızca AYNI paket sınıfı içinde. Açık alınan
            # üzümle paketli üzümü aynı seriye koymak "fiyat iki katına çıktı"
            # der; oysa değişen fiyat değil ambalajdır.
            same = [r for r in rows if r["pack_type"] == cur["pack_type"]]
            if not same:
                continue
            # "En ucuz" artık bir market önerisi değil, bu markette görülmüş
            # en düşük fiyat: "bunu burada 2,98'e de görmüştük".
            cheapest = min(same, key=lambda r: r["unit_price"])
            prev = same[0]
            delta = None
            if prev["unit_price"] > 0:
                delta = round(
                    (cur["unit_price"] - prev["unit_price"]) / prev["unit_price"] * 100
                )
            memory[raw] = {
                "unit_price": cur["unit_price"],
                "price_unit": cur["price_unit"],
                "pack_type": cur["pack_type"],
                "previous": prev,
                "cheapest": cheapest,
                "delta_pct": delta,
                "count": len(same),
                "history": same[:8],
            }
    return {"memory": memory}


# ---------- Stats ----------
# Ev ya da dönem yoksa dönen iskelet. Alanların hepsi burada da bulunmalı:
# istemci eksik anahtarı undefined okuyup grafiği boş yerine çökmüş çiziyordu.
EMPTY_STATS = {
    "total": 0, "per_person": 0, "daily_average": 0, "projected_30d": 0,
    "change_pct": None, "expense_count": 0, "item_count": 0, "avg_expense": 0,
    "member_count": 0, "by_member": [], "daily_series": [],
    "categories": [], "merchants": [],
}


@api.get("/stats")
async def stats(period_id: Optional[str] = None, user=Depends(get_current_user)):
    """Household numbers for the home screen.

    Ortak harcanan para sayılıyor: `household` (herkes) ve `custom` (evin bir
    bölümü, örneğin fişteki yumurtayı iki kişinin bölüşmesi). Dışarıda kalan
    ikisi ortak harcama değil — `self` kişiseldir, `roommate` iki kişi
    arasındaki borçtur.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        return EMPTY_STATS

    period = (
        await db.periods.find_one({"period_id": period_id, "household_id": hh["household_id"]}, {"_id": 0})
        if period_id else await get_active_period(hh["household_id"])
    )
    if not period:
        return EMPTY_STATS

    exps = await db.expenses.find(
        {"household_id": hh["household_id"], "period_id": period["period_id"],
         "target_type": {"$in": ["household", "custom"]}},
        {"_id": 0},
    ).to_list(5000)

    total = round(sum(float(e["total"]) for e in exps), 2)
    members = await period_participants(hh["household_id"], period["period_id"], hh["member_ids"])
    per_person = round(total / max(len(members), 1), 2)

    cats: Dict[str, float] = {}
    for e in exps:
        items = e.get("items") or []
        item_sum = sum(float(i.get("price", 0)) * float(i.get("quantity", 1) or 1) for i in items)
        for i in items:
            line = float(i.get("price", 0)) * float(i.get("quantity", 1) or 1)
            key = i.get("category") or "diger"
            # Scale line values to the recorded total so discounts and rounding
            # on the receipt do not make the breakdown disagree with the header.
            share = (line / item_sum * float(e["total"])) if item_sum else 0
            cats[key] = cats.get(key, 0) + share
        if not items:
            cats["diger"] = cats.get("diger", 0) + float(e["total"])

    merchants: Dict[str, float] = {}
    for e in exps:
        merchants[(e.get("merchant") or "Diğer").strip() or "Diğer"] = (
            merchants.get((e.get("merchant") or "Diğer").strip() or "Diğer", 0) + float(e["total"])
        )

    # Kim ne kadar ödedi. Aynı listeden çıkıyor — ek sorgu yok.
    by_member: Dict[str, float] = {m: 0.0 for m in members}
    for e in exps:
        payer = e.get("added_by")
        if payer in by_member:
            by_member[payer] += float(e["total"])

    # Son 14 günün günlük dökümü. Grafiğin her zaman çubuğu olsun diye harcama
    # olmayan günler de 0 ile dizide duruyor — aksi halde grafik gün atlıyor
    # ve aralar eşit görünmüyordu.
    item_count = 0
    days_of: List[str] = []
    for e in exps:
        item_count += len(e.get("items") or [])
        d = (e.get("expense_date") or "")[:10]
        days_of.append(d or make_aware(e["created_at"]).date().isoformat())

    # Pencerenin sonu UTC "bugün" DEĞİL, bunun ile en yeni harcama tarihinin
    # büyüğü. expense_date kullanıcının yerel takviminden geliyor: Almanya'da
    # gece 01:00'de girilen harcama UTC'ye göre yarın tarihli olur ve sabit
    # UTC penceresi onu grafikten tamamen düşürürdü.
    last = max([now_utc().date().isoformat()] + days_of)
    end = date.fromisoformat(last)
    span = [end - timedelta(days=i) for i in range(13, -1, -1)]
    daily_map: Dict[str, float] = {d.isoformat(): 0.0 for d in span}
    for e, day in zip(exps, days_of):
        if day in daily_map:
            daily_map[day] += float(e["total"])

    started = make_aware(period["started_at"])
    days = max((now_utc() - started).days + 1, 1)
    daily = round(total / days, 2)
    # Straight-line projection to 30 days — the question people actually ask
    # mid-period is "where does this land if we carry on like this".
    projected = round(daily * 30, 2)

    previous = await db.periods.find(
        {"household_id": hh["household_id"], "status": "closed"}, {"_id": 0}
    ).sort("closed_at", -1).to_list(1)
    change_pct = None
    if previous:
        prev_exps = await db.expenses.find(
            {"household_id": hh["household_id"], "period_id": previous[0]["period_id"],
             "target_type": {"$in": ["household", "custom"]}},
            {"_id": 0, "total": 1},
        ).to_list(5000)
        prev_total = sum(float(e["total"]) for e in prev_exps)
        if prev_total > 0:
            change_pct = round((total - prev_total) / prev_total * 100)

    return {
        "period_id": period["period_id"],
        "started_at": period["started_at"],
        "days": days,
        "total": total,
        "per_person": per_person,
        "daily_average": daily,
        "projected_30d": projected,
        "change_pct": change_pct,
        "expense_count": len(exps),
        "item_count": item_count,
        "avg_expense": round(total / len(exps), 2) if exps else 0,
        "member_count": len(members),
        "by_member": [
            {"user_id": uid, "total": round(v, 2)}
            for uid, v in sorted(by_member.items(), key=lambda x: -x[1])
        ],
        "daily_series": [{"day": d, "total": round(v, 2)} for d, v in daily_map.items()],
        "categories": sorted(
            [{"key": k, "total": round(v, 2)} for k, v in cats.items() if v > 0.005],
            key=lambda x: -x["total"],
        ),
        "merchants": sorted(
            [{"name": k, "total": round(v, 2)} for k, v in merchants.items()],
            key=lambda x: -x["total"],
        )[:6],
    }


# ---------- Aylık istatistik ----------
# **Takvim ayı, dönem değil.** Dönem üç hafta da sürebilir yedi hafta da;
# "bu ay ne kadar harcadık" sorusunun cevabı dönemle değişmemeli. Mevcut
# `/stats` dönem bazlıdır ve Anasayfa'nın başlığını besler; burası ayrı.
#
# Her sayı birinin gerçekten sorduğu bir soruya cevap veriyor. "Koymak için"
# konan tek bir gösterge yok — özellikle kişi başına tüketim karşılaştırması
# bilinçli olarak dışarıda: kimin daha çok tükettiğini değil kimin daha müsait
# olduğunu ölçer ve ev arkadaşları arasında gereksiz sürtüşme üretir.


def _month_bounds(month: str) -> tuple:
    y, m = int(month[:4]), int(month[5:7])
    start = date(y, m, 1)
    end = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return start.isoformat(), end.isoformat()


def _prev_month(month: str) -> str:
    y, m = int(month[:4]), int(month[5:7])
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def _expense_day(e: dict) -> str:
    d = (e.get("expense_date") or "")[:10]
    return d or make_aware(e["created_at"]).date().isoformat()


async def _month_expenses(household_id: str, month: str, scope: str, user_id: str) -> List[dict]:
    lo, hi = _month_bounds(month)
    q: dict = {"household_id": household_id}
    if scope == "self":
        # Kişisel harcamalar: yalnızca kendi ekledikleri ve yalnızca kişisel
        # olanlar. Başkasının kişisel harcaması zaten hiçbir yerde görünmüyor.
        q.update({"target_type": "self", "added_by": user_id})
    else:
        q["target_type"] = {"$in": ["household", "custom"]}
    rows = await db.expenses.find(q, {"_id": 0}).to_list(5000)
    return [e for e in rows if lo <= _expense_day(e) < hi]


def _breakdown(exps: List[dict]) -> dict:
    cats: Dict[str, float] = {}
    merchants: Dict[str, float] = {}
    for e in exps:
        total = float(e["total"])
        items = e.get("items") or []
        item_sum = sum(float(i.get("price", 0)) * float(i.get("quantity", 1) or 1) for i in items)
        if items and item_sum:
            for i in items:
                line = float(i.get("price", 0)) * float(i.get("quantity", 1) or 1)
                key = i.get("category") or "diger"
                # Kalemler fişin toplamına ölçekleniyor: indirim satırları ve
                # yuvarlama yüzünden kalem toplamı fiş toplamını tutmuyor ve
                # ölçeklenmezse döküm başlıktaki rakamla çelişiyor.
                cats[key] = cats.get(key, 0) + line / item_sum * total
        else:
            cats["diger"] = cats.get("diger", 0) + total
        name = (e.get("merchant") or "Diğer").strip() or "Diğer"
        merchants[name] = merchants.get(name, 0) + total
    return {
        "categories": sorted(
            [{"key": k, "total": round(v, 2)} for k, v in cats.items() if v > 0.005],
            key=lambda x: -x["total"]),
        "merchants": sorted(
            [{"name": k, "total": round(v, 2)} for k, v in merchants.items()],
            key=lambda x: -x["total"])[:8],
    }


@api.get("/stats/monthly")
async def monthly_stats(
    month: Optional[str] = None,
    scope: str = "household",
    user=Depends(get_current_user),
):
    hh = await get_user_household(user["user_id"])
    today = now_utc().date()
    month = month if (month and len(month) == 7) else month_key(today)
    empty = {
        "month": month, "scope": scope, "total": 0, "expense_count": 0,
        "prev_total": 0, "change_pct": None, "fixed": 0, "variable": 0,
        "categories": [], "merchants": [], "by_member": [], "daily_series": [],
        "months": [], "member_count": 0, "per_person": 0,
    }
    if not hh:
        return empty

    exps = await _month_expenses(hh["household_id"], month, scope, user["user_id"])
    prev = await _month_expenses(
        hh["household_id"], _prev_month(month), scope, user["user_id"])

    total = round(sum(float(e["total"]) for e in exps), 2)
    prev_total = round(sum(float(e["total"]) for e in prev), 2)
    change = round((total - prev_total) / prev_total * 100) if prev_total > 0 else None

    # Sabit / değişken ayrımı Tur 5'in getirdiği yeni kesit: `recurring_id`
    # taşıyan harcama bir şablondan geldi, yani kira-elektrik-abonelik.
    # "Bu ay 340 € market, 1.290 € sabit gider" cümlesi bundan önce
    # kurulamıyordu ve insanların asıl sorduğu ayrım bu.
    fixed = round(sum(float(e["total"]) for e in exps if e.get("recurring_id")), 2)

    by_member: Dict[str, float] = {}
    if scope == "household":
        for e in exps:
            by_member[e["added_by"]] = by_member.get(e["added_by"], 0) + float(e["total"])

    lo, hi = _month_bounds(month)
    days = (date.fromisoformat(hi) - date.fromisoformat(lo)).days
    daily = {(date.fromisoformat(lo) + timedelta(days=i)).isoformat(): 0.0
             for i in range(days)}
    for e in exps:
        d = _expense_day(e)
        if d in daily:
            daily[d] += float(e["total"])

    # Ay seçicisinin dolaşabileceği aylar: veri olan aylar + içinde bulunulan.
    all_rows = await db.expenses.find(
        {"household_id": hh["household_id"]},
        {"_id": 0, "expense_date": 1, "created_at": 1},
    ).to_list(5000)
    months = sorted({_expense_day(e)[:7] for e in all_rows} | {month_key(today)}, reverse=True)

    members = await period_participants(
        hh["household_id"],
        (await get_active_period(hh["household_id"]) or {}).get("period_id", ""),
        hh["member_ids"],
    ) if scope == "household" else [user["user_id"]]

    return {
        **empty,
        "total": total,
        "expense_count": len(exps),
        "prev_total": prev_total,
        "prev_month": _prev_month(month),
        "change_pct": change,
        "fixed": fixed,
        "variable": round(total - fixed, 2),
        "member_count": len(members),
        "per_person": round(total / max(len(members), 1), 2),
        "by_member": sorted(
            [{"user_id": k, "total": round(v, 2)} for k, v in by_member.items()],
            key=lambda x: -x["total"]),
        "daily_series": [{"day": d, "total": round(v, 2)} for d, v in daily.items()],
        "months": months,
        **_breakdown(exps),
    }


# ---------- Periods ----------
@api.get("/periods")
async def list_periods(user=Depends(get_current_user)):
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"periods": []}
    periods = await db.periods.find({"household_id": hh["household_id"]}, {"_id": 0}).sort(
        "started_at", -1
    ).to_list(200)
    return {"periods": periods}


@api.post("/periods/close")
async def close_period(user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    period = await get_active_period(hh["household_id"])
    if not period:
        raise HTTPException(status_code=400, detail="Aktif dönem yok")
    # Katılımcı listesi bakiyelerden ÖNCE donuyor: hesap bu listeyle yapıldı,
    # aynı liste kayda geçmezse dönem sonradan başka bir kadroyla yeniden
    # hesaplanabilir hale gelir.
    frozen = await period_participants(
        hh["household_id"], period["period_id"], hh["member_ids"]
    )
    snap = await _compute_balances(hh["household_id"], period["period_id"])
    await db.periods.update_one(
        {"period_id": period["period_id"]},
        {"$set": {
            "status": "closed",
            "closed_at": now_utc(),
            "participant_ids": frozen,
            "final_balances": snap,
        }},
    )
    new_period_id = new_id("per")
    new_period = {
        "period_id": new_period_id,
        "household_id": hh["household_id"],
        "started_at": now_utc(),
        "closed_at": None,
        "status": "active",
        "participant_ids": list(hh["member_ids"]),
    }
    await db.periods.insert_one(new_period.copy())
    await db.households.update_one(
        {"household_id": hh["household_id"]}, {"$set": {"current_period_id": new_period_id}}
    )
    await notify(
        [m for m in hh["member_ids"] if m != user["user_id"]],
        "Dönem kapatıldı",
        f"{user['name']} dönemi kapattı, yeni dönem başladı. Bakiyeler sıfırlandı.",
        "period_closed",
        {"household_id": hh["household_id"]},
    )
    return {"closed_period_id": period["period_id"], "new_period": new_period}


@api.post("/periods/reopen")
async def reopen_period(user=Depends(get_current_user)):
    """Undo the most recent close — for when it was hit by accident.

    Only safe while the fresh period is still empty. Once expenses exist in it,
    reopening would leave them sitting in a period that is no longer current,
    invisible in every balance, so we refuse and say why.
    """
    hh = await require_admin(user["user_id"])
    active = await get_active_period(hh["household_id"])
    if not active:
        raise HTTPException(status_code=400, detail="Aktif dönem yok")

    used = await db.expenses.count_documents(
        {"household_id": hh["household_id"], "period_id": active["period_id"]}
    )
    if used:
        raise HTTPException(
            status_code=400,
            detail=f"Yeni döneme {used} harcama girilmiş. Geri alınamaz, "
                   "önce bu harcamaları silmeniz gerekir.",
        )

    closed = await db.periods.find(
        {"household_id": hh["household_id"], "status": "closed"}, {"_id": 0}
    ).sort("closed_at", -1).to_list(1)
    if not closed:
        raise HTTPException(status_code=400, detail="Geri alınacak kapatılmış dönem yok")
    previous = closed[0]

    await db.periods.delete_one({"period_id": active["period_id"]})
    await db.periods.update_one(
        {"period_id": previous["period_id"]},
        {"$set": {"status": "active", "closed_at": None}, "$unset": {"final_balances": ""}},
    )
    await db.households.update_one(
        {"household_id": hh["household_id"]},
        {"$set": {"current_period_id": previous["period_id"]}},
    )
    reopened = await db.periods.find_one({"period_id": previous["period_id"]}, {"_id": 0})
    return {"reopened_period": reopened}


# ---------- Health ----------
@api.get("/")
async def root():
    # push_ready surfaces the boot-time check so a broken notification setup is
    # visible from outside instead of only in the logs.
    check = getattr(app.state, "push_check", None) or {}
    return {
        "service": "odahesap",
        "ok": True,
        "push_ready": bool(check.get("token")),
        "push_detail": check.get("detail"),
    }


# ---------- App ----------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.households.create_index("invite_code", unique=True)
    await db.households.create_index("member_ids")
    await db.households.create_index("pending_member_ids")
    await db.periods.create_index([("household_id", 1), ("status", 1)])
    await db.expenses.create_index([("household_id", 1), ("period_id", 1)])
    await db.devices.create_index("token", unique=True)
    await db.devices.create_index("user_id")
    await db.avatars.create_index("user_id", unique=True)
    await db.settlements.create_index("settlement_id", unique=True)
    await db.settlements.create_index([("household_id", 1), ("period_id", 1)])
    await db.shopping_items.create_index("item_id", unique=True)
    await db.shopping_items.create_index([("household_id", 1), ("scope", 1)])
    await db.shopping_items.create_index([("added_by", 1), ("scope", 1)])
    # Fiyat kayıtlarında kimlik alanı yok, indeks de sorgunun kendisine göre:
    # "şu ürün, şu ülkede, şu paket sınıfında, hangi markette kaça".
    await db.price_points.create_index(
        [("product_key", 1), ("country", 1), ("pack_type", 1), ("week", -1)]
    )
    await db.price_points.create_index([("merchant_key", 1), ("week", -1)])
    await db.recurring.create_index("recurring_id", unique=True)
    await db.recurring.create_index([("household_id", 1), ("active", 1)])
    check = await asyncio.to_thread(push.self_check)
    if check["token"]:
        logger.info("OdaHesap backend started (bildirimler: hazir)")
    else:
        logger.warning("OdaHesap backend started (BILDIRIMLER CALISMIYOR: %s)", check["detail"])
    app.state.push_check = check


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
