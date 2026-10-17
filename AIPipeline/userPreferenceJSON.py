# Allowed values and scales are commented out for reference. They are not part of the actual JSON structure.
# Priorty includes "critical", "flexible", and "weak_link" to indicate how the AI should handle conflicts or preferences.
# Critical - Family must agree on it.
# Flexible - AI can average it out into the trip
# Weak Link - There is an option that others should adhere to

{
    "userProfile": {
        "userId": "",
        "name": "",
        "email": ""
    },
    "userTravelProfile": {
        "groundTransportation": {
            "value": null,
            # "allowedValues": ["rental", "rideshare", "public"],
            "priority": "critical"
        },
        "dietaryRestrictions": {
            "value": [],
            # "allowedValues": ["none", "vegan", "vegetarian", "gluten-free", "halal", "kosher", "pescatarian", "dairy-free"],
            "priority": "weak_link"
        },
        "diningCuisine": {
            "value": null,
            # "allowedValues": ["local", "casual"],
            "priority": "flexible"
        },
        "tripPace": {
            "value": null,
            # "scale": "0.0 (Slow) to 1.0 (Fast)",
            "priority": "flexible"
        },
        "activityFocus": {
            "value": [],
            # "allowedValues": ["culture", "nature", "city_life", "historical", "landmarks"],
            "priority": "flexible"
        },
        "budgetTier": {
            "value": null,
            # "scale": "1 ($) to 3 ($$$)",
            "priority": "critical"
        },
        "morningRoutine": {
            "value": null,
            # "allowedValues": ["early", "midway", "late"],
            # Early - 6:00 AM to 8:00 AM
            # Midway - 8:00 AM to 10:00 AM
            # Late - 10:00 AM to 12:00 PM
            "priority": "critical"
        },
        "interestedInShopping": {
            "value": null,
            # "type": "boolean",
            "priority": "flexible"
        },
        "travelStyle": {
            "value": null,
            # "scale": "0.0 (Relaxed) to 1.0 (Explorative)",
            "priority": "flexible"
        },
        "tourPreference": {
            "value": null,
            # "allowedValues": ["self-guided", "guided"],
            "priority": "flexible"
        },
        "luggagePreference": {
            "value": null,
            # "allowedValues": ["backpacking", "suitcases"],
            "priority": "critical"
        },
        "petFriendly": {
            "value": null,
            # "type": "boolean",
            "priority": "weak_link"
        },
        "activityPopularity": {
            "value": null,
            # "scale": "0.0 (Hidden Gems) to 1.0 (Hot Spots)",
            "priority": "flexible"
        }
    }
}