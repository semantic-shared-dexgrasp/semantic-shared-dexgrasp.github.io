# Semantic-Aware Shared Control — Project Website

Static GitHub Pages site for **Semantic-Aware Shared Control for Functional
Dexterous Grasping**.

The site has no build step. Open `index.html` through a local web server:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000>.

## Add a Playground sample

Name each raw pair using:

```text
object_category_object-id_grasp_type_generation_raw.html
object_category_object-id_grasp_type_motion_raw.html
```

Place the files in `temp/playground_raw/`, then run:

```bash
node scripts/prepare_all_playground_assets.mjs
```

The script rebuilds the compact assets and `assets/playground/manifest.json`.
The page reads this manifest to populate the linked Object and Grasp type
selectors. Only processed JSON assets are published; raw standalone Plotly HTML
files remain excluded by `.gitignore`.

## License

The original website source code in this repository is released under the
[MIT License](LICENSE).

Figures, videos, Plotly exports, derived visualization data, fonts, icons, and
other assets may originate from the associated research project or third-party
software. Those materials remain subject to their respective upstream licenses,
terms, and attribution requirements. The MIT License for this website does not
relicense assets or code for which the website authors do not hold the necessary
rights. Refer to the
[research code repository](https://github.com/semantic-shared-dexgrasp/semantic_shared_dexgrasp)
and the original providers for the applicable terms.
