/** Only iframe windows registered by canvas nodes may send frame messages. */
const sources = new Map<Window, HTMLIFrameElement>();
export const registeredFrames = () =>
  [...sources.values()].filter((iframe) => iframe.isConnected);
export const frameTextEditing = () =>
  registeredFrames().some(
    (iframe) =>
      iframe.dataset.shown === "true" && iframe.dataset.textEditing === "true",
  );
export const displayedFrame = (id: string) =>
  registeredFrames().find(
    (iframe) => iframe.dataset.frame === id && iframe.dataset.shown === "true",
  );
export function registerFrame(iframe: HTMLIFrameElement) {
  const source = iframe.contentWindow;
  if (!source) return () => {};
  sources.set(source, iframe);
  return () => {
    if (sources.get(source) === iframe) sources.delete(source);
    window.dispatchEvent(new Event("framio:frame-documents"));
  };
}
export function sourceFrame(source: MessageEventSource | null, id: string) {
  const iframe = sources.get(source as Window);
  return iframe?.isConnected && iframe.dataset.frame === id
    ? iframe
    : undefined;
}
