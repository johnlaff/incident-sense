import next from "eslint-config-next";
import prettier from "eslint-config-prettier";

// eslint-config-next 16 ships native flat configs (core-web-vitals + typescript),
// so we use them directly. `prettier` disables formatting rules that conflict.
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...next,
  prettier,
  {
    // This didactic UI intentionally drives animation timelines and reads
    // pre-hydration / external state (the theme attribute set by the no-flash
    // inline script, route changes) from mount effects. The newly-added
    // `set-state-in-effect` rule flags those legitimate, well-understood
    // patterns; the other react-hooks rules (rules-of-hooks, exhaustive-deps)
    // stay on. Media-query reads use useSyncExternalStore instead (see motion.ts).
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
];

export default eslintConfig;
