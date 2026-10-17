
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

def auth0_request_json(url, form_data=None, access_token=None):
    headers = {"Accept": "application/json"}
    data = None
    if form_data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        data = urllib.parse.urlencode(form_data).encode("utf-8")
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            details = json.loads(error.read().decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            details = {}
        description = details.get("error_description") or details.get("message")
        if not description:
            description = details.get("error", f"HTTP {error.code}")
        if "connection is disabled" in description.casefold():
            description = (
                "The Auth0 Email passwordless connection is disabled for this application. "
                "In the Auth0 Dashboard, enable Email for the Native Application whose Client ID "
                "is in .env (Authentication > Passwordless > Email > Applications, or the app's "
                "Connections tab), then try again."
            )
        raise Auth0RequestError(
            f"Auth0 request failed: {description}", details.get("error")
        ) from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise RuntimeError("Auth0 returned an invalid response.") from error


def auth0_sign_in(domain, client_id, email):
    base_url = f"https://{domain}"
    auth0_request_json(
        f"{base_url}/passwordless/start",
        {
            "client_id": client_id,
            "connection": "email",
            "email": email,
            "send": "code",
        },
    )

    print(f"A verification code was sent to {email}.")
    for attempt in range(1, MAX_CODE_ATTEMPTS + 1):
        one_time_code = getpass.getpass("Enter the code from your email: ").strip()
        if not one_time_code:
            print("Enter the code from your email.")
            continue

        try:
            token = auth0_request_json(
                f"{base_url}/oauth/token",
                {
                    "grant_type": "http://auth0.com/oauth/grant-type/passwordless/otp",
                    "client_id": client_id,
                    "username": email,
                    "otp": one_time_code,
                    "realm": "email",
                    "scope": "openid profile email",
                },
            )
        except Auth0RequestError as error:
            if error.error_code != "invalid_grant":
                raise
            attempts_left = MAX_CODE_ATTEMPTS - attempt
            if attempts_left:
                print(f"That code is incorrect or expired. {attempts_left} attempt(s) remaining.")
                continue
            raise RuntimeError(
                "Too many incorrect code attempts. Run the program again to request another code."
            ) from error

        access_token = token.get("access_token")
        if not access_token:
            raise RuntimeError("Auth0 did not return an access token.")
        user_info = auth0_request_json(f"{base_url}/userinfo", access_token=access_token)
        verified_email = user_info.get("email")
        user_id = user_info.get("sub")
        if not verified_email or user_info.get("email_verified") is not True or not user_id:
            raise RuntimeError("Auth0 must return a verified email and user ID for this sign-in.")
        verified_email = validate_email(verified_email, "Auth0 email")
        if verified_email.casefold() != email.casefold():
            raise RuntimeError("The email verified by Auth0 does not match the email entered.")
        return {"email": verified_email, "auth0_user_id": user_id}

    raise RuntimeError("Unable to verify the email code.")