"""
Install the SDK with:
    pip install google-genai

Set the API key before running:
    PowerShell: $env:GEMINI_API_KEY = "your-api-key"
"""

import os
import json
import time
import tripPrompts as tripPrompts
import jsonPreprocessing as jsonPp

from google import genai

MODEL_NAME = "gemini-3.8-flash"

from pydantic import BaseModel, Field
from typing import List, Literal, Optional

class LocationDetails(BaseModel):
    name: str = Field(description="Name of the venue, station, or landmark")
    address: Optional[str] = None

class TransitDetails(BaseModel):
    mode: Literal["flight", "train", "subway", "bus", "taxi", "rideshare", "walking", "rental_car", "ferry"]
    provider_or_line: Optional[str] = Field(description="e.g., 'Yamanote Line', 'Delta Airlines'")
    route_number: Optional[str] = Field(description="Flight number or train number")
    distance_km: Optional[float] = None

class CostEstimate(BaseModel):
    amount: float
    currency: str
    is_per_person: bool

class TimelineItem(BaseModel):
    id: str = Field(description="Unique identifier for frontend keys/drag-and-drop")
    item_type: Literal["lodging", "activity", "meal", "transit"]
    title: str = Field(description="Summary of the event (e.g., 'Walk to Senso-ji', 'Lunch at Afuri Ramen')")
    
    start_time: str = Field(description="24-hour local time, e.g., '09:00'")
    end_time: str = Field(description="24-hour local time, e.g., '10:30'")
    duration_minutes: int
    
    location: Optional[LocationDetails] = Field(description="Omit only if item_type is 'transit' and it represents pure movement")
    transit_details: Optional[TransitDetails] = Field(description="Only populated if item_type is 'transit'")
    
    estimated_cost: Optional[CostEstimate] = None
    notes_and_tips: Optional[List[str]] = Field(description="Important context like 'Cash only', 'Reservation confirmed'")

class SplitBranch(BaseModel):
    id: str = Field(description="Unique identifier for this branch")
    label: str = Field(description="Short description of who or what this branch is for")
    traveler_ids: Optional[List[str]] = Field(
        default=None,
        description="Identifiers or names of travelers taking this branch, when applicable"
    )
    timeline: List[TimelineItem] = Field(
        description="Branch-specific activities and transit during the split interval"
    )

class Split(BaseModel):
    id: str = Field(description="Unique identifier for the split")
    start_time: str = Field(description="24-hour local time when the group separates, e.g., '14:00'")
    end_time: str = Field(description="24-hour local time when the group begins to reunite, e.g., '16:30'")
    branches: List[SplitBranch] = Field(
        description="Parallel branch itineraries; each branch may use different transit"
    )
    rejoin_time: str = Field(description="24-hour local time when the group is together again")
    rejoin_location: LocationDetails = Field(
        description="Location where all branches reunite before continuing on the shared path"
    )

class DayPlan(BaseModel):
    day_number: int
    date: str = Field(description="YYYY-MM-DD")
    base_city: str
    day_theme_or_summary: str
    timeline: List[TimelineItem]
    splits: List[Split] = Field(
        default_factory=list,
        description=(
            "Optional parallel plans for part of the day. Keep shared activities and "
            "transit in timeline; put branch-specific activities and transit here."
        )
    )

class SplitDayPlan(DayPlan):
    splits: List[Split] = Field(
        description="Splits for this day; use an empty list when no requested activity is split"
    )

class TripItinerary(BaseModel):
    trip_title: str
    start_date: str = Field(description="YYYY-MM-DD")
    end_date: str = Field(description="YYYY-MM-DD")
    destinations: List[str] = Field(description="List of main cities/regions visited")
    warnings: List[str] = Field(
        default_factory=list,
        description="Important warnings or unresolved preference conflicts"
    )
    days: List[DayPlan]

class SplitTripItinerary(TripItinerary):
    days: List[SplitDayPlan]


def create_gemini_client() -> genai.Client:
    # Create a Gemini client using the API key from the environment.
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Set it in the environment before "
            "using the Gemini API."
        )

    return genai.Client(api_key=api_key)


# MAIN FUNCTION TO GENERATE TRIP PLAN. SIMPLY INPUT A VALID FAMILY JSON.
def generate_trip_plan(familyJSON: dict) -> str:
    request = tripPrompts.generationPrompt
    # Generate a trip plan from a natural-language request.
    if not request.strip():
        raise ValueError("The trip-planning request cannot be empty.")

    master_preference = jsonPp.process_master_preferences(
        familyJSON["users"],
        country=familyJSON.get("country", ""),
        startDate=familyJSON.get("startDate", ""),
        endDate=familyJSON.get("endDate", ""),
        startTime=familyJSON.get("startTime", ""),
        endTime=familyJSON.get("endTime", ""),
        startCity=familyJSON.get("startCity", ""),
        endCity=familyJSON.get("endCity", "")
    )
    with open("masterJSON.json", "w", encoding="utf-8") as output_file:
        json.dump(master_preference, output_file, indent=4)
        output_file.write("\n")
    master_preference = json.dumps(master_preference)

    client = create_gemini_client()

    
    response = client.interactions.create(
        model=MODEL_NAME,
        tools=[{"type": "google_maps"}],
        input=f"{master_preference}\n\n{request}",
        generation_config={
            "thinking_level": "low"
        },
        response_format={
            "type": "text",
            "mime_type": "application/json",
            "schema": TripItinerary.model_json_schema()
        },
    )
    if not response.output_text:
        raise RuntimeError("Gemini returned an empty response.")

    return response.output_text

# MAIN FUNCTION TO GENERATE TRIP PLAN. SIMPLY INPUT A VALID FAMILY JSON.
def split_trip_plan(familyJSON: dict, userID: str, trip: dict, specificRequests: str, activityIDs: list) -> str:
    request = tripPrompts.splitPrompt
    # Modify a trip plan to include splits based on a natural-language request.
    if not request.strip():
        raise ValueError("The trip-planning request cannot be empty.")

    userJson = None
    for user in familyJSON["users"]:
        if user.get("userProfile", {}).get("userId") == userID:
            userJson = user
            break
    if not userJson:
        raise ValueError(f"User ID {userID} not found in family JSON.")

    userJson = json.dumps(userJson)
    familyJSON = json.dumps(familyJSON)
    trip = json.dumps(trip)

    client = create_gemini_client()


    response = client.interactions.create(
        model=MODEL_NAME,
        tools=[{"type": "google_maps"}],
        input=(
            f"User Preferences: {userJson}\n\n"
            f"Overall Preference: {familyJSON}\n\n"
            f"Trip: {trip}\n\n"
            f"Activity IDs to split: {json.dumps(activityIDs)}\n\n"
            f"Request: {request}\n\n"
            f"Specific Requests: {specificRequests}"
        ),
        generation_config={
            "thinking_level": "low"
        },
        response_format={
            "type": "text",
            "mime_type": "application/json",
            "schema": SplitTripItinerary.model_json_schema()
        },
    )
    if not response.output_text:
        raise RuntimeError("Gemini returned an empty response.")

    return response.output_text



if __name__ == "__main__":
    # Load the family JSON data
    with open("family_1.json", "r", encoding="utf-8") as family_file:
        familyJSON = json.load(family_file)
        # Testing block for initial trip plan generation    
        start_time = time.perf_counter()

        trip_plan = generate_trip_plan(familyJSON)
        
        elapsed_time = time.perf_counter() - start_time

        print(f"Response time: {elapsed_time:.2f} seconds")
        with open("trip.json", "w", encoding="utf-8") as output_file:
            output_file.write(trip_plan)
    """
    # Testing block for split trip plan generation
    with open("trip.json", "r", encoding="utf-8") as trip_file:
        trip_plan = json.load(trip_file)

    userID = "U001"  # Example user ID for testing
    specificRequests = ""
    activityIDs = ["d2-nezu-yanaka", "d2-ueno-park", "d3-meiji-jingu"]  # Example activity IDs for testing

    start_time = time.perf_counter() 

    split_trip_plan = split_trip_plan(familyJSON, userID, trip_plan, specificRequests, activityIDs)

    elapsed_time = time.perf_counter() - start_time
    print(f"Response time: {elapsed_time:.2f} seconds")
    with open("split_trip.json", "w", encoding="utf-8") as output_file:
        output_file.write(split_trip_plan)
    """