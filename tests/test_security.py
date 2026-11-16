from app.core.security import CryptoService, decrypt_contact, encrypt_contact


def test_contact_roundtrip():
    token = encrypt_contact("@polar_navigator")
    assert token != "@polar_navigator"
    assert decrypt_contact(token) == "@polar_navigator"


def test_garbage_token_returns_guard():
    assert decrypt_contact("not-a-fernet-token") == "@keeper_protected"
    assert decrypt_contact("") == "@keeper_protected"


def test_crypto_service_secret_isolation():
    alice = CryptoService(secret="alice-secret", salt="s")
    bob = CryptoService(secret="bob-secret", salt="s")
    token = alice.encrypt_contact("+7 900 000-00-00")
    assert bob.decrypt_contact(token) == "@keeper_protected"
    assert alice.decrypt_contact(token) == "+7 900 000-00-00"


def test_same_secret_same_service_interop():
    one = CryptoService(secret="shared", salt="s")
    two = CryptoService(secret="shared", salt="s")
    assert two.decrypt_contact(one.encrypt_contact("@keeper")) == "@keeper"
