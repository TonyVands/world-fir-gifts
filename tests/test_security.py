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


def test_key_rotation_reads_old_and_reencrypts():
    old = CryptoService(secret="old-file-secret", salt="arctic-aurora-salt", legacy=[])
    token = old.encrypt_contact("@polar_navigator")

    new = CryptoService(
        secret="new-env-secret",
        salt="new-salt",
        legacy=[("old-file-secret", "arctic-aurora-salt")],
    )
    assert new.decrypt_contact(token) == "@polar_navigator", "старый контакт читается"
    assert new.decrypts_with_primary(token) is False

    rotated = new.rotate_token(token)
    assert rotated and new.decrypts_with_primary(rotated)
    assert new.decrypt_contact(rotated) == "@polar_navigator"
    assert new.rotate_token(rotated) is None, "повторная ротация не нужна"


def test_rotation_impossible_with_unknown_key():
    stranger = CryptoService(secret="x", salt="y", legacy=[]).encrypt_contact("@a")
    svc = CryptoService(secret="new", salt="s", legacy=[])
    assert svc.rotate_token(stranger) is None
    assert svc.decrypt_contact(stranger) == "@keeper_protected"


def test_new_contacts_use_primary_key():
    svc = CryptoService(secret="primary", salt="s", legacy=[("legacy", "s")])
    token = svc.encrypt_contact("@new")
    assert CryptoService(secret="primary", salt="s", legacy=[]).decrypt_contact(token) == "@new"
