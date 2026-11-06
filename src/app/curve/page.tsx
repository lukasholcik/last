import { type Metadata } from "next";
import { CurveLab } from "./CurveLab";

export const metadata: Metadata = {
  title: "Curve lab",
  description:
    "Model any Bezier curve with add, drag and per-point handle modes",
};

export default function CurvePage() {
  return <CurveLab />;
}
