import { createBrowserRouter, createHashRouter } from 'react-router';

/**
 * The preview build (VITE_PREVIEW=1) is a static copy of the app with the mock
 * API, opened from any URL: it routes on the #hash so no server rewrite is needed.
 */
export const createAppRouter: typeof createBrowserRouter = import.meta.env.VITE_PREVIEW === '1' ? createHashRouter : createBrowserRouter;
