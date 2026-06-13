import { createLogger } from '@mapart/logger';

/**
 * Server-side logger for apps/web — route handlers and server actions.
 *
 * Server-only: it reads the environment and writes to the process streams, so
 * never import it from a Client Component (those run in the browser). Client
 * code keeps using `console`.
 */
export const log = createLogger('web');
