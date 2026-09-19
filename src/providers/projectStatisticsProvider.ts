/**
 * Project Statistics Dashboard — webview panel showing live project metrics.
 *
 * Follows the standalone webview panel pattern established by libraryBrowserProvider.ts.
 * Successor to jMashProjectProfile's HTML reports, upgraded with interactive Chart.js charts.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { loadWorkspaceProjectConfig, B4xProjectConfig } from '../projectFile';
import { WorkspaceClassStore } from '../workspaceClassIndex';
import { XmlLibraryStore } from '../xmlLibraryIndex';
import { collectStatistics, ProjectStatistics } from '../projectStatisticsCore';

export class ProjectStatisticsProvider {
  private panel: vscode.WebviewPanel | undefined;
  private readonly viewType = 'b4x-project-statistics';
  private refreshVersion = 0;

  constructor(
    private readonly workspaceClasses: WorkspaceClassStore,
    private readonly xmlLibraries: XmlLibraryStore,
    private readonly extensionUri: vscode.Uri,
    private readonly context?: vscode.ExtensionContext,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      this.viewType,
      'Project Statistics',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'media'),
        ],
      },
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    // Immediately trigger data load
    void this.updateData();

    this.panel.webview.onDidReceiveMessage(async (msg: { type: string }) => {
      if (msg.type === 'refresh') {
        try {
          await this.updateData();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.panel?.webview.postMessage({ type: 'error', message });
        }
      }
    });
  }

  private async updateData(): Promise<void> {
    if (!this.panel) return;

    // Debounce: stale refresh results are discarded
    const version = ++this.refreshVersion;
    const { stats, projectName, projectPath } = await this.collectStatistics();
    if (version !== this.refreshVersion || !this.panel) return;

    if (projectName) {
      this.panel.title = `Statistics - ${projectName}`;
    }

    this.panel.webview.postMessage({
      type: 'updateStatistics',
      statistics: stats,
      projectName,
      projectPath,
    });
  }

  private async collectStatistics(): Promise<{ stats: ProjectStatistics; projectName: string; projectPath: string }> {
    const files = new Map<string, string>();

    const cfg = vscode.workspace.getConfiguration('b4xIntellisense');
    const sharedFolder = cfg.get<string>('sharedModulesFolder', '');
    const sharedFolders = sharedFolder ? [sharedFolder] : [];

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0]!.uri.fsPath : undefined;

    const activeEditor = vscode.window.activeTextEditor;
    const activeDocUri = activeEditor?.document?.uri;

    // Resolve target project file URI
    let targetProjectUri: vscode.Uri | undefined;

    // 1. If active editor is a B4X document or project file, use it
    if (activeDocUri && (activeEditor?.document?.languageId === 'b4x' || /\.(b4a|b4j|b4i|b4r)$/i.test(activeDocUri.fsPath))) {
      targetProjectUri = activeDocUri;
    }

    // 2. If not, check last opened project file from global state
    if (!targetProjectUri && this.context) {
      const lastOpened = this.context.globalState.get<string>('b4x.lastOpenedProjectFile');
      if (lastOpened && fs.existsSync(lastOpened)) {
        targetProjectUri = vscode.Uri.file(lastOpened);
      }
    }

    // 3. If still not found, search workspace for B4X project files (.b4a, .b4j, .b4i, .b4r)
    if (!targetProjectUri) {
      const foundProjectFiles = await vscode.workspace.findFiles('**/*.{b4a,b4j,b4i,b4r}', '**/Objects/**');
      if (foundProjectFiles.length > 0) {
        if (rootPath) {
          const rootBase = path.basename(rootPath).toLowerCase();
          const match = foundProjectFiles.find(f => path.basename(f.fsPath, path.extname(f.fsPath)).toLowerCase() === rootBase);
          targetProjectUri = match ?? foundProjectFiles[0];
        } else {
          targetProjectUri = foundProjectFiles[0];
        }
      }
    }

    let projectConfig: B4xProjectConfig | undefined;
    if (targetProjectUri) {
      try {
        projectConfig = await loadWorkspaceProjectConfig(sharedFolders, targetProjectUri);
      } catch {
        // ignore
      }
    }

    let projectName = 'Workspace';
    let projectPath = '';

    if (projectConfig && projectConfig.projectFilePath) {
      projectPath = projectConfig.projectFilePath;
      projectName = path.basename(projectConfig.projectFilePath, path.extname(projectConfig.projectFilePath));
      const projectDir = projectConfig.projectDirectory || (rootPath ?? path.dirname(projectConfig.projectFilePath));

      // 1. Collect all module files explicitly declared in the current project
      const moduleFiles = projectConfig.allowedModuleFiles || [];
      for (const modPath of moduleFiles) {
        try {
          if (fs.existsSync(modPath)) {
            const content = await fs.promises.readFile(modPath, 'utf-8');
            const modName = path.basename(modPath);
            files.set(modName, content);
          }
        } catch {
          // Skip unreadable files
        }
      }

      // 2. Add Main module code if embedded inside the project file after @EndOfDesignText@
      try {
        const projContent = await fs.promises.readFile(projectConfig.projectFilePath, 'utf-8');
        const marker = '@EndOfDesignText@';
        const markerIdx = projContent.indexOf(marker);
        if (markerIdx !== -1) {
          const mainBody = projContent.substring(markerIdx + marker.length).trim();
          if (mainBody && !files.has('Main.bas')) {
            files.set('Main.bas', mainBody);
          }
        }
      } catch {
        // Skip unreadable project file
      }

      // 3. If no modules were discovered via allowedModuleFiles, check projectDir for loose .bas
      if (files.size === 0 && fs.existsSync(projectDir)) {
        try {
          const entries = await fs.promises.readdir(projectDir);
          for (const e of entries) {
            if (e.toLowerCase().endsWith('.bas')) {
              const full = path.join(projectDir, e);
              const content = await fs.promises.readFile(full, 'utf-8');
              files.set(e, content);
            }
          }
        } catch {
          // Skip
        }
      }
    } else if (rootPath) {
      projectName = path.basename(rootPath);
      projectPath = rootPath;

      // Fallback: scan workspace folder for .bas files strictly within this workspace
      const uris = await vscode.workspace.findFiles('**/*.bas', '**/Objects/**');
      for (const u of uris) {
        try {
          const content = await fs.promises.readFile(u.fsPath, 'utf-8');
          const rel = path.basename(u.fsPath);
          files.set(rel, content);
        } catch {
          // Skip unreadable files
        }
      }
    }

    // If active document is open and modified in the editor, use the active buffer content
    if (activeEditor && activeEditor.document.languageId === 'b4x') {
      const activeBase = path.basename(activeEditor.document.uri.fsPath).toLowerCase();
      for (const [key, _] of files) {
        if (path.basename(key).toLowerCase() === activeBase) {
          files.set(key, activeEditor.document.getText());
          break;
        }
      }
    }

    const stats = collectStatistics(files);
    return { stats, projectName, projectPath };
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');

    const styleSrc = webview.cspSource;
    const daisyuiUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'daisyui.min.css'),
    );
    const tailwindUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'tailwind.min.js'),
    );
    const remixIconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'remixicon.css'),
    );
    const chartUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'chart.umd.js'),
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${styleSrc} 'unsafe-inline'; font-src ${styleSrc}; script-src ${styleSrc} 'nonce-${nonce}';">
  <link rel="stylesheet" href="${daisyuiUri}">
  <link rel="stylesheet" href="${remixIconUri}">
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --font: var(--vscode-font-family);
      --font-size: var(--vscode-font-size);
      --border: var(--vscode-panel-border);
      --hover: var(--vscode-list-hoverBackground);
      --link: var(--vscode-textLink-foreground);
    }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: var(--font-size);
      padding: 1rem;
    }
    .stat-card {
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }
    .stat-number {
      font-size: 2rem;
      font-weight: bold;
      color: var(--link);
    }
    .stat-label {
      font-size: 0.85rem;
      opacity: 0.8;
    }
    .num { text-align: right; }
    .totals-row { font-weight: bold; border-top: 2px solid var(--border); }
    .chart-container {
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
    }
    .chart-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--fg);
      opacity: 0.95;
      margin-bottom: 0.5rem;
    }
    .chart-wrapper {
      position: relative;
      height: 350px;
    }
    .chart-wrapper-wide {
      position: relative;
      height: 350px;
    }
    .no-data {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      opacity: 0.5;
      font-size: 0.9rem;
    }
    .error-banner {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      border-radius: 4px;
      padding: 0.5rem 1rem;
      margin-bottom: 1rem;
      display: none;
    }
  </style>
</head>
<body>
  <div id="error-banner" class="error-banner"></div>

  <div class="flex justify-between items-center mb-4">
    <div>
      <h2 class="text-lg font-bold">
        <i class="ri-bar-chart-box-line mr-2"></i>Project Statistics: <span id="project-name" class="text-primary font-bold">Loading...</span>
      </h2>
      <div id="project-path" class="text-xs opacity-60 font-mono mt-0.5"></div>
    </div>
    <button id="refresh-btn" class="btn btn-sm btn-primary">
      <i class="ri-refresh-line mr-1"></i>Refresh
    </button>
  </div>

  <div id="stats-grid" class="grid grid-cols-3 gap-3 mb-4">
    <div class="stat-card">
      <div class="stat-number" id="total-lines">-</div>
      <div class="stat-label">Total Lines</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="code-lines">-</div>
      <div class="stat-label">Code Lines</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="module-count">-</div>
      <div class="stat-label">Modules</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="sub-count">-</div>
      <div class="stat-label">Subs</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="event-count">-</div>
      <div class="stat-label">Event Handlers</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="type-count">-</div>
      <div class="stat-label">Types</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="comment-lines">-</div>
      <div class="stat-label">Comment Lines</div>
    </div>
    <div class="stat-card">
      <div class="stat-number" id="blank-lines">-</div>
      <div class="stat-label">Blank Lines</div>
    </div>
  </div>

  <!-- Charts -->
  <div class="grid grid-cols-2 gap-3 mb-4">
    <div class="chart-container">
      <div class="chart-title"><i class="ri-pie-chart-line mr-1"></i>Line Composition</div>
      <div class="chart-wrapper">
        <canvas id="chart-composition"></canvas>
      </div>
    </div>
    <div class="chart-container">
      <div class="chart-title"><i class="ri-bar-chart-grouped-line mr-1"></i>Subroutines per Module (Top 10)</div>
      <div class="chart-wrapper">
        <canvas id="chart-subs"></canvas>
      </div>
    </div>
  </div>

  <div class="chart-container mb-4">
    <div class="chart-title"><i class="ri-stack-line mr-1"></i>Module Size Breakdown (Top 10)</div>
    <div class="chart-wrapper-wide">
      <canvas id="chart-breakdown"></canvas>
    </div>
  </div>

  <div class="overflow-x-auto">
    <table class="table table-sm table-zebra w-full">
      <thead>
        <tr>
          <th>Module</th>
          <th class="num">Lines</th>
          <th class="num">Code</th>
          <th class="num">Comments</th>
          <th class="num">Subs</th>
          <th class="num">Events</th>
          <th class="num">Types</th>
        </tr>
      </thead>
      <tbody id="modules-tbody">
        <tr><td colspan="7" style="text-align:center;opacity:0.5">Loading...</td></tr>
      </tbody>
      <tfoot id="modules-tfoot">
        <tr class="totals-row">
          <td>Total</td>
          <td class="num" id="foot-lines">-</td>
          <td class="num" id="foot-code">-</td>
          <td class="num" id="foot-comments">-</td>
          <td class="num" id="foot-subs">-</td>
          <td class="num" id="foot-events">-</td>
          <td class="num" id="foot-types">-</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <script nonce="${nonce}" src="${tailwindUri}" defer></script>
  <script nonce="${nonce}" src="${chartUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    /* ── Error banner ── */
    const errorBanner = document.getElementById('error-banner');
    function showError(msg) {
      errorBanner.textContent = msg;
      errorBanner.style.display = 'block';
    }
    function hideError() {
      errorBanner.style.display = 'none';
    }

    document.getElementById('refresh-btn').addEventListener('click', () => {
      hideError();
      vscode.postMessage({ type: 'refresh' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateStatistics') {
        hideError();
        if (msg.projectName) {
          const nameEl = document.getElementById('project-name');
          if (nameEl) nameEl.textContent = msg.projectName;
        }
        if (msg.projectPath) {
          const pathEl = document.getElementById('project-path');
          if (pathEl) pathEl.textContent = msg.projectPath;
        }
        updateDashboard(msg.statistics);
      } else if (msg.type === 'error') {
        showError(msg.message || 'Failed to load statistics');
      }
    });

    /* ── Theme-aware chart colors ── */
    function readChartColors() {
      const s = getComputedStyle(document.body);

      // Multi-layer light theme detection (classes, attributes, background luminance)
      let isLight = document.body.classList.contains('vscode-light')
        || document.body.classList.contains('vscode-high-contrast-light')
        || document.documentElement.classList.contains('vscode-light')
        || document.documentElement.classList.contains('vscode-high-contrast-light')
        || document.body.getAttribute('data-vscode-theme-kind') === 'vscode-light'
        || document.body.getAttribute('data-vscode-theme-kind') === 'vscode-high-contrast-light';

      if (!isLight) {
        const bg = s.getPropertyValue('--vscode-editor-background').trim() || s.backgroundColor;
        if (bg) {
          const m = bg.match(/\d+/g);
          if (m && m.length >= 3) {
            const lum = 0.299 * parseInt(m[0], 10) + 0.587 * parseInt(m[1], 10) + 0.114 * parseInt(m[2], 10);
            if (lum > 128) isLight = true;
          } else if (bg.startsWith('#') && bg.length >= 7) {
            const r = parseInt(bg.substring(1, 3), 16);
            const g = parseInt(bg.substring(3, 5), 16);
            const b = parseInt(bg.substring(5, 7), 16);
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            if (lum > 128) isLight = true;
          }
        }
      }

      // IDE theme determined: solid crisp black in light mode, solid crisp white in dark mode
      const fgColor = isLight ? '#000000' : '#ffffff';
      const guidesColor = isLight ? '#d0d0d0' : '#444444';

      return {
        isLight: isLight,
        blue:   s.getPropertyValue('--vscode-charts-blue').trim()   || '#3734eb',
        green:  s.getPropertyValue('--vscode-charts-green').trim()  || '#008000',
        yellow: s.getPropertyValue('--vscode-charts-yellow').trim() || '#cca700',
        red:    s.getPropertyValue('--vscode-charts-red').trim()    || '#e45454',
        orange: s.getPropertyValue('--vscode-charts-orange').trim() || '#e67e22',
        purple: s.getPropertyValue('--vscode-charts-purple').trim() || '#6b40c8',
        fg:     fgColor,
        guides: guidesColor,
      };
    }

    let compositionChart = null;
    let subsChart = null;
    let breakdownChart = null;

    /** Max modules shown in bar charts (top N by primary metric). */
    var TOP_N = 10;

    /** Shorten B4X file names for chart labels.
     *  Keeps the platform extension (e.g. "Main.b4a") to disambiguate
     *  cross-platform variants like Main.b4a / Main.b4j / Main.b4i.
     *  Only strips truly internal extensions (.bas, .cls). */
    function shortName(fileName) {
      return fileName.replace(/\\.(bas|cls)$/i, '');
    }

    /** Truncate long labels with ellipsis. */
    function truncateLabel(label, maxLen) {
      if (maxLen === undefined) { maxLen = 20; }
      return label.length > maxLen ? label.slice(0, maxLen - 1) + '\\u2026' : label;
    }

    /** Return the top N modules sorted by the given metric (descending). */
    function topModules(modules, metricFn, n) {
      if (!modules || modules.length === 0) return [];
      var sorted = modules.slice().sort(function(a, b) { return metricFn(b) - metricFn(a); });
      return sorted.slice(0, n);
    }

    /** Destroy all existing chart instances to prevent memory leaks. */
    function destroyCharts() {
      if (compositionChart) { compositionChart.destroy(); compositionChart = null; }
      if (subsChart) { subsChart.destroy(); subsChart = null; }
      if (breakdownChart) { breakdownChart.destroy(); breakdownChart = null; }
    }

    function createCharts(stats, colors) {
      if (typeof Chart !== 'undefined') {
        Chart.defaults.color = colors.fg;
        Chart.defaults.borderColor = colors.guides;
      }

      if (!stats.modules || stats.modules.length === 0) {
        document.querySelectorAll('.chart-wrapper, .chart-wrapper-wide').forEach(function(el) {
          var canvas = el.querySelector('canvas');
          if (canvas) { canvas.style.display = 'none'; }
          if (!el.querySelector('.no-data')) {
            var msg = document.createElement('div');
            msg.className = 'no-data';
            msg.textContent = 'No modules found';
            el.appendChild(msg);
          }
        });
        return;
      }

      /* ── Top 10 modules for bar charts ── */
      const subsTop = topModules(stats.modules, function(m) { return m.subCount; }, TOP_N);
      const sizeTop = topModules(stats.modules, function(m) { return m.totalLines; }, TOP_N);

      const subsLabels = subsTop.map(function(m) { return truncateLabel(shortName(m.fileName)); });
      const sizeLabels = sizeTop.map(function(m) { return truncateLabel(shortName(m.fileName)); });

      /* ── Line Composition Doughnut ── */
      const compCtx = document.getElementById('chart-composition');
      if (compCtx) {
        compositionChart = new Chart(compCtx, {
          type: 'doughnut',
          data: {
            labels: ['Code', 'Comments', 'Blank'],
            datasets: [{
              data: [stats.codeLines, stats.commentLines, stats.blankLines],
              backgroundColor: [colors.blue, colors.green, colors.yellow],
              borderColor: colors.isLight ? '#ffffff' : '#1e1e1e',
              borderWidth: 2,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '50%',
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: colors.fg,
                  padding: 12,
                  usePointStyle: true,
                  pointStyleWidth: 10,
                  generateLabels: function(chart) {
                    const data = chart.data;
                    const dataset = data.datasets[0];
                    const total = dataset.data.reduce(function(a, b) { return a + b; }, 0);
                    return data.labels.map(function(label, i) {
                      const val = dataset.data[i] || 0;
                      const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                      return {
                        text: label + ': ' + val.toLocaleString() + ' (' + pct + '%)',
                        fillStyle: dataset.backgroundColor[i],
                        strokeStyle: dataset.backgroundColor[i],
                        fontColor: colors.fg,
                        lineWidth: 0,
                        hidden: false,
                        index: i,
                        pointStyle: 'circle',
                      };
                    });
                  }
                },
              },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
                    var pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
                    return ' ' + ctx.label + ': ' + ctx.parsed.toLocaleString() + ' (' + pct + '%)';
                  },
                },
              },
            },
          },
          plugins: [{
            id: 'pieSliceLabels',
            afterDraw: function(chart) {
              const ctx = chart.ctx;
              const meta = chart.getDatasetMeta(0);
              if (!meta || !meta.data) return;

              const total = chart.data.datasets[0].data.reduce(function(a, b) { return a + b; }, 0);
              if (total <= 0) return;

              meta.data.forEach(function(element, i) {
                const val = chart.data.datasets[0].data[i];
                if (!val || val <= 0) return;

                const pct = (val / total) * 100;
                if (pct < 3.5) return;

                const pos = element.tooltipPosition();
                ctx.save();
                ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                ctx.shadowBlur = 4;
                ctx.fillText(pct.toFixed(1) + '%', pos.x, pos.y);
                ctx.restore();
              });
            }
          }]
        });
      }

      /** Inline plugin to draw data labels on horizontal stacked bar charts. */
      function createBarDataLabelsPlugin(pluginId) {
        return {
          id: pluginId || 'barDataLabels',
          afterDraw: function(chart) {
            const ctx = chart.ctx;
            const datasets = chart.data.datasets;
            if (!datasets || datasets.length === 0) return;
            const metaList = datasets.map(function(_, dIdx) { return chart.getDatasetMeta(dIdx); });
            const rowCount = chart.data.labels ? chart.data.labels.length : 0;

            ctx.save();
            ctx.textBaseline = 'middle';

            for (var i = 0; i < rowCount; i++) {
              var barEnd = 0;
              var barBase = null;
              var barY = 0;
              var totalVal = 0;
              var visibleSegments = 0;

              for (var dIdx = 0; dIdx < datasets.length; dIdx++) {
                var ds = datasets[dIdx];
                var meta = metaList[dIdx];
                if (!meta || meta.hidden) continue;
                var el = meta.data ? meta.data[i] : null;
                if (!el) continue;

                barY = el.y;
                if (barBase === null) barBase = el.base;
                var val = ds.data[i] || 0;
                if (val > 0) {
                  totalVal += val;
                  visibleSegments++;
                }

                var width = Math.abs(el.x - el.base);
                if (el.x > barEnd) barEnd = el.x;

                /* Render label on the bar segment if wide enough to fit */
                if (val > 0 && width >= 22) {
                  ctx.save();
                  ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
                  if (ds.label === 'Blank') {
                    ctx.fillStyle = '#1e1e1e';
                    ctx.shadowColor = 'transparent';
                  } else {
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                    ctx.shadowBlur = 3;
                  }
                  ctx.textAlign = 'center';
                  ctx.fillText(val.toLocaleString(), (el.x + el.base) / 2, el.y);
                  ctx.restore();
                }
              }

              /* If stacked (multiple segments) or single segment too narrow for inner label, show total at end of bar */
              if (totalVal > 0 && (visibleSegments > 1 || (barBase !== null && barEnd - barBase < 22))) {
                ctx.save();
                ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
                ctx.fillStyle = colors.fg;
                ctx.textAlign = 'left';
                ctx.shadowColor = 'transparent';
                ctx.fillText(totalVal.toLocaleString(), barEnd + 5, barY);
                ctx.restore();
              }
            }
            ctx.restore();
          }
        };
      }

      /* ── Subroutines per Module Bar Chart (Top 10) ── */
      const subsCtx = document.getElementById('chart-subs');
      if (subsCtx) {
        subsChart = new Chart(subsCtx, {
          type: 'bar',
          data: {
            labels: subsLabels,
            datasets: [
              {
                label: 'Subs',
                data: subsTop.map(function(m) { return m.subCount - m.eventHandlerCount; }),
                backgroundColor: colors.blue,
              },
              {
                label: 'Event Handlers',
                data: subsTop.map(function(m) { return m.eventHandlerCount; }),
                backgroundColor: colors.green,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: colors.fg, usePointStyle: true, pointStyleWidth: 10 },
              },
            },
            scales: {
              x: { stacked: true, grace: '12%', ticks: { color: colors.fg }, grid: { color: colors.guides } },
              y: { stacked: true, ticks: { color: colors.fg, autoSkip: false }, grid: { color: colors.guides } },
            },
          },
          plugins: [createBarDataLabelsPlugin('subsBarLabels')],
        });
      }

      /* ── Module Size Breakdown Stacked Bar (Top 10) ── */
      const brkCtx = document.getElementById('chart-breakdown');
      if (brkCtx) {
        breakdownChart = new Chart(brkCtx, {
          type: 'bar',
          data: {
            labels: sizeLabels,
            datasets: [
              {
                label: 'Code',
                data: sizeTop.map(function(m) { return m.codeLines; }),
                backgroundColor: colors.blue,
              },
              {
                label: 'Comments',
                data: sizeTop.map(function(m) { return m.commentLines; }),
                backgroundColor: colors.green,
              },
              {
                label: 'Blank',
                data: sizeTop.map(function(m) { return m.blankLines; }),
                backgroundColor: colors.yellow,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: colors.fg, usePointStyle: true, pointStyleWidth: 10 },
              },
            },
            scales: {
              x: { stacked: true, grace: '12%', ticks: { color: colors.fg }, grid: { color: colors.guides } },
              y: { stacked: true, ticks: { color: colors.fg, autoSkip: false }, grid: { color: colors.guides } },
            },
          },
          plugins: [createBarDataLabelsPlugin('breakdownBarLabels')],
        });
      }
    }

    function updateCharts(stats) {
      if (typeof Chart === 'undefined') {
        /* Chart.js not loaded — hide canvas and show fallback message */
        document.querySelectorAll('.chart-wrapper, .chart-wrapper-wide').forEach(function(el) {
          var canvas = el.querySelector('canvas');
          if (canvas) { canvas.style.display = 'none'; }
          if (!el.querySelector('.no-data')) {
            var msg = document.createElement('div');
            msg.className = 'no-data';
            msg.textContent = 'Charts unavailable';
            el.appendChild(msg);
          }
        });
        return;
      }

      /* Always destroy and recreate to avoid stale axis orientation issues. */
      destroyCharts();
      createCharts(stats, readChartColors());
    }

    function updateDashboard(stats) {
      /* ── Stat cards ── */
      document.getElementById('total-lines').textContent = stats.totalLines.toLocaleString();
      document.getElementById('code-lines').textContent = stats.codeLines.toLocaleString();
      document.getElementById('module-count').textContent = stats.moduleCount.toLocaleString();
      document.getElementById('sub-count').textContent = stats.subCount.toLocaleString();
      document.getElementById('event-count').textContent = stats.eventHandlerCount.toLocaleString();
      document.getElementById('type-count').textContent = stats.typeCount.toLocaleString();
      document.getElementById('comment-lines').textContent = stats.commentLines.toLocaleString();
      document.getElementById('blank-lines').textContent = stats.blankLines.toLocaleString();

      /* ── Table ── */
      const tbody = document.getElementById('modules-tbody');
      tbody.replaceChildren();
      for (const m of stats.modules) {
        const row = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = m.fileName;
        const tdLines = document.createElement('td');
        tdLines.className = 'num';
        tdLines.textContent = m.totalLines.toLocaleString();
        const tdCode = document.createElement('td');
        tdCode.className = 'num';
        tdCode.textContent = m.codeLines.toLocaleString();
        const tdComments = document.createElement('td');
        tdComments.className = 'num';
        tdComments.textContent = m.commentLines.toLocaleString();
        const tdSubs = document.createElement('td');
        tdSubs.className = 'num';
        tdSubs.textContent = m.subCount.toLocaleString();
        const tdEvents = document.createElement('td');
        tdEvents.className = 'num';
        tdEvents.textContent = m.eventHandlerCount.toLocaleString();
        const tdTypes = document.createElement('td');
        tdTypes.className = 'num';
        tdTypes.textContent = m.typeCount.toLocaleString();
        row.append(tdName, tdLines, tdCode, tdComments, tdSubs, tdEvents, tdTypes);
        tbody.appendChild(row);
      }

      /* ── Totals row ── */
      document.getElementById('foot-lines').textContent = stats.totalLines.toLocaleString();
      document.getElementById('foot-code').textContent = stats.codeLines.toLocaleString();
      document.getElementById('foot-comments').textContent = stats.commentLines.toLocaleString();
      document.getElementById('foot-subs').textContent = stats.subCount.toLocaleString();
      document.getElementById('foot-events').textContent = stats.eventHandlerCount.toLocaleString();
      document.getElementById('foot-types').textContent = stats.typeCount.toLocaleString();

      /* ── Charts ── */
      lastStats = stats;
      updateCharts(stats);
    }

    let lastStats = null;
    const themeObserver = new MutationObserver(function() {
      if (lastStats) {
        updateCharts(lastStats);
      }
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });

    /* Request initial data */
    vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>`;
  }
}