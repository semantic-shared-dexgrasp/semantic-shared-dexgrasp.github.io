#!/usr/bin/env node

import { readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rawDirectory = resolve(root, "temp/playground_raw");
const outputDirectory = resolve(root, "assets/playground");
const filenamePattern =
  /^(?<object>.+)_(?<objectId>\d+)_(?<grasp>.+)_(?<kind>generation|motion)_raw\.html$/;

function slug(value) {
  return value.replaceAll("_", "-").toLowerCase();
}

function label(value) {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function runProcessor(input, output, kind) {
  const argumentsList = [
    resolve(root, "scripts/prepare_plotly_asset.mjs"),
    input,
    output,
  ];
  if (kind === "generation") {
    argumentsList.push("--max-generated-meshes", "8");
  } else {
    argumentsList.push("--max-trajectory-meshes", "5");
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, argumentsList, { stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Asset processor exited with code ${code}`));
    });
  });
}

async function main() {
  const rawFiles = await readdir(rawDirectory);
  const samples = new Map();

  for (const filename of rawFiles.sort()) {
    const match = filename.match(filenamePattern);
    if (!match?.groups) continue;
    const { object, objectId, grasp, kind } = match.groups;
    const id = `${slug(object)}-${objectId}-${slug(grasp)}`;
    const sample = samples.get(id) ?? {
      id,
      objectId: slug(object),
      objectLabel: label(object),
      graspId: slug(grasp),
      graspLabel: label(grasp),
      sourceObjectId: objectId,
    };
    sample[kind] = {
      input: resolve(rawDirectory, filename),
      output: resolve(outputDirectory, `${id}-${kind}.plotly.json`),
      publicPath: `assets/playground/${id}-${kind}.plotly.json`,
    };
    samples.set(id, sample);
  }

  const completeSamples = [...samples.values()].filter(
    (sample) => sample.generation && sample.motion,
  );
  if (completeSamples.length === 0) {
    throw new Error(`No complete generation/motion pairs found in ${rawDirectory}`);
  }

  await rm(outputDirectory, { recursive: true, force: true });
  for (const sample of completeSamples) {
    await runProcessor(
      sample.generation.input,
      sample.generation.output,
      "generation",
    );
    await runProcessor(sample.motion.input, sample.motion.output, "motion");
  }

  const manifest = completeSamples
    .map((sample) => ({
      id: sample.id,
      objectId: sample.objectId,
      objectLabel: sample.objectLabel,
      graspId: sample.graspId,
      graspLabel: sample.graspLabel,
      sourceObjectId: sample.sourceObjectId,
      generation: sample.generation.publicPath,
      motion: sample.motion.publicPath,
    }))
    .sort(
      (a, b) =>
        a.objectLabel.localeCompare(b.objectLabel) ||
        a.graspLabel.localeCompare(b.graspLabel),
    );

  await writeFile(
    resolve(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(`Prepared ${manifest.length} Playground samples.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
