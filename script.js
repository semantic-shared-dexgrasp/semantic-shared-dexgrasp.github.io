const PLOTLY_URL = "https://cdn.plot.ly/plotly-gl3d-3.3.0.min.js";
const MANIFEST_URL = "assets/playground/manifest.json";
const playground = document.querySelector("[data-playground]");
const objectSelect = document.querySelector("#object-select");
const graspSelect = document.querySelector("#grasp-select");
const sampleStatus = document.querySelector("#sample-status");
const statusContainer = document.querySelector(".sample-status");
const generationPlot = document.querySelector("#generation-plot");
const motionPlot = document.querySelector("#motion-plot");
const resetButton = document.querySelector("#reset-cameras");

let plotlyPromise;
let playgroundSamples = [];
let plotsReady = false;
let activeSampleId = null;
let loadSequence = 0;

function setStatus(message, state = "ready") {
  sampleStatus.textContent = message;
  statusContainer.classList.toggle("is-loading", state === "loading");
  statusContainer.classList.toggle("is-error", state === "error");
}

function uniqueValues(items, key) {
  return [...new Map(items.map((item) => [item[key], item])).values()];
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function populateObjectOptions() {
  const objects = uniqueValues(playgroundSamples, "objectId");
  objectSelect.replaceChildren(
    ...objects.map((sample) =>
      createOption(sample.objectId, sample.objectLabel),
    ),
  );
  populateGraspOptions();
}

function populateGraspOptions(preferredGraspId) {
  const compatible = playgroundSamples.filter(
    (sample) => sample.objectId === objectSelect.value,
  );
  graspSelect.replaceChildren(
    ...compatible.map((sample) =>
      createOption(sample.graspId, sample.graspLabel),
    ),
  );
  if (
    preferredGraspId &&
    compatible.some((sample) => sample.graspId === preferredGraspId)
  ) {
    graspSelect.value = preferredGraspId;
  }
}

function selectedSample() {
  return playgroundSamples.find(
    (sample) =>
      sample.objectId === objectSelect.value &&
      sample.graspId === graspSelect.value,
  );
}

function loadPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  if (plotlyPromise) return plotlyPromise;

  plotlyPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PLOTLY_URL;
    script.async = true;
    script.onload = () => resolve(window.Plotly);
    script.onerror = () =>
      reject(new Error("The interactive viewer could not be loaded."));
    document.head.append(script);
  });
  return plotlyPromise;
}

async function fetchFigure(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Figure asset returned ${response.status}.`);
  }
  return response.json();
}

function siteLayout(figure) {
  return {
    ...figure.layout,
    autosize: true,
    width: undefined,
    height: undefined,
    title: undefined,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: {
      ...(figure.layout.font || {}),
      family: "Inter, Arial, sans-serif",
      color: "#344a50",
      size: 11,
    },
    margin: { l: 0, r: 0, t: 10, b: 0 },
    legend: {
      ...(figure.layout.legend || {}),
      bgcolor: "rgba(245,247,248,0.92)",
      bordercolor: "#d7dde1",
      borderwidth: 1,
      font: { size: 10, color: "#344a50" },
    },
  };
}

function siteConfig(figure) {
  return {
    ...figure.config,
    responsive: true,
    displaylogo: false,
    scrollZoom: true,
    modeBarButtonsToRemove: [
      "toImage",
      "sendDataToCloud",
      "hoverClosest3d",
    ],
  };
}

async function renderSample(sample) {
  if (!sample || sample.id === activeSampleId) return;

  const sequence = ++loadSequence;
  setStatus("Loading interactive sample…", "loading");

  try {
    const [Plotly, generationFigure, motionFigure] = await Promise.all([
      loadPlotly(),
      fetchFigure(sample.generation),
      fetchFigure(sample.motion),
    ]);
    if (sequence !== loadSequence) return;

    if (!plotsReady) {
      generationPlot.replaceChildren();
      motionPlot.replaceChildren();
    }
    const render = plotsReady ? Plotly.react : Plotly.newPlot;
    await Promise.all([
      render(
        generationPlot,
        generationFigure.data,
        siteLayout(generationFigure),
        siteConfig(generationFigure),
      ),
      render(
        motionPlot,
        motionFigure.data,
        siteLayout(motionFigure),
        siteConfig(motionFigure),
      ),
    ]);

    plotsReady = true;
    activeSampleId = sample.id;
    setStatus(`${sample.objectLabel} · ${sample.graspLabel}`);
  } catch (error) {
    console.error(error);
    setStatus(
      "Interactive view unavailable. Check your connection and refresh.",
      "error",
    );
  }
}

function resetCameras() {
  if (!plotsReady || !window.Plotly) return;
  window.Plotly.relayout(generationPlot, { "scene.camera": null });
  window.Plotly.relayout(motionPlot, { "scene.camera": null });
}

function observePlayground() {
  if (!("IntersectionObserver" in window)) {
    renderSample(selectedSample());
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        renderSample(selectedSample());
        observer.disconnect();
      }
    },
    { rootMargin: "500px 0px" },
  );
  observer.observe(playground);
}

function observeReveals() {
  const reveals = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    reveals.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 },
  );
  reveals.forEach((element) => observer.observe(element));
}

objectSelect.addEventListener("change", () => {
  populateGraspOptions();
  renderSample(selectedSample());
});

graspSelect.addEventListener("change", () => {
  renderSample(selectedSample());
});

resetButton.addEventListener("click", resetCameras);

observeReveals();

async function initializePlayground() {
  objectSelect.disabled = true;
  graspSelect.disabled = true;
  setStatus("Loading examples…", "loading");

  try {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) {
      throw new Error(`Manifest returned ${response.status}.`);
    }
    playgroundSamples = await response.json();
    if (playgroundSamples.length === 0) {
      throw new Error("The Playground manifest is empty.");
    }
    populateObjectOptions();
    objectSelect.disabled = false;
    graspSelect.disabled = false;
    setStatus("Ready to load");
    observePlayground();
  } catch (error) {
    console.error(error);
    setStatus("No Playground examples are available.", "error");
  }
}

initializePlayground();
