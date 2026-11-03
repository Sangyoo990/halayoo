import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import "./office.css";
import App from "./App";
import { COMPANY } from "../company.config";

document.title = COMPANY.pageTitle;
document.querySelector('meta[name="description"]')?.remove();
const meta = document.createElement("meta");
meta.name = "description";
meta.content = COMPANY.description;
document.head.appendChild(meta);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
