/**
 * Vitest global setup. Runs once per test worker before any test file.
 *
 * We initialize i18next here so any component rendered via React Testing
 * Library resolves `t()` against real English strings (the default locale)
 * without each test file having to `import "src/frontend/i18n"` itself.
 * The init is idempotent — re-importing the module in a test file is a
 * no-op.
 */

import "../src/frontend/i18n";
