import base64
import hashlib
import logging
import os
import secrets
from pathlib import Path

from cryptography.fernet import Fernet

logger = logging.getLogger("uvicorn.error")

SALT = os.getenv("CONTACT_ENCRYPTION_SALT", "arctic-aurora-salt")
SECRET_FILE = os.getenv("CONTACT_SECRET_FILE", "/data/.contact_secret")
DEV_FALLBACK_SECRET = "world-fir-gifts-dev-secret-do-not-use-in-prod"


def _load_secret() -> str:
    env_secret = os.getenv("CONTACT_ENCRYPTION_SECRET")
    if env_secret:
        return env_secret
    try:
        path = Path(SECRET_FILE)
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
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
        if os.getenv("APP_ENV", "").strip().lower() in ("prod", "production"):
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


class CryptoService:
    def __init__(self, secret: str | None = None, salt: str | None = None) -> None:
        self._secret = secret or _load_secret()
        self._salt = salt or SALT

    def _fernet(self) -> Fernet:
        dk = hashlib.pbkdf2_hmac("sha256", self._secret.encode("utf-8"), self._salt.encode("utf-8"), 100_000, dklen=32)
        return Fernet(base64.urlsafe_b64encode(dk))

    def encrypt_contact(self, raw_contact: str) -> str:
        return self._fernet().encrypt(raw_contact.encode("utf-8")).decode("utf-8")

    def decrypt_contact(self, token: str) -> str:
        try:
            return self._fernet().decrypt(token.encode("utf-8")).decode("utf-8")
        except Exception:
            return "@keeper_protected"


crypto_service = CryptoService()


def encrypt_contact(raw_contact: str) -> str:
    return crypto_service.encrypt_contact(raw_contact)


def decrypt_contact(token: str) -> str:
    return crypto_service.decrypt_contact(token)
