/** Only product diagnostics belong in telemetry. Never include source excerpts. */
export const scrubTelemetryText = (value: string) => {
  const first = value.split(/\r?\n/)[0]!;
  if (
    /(?:<\/?[A-Za-z][^>]*>|\b(?:const|let|function|import|export)\s|^\s*\d+\s*\|)/.test(
      first,
    )
  )
    return "Source diagnostic omitted";
  return first
    .replace(/(['"`]).*?\1/g, "[value]")
    .replace(/https?:\/\/[^\s)"']+/gi, "[url]")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^\r\n]*/g, "[path]")
    .replace(/\b(?:ph[cp]_\w+|Bearer\s+\S+)/gi, "[redacted]")
    .replace(/([\w.+-]+)@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, 300);
};
