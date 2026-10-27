/**
 * The universal deny list: paths that are refused even inside an allowed prefix.
 *
 * The same list is compiled case-insensitively here and in the reference gateway, so the two
 * cannot drift apart on a capitalised name. Compiled from regular expression sources, because
 * JavaScript has no inline (?i) flag.
 */
export const DEFAULT_DENY: string[] = [
  "(^|/)\\.git(/|$)",
  "(^|/)\\.github/",
  "(^|/)\\.env",
  "(^|/)(secrets?|credentials?)(\\.|/|$)",
  "\\.(pem|key|p12)$",
  "(^|/)__pycache__(/|$)",
  "\\.pyc$",
];
