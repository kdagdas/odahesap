"""Firebase Cloud Messaging (HTTP v1) push sender.

Kept separate from server.py so the API keeps working untouched when pushes
are not configured: every function here degrades to a no-op if the service
account is missing, and no send failure is ever allowed to break the request
that triggered it. A notification is a nice-to-have; recording the expense is
not.

Setup: FIREBASE_SERVICE_ACCOUNT holds the whole service-account JSON (as a
single-line string) in the hosting dashboard's environment. It must never be
committed — it grants full access to the Firebase project.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Iterable, Optional

import httpx

logger = logging.getLogger("odahesap.push")

_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_service_account: Optional[dict] = None
_credentials = None

raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
if raw:
    try:
        _service_account = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("FIREBASE_SERVICE_ACCOUNT gecerli JSON degil, bildirimler kapali")


def is_configured() -> bool:
    return _service_account is not None


def _fcm_url() -> str:
    return f"https://fcm.googleapis.com/v1/projects/{_service_account['project_id']}/messages:send"


def _access_token() -> Optional[str]:
    """Mint (and let google-auth cache/refresh) an OAuth2 token."""
    global _credentials
    if not _service_account:
        return None
    try:
        from google.oauth2 import service_account as gsa
        from google.auth.transport.requests import Request

        if _credentials is None:
            _credentials = gsa.Credentials.from_service_account_info(
                _service_account, scopes=[_SCOPE]
            )
        if not _credentials.valid:
            _credentials.refresh(Request())
        return _credentials.token
    except Exception:
        logger.exception("FCM erisim jetonu alinamadi")
        return None


async def send_to_tokens(
    tokens: Iterable[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
) -> dict:
    """Fire one push per token. Returns {sent, failed, invalid_tokens}.

    Invalid/unregistered tokens are reported back so the caller can drop them —
    otherwise a reinstalled app leaves dead tokens accumulating forever.
    """
    tokens = [t for t in dict.fromkeys(tokens) if t]
    if not tokens or not is_configured():
        return {"sent": 0, "failed": 0, "invalid_tokens": []}

    token_str = await asyncio.to_thread(_access_token)
    if not token_str:
        return {"sent": 0, "failed": len(tokens), "invalid_tokens": []}

    headers = {"Authorization": f"Bearer {token_str}", "Content-Type": "application/json"}
    sent = failed = 0
    invalid: list[str] = []

    async with httpx.AsyncClient(timeout=20.0) as http:
        for tok in tokens:
            payload = {
                "message": {
                    "token": tok,
                    "notification": {"title": title, "body": body},
                    "data": {k: str(v) for k, v in (data or {}).items()},
                    "android": {
                        "priority": "high",
                        "notification": {"channel_id": "default", "sound": "default"},
                    },
                }
            }
            try:
                r = await http.post(_fcm_url(), headers=headers, json=payload)
            except Exception:
                logger.exception("FCM istegi basarisiz")
                failed += 1
                continue

            if r.status_code == 200:
                sent += 1
            elif r.status_code in (400, 403, 404):
                # UNREGISTERED / INVALID_ARGUMENT — the device is gone.
                logger.info("Gecersiz FCM jetonu dusuruluyor: %s", r.text[:200])
                invalid.append(tok)
                failed += 1
            else:
                logger.warning("FCM %s: %s", r.status_code, r.text[:200])
                failed += 1

    return {"sent": sent, "failed": failed, "invalid_tokens": invalid}
