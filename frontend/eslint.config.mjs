import next from "eslint-config-next";
import prettier from "eslint-config-prettier";

// eslint-config-next 16 ships native flat configs (core-web-vitals + typescript),
// so we use them directly. `prettier` disables formatting rules that conflict.
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...next,
  prettier,
];

export default eslintConfig;
