import { useState, type ReactNode } from "react";
import styles from "./EditorTabs.module.css";

export function EditorTabs({
  last,
  heel,
}: {
  last: ReactNode;
  heel: (editLast: () => void) => ReactNode;
}) {
  const [selected, setSelected] = useState<"last" | "heel">("last");
  const [heelOpened, setHeelOpened] = useState(false);
  function choose(tab: "last" | "heel", focus = false) {
    setSelected(tab);
    if (tab === "heel") setHeelOpened(true);
    if (focus) document.getElementById(`${tab}-tab`)?.focus();
  }
  return (
    <main>
      <div className={styles.bar}>
        <div className={styles.tabs} role="tablist" aria-label="Design editor">
          {(["last", "heel"] as const).map((tab) => (
            <button
              key={tab}
              id={`${tab}-tab`}
              type="button"
              role="tab"
              aria-selected={selected === tab}
              aria-controls={`${tab}-panel`}
              tabIndex={selected === tab ? 0 : -1}
              onClick={() => choose(tab)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                choose(
                  event.key === "Home"
                    ? "last"
                    : event.key === "End"
                      ? "heel"
                      : tab === "last"
                        ? "heel"
                        : "last",
                  true,
                );
              }}
            >
              {tab === "last" ? "Last" : "Heel"}
            </button>
          ))}
        </div>
        <p>Last defines the attachment. Heel shapes the body.</p>
      </div>
      <div
        id="last-panel"
        role="tabpanel"
        aria-labelledby="last-tab"
        hidden={selected !== "last"}
        tabIndex={0}
      >
        {last}
      </div>
      <div
        id="heel-panel"
        role="tabpanel"
        aria-labelledby="heel-tab"
        hidden={selected !== "heel"}
        tabIndex={0}
      >
        {heelOpened ? heel(() => choose("last", true)) : null}
      </div>
    </main>
  );
}
