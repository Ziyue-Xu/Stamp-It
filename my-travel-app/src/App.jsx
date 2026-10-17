import Stamp from "./components/Stamp";
import { DESTINATION_STAMPS } from "./components/destinationStamps";
import { LandscapeArt } from "./components/stampArt";
 

const colors = {
  "--paper": "#3a3d5c",
  "--ink": "#f6ebcb",
  "--sky": "#474c70",
  "--gold": "#edb04c",
  "--teal": "#7fa46b",
  "--pink": "#efa3bb",
};

function App() {
  const ids = Object.keys(DESTINATION_STAMPS);
  return (
    <div
      style={{
        ...colors,
        minHeight: "100vh",
        background: "var(--paper)",
        color: "var(--ink)",
        padding: 40,
        display: "flex",
        flexWrap: "wrap",
        gap: 24,
        alignItems: "flex-start",
        fontFamily: "'Archivo', sans-serif",
      }}
    >
      {ids.map((id) => (
        <div key={id} style={{ textAlign: "center" }}>
          <Stamp color="var(--ink)" fill="var(--gold)" w={110} h={140} rot={-2}>
            {DESTINATION_STAMPS[id]}
          </Stamp>
          <div style={{ marginTop: 8, fontSize: 13 }}>{id}</div>
        </div>
      ))}
      <div style={{ textAlign: "center" }}>
        <Stamp color="var(--ink)" fill="var(--gold)" w={110} h={140} rot={2}>
          <LandscapeArt />
        </Stamp>
        <div style={{ marginTop: 8, fontSize: 13 }}>(everything else)</div>
      </div>
    </div>
  );
}

export default App;