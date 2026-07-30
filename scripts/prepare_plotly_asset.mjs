#!/usr/bin/env node

/**
 * Convert a standalone Plotly HTML export into a compact figure JSON asset.
 *
 * The script removes the duplicated Plotly runtime and can reduce repeated MANO
 * or Allegro mesh snapshots while preserving point clouds, trajectories,
 * reference grasps, layout, and camera interaction.
 *
 * Usage:
 *   node scripts/prepare_plotly_asset.mjs input.html output.plotly.json
 *   node scripts/prepare_plotly_asset.mjs input.html output.plotly.json \
 *     --max-generated-meshes 10 --max-trajectory-meshes 6
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

function printUsage() {
  console.error(
    "Usage: node scripts/prepare_plotly_asset.mjs INPUT.html OUTPUT.json " +
      "[--max-generated-meshes N] [--max-trajectory-meshes N]",
  );
}

function parsePositiveInteger(value, option) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} requires a positive integer, received ${value}`);
  }
  return parsed;
}

function parseCommandLine(argumentsList) {
  if (argumentsList.length < 2) {
    printUsage();
    process.exitCode = 2;
    return null;
  }

  const options = {
    inputPath: resolve(argumentsList[0]),
    outputPath: resolve(argumentsList[1]),
    maxGeneratedMeshes: null,
    maxTrajectoryMeshes: null,
  };
  for (let index = 2; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    const value = argumentsList[index + 1];
    if (option === "--max-generated-meshes") {
      options.maxGeneratedMeshes = parsePositiveInteger(value, option);
      index += 1;
    } else if (option === "--max-trajectory-meshes") {
      options.maxTrajectoryMeshes = parsePositiveInteger(value, option);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  return options;
}

function splitCallArguments(source, openingParenthesis) {
  const values = [];
  let currentStart = openingParenthesis + 1;
  let squareDepth = 0;
  let curlyDepth = 0;
  let roundDepth = 0;
  let quote = null;
  let escaped = false;

  for (let index = currentStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "[") {
      squareDepth += 1;
    } else if (character === "]") {
      squareDepth -= 1;
    } else if (character === "{") {
      curlyDepth += 1;
    } else if (character === "}") {
      curlyDepth -= 1;
    } else if (character === "(") {
      roundDepth += 1;
    } else if (character === ")" && roundDepth > 0) {
      roundDepth -= 1;
    } else if (
      character === ")" &&
      squareDepth === 0 &&
      curlyDepth === 0 &&
      roundDepth === 0
    ) {
      values.push(source.slice(currentStart, index).trim());
      return values;
    } else if (
      character === "," &&
      squareDepth === 0 &&
      curlyDepth === 0 &&
      roundDepth === 0
    ) {
      values.push(source.slice(currentStart, index).trim());
      currentStart = index + 1;
    }
  }
  throw new Error("Could not find the end of Plotly.newPlot(...)");
}

function extractFigure(html) {
  const marker = "Plotly.newPlot(";
  // Standalone exports contain the minified Plotly runtime before the actual
  // page-level call, so the final occurrence is the figure initialization.
  const markerIndex = html.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error("Input does not contain a Plotly.newPlot(...) call");
  }
  const openingParenthesis = markerIndex + marker.length - 1;
  const argumentsList = splitCallArguments(html, openingParenthesis);
  if (argumentsList.length < 3) {
    throw new Error(
      `Expected at least three Plotly.newPlot arguments, found ${argumentsList.length}`,
    );
  }

  return {
    data: JSON.parse(argumentsList[1]),
    layout: JSON.parse(argumentsList[2]),
    config: argumentsList[3] ? JSON.parse(argumentsList[3]) : {},
  };
}

function evenlySpacedIndices(indices, count) {
  if (indices.length <= count) {
    return indices;
  }
  if (count === 1) {
    return [indices[indices.length - 1]];
  }
  const selected = new Set();
  for (let index = 0; index < count; index += 1) {
    const position = Math.round((index * (indices.length - 1)) / (count - 1));
    selected.add(indices[position]);
  }
  return [...selected];
}

function limitRepeatedMeshes(figure, options) {
  const generatedIndices = [];
  const trajectoryIndices = [];
  figure.data.forEach((trace, index) => {
    const name = String(trace.name ?? "");
    if (trace.type === "mesh3d" && name.startsWith("GMM component")) {
      generatedIndices.push(index);
    } else if (trace.type === "mesh3d" && name.startsWith("Allegro hand")) {
      trajectoryIndices.push(index);
    }
  });

  const retainedIndices = new Set(figure.data.map((_, index) => index));
  if (
    options.maxGeneratedMeshes !== null &&
    generatedIndices.length > options.maxGeneratedMeshes
  ) {
    // The generator writes meshes in a component-balanced order.
    const selected = new Set(
      generatedIndices.slice(0, options.maxGeneratedMeshes),
    );
    generatedIndices.forEach((index) => {
      if (!selected.has(index)) {
        retainedIndices.delete(index);
      }
    });
  }
  if (
    options.maxTrajectoryMeshes !== null &&
    trajectoryIndices.length > options.maxTrajectoryMeshes
  ) {
    const selected = new Set(
      evenlySpacedIndices(
        trajectoryIndices,
        options.maxTrajectoryMeshes,
      ),
    );
    trajectoryIndices.forEach((index) => {
      if (!selected.has(index)) {
        retainedIndices.delete(index);
      }
    });
  }

  const originalTraceCount = figure.data.length;
  figure.data = figure.data.filter((_, index) => retainedIndices.has(index));
  return {
    originalTraceCount,
    retainedTraceCount: figure.data.length,
    removedTraceCount: originalTraceCount - figure.data.length,
  };
}

function normalizeFigureLayout(figure) {
  const axisStyle = (axis, title) => ({
    ...(axis ?? {}),
    title: {
      ...(axis?.title ?? {}),
      text: title,
      font: {
        ...(axis?.title?.font ?? {}),
        family: "Inter, Arial, sans-serif",
        size: 12,
        color: "#4f5a61",
      },
    },
    backgroundcolor: "#ffffff",
    gridcolor: "#dfe4e7",
    zerolinecolor: "#c7d0d5",
    showbackground: true,
    tickfont: {
      ...(axis?.tickfont ?? {}),
      family: "Inter, Arial, sans-serif",
      size: 10,
      color: "#566169",
    },
  });

  figure.layout = {
    ...figure.layout,
    width: undefined,
    height: undefined,
    title: undefined,
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: {
      ...(figure.layout.font ?? {}),
      family: "Inter, Arial, sans-serif",
      color: "#39444a",
    },
    margin: { l: 0, r: 0, b: 0, t: 0 },
    scene: {
      ...(figure.layout.scene ?? {}),
      bgcolor: "#ffffff",
      domain: { x: [0, 1], y: [0, 1] },
      xaxis: axisStyle(figure.layout.scene?.xaxis, "X (m)"),
      yaxis: axisStyle(figure.layout.scene?.yaxis, "Y (m)"),
      zaxis: axisStyle(figure.layout.scene?.zaxis, "Z (m)"),
    },
    legend: {
      ...(figure.layout.legend ?? {}),
      x: 0.985,
      y: 0.985,
      xanchor: "right",
      yanchor: "top",
      orientation: "v",
      bgcolor: "rgba(245,247,248,0.92)",
      bordercolor: "#d7dde1",
      borderwidth: 1,
      font: {
        ...(figure.layout.legend?.font ?? {}),
        family: "Inter, Arial, sans-serif",
        size: 10,
        color: "#39444a",
      },
      itemsizing: "constant",
      tracegroupgap: 3,
    },
    hoverlabel: {
      ...(figure.layout.hoverlabel ?? {}),
      font: { family: "Inter, Arial, sans-serif", size: 11 },
    },
  };
}

async function main() {
  const options = parseCommandLine(process.argv.slice(2));
  if (options === null) {
    return;
  }
  const html = await readFile(options.inputPath, "utf8");
  const figure = extractFigure(html);
  const traceSummary = limitRepeatedMeshes(figure, options);
  normalizeFigureLayout(figure);

  figure.config = {
    ...figure.config,
    displaylogo: false,
    responsive: true,
    scrollZoom: true,
  };
  const serialized = `${JSON.stringify(figure)}\n`;
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, serialized, "utf8");

  const inputMiB = Buffer.byteLength(html) / 1024 / 1024;
  const outputMiB = Buffer.byteLength(serialized) / 1024 / 1024;
  console.log(`Input:  ${options.inputPath} (${inputMiB.toFixed(2)} MiB)`);
  console.log(`Output: ${options.outputPath} (${outputMiB.toFixed(2)} MiB)`);
  console.log(
    `Traces: ${traceSummary.originalTraceCount} -> ${traceSummary.retainedTraceCount} ` +
      `(${traceSummary.removedTraceCount} removed)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
