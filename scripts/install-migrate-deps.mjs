import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Read the app manifest under its non-manifest name so npm does not treat it as
// this directory's package.json and install the whole app dependency tree.
const pkg = JSON.parse(readFileSync("./app-package.json", "utf8"));
const drizzleVersion = pkg.dependencies["drizzle-orm"].replace("^", "");
const pgVersion = pkg.dependencies["pg"].replace("^", "");

execFileSync("npm", ["init", "-y"], { stdio: "inherit" });
execFileSync(
  "npm",
  ["install", "--save-exact", `drizzle-orm@${drizzleVersion}`, `pg@${pgVersion}`],
  { stdio: "inherit" },
);
