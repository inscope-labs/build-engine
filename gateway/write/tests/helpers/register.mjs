/**
 * Register the markdown loader hook.
 *
 * `node --import ./tests/helpers/register.mjs --test ...`
 */
import { register } from "node:module";

register("./md-loader.mjs", import.meta.url);
