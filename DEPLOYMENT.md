# Run and deploy Afterlight

Use the [public demo](https://starright00631-dev.github.io/afterlight/) to evaluate the application immediately. To run your own copy, choose the local application or the static browser edition below.

## Two environments

| Environment | Suitable use | Capabilities |
| --- | --- | --- |
| Local application | Personal work on the computer running Node | Studio, reading, review, planning, exports and optional configured assistance. The server binds to `127.0.0.1`. |
| Static browser edition | A public URL accessible from other computers | Core workspaces, in-browser PDF extraction and exports. Provider connections are disabled. Workspace records remain browser-local. |

`127.0.0.1` and `localhost` refer to each visitor's own computer. Sending someone your localhost URL does not send them your running application. A public deployment has its own HTTPS URL; visitors' work is not automatically shared or synchronized.

## Local installation and custom ports

Install Node **22.13+**, preferably **24 LTS**, then extract the complete folder. Do not copy only `index.html`. Paths with spaces are supported.

Windows:

```powershell
# Run in the extracted application folder.
.\Start-Afterlight.bat
# If the default port is occupied, select an unused port explicitly.
.\Start-Afterlight.bat -Port 5188
```

The launcher verifies Node, installs the locked dependencies when needed and prints/opens the chosen address. It will not stop another application or silently switch browser origins.

Terminal setup on any supported platform:

```bash
npm ci
npm start
```

Custom port in PowerShell:

```powershell
$env:PORT = '5188'
npm start
```

Custom port in a macOS/Linux shell:

```bash
PORT=5188 npm start
```

Open the address printed by the process. Keep its terminal open when using `npm start`; Ctrl+C stops it. For Windows launcher processes, the matching record in `.runtime/server-PORT.json` identifies the server you started. A different Afterlight version/folder on the selected port requires closing its own server or explicitly selecting another port.

Export **Backups and examples → Save backup (.json)** before changing hostname, port, browser or computer. Restore through the destination's backup dialog and confirm replacement. Each browser origin has separate storage. Do not open the HTML from disk.

## GitHub Pages

The full repository and independent submission copy include `.github/workflows/pages.yml`. It installs dependencies, runs application checks, builds `dist/pages`, uploads that directory and deploys it. A fresh repository must be configured to use GitHub Actions as its Pages source.

1. Fork the full repository, or place the **contents** of the submission folder at the root of a repository with a `main` branch. Include `.github/`, the lockfile, assets, licenses, tests and QA fixtures.
2. Enable Actions for the repository if prompted.
3. Open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**. These steps follow [GitHub's publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
4. Push to `main`, or run **Actions → Deploy Afterlight → Run workflow**. If your branch has another name, update the workflow's `on.push.branches` and any environment branch restriction accordingly.
5. Wait for the build and deploy jobs to succeed. Use the URL reported by the deployment and the Pages settings, rather than the original project's URL. For the usual project-site layout it is `https://YOUR_ACCOUNT.github.io/YOUR_REPOSITORY/`; a configured custom domain can differ.
6. Check the published `build-manifest.json`: its `version` should be `3.4.0`, with `capabilities.mode: "browser"`, `capabilities.assistants: false` and `capabilities.pdf: "browser"`. Open Studio, Week and Add a reading in the deployed application.

The workflow supplies the required `pages: write`, `id-token: write`, deployment environment and build dependency described in [GitHub's custom-workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Repository or organization policies can require a deployment approval. This guide does not change those settings for you.

## Another static host

On a build machine with Node installed, run:

```bash
npm ci
npm run build:pages
```

Publish **the contents of `dist/pages`** to an HTTP(S) static host. Keep the complete `vendor/pdfjs/` tree, `assets/`, licenses, `.nojekyll` and `build-manifest.json` together. Relative module and asset paths support a site subdirectory; no localhost address is compiled into this edition.

Serve `.js` and `.mjs` as JavaScript, `.wasm` as `application/wasm`, and preserve ordinary binary asset responses. The generated HTML contains a content-security policy; do not strip it. Do not serve the application source directory or the loopback Node service as a shortcut to public hosting.

Suggested host configuration:

| Setting | Value |
| --- | --- |
| Build command | `npm ci && npm run build:pages` |
| Publish/output directory | `dist/pages` |
| Build runtime | Node 24, or the documented supported Node version |
| Provider secrets | None for the static edition |

## Troubleshooting

| Symptom | Check |
| --- | --- |
| The local address does not open | Start the application on the same computer and use the printed port. Check Node and dependency installation. |
| The selected port is occupied | Choose an unused port explicitly; export your backup before moving an existing workspace. |
| A fork's public page is missing | Enable Actions, configure Pages to use GitHub Actions, check the branch and deployment jobs. |
| PDF worker/module fails to load | Publish the complete generated tree and verify `.mjs`/`.wasm` MIME types. |
| A changed deployment mixes old modules | Deploy the complete build atomically. The generated module URLs include a shared build identity; do not upload only one source file. |
| A public deployment asks for a provider key | Verify you published the generated static edition and its capability module, not local server files. |
| My records are absent on another device | Storage is local to each browser origin. Move your own workspace with explicit JSON backup/restore. |
