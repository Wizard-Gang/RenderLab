import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const mount = document.querySelector<HTMLElement>("#app");
if (!mount) throw new Error("RenderLab mount point is missing");

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
