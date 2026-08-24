/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.e2e-spec.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
    // otplib zieht (transitiv) @scure/base und @noble/hashes nach, die
    // reines ESM ausliefern (kein "type": "module" gesetzt, aber
    // "export const ..."-Syntax) -- ohne diesen Eintrag stolpert Jests
    // CommonJS-Ladepfad genau darueber. ts-jest transformiert sie hier per
    // allowJs auf CommonJS herunter.
    "^.+\\.js$": [
      "ts-jest",
      { tsconfig: "<rootDir>/tsconfig.json", isolatedModules: true, compilerOptions: { allowJs: true } },
    ],
  },
  // pnpm legt Pakete unter node_modules/.pnpm/<name>@<version>/node_modules/<name>
  // ab -- das Ignore-Pattern muss diese verschachtelte Struktur kennen,
  // sonst greift schon das erste "node_modules/.pnpm/" in der Kette und die
  // Ausnahme fuer otplib & Co. weiter unten im Pfad wird nie erreicht.
  transformIgnorePatterns: ["node_modules/\\.pnpm/(?!(otplib@|@otplib\\+|@noble\\+|@scure\\+))"],
  setupFiles: ["<rootDir>/test/setup-env.ts"],
};
