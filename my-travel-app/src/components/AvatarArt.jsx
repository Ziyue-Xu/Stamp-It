

import "./Avatar.css";
import {
  TajMahalArt,
  LibertyArt,
  EiffelArt,
  FujiArt,
  ColosseumArt,
  ParthenonArt,
  BlueMosqueArt,
  GreatWallArt,
  SagradaArt,
  BelemArt,
} from "./stampArt";

const AVATAR_ART = {
  taj: TajMahalArt,
  liberty: LibertyArt,
  eiffel: EiffelArt,
  fuji: FujiArt,
  colosseum: ColosseumArt,
  parthenon: ParthenonArt,
  mosque: BlueMosqueArt,
  greatwall: GreatWallArt,
  sagrada: SagradaArt,
  belem: BelemArt,
};

export default function AvatarArt({ id }) {
  const Art = AVATAR_ART[id] || TajMahalArt;
  return <Art />;
}