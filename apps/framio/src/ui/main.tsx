import { createRoot } from "react-dom/client";
import { RegistryProvider } from "@effect/atom-react";
import { App } from "./app";
import { startAnalytics } from "./services/analytics";

startAnalytics();

createRoot(document.getElementById("app")!).render(
  <RegistryProvider>
    <App />
  </RegistryProvider>,
);
