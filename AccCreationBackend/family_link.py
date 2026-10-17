import sys

import accountcreation as accounts
import family_groups


def authenticate_member(auth0_settings):
    email = accounts.validate_email(input("Your account email: ").strip(), "Email")
    verified = accounts.auth0_sign_in(*auth0_settings, email)
    return verified["email"], verified["auth0_user_id"]


def main():
    try:
        accounts.load_env_file()
        authenticated = authenticate_member(accounts.configured_auth0())
        email, auth0_user_id = authenticated

        profile_store = accounts.LocalProfileStore()
        profile = profile_store.find(email, auth0_user_id)
        if profile is None:
            raise ValueError(
                "No local profile exists for this account. Run accountcreation.py first, "
                "then run family_link.py."
            )

        member_id = family_groups.member_key(email, auth0_user_id)
        family_store = family_groups.LocalFamilyStore()
        action = input("Choose: [C]reate a family code or [J]oin with a code: ").strip().casefold()

        if action in {"c", "create"}:
            trip_details = family_groups.collect_trip_details()
            code = family_groups.generate_family_code()
            family_id = family_store.create(
                code, member_id=profile, trip_details=trip_details
            )
            profile_store.link_family_group(profile, family_id)
            profile_store.save(profile)
            print(f"\nFamily code: {code}")
            print("Share this code with the other account holders. Keep it private.")
            print("This account is linked. Personal settings remain separate.")
            print(family_groups.format_trip_details(trip_details))
            return 0
        if action in {"j", "join"}:
            code = family_groups.validate_family_code(input("Family code: ").strip())
            existing_group = family_store.find(code)
            if existing_group is None:
                raise ValueError(
                    "That family code was not found in this local installation. "
                    "Local family codes only work on this computer."
                )
            family_id = existing_group.get("family_id")
            if not isinstance(family_id, str) or not family_id:
                raise ValueError("Family group data is invalid.")
            family_store.join(code, family_id, member_id, profile=profile)
            profile_store.link_family_group(profile, family_id)
            profile_store.save(profile)
            print("This account is linked to the family group. Personal settings remain separate.")
            print(family_groups.format_trip_details(existing_group.get("trip")))
            return 0

        raise ValueError("Choose C to create a code or J to join a group.")
    except (EOFError, KeyboardInterrupt):
        print("\nFamily linking cancelled.", file=sys.stderr)
        return 1
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Family linking failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
