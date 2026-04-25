import type { Config } from "tailwindcss";
import base from "../../tailwind.config";

export default {
  ...base,
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}", "../../packages/ui/**/*.{ts,tsx}"],
} satisfies Config;
