/**
 * Environment Loader
 *
 * Loads variables from server/.env before any other module evaluates process.env.
 * Import this module first in every server entrypoint (API, Worker, MCP).
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });
