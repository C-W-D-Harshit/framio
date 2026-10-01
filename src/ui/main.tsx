import { createRoot } from "react-dom/client";
import { RegistryProvider } from "@effect/atom-react";
import { App } from "./app";

createRoot(document.getElementById("app")!).render(<RegistryProvider><App /></RegistryProvider>);
