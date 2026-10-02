/** Only iframe windows registered by canvas nodes may send frame messages. */
const sources = new Map<Window, HTMLIFrameElement>();
export function registerFrame(iframe: HTMLIFrameElement) {
  const source = iframe.contentWindow;
  if (!source) return () => {};
  sources.set(source, iframe);
  return () => {
    if (sources.get(source) === iframe) sources.delete(source);
  };
}
export function sourceFrame(source: MessageEventSource | null, id: string) {
  const iframe = sources.get(source as Window);
  return iframe?.isConnected && iframe.dataset.frame === id
    ? iframe
    : undefined;
}
