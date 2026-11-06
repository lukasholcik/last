"use client";

import dynamic from "next/dynamic";

// Client-only: the document autosaves to and restores from localStorage.
const Studio = dynamic(() => import("./Studio").then((m) => m.Studio), {
  ssr: false,
});

export function StudioLoader() {
  return <Studio />;
}
