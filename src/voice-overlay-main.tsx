import React from "react";
import ReactDOM from "react-dom/client";
import { VoiceOverlayApp } from "./VoiceOverlayApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <VoiceOverlayApp />
  </React.StrictMode>
);
