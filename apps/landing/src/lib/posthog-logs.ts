export const landingLogger = {
  info(
    message: string,
    attributes?: Record<string, string | number | boolean>,
  ) {
    window.posthog?.logger?.info(message, attributes);
  },
};
