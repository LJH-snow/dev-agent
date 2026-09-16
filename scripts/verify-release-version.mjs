import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RELEASE_TAG_PATTERN = new RegExp(`^v(${VERSION_PATTERN.source.slice(1, -1)})$`);

/**
 * Resolves a release version from a tag and, optionally, an explicit version.
 * The explicit value is only an assertion of the tag value; it is never read
 * from package metadata or a remote source.
 */
export function resolveReleaseVersion({ releaseTag, releaseVersion } = {}) {
  if (typeof releaseTag !== "string" || releaseTag.length === 0) {
    throw new Error("release tag is required");
  }
  if (!RELEASE_TAG_PATTERN.test(releaseTag)) {
    throw new Error(`release tag must be a semver tag such as v0.2.0: ${releaseTag}`);
  }

  const derivedVersion = releaseTag.slice(1);
  if (releaseVersion === undefined || releaseVersion === null || releaseVersion === "") {
    return { releaseTag, releaseVersion: derivedVersion };
  }
  if (typeof releaseVersion !== "string" || !VERSION_PATTERN.test(releaseVersion)) {
    throw new Error(`release version must be semver without the v prefix: ${releaseVersion}`);
  }
  if (releaseVersion !== derivedVersion) {
    throw new Error(
      `release version ${releaseVersion} does not match release tag ${releaseTag}`
    );
  }
  return { releaseTag, releaseVersion };
}

function parseArgs(argv) {
  const values = {};
  const aliases = new Map([
    ["--tag", "releaseTag"],
    ["--release-tag", "releaseTag"],
    ["--version", "releaseVersion"],
    ["--release-version", "releaseVersion"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equalIndex = argument.indexOf("=");
    const flag = equalIndex === -1 ? argument : argument.slice(0, equalIndex);
    const key = aliases.get(flag);
    if (!key) {
      throw new Error(`unknown argument: ${argument}`);
    }
    if (key in values) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    const value = equalIndex === -1 ? argv[++index] : argument.slice(equalIndex + 1);
    if (!value) {
      throw new Error(`argument requires a value: ${flag}`);
    }
    values[key] = value;
  }

  return values;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const releaseTag = options.releaseTag;
  const releaseVersion = options.releaseVersion;
  process.stdout.write(`${resolveReleaseVersion({ releaseTag, releaseVersion }).releaseVersion}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedFile === currentFile) {
  try {
    main();
  } catch (error) {
    console.error(`release version error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
