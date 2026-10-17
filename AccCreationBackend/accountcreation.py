
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from email.utils import parseaddr
from pathlib import Path




def load_env_file():
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for line_number, raw_line in enumerate(env_path.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key.strip()):
            raise ValueError(f"Invalid .env entry on line {line_number}.")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)

def configured_auth0():
    domain = os.environ.get("AUTH0_DOMAIN", "").strip()
    client_id = os.environ.get("AUTH0_CLIENT_ID", "").strip()
    if not domain and not client_id:
        raise ValueError(
            "Set AUTH0_DOMAIN and AUTH0_CLIENT_ID in your .env file before starting."
        )
    if not domain or not client_id:
        raise ValueError("Set both AUTH0_DOMAIN and AUTH0_CLIENT_ID before starting.")

    domain = domain.removeprefix("https://").removesuffix("/")
    if not domain or "/" in domain or "@" in domain:
        raise ValueError("AUTH0_DOMAIN must be a tenant hostname, such as your-tenant.us.auth0.com.")
    return domain, client_id


class Auth0RequestError(RuntimeError):
    def __init__(self, message, error_code=None):
        super().__init__(message)
        self.error_code = error_code
