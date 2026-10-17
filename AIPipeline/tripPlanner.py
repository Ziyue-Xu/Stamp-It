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

class DayPlan(BaseModel):
    day_number: int
    date: str = Field(description="YYYY-MM-DD")
    base_city: str
    day_theme_or_summary: str
    timeline: List[TimelineItem]

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
def generate_trip_plan(request: str, familyJSON: dict) -> str:
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
            "thinking_level": "medium"
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


if __name__ == "__main__":
    # Load the family JSON data
    with open("family_1.json", "r", encoding="utf-8") as family_file:
        familyJSON = json.load(family_file)
    start_time = time.perf_counter()

    trip_plan = generate_trip_plan(tripPrompts.generationPrompt, familyJSON)
    
    elapsed_time = time.perf_counter() - start_time

    print(f"Response time: {elapsed_time:.2f} seconds")
    with open("trip.json", "w", encoding="utf-8") as output_file:
        output_file.write(trip_plan)