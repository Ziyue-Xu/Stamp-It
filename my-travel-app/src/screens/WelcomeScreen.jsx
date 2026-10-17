

import { useEffect, useRef, useState } from "react";
import Stamp from "../components/Stamp";
import {
  TajMahalArt,
  LibertyArt,
  EiffelArt,
  ChapelArt,
  FujiArt,
  CathedralInk,
  BasilicaInk,
} from "../components/stampArt";
import "./WelcomeScreen.css";

const DESIGN_W = 390;
const DESIGN_H = 844;

export default function WelcomeScreen({ onStartTrip, onJoinTrip, onLogin }) {

  const [k, setK] = useState(1);
  useEffect(() => {
    const fit = () =>
      setK(
        Math.max(
          0.7,
          Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H, 1.4)
        )
      );
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);


  const stageRef = useRef(null);
  useEffect(() => {
    const onMove = (e) => {
      const el = stageRef.current;
      if (!el) return;
      el.style.setProperty("--px", ((e.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
      el.style.setProperty("--py", ((e.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div className="welcome">
      <div
        className="welcome-stage"
        ref={stageRef}
        style={{
          width: DESIGN_W,

          height: `max(780px, calc(100dvh / ${k}))`,
          transform: `scale(${k})`,
          marginLeft: -DESIGN_W / 2,
        }}
      >

        <div className="welcome-collage">
          <Stamp placed color="var(--pink)" x={22} y={26} w={128} h={158} rot={-1} depth={0.5} delay={0.1}>
            <TajMahalArt />
          </Stamp>
          <Stamp placed color="var(--gold)" x={214} y={14} w={142} h={172} rot={7} depth={0.8} delay={0.25}>
            <LibertyArt />
          </Stamp>
          <Stamp placed shape="ink" color="var(--ink)" x={12} y={214} w={120} h={136} rot={-4} depth={0.4} delay={0.4}>
            <CathedralInk />
          </Stamp>
          <Stamp placed color="var(--ink)" fill="var(--teal)" x={156} y={200} w={84} h={108} rot={1} depth={1.1} delay={0.55}>
            <ChapelArt />
          </Stamp>
          <Stamp placed color="var(--ink)" fill="var(--gold)" x={258} y={206} w={150} h={188} rot={6} depth={1.3} delay={0.7}>
            <EiffelArt />
          </Stamp>
          <Stamp placed shape="ink" color="var(--ink)" x={14} y={384} w={132} h={112} rot={-1} depth={0.6} delay={0.85}>
            <BasilicaInk />
          </Stamp>
          <Stamp placed color="var(--ink)" fill="var(--ink)" x={236} y={418} w={150} h={96} rot={3} depth={0.9} delay={1.0}>
            <FujiArt />
          </Stamp>
        </div>

   
        <div className="welcome-bottom">
          <h1 className="welcome-title rise" style={{ "--d": "1.2s" }}>
            Travel,
            <br />
            together
          </h1>
          <div className="welcome-tag rise" style={{ "--d": "1.35s" }}>
            GROUP TRIPS, MADE EASY
          </div>

          <div className="welcome-buttons rise" style={{ "--d": "1.5s" }}>
       
            <button type="button" className="btn btn-primary" onClick={onStartTrip}>
              Start a new trip
            </button>

   
            <button type="button" className="btn btn-secondary" onClick={onJoinTrip}>
              Join with a code
            </button>

            <button type="button" className="btn btn-secondary" onClick={onLogin}>
              Log in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}