const project = document.querySelector<HTMLMetaElement>(
  'meta[name="framio-project"]',
)?.content;
const key = (name: string) => `framio:${project}:${name}`;

export const projectSession = {
  getItem(name: string): string | null {
    try {
      return project ? sessionStorage.getItem(key(name)) : null;
    } catch {
      return null;
    }
  },
  setItem(name: string, value: string): void {
    try {
      if (project) sessionStorage.setItem(key(name), value);
    } catch {}
  },
  removeItem(name: string): void {
    try {
      if (project) sessionStorage.removeItem(key(name));
    } catch {}
  },
};
