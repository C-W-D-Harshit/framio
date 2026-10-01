export const Policies = {
  firstPort: 4747,
  portCount: 100,
  startupTimeout: "30 seconds",
  startupPoll: "100 millis",
  healthTimeout: "1 second",
  stopTimeout: "10 seconds",
  rebuildQuietWindow: "60 millis",
  rebuildMaxWait: "500 millis",
  browserIdleTTL: "5 minutes",
  captureConcurrency: 4,
  renderTimeout: "20 seconds",
  pageMaxWidth: 3200,
} as const;
