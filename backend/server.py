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
import os
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


class HouseholdCreate(BaseModel):
    name: str


class HouseholdJoin(BaseModel):
    invite_code: str


class HouseholdRename(BaseModel):
    name: str = Field(min_length=1, max_length=60)


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


class ExpenseItem(BaseModel):
    name: str
    price: float  # unit price in EUR
    quantity: float = 1  # allow fractional (e.g. 0.5 kg produce)
    category: str = "diger"


class ExpenseCreate(BaseModel):
    target_type: Literal["self", "household", "roommate"]
    target_user_id: Optional[str] = None
    items: List[ExpenseItem] = []
    total: float
    source: Literal["manual", "receipt"] = "manual"
    category: Optional[str] = None
    merchant: Optional[str] = None
    notes: Optional[str] = None
    currency: str = "EUR"
    expense_date: Optional[str] = None  # ISO YYYY-MM-DD


class ExpenseUpdate(BaseModel):
    target_type: Optional[Literal["self", "household", "roommate"]] = None
    target_user_id: Optional[str] = None
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
    try:
        ids = [u for u in dict.fromkeys(user_ids) if u]
        if not ids or not push.is_configured():
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
    await db.households.update_one(
        {"household_id": hh["household_id"]}, {"$set": {"name": body.name.strip()}}
    )
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
async def approve_member(body: MemberActionReq, user=Depends(get_current_user)):
    hh = await require_admin(user["user_id"])
    if body.user_id not in hh.get("pending_member_ids", []):
        raise HTTPException(status_code=404, detail="Bekleyen üye bulunamadı")
    await db.households.update_one(
        {"household_id": hh["household_id"]},
        {
            "$pull": {"pending_member_ids": body.user_id},
            "$addToSet": {"member_ids": body.user_id},
        },
    )
    await notify(
        [body.user_id],
        "İsteğin onaylandı",
        f"Artık \"{hh['name']}\" evindesin. Harcamaları görebilirsin.",
        "join_request",
        {"household_id": hh["household_id"]},
    )
    return {"ok": True}


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


OCR_SYSTEM_PROMPT = """You are an expert at reading German grocery receipts (Kassenbon) from supermarkets such as Rewe, Edeka, Aldi, Lidl, Penny, Kaufland, Netto, DM, Rossmann, Bauhaus, Obi, Hornbach, IKEA.

Extract information from the receipt image and return STRICT JSON only (no prose, no markdown, no code fences).

Rules:
1. German number format uses comma as decimal separator: "3,49" means 3.49. Convert to a float with dot.
2. Extract the merchant/store name from the top of the receipt (e.g. "REWE", "EDEKA", "ALDI", "LIDL", "PENNY", "KAUFLAND"). If unknown, use null.
3. Extract the purchase date. Look for "Datum", or a date-like line at the top or bottom. Return as ISO string "YYYY-MM-DD". Ignore any time.
4. Line items: each product line typically has a name and a price. Return one entry per item.
   - Quantity: if you see "2 x 1,49" or "3 Stk" or "2X" style, set quantity accordingly and use the unit price. If unclear, quantity = 1 and price = total for that line.
   - German items often have "A" or "B" (VAT class) at end — strip it.
5. Discount lines: markers include "Rabatt", "RABATT", "-%", "Preisnachlass", "PAYBACK Rabatt", lines starting with "-", or negative prices. If a discount is clearly associated with an item, subtract from that item's price. Otherwise return as a separate item with negative price.
6. Ignore non-item lines: "MwSt", "Summe", "Zwischensumme", "Gesamtsumme", "Bar", "EC", "Karte", "Rueckgeld", store address, times, cashier numbers, "vielen Dank".
7. Item names stay in German — do NOT translate.

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
  "currency": "EUR",
  "items": [
    { "name": string, "price": number, "quantity": number, "category": string }
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
        items.append(
            {
                "name": name,
                "price": round(price, 2),
                "quantity": qty if qty > 0 else 1,
                "category": cat,
            }
        )

    return {
        "merchant": parsed.get("merchant"),
        "date": parse_date(parsed.get("date")),
        "total": parsed.get("total"),
        "currency": parsed.get("currency", "EUR"),
        "items": items,
    }


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

    expense_id = new_id("exp")
    doc = {
        "expense_id": expense_id,
        "household_id": hh["household_id"],
        "period_id": period["period_id"],
        "added_by": user["user_id"],
        "target_type": body.target_type,
        "target_user_id": body.target_user_id,
        "items": [i.model_dump() for i in body.items],
        "total": round(body.total, 2),
        "source": body.source,
        "category": body.category,
        "merchant": body.merchant,
        "notes": body.notes,
        "currency": body.currency,
        "expense_date": parse_date(body.expense_date) or now_utc().strftime("%Y-%m-%d"),
        "created_at": now_utc(),
    }
    await db.expenses.insert_one(doc.copy())

    # Who hears about it follows who it affects: household expenses go to
    # everyone else, a roommate expense only to the person it lands on, and a
    # "self" expense to nobody — it is private by definition.
    label = body.merchant or body.category or ("Fiş" if body.source == "receipt" else "Harcama")
    amount = f"{doc['total']:.2f}".replace(".", ",")
    if body.target_type == "household":
        await notify(
            [m for m in hh["member_ids"] if m != user["user_id"]],
            "Yeni ev harcaması",
            f"{user['name']} · {label} · {amount} €",
            "new_expense",
            {"expense_id": expense_id},
        )
    elif body.target_type == "roommate" and body.target_user_id:
        await notify(
            [body.target_user_id],
            "Senin için bir harcama",
            f"{user['name']} senin için {label} aldı · {amount} €",
            "new_expense",
            {"expense_id": expense_id},
        )
    return {"expense": doc}


def _visible_filter(user_id: str) -> dict:
    return {
        "$or": [
            {"target_type": "household"},
            {"target_type": "self", "added_by": user_id},
            {"target_type": "roommate", "added_by": user_id},
            {"target_type": "roommate", "target_user_id": user_id},
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


@api.patch("/expenses/{expense_id}")
async def update_expense(expense_id: str, body: ExpenseUpdate, user=Depends(get_current_user)):
    doc = await _get_editable_expense(expense_id, user)
    hh = await get_user_household(user["user_id"])
    if not hh:
        raise HTTPException(status_code=400, detail="Ev bulunamadı")

    patch: dict = {}
    target_type = body.target_type or doc["target_type"]
    if body.target_type is not None or body.target_user_id is not None:
        target_user = body.target_user_id if body.target_user_id is not None else doc.get("target_user_id")
        if target_type == "roommate":
            if not target_user or target_user not in hh["member_ids"]:
                raise HTTPException(status_code=400, detail="Geçersiz oda arkadaşı")
            if target_user == user["user_id"]:
                raise HTTPException(status_code=400, detail="Kendinize atayamazsınız")
        else:
            target_user = None
        patch["target_type"] = target_type
        patch["target_user_id"] = target_user

    if body.items is not None:
        patch["items"] = [i.model_dump() for i in body.items]
    if body.total is not None:
        if body.total <= 0:
            raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı")
        patch["total"] = round(body.total, 2)
    if body.merchant is not None:
        patch["merchant"] = body.merchant.strip() or None
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
    updated = await db.expenses.find_one({"expense_id": expense_id}, {"_id": 0})
    return {"expense": updated}


@api.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(get_current_user)):
    await _get_editable_expense(expense_id, user)
    await db.expenses.delete_one({"expense_id": expense_id})
    return {"ok": True}


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
    """Current members plus anyone who took part in this period.

    A member who has since been removed still belongs in the maths for the
    periods they lived through — otherwise closing the books on an old period
    would re-split their share among whoever happens to be around today.
    """
    rows = await db.expenses.find(
        {"household_id": household_id, "period_id": period_id},
        {"_id": 0, "added_by": 1, "target_user_id": 1},
    ).to_list(5000)
    extra = set()
    for r in rows:
        extra.add(r["added_by"])
        if r.get("target_user_id"):
            extra.add(r["target_user_id"])
    # Someone can settle up and only then be removed from the household; their
    # payment still has to count in that period's maths.
    for s in await db.settlements.find(
        {"household_id": household_id, "period_id": period_id},
        {"_id": 0, "from_user_id": 1, "to_user_id": 1},
    ).to_list(1000):
        extra.add(s["from_user_id"])
        extra.add(s["to_user_id"])
    return list(member_ids) + [u for u in sorted(extra) if u not in member_ids]


async def _compute_balances(household_id: str, period_id: str) -> dict:
    hh = await db.households.find_one({"household_id": household_id}, {"_id": 0})
    if not hh:
        return {"net": {}, "transfers": [], "totals_paid": {}}
    members = await period_participants(household_id, period_id, hh["member_ids"])
    n = len(members)
    net: Dict[str, float] = {m: 0.0 for m in members}
    totals_paid: Dict[str, float] = {m: 0.0 for m in members}
    roommate_paid: Dict[str, float] = {m: 0.0 for m in members}

    exps = await db.expenses.find(
        {
            "household_id": household_id,
            "period_id": period_id,
            "target_type": {"$in": ["household", "roommate"]},
        },
        {"_id": 0},
    ).to_list(5000)

    for e in exps:
        payer = e["added_by"]
        total = float(e["total"])
        if e["target_type"] == "household" and n > 0:
            totals_paid[payer] = totals_paid.get(payer, 0) + total
            share = total / n
            for m in members:
                if m == payer:
                    net[m] = net.get(m, 0) + (total - share)
                else:
                    net[m] = net.get(m, 0) - share
        elif e["target_type"] == "roommate":
            other = e.get("target_user_id")
            if not other or other not in net:
                continue
            roommate_paid[payer] = roommate_paid.get(payer, 0) + total
            net[payer] = net.get(payer, 0) + total
            net[other] = net.get(other, 0) - total

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
    result = await _compute_balances(hh["household_id"], period["period_id"])
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


# ---------- Stats ----------
@api.get("/stats")
async def stats(period_id: Optional[str] = None, user=Depends(get_current_user)):
    """Household numbers for the home screen.

    Only household expenses count: "self" is private and "roommate" is a debt
    between two people, neither is money the house spent together.
    """
    hh = await get_user_household(user["user_id"])
    if not hh:
        return {"total": 0, "per_person": 0, "categories": [], "merchants": []}

    period = (
        await db.periods.find_one({"period_id": period_id, "household_id": hh["household_id"]}, {"_id": 0})
        if period_id else await get_active_period(hh["household_id"])
    )
    if not period:
        return {"total": 0, "per_person": 0, "categories": [], "merchants": []}

    exps = await db.expenses.find(
        {"household_id": hh["household_id"], "period_id": period["period_id"],
         "target_type": "household"},
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
             "target_type": "household"},
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
        "categories": sorted(
            [{"key": k, "total": round(v, 2)} for k, v in cats.items() if v > 0.005],
            key=lambda x: -x["total"],
        ),
        "merchants": sorted(
            [{"name": k, "total": round(v, 2)} for k, v in merchants.items()],
            key=lambda x: -x["total"],
        )[:6],
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
    snap = await _compute_balances(hh["household_id"], period["period_id"])
    await db.periods.update_one(
        {"period_id": period["period_id"]},
        {"$set": {"status": "closed", "closed_at": now_utc(), "final_balances": snap}},
    )
    new_period_id = new_id("per")
    new_period = {
        "period_id": new_period_id,
        "household_id": hh["household_id"],
        "started_at": now_utc(),
        "closed_at": None,
        "status": "active",
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
    check = await asyncio.to_thread(push.self_check)
    if check["token"]:
        logger.info("OdaHesap backend started (bildirimler: hazir)")
    else:
        logger.warning("OdaHesap backend started (BILDIRIMLER CALISMIYOR: %s)", check["detail"])
    app.state.push_check = check


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
