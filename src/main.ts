import { mount, unmount } from 'svelte';
import App from './app/App.svelte';
import './app/app.css';

function lockPortraitOrientation(): void {
  try {
    if (
      typeof screen !== 'undefined' &&
      screen.orientation &&
      typeof screen.orientation.lock === 'function'
    ) {
      screen.orientation.lock('portrait').catch(() => {});
    }
  } catch {}
}

function bootstrapApplication(): Record<string, any> | null {
  try {
    if (typeof document === 'undefined') return null;
    const appElement = document.getElementById('app');
    if (!appElement) return null;

    const instance = mount(App, { target: appElement });
    lockPortraitOrientation();

    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        try {
          unmount(instance);
        } catch {}
      });
    }

    return instance;
  } catch {
    return null;
  }
}

const app = bootstrapApplication();

export default app;
