from pathlib import Path

FAMILY_CODE_ALPHABET = "0123456789"
FAMILY_CODE_LENGTH = 4
STORE_ROOT = Path.home() / ".AccCreationBackend"
FAMILY_STORE_PATH = STORE_ROOT / "families"
LEGACY_FAMILY_STORE_PATH = STORE_ROOT / "family-groups.json"


def empty_travel_profile():
    pass


def normalize_travel_profile(travel_profile):
    pass


def member_record(profile, organizer=False):
    pass


def _write_json_file(path, data, prefix):
    pass


class LocalFamilyStore:
    def __init__(
        self,
        path=FAMILY_STORE_PATH,
        profile_store=None,
        legacy_path=None,
    ):
        pass

    @staticmethod
    def code_key(code):
        pass

    @staticmethod
    def _normalize_member(member, profile_by_member_id=None):
        pass

    @classmethod
    def _normalize_members(cls, members, profile_by_member_id=None):
        pass

    def _profile_lookup(self):
        pass

    def _migrate_legacy_store(self):
        pass

    def _read_groups(self):
        pass

    def find(self, code):
        pass

    def find_by_family_id(self, family_id):
        pass

    def get_member_travel_profile(self, code, user_id):
        pass

    def save_member_travel_profile(self, code, user_id, travel_profile):
        pass

    def update_trip(self, code, trip_details):
        pass

    def create(self, code, family_id=None, member_id=None, trip_details=None):
        pass

    def join(self, code, family_id, member_id, profile=None):
        pass

    def _write_groups(self, groups):
        pass


def generate_family_code():
    pass


def validate_family_code(code):
    pass


def validate_trip_details(country, start_date, end_date, start_time, end_time):
    pass


def collect_trip_details():
    pass


def format_trip_details(trip):
    pass


def member_key(email, auth0_user_id):
    pass


def choose_family_link(family_store):
    pass