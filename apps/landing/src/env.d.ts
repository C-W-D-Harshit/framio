interface Window {
  posthog?: {
    capture: (event: string, properties?: Record<string, unknown>) => void;
    logger?: {
      info: (
        message: string,
        attributes?: Record<string, string | number | boolean>,
      ) => void;
    };
  };
}
