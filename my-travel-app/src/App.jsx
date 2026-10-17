import Stamp from "./components/Stamp";

const colors = {
  "--paper": "#3a3d5c",
  "--ink": "#f6ebcb",
  "--sky": "#474c70",
  "--gold": "#edb04c",
  "--teal": "#7fa46b",
  "--pink": "#efa3bb",
};

function App() {
  return (
    <div
      style={{
        ...colors,
        minHeight: "100vh",
        background: "var(--paper)",
        color: "var(--ink)",
        padding: 40,
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        fontFamily: "'Archivo', sans-serif",
      }}
    >
      <Stamp color="var(--pink)" w={110} h={140} rot={-4}>
        <div style={{ color: "#3a3d5c", fontWeight: 900, padding: 6 }}>PINK</div>
      </Stamp>
      <Stamp color="var(--gold)" w={110} h={140} rot={3}>
        <div style={{ color: "#3a3d5c", fontWeight: 900, padding: 6 }}>MUSTARD</div>
      </Stamp>
      <Stamp color="var(--ink)" fill="var(--teal)" w={110} h={140} rot={-2}>
        <div style={{ color: "#3a3d5c", fontWeight: 900, padding: 6 }}>SAGE</div>
      </Stamp>
      <Stamp color="var(--gold)" shape="ink" w={110} h={140} rot={2}>
        INK
      </Stamp>
    </div>
  );
}

export default App;