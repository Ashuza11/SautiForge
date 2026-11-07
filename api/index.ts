import { createAppFromEnvironment } from '../server/src/create-app';
import { createLazyEntry } from '../server/src/vercel-entry';

// One catch-all function: Vercel Hobby allows at most 12 functions.
export default createLazyEntry(() => createAppFromEnvironment(process.env).app);
