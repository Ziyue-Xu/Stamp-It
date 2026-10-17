import { useState } from "react";
import CreateTripScreen from "./screens/CreateTripScreen";
import ShareCodeScreen from "./screens/ShareCodeScreen";
import { createTrip } from "./api/tripApi";

function App() {
  const [destinationId, setDestinationId] = useState(null);
  const [trip, setTrip] = useState(null);

  if (trip) {
    return <ShareCodeScreen trip={trip} onContinue={() => setTrip(null)} />;
  }

  return (
    <CreateTripScreen
      selectedId={destinationId}
      onSelect={setDestinationId}
      onCreate={async (data) => {

        setTrip(await createTrip({ destinationId, ...data }));
      }}
      onBack={() => {}}
    />
  );
}

export default App;