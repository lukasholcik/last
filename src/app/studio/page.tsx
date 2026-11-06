import { type Metadata } from "next";
import { StudioLoader } from "./StudioLoader";

export const metadata: Metadata = {
  title: "Last studio",
  description: "CAD-style workspace for modelling a last, one view at a time",
};

export default function StudioPage() {
  return <StudioLoader />;
}
