import json

def process_master_preferences(
    user_jsons,
    country,
    startDate,
    endDate,
    startTime,
    endTime,
    startCity,
    endCity
):
    master_json = {
        "country": country,
        "startDate": startDate,
        "endDate": endDate,
        "startTime": startTime,
        "endTime": endTime,
        "startCity": startCity,
        "endCity": endCity,
        "groupMembers": [],
        "userTravelProfile": {}
    }

    if not user_jsons:
        return master_json

    # Extract user identities[cite: 2]
    for user_data in user_jsons:
        profile = user_data.get("userProfile", {})
        if profile.get("name"):
            master_json["groupMembers"].append({
                "name": profile.get("name"),
                "userId": profile.get("userId")
            })

    # Use the first user's JSON as the template to dynamically iterate through all preference keys[cite: 2]
    template_profile = user_jsons[0].get("userTravelProfile", {})

    for key, attributes in template_profile.items():
        priority = attributes.get("priority")
        preference_tuples = _get_preference_tuples(user_jsons, key)
        raw_values = [preference[2] for preference in preference_tuples]

        if not preference_tuples:
            master_value = None

        elif priority == "critical":
            # Check for unanimous agreement across primitive types
            unique_values = set(raw_values)
            if len(unique_values) <= 1:
                master_value = raw_values[0]
            else:
                distinct_choices = ", ".join(map(str, unique_values))
                user_preferences = "; ".join(
                    f"{name} (userId: {user_id}): {preference}"
                    for name, user_id, preference in preference_tuples
                )
                master_value = (
                    f"WARNING: Not everybody's {key} matches "
                    f"({distinct_choices}). User preferences: {user_preferences}"
                )

        elif priority == "flexible":
            # Keep each choice tied to its user so the AI can balance preferences.
            master_value = preference_tuples

        elif priority == "weak_link":
            # Keep weak-link preferences tied to their users as well.
            master_value = preference_tuples

        master_json["userTravelProfile"][key] = {
            "value": master_value,
            "priority": priority
        }

    return master_json


def _get_preference_tuples(user_jsons, key):
    """Return each user's preference with the identity needed to interpret it."""
    preference_tuples = []
    for user_data in user_jsons:
        profile = user_data.get("userProfile", {})
        preference = user_data.get("userTravelProfile", {}).get(key, {}).get("value")
        if preference is not None:
            preference_tuples.append((
                profile.get("name"),
                profile.get("userId"),
                preference
            ))
    return preference_tuples


def load_user_json(input_filename):
    with open(input_filename, "r", encoding="utf-8") as input_file:
        return json.load(input_file)


if __name__ == "__main__":
    user_1 = load_user_json("user_1.json")
    user_2 = load_user_json("user_2.json")
    
    master_preference = process_master_preferences(
        [user_1, user_2],
        country="Japan",
        startTime="09:00",
        endTime="18:00",
        startDate="2026-10-13",
        endDate="2026-10-20",
        startCity="Tokyo",
        endCity="Kyoto"
    )
    with open("masterJSON.json", "w", encoding="utf-8") as output_file:
        json.dump(master_preference, output_file, indent=4)
        output_file.write("\n")