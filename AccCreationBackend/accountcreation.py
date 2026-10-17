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

import family_groups

CODE_TTL_SECONDS = 5 * 60
MAX_CODE_ATTEMPTS = 5
STORE_ROOT = Path.home() / ".AccCreationBackend"
PROFILE_STORE_PATH = STORE_ROOT / "users"
LEGACY_PROFILE_STORE_PATH = STORE_ROOT / "profiles.json"

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


def validate_email(address, setting_name):
    parsed_address = parseaddr(address)[1]
    if (
        parsed_address != address
        or address.count("@") != 1
        or any(character.isspace() for character in address)
        or address.startswith("@")
        or address.endswith("@")
        or "." not in address.rsplit("@", 1)[1]
    ):
        raise ValueError(f"{setting_name} must be a valid email address.")
    return address


class LocalProfileStore:
    def __init__(self, path=PROFILE_STORE_PATH, legacy_path=None):
        self.path = Path(path)
        self.legacy_path = Path(
            legacy_path
            if legacy_path is not None
            else (
                LEGACY_PROFILE_STORE_PATH
                if self.path == PROFILE_STORE_PATH
                else self.path.parent / "profiles.json"
            )
        )
        self._migrate_legacy_store()

    def _read_profiles(self):
        if not self.path.exists():
            return {}
        profiles = {}
        for profile_path in self.path.glob("*.json"):
            saved_profile = json.loads(profile_path.read_text(encoding="utf-8"))
            if not isinstance(saved_profile, dict):
                raise ValueError(f"Local profile data is invalid: {profile_path}")
            profiles[profile_path.stem] = saved_profile
        return profiles

    @staticmethod
    def _email_key(email):
        return email.strip().casefold()

    def find(self, email, user_id=None):
        profiles = self._read_profiles()
        if user_id:
            profile = profiles.get(self._file_key(user_id))
            if profile:
                return self._decode_profile(profile)
        for saved_profile in profiles.values():
            profile = self._decode_profile(saved_profile)
            if profile.get("email", "").strip().casefold() == self._email_key(email):
                return profile
        return None

    def find_by_user_id(self, user_id):
        for saved_profile in self._read_profiles().values():
            profile = self._decode_profile(saved_profile)
            profile_user_id = profile.get("auth0_user_id") or profile.get(
                "email", ""
            ).strip().casefold()
            if profile_user_id == user_id:
                return profile
        return None

    def all_profiles(self):
        return [
            self._decode_profile(saved_profile)
            for saved_profile in self._read_profiles().values()
        ]

    @staticmethod
    def _file_key(user_id):
        return urllib.parse.quote(user_id, safe="")

    def _write_profile(self, profile):
        user_id = profile.get("auth0_user_id") or profile["email"].strip().casefold()
        target = self.path / f"{self._file_key(user_id)}.json"
        family_groups._write_json_file(
            target, self._encode_profile(profile), ".user-"
        )
        return target

    def _migrate_legacy_store(self):
        if not self.legacy_path.exists():
            return
        data = json.loads(self.legacy_path.read_text(encoding="utf-8"))
        schema_version = data.get("schemaVersion", data.get("schema_version"))
        if schema_version != 1 or not isinstance(data.get("profiles"), dict):
            raise ValueError(
                f"Local profile store has an unsupported format: {self.legacy_path}"
            )
        existing = self._read_profiles()
        for saved_profile in data["profiles"].values():
            profile = self._decode_profile(saved_profile)
            if not isinstance(profile, dict) or not profile.get("email"):
                raise ValueError(
                    f"Local profile data is invalid: {self.legacy_path}"
                )
            user_id = profile.get("auth0_user_id") or profile["email"].strip().casefold()
            file_key = self._file_key(user_id)
            if file_key not in existing:
                self._write_profile(profile)
                existing[file_key] = self._encode_profile(profile)

        backup_path = self.legacy_path.with_suffix(
            self.legacy_path.suffix + ".migrated"
        )
        counter = 1
        while backup_path.exists():
            backup_path = self.legacy_path.with_suffix(
                self.legacy_path.suffix + f".migrated.{counter}"
            )
            counter += 1
        os.replace(self.legacy_path, backup_path)

    @staticmethod
    def _decode_profile(saved_profile):
        if not isinstance(saved_profile, dict) or "userProfile" not in saved_profile:
            return saved_profile
        user_profile = saved_profile["userProfile"]
        if not isinstance(user_profile, dict):
            raise ValueError("Local profile data is invalid.")
        email = user_profile.get("email", "")
        user_id = user_profile.get("userId")
        profile = {
            "name": user_profile.get("name", ""),
            "email": email,
            "email_verified": user_profile.get("emailVerified", False),
        }
        if user_id and user_id != email:
            profile["auth0_user_id"] = user_id
        family_ids = user_profile.get("familyIds")
        if family_ids is None:
            family_id = user_profile.get("familyId")
            family_ids = [family_id] if family_id else []
        if not isinstance(family_ids, list) or any(
            not isinstance(family_id, str) or not family_id for family_id in family_ids
        ):
            raise ValueError("Local profile data is invalid.")
        if family_ids:
            profile["family_group_ids"] = list(dict.fromkeys(family_ids))
        return profile

    @staticmethod
    def _encode_profile(profile):
        user_id = profile.get("auth0_user_id") or profile["email"].strip().casefold()
        user_profile = {
            "userId": user_id,
            "name": profile.get("name", ""),
            "email": profile["email"],
            "emailVerified": profile.get("email_verified", False),
        }
        family_ids = profile.get("family_group_ids")
        if family_ids is None:
            family_id = profile.get("family_group_id")
            family_ids = [family_id] if family_id else []
        if not isinstance(family_ids, list) or any(
            not isinstance(family_id, str) or not family_id for family_id in family_ids
        ):
            raise ValueError("Local profile data is invalid.")
        if family_ids:
            user_profile["familyIds"] = list(dict.fromkeys(family_ids))
        return {"userProfile": user_profile}

    @staticmethod
    def link_family_group(profile, family_id):
        family_ids = profile.get("family_group_ids")
        if family_ids is None:
            family_id_legacy = profile.pop("family_group_id", None)
            family_ids = [family_id_legacy] if family_id_legacy else []
        if not isinstance(family_ids, list) or any(
            not isinstance(existing_id, str) or not existing_id
            for existing_id in family_ids
        ):
            raise ValueError("Local profile data is invalid.")
        profile["family_group_ids"] = list(dict.fromkeys([*family_ids, family_id]))

    def save(self, profile):
        profile.pop("preferences", None)
        self._write_profile(profile)
        user_id = profile.get("auth0_user_id") or profile["email"].strip().casefold()
        current_key = self._file_key(user_id)
        for file_key, saved_profile in self._read_profiles().items():
            if file_key == current_key:
                continue
            existing = self._decode_profile(saved_profile)
            if existing.get("email", "").strip().casefold() == self._email_key(
                profile["email"]
            ):
                (self.path / f"{file_key}.json").unlink()

    def clear_preferences(self):
        for saved_profile in self._read_profiles().values():
            profile = self._decode_profile(saved_profile)
            if isinstance(profile, dict):
                profile.pop("preferences", None)
                self.save(profile)


def save_profile(profile, local_store):
    local_store.save(profile)
    print(f"Profile saved locally at {local_store.path}.")


def main():
    try:
        load_env_file()
        auth0_settings = configured_auth0()
        local_store = LocalProfileStore()
        family_store = family_groups.LocalFamilyStore(profile_store=local_store)
        family_code, family_id = family_groups.choose_family_link(family_store)
        name = input("Your name: ").strip()
        if not name or len(name) > 80 or any(ord(character) < 32 for character in name):
            raise ValueError("Enter a name between 1 and 80 characters.")
        recipient = validate_email(input("Your email: ").strip(), "Email")

        print("Using Auth0 passwordless email sign-in in the terminal.")
        verified_account = auth0_sign_in(*auth0_settings, recipient)
        recipient = verified_account["email"]
        auth0_user_id = verified_account["auth0_user_id"]

        profile = local_store.find(recipient, auth0_user_id)
        is_existing_profile = profile is not None
        if not profile:
            profile = {
                "name": name,
                "email": recipient,
                "email_verified": True,
            }
        else:
            profile["email_verified"] = True
            profile.setdefault("email", recipient)
            profile.setdefault("name", name)
        profile.pop("preferences", None)
        profile["auth0_user_id"] = auth0_user_id

        member_id = family_groups.member_key(recipient, auth0_user_id)
        if family_store.join(
            family_code, family_id, member_id, profile=profile
        ) is None:
            raise ValueError("The family code is no longer available in local storage.")
        local_store.link_family_group(profile, family_id)
        save_profile(profile, local_store)
        print(f"\nWelcome, {profile.get('name', name)}.")
        print("Your email address has been verified.")
        print("This confirms access to that inbox; it is not a second authentication factor.")
        if is_existing_profile:
            print("Your existing profile was loaded.")
        print("\nProfile response (personal preferences are not collected or stored):")
        print(json.dumps(profile, indent=2, ensure_ascii=False))
        return 0
    except (EOFError, KeyboardInterrupt):
        print("\nSign-in cancelled.", file=sys.stderr)
        return 1
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Sign-in failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())