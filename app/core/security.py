"""Шифрование контактов (Fernet) с поддержкой смены ключа.

Основной ключ — CONTACT_ENCRYPTION_SECRET (+ CONTACT_ENCRYPTION_SALT).
Если его сменили, старые записи остаются читаемыми: для расшифровки
перебираются «наследные» ключи (файл /data/.contact_secret, соль по
умолчанию), а при старте приложения такие записи перешифровываются
основным ключом (см. rotate_token и app.main).
"""

import base64
import hashlib
import logging
import os
import secrets
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

logger = logging.getLogger("uvicorn.error")

DEFAULT_SALT = "arctic-aurora-salt"
SALT = os.getenv("CONTACT_ENCRYPTION_SALT", DEFAULT_SALT)
SECRET_FILE = os.getenv("CONTACT_SECRET_FILE", "/data/.contact_secret")
DEV_FALLBACK_SECRET = "world-fir-gifts-dev-secret-do-not-use-in-prod"
PROTECTED_PLACEHOLDER = "@keeper_protected"


def _is_production() -> bool:
    return os.getenv("APP_ENV", "").strip().lower() in ("prod", "production")


def _read_secret_file() -> str | None:
    try:
        path = Path(SECRET_FILE)
        if path.exists():
            value = path.read_text(encoding="utf-8").strip()
            return value or None
    except OSError:
        pass
    return None


def _load_secret() -> str:
    env_secret = os.getenv("CONTACT_ENCRYPTION_SECRET")
    if env_secret:
        return env_secret
    existing = _read_secret_file()
    if existing:
        return existing
    try:
        path = Path(SECRET_FILE)
        path.parent.mkdir(parents=True, exist_ok=True)
        generated = secrets.token_urlsafe(32)
        path.write_text(generated, encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        logger.info("[Security] Сгенерирован новый ключ шифрования контактов: %s", path)
        return generated
    except OSError:
        if _is_production():
            # В проде публичный dev-ключ = все контакты читаемы любым, кто видел код.
            raise RuntimeError(
                f"Нет CONTACT_ENCRYPTION_SECRET и недоступен файл ключа {SECRET_FILE}. "
                "Задайте секрет в переменных окружения."
            )
        logger.warning(
            "[Security] Недоступен файл ключа %s — используется dev-ключ (только для разработки).",
            SECRET_FILE,
        )
        return DEV_FALLBACK_SECRET


def _derive(secret: str, salt: str) -> Fernet:
    dk = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt.encode("utf-8"), 100_000, dklen=32)
    return Fernet(base64.urlsafe_b64encode(dk))


class CryptoService:
    """Ключи выводятся ОДИН раз (PBKDF2 на 100k итераций дорогой), дальше — кеш."""

    def __init__(
        self,
        secret: str | None = None,
        salt: str | None = None,
        legacy: list[tuple[str, str]] | None = None,
    ) -> None:
        self._secret = secret or _load_secret()
        self._salt = salt or SALT
        self._primary = _derive(self._secret, self._salt)

        candidates: list[tuple[str, str]] = []
        if legacy is None:
            file_secret = _read_secret_file()
            # Dev-ключ участвует ТОЛЬКО в расшифровке: это позволяет перешифровать
            # записи, случайно созданные с ним, но новые данные им не шифруются.
            for s in (self._secret, file_secret, DEV_FALLBACK_SECRET):
                if not s:
                    continue
                for sl in (self._salt, DEFAULT_SALT):
                    candidates.append((s, sl))
        else:
            candidates = list(legacy)

        seen = {(self._secret, self._salt)}
        fallbacks: list[Fernet] = []
        for pair in candidates:
            if pair in seen:
                continue
            seen.add(pair)
            fallbacks.append(_derive(*pair))
        self._legacy_count = len(fallbacks)
        # MultiFernet: шифрует первым ключом, расшифровывает любым из списка.
        self._multi = MultiFernet([self._primary, *fallbacks])

    def encrypt_contact(self, raw_contact: str) -> str:
        return self._primary.encrypt(raw_contact.encode("utf-8")).decode("utf-8")

    def decrypt_contact(self, token: str) -> str:
        try:
            return self._multi.decrypt(token.encode("utf-8")).decode("utf-8")
        except Exception:
            return PROTECTED_PLACEHOLDER

    def decrypts_with_primary(self, token: str) -> bool:
        try:
            self._primary.decrypt(token.encode("utf-8"))
            return True
        except (InvalidToken, ValueError, TypeError):
            return False

    def rotate_token(self, token: str) -> str | None:
        """Новый токен под основным ключом, если запись зашифрована старым ключом.
        None — перешифровка не нужна или невозможна (ключ неизвестен)."""
        if not token or self.decrypts_with_primary(token):
            return None
        try:
            return self._multi.rotate(token.encode("utf-8")).decode("utf-8")
        except (InvalidToken, ValueError, TypeError):
            return None


crypto_service = CryptoService()


def encrypt_contact(raw_contact: str) -> str:
    return crypto_service.encrypt_contact(raw_contact)


def decrypt_contact(token: str) -> str:
    return crypto_service.decrypt_contact(token)
