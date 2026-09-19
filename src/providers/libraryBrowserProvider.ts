import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { LibraryCatalog, LibraryEntry } from '../libraryCatalog';

export class LibraryBrowserProvider {
  public static readonly viewType = 'b4x-library-browser';
  private panel: vscode.WebviewPanel | undefined;
  private catalog: LibraryCatalog;
  private pendingEntry: LibraryEntry | undefined;
  private pendingEntries: LibraryEntry[] | undefined;
  private webviewReady = false;
  private _internalLibrariesFolder: string = '';
  private _additionalLibrariesFolder: string = '';

  constructor(private extensionUri: vscode.Uri, private context: vscode.ExtensionContext, catalog: LibraryCatalog) {
    this.catalog = catalog;
    this.catalog.onDidChange(() => this.pushData());
  }

  public setLibraryFolders(internal: string, additional: string): void {
    this._internalLibrariesFolder = internal;
    this._additionalLibrariesFolder = additional;
  }

  private safePostMessage(message: unknown): void {
    try {
      this.panel?.webview.postMessage(message);
    } catch {
      // webview may have been disposed between the null-check and postMessage
    }
  }

  public show(entry?: LibraryEntry): void {
    if (this.panel) {
      this.panel.reveal();
      // Clear any pending entries since we're about to refresh the grid
      this.pendingEntries = undefined;
      if (entry) {
        this.pendingEntry = entry;
        this.safePostMessage({ type: 'selectLibrary', key: entry.key });
      }
      this.safePostMessage({ type: 'refresh', entries: this.catalog.getEntries() });
    } else {
      this.pendingEntry = entry;
      this.pendingEntries = this.catalog.getEntries();
      this.webviewReady = false;
      this.panel = vscode.window.createWebviewPanel(
        LibraryBrowserProvider.viewType, 'B4X Library Browser', vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] }
      );
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
      this.panel.onDidDispose(() => { this.panel = undefined; this.webviewReady = false; });
    }
  }

  /**
   * Fetch version for a library entry and send it to the webview.
   * Updates the entry in place and fires onDidChange if successful.
   */
  private async fetchAndSendVersion(key: string): Promise<void> {
    const version = await this.catalog.fetchLibraryVersion(key);
    const entry = this.catalog.getEntry(key);
    if (entry && this.panel && this.webviewReady) {
      this.safePostMessage({ type: 'updateVersion', key, version, versionStatus: entry.versionStatus });
    }
  }

  private pushData(): void {
    const entries = this.catalog.getEntries();
    if (!this.panel || !this.webviewReady) {
      this.pendingEntries = entries;
      return;
    }
    this.safePostMessage({ type: 'refresh', entries });
  }

  private handleMessage(msg: { type: string; url?: string; title?: string; snippet?: string; key?: string; message?: string }): void {
    if (msg.type === 'openExternal' && msg.url) {
      if (/^https?:\/\//i.test(msg.url)) {
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
    } else if (msg.type === 'openReadme' && msg.url) {
      this.openReadme(msg.url);
    } else if (msg.type === 'openForum' && msg.url) {
      this.openForum(msg.url, msg.title);
    } else if (msg.type === 'downloadFile' && msg.url) {
      void this.downloadLibrary(msg.url);
    } else if (msg.type === 'copySnippet' && msg.snippet) {
      void vscode.env.clipboard.writeText(msg.snippet);
      void vscode.window.showInformationMessage('Snippet copied to clipboard');
    } else if (msg.type === 'fetchVersion' && msg.key) {
      void this.fetchAndSendVersion(msg.key);
    } else if (msg.type === 'ready') {
      this.webviewReady = true;
      if (this.pendingEntries !== undefined) {
        this.safePostMessage({ type: 'refresh', entries: this.pendingEntries });
        this.pendingEntries = undefined;
      } else {
        this.pushData();
      }
      if (this.pendingEntry) {
        this.safePostMessage({ type: 'selectLibrary', key: this.pendingEntry.key });
        this.pendingEntry = undefined;
      }
    }
  }

  private async downloadLibrary(url: string): Promise<void> {
    const destFolder = this._additionalLibrariesFolder || this._internalLibrariesFolder;
    if (!destFolder) {
      void vscode.window.showErrorMessage('No library folder configured. Please open a B4X project first.');
      return;
    }

    try {
      const parsedUrl = new URL(url);
      const fileName = decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'library.b4xlib');
      const destPath = path.join(destFolder, fileName);

      await this.downloadFile(url, destPath);

      if (fileName.toLowerCase().endsWith('.xml')) {
        const jarUrl = url.replace(/\.xml$/i, '.jar');
        const jarFileName = fileName.replace(/\.xml$/i, '.jar');
        const jarDest = path.join(destFolder, jarFileName);
        try {
          await this.downloadFile(jarUrl, jarDest);
        } catch (jarErr) {
          fs.unlink(destPath, () => {});
          throw jarErr;
        }
        void vscode.window.showInformationMessage(`Downloaded to library folder:\n• ${fileName}\n• ${jarFileName}`);
      } else {
        void vscode.window.showInformationMessage(`Downloaded ${fileName} to library folder.`);
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`Failed to download library: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const req = https.get(url, { timeout: 30000 }, (res) => {
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400 && res.headers.location) {
          const redirect = https.get(res.headers.location, { timeout: 30000 }, (res2) => {
            res2.pipe(file);
            file.on('finish', () => { file.close(() => resolve()); });
          });
          redirect.on('error', (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err); });
          redirect.setTimeout(30000, () => { redirect.destroy(); file.close(); fs.unlink(destPath, () => {}); reject(new Error('timeout')); });
        } else if (res.statusCode === 200) {
          res.pipe(file);
          file.on('finish', () => { file.close(() => resolve()); });
        } else {
          res.resume();
          file.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
      req.on('error', (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err); });
      req.setTimeout(30000, () => { req.destroy(); file.close(); fs.unlink(destPath, () => {}); reject(new Error('timeout')); });
    });
  }

  private openReadme(rawUrl: string): void {
    const url = new URL(rawUrl);
    https.get({
      hostname: url.hostname,
      path: url.pathname,
      headers: { 'User-Agent': 'B4X-IntelliSense/1.0' },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', async () => {
        try {
          const content = Buffer.concat(chunks).toString('utf-8');
          const tempDir = this.context.globalStorageUri.fsPath;
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          const fileName = `readme_${crypto.randomBytes(4).toString('hex')}.md`;
          const filePath = path.join(tempDir, fileName);
          fs.writeFileSync(filePath, content, 'utf8');
          const uri = vscode.Uri.file(filePath);
          await vscode.commands.executeCommand('markdown.showPreview', uri);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Failed to open ReadMe: ${msg}`);
        }
      });
    }).on('error', (err) => {
      vscode.window.showErrorMessage(`Failed to fetch ReadMe: ${err.message}`);
    }).setTimeout(10000, () => {
      vscode.window.showErrorMessage('ReadMe request timed out.');
    });
  }

  private openForum(forumUrl: string, title?: string): void {
    vscode.env.openExternal(vscode.Uri.parse(forumUrl));
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'daisyui.min.css'));
    const twUri  = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'tailwind.min.js'));
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${cssUri}" rel="stylesheet" type="text/css">
  <style>
    body{background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-editor-foreground,#d4d4d4);font-family:var(--vscode-font-family,sans-serif);font-size:var(--vscode-font-size,13px);margin:0;padding:0}
    .card-hover{cursor:pointer;transition:box-shadow .2s,transform .2s}
    .card-hover:hover{box-shadow:0 4px 12px rgba(0,0,0,.15);transform:scale(1.02)}
    .sticky-bar{position:sticky;top:0;z-index:10}
    .snippet-scroll{max-height:400px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
  </style>
</head>
<body>
  <div class="sticky-bar p-3 border-b" style="background:var(--vscode-editor-background,#1e1e1e);border-color:var(--vscode-panel-border,#3c3c3c)">
    <div class="flex flex-wrap gap-4 items-center">
      <input id="searchInput" type="search" placeholder="Search by name, keyword, or author..." class="input input-bordered input-sm flex-1 min-w-[200px]" />
      <div class="flex items-center gap-2">
        <span class="text-xs opacity-60 font-medium">Platform:</span>
        <div id="platformFilters" class="filter flex gap-1"></div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs opacity-60 font-medium">Type:</span>
        <div id="typeFilters" class="filter flex gap-1"></div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs opacity-60 font-medium">Sort:</span>
        <div id="sortFilters" class="filter flex gap-1"></div>
      </div>
    </div>
    <div id="resultCount" class="text-sm opacity-60 mt-1"></div>
  </div>
  <div id="libraryGrid" class="grid grid-cols-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4"></div>
  <div id="emptyState" class="hidden flex-col items-center justify-center py-16 opacity-50">
    <p class="text-base font-semibold mb-2">No libraries match your search</p>
    <p class="text-sm">Try a different keyword, platform, or type filter.</p>
  </div>
  <dialog id="modalOverlay" class="modal">
    <div class="modal-box max-w-2xl" style="background:var(--vscode-editor-background,#1e1e1e);border:1px solid var(--vscode-panel-border,#3c3c3c)">
      <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">&times;</button></form>
      <h3 id="detailTitle" class="text-lg font-bold"></h3>
      <div id="detailVersionAuthor" class="flex gap-2 mt-2"></div>
      <div id="detailTitleSub" class="text-xs opacity-70 mt-1"></div>
      <div id="detailBadges" class="flex gap-2 mt-2"></div>
      <div id="detailSnippet" class="snippet-scroll mt-3 text-sm mockup-code bg-neutral text-neutral-content p-4"></div>
      <div id="detailActions" class="flex gap-2 mt-4"></div>
    </div>
  </dialog>
  <script nonce="${nonce}" src="${twUri}" defer></script>
  <script nonce="${nonce}">
    var vsc; try{vsc=acquireVsCodeApi()}catch(e){}
    function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
    var all=[],sPlat='All',sType='all',sSort='name';
    var PF=['All','B4X','B4A','B4J','B4i','B4R'],pDiv=document.getElementById('platformFilters');
    for(var pi=0;pi<PF.length;pi++){(function(p){
      var b=document.createElement('input');
      b.type='radio';
      b.name='platform';
      b.className='btn btn-sm rounded-full checked:bg-success checked:text-success-content checked:border-success '+(p==='All'?'filter-reset':'');
      b.setAttribute('aria-label',p==='All'?'x':p);
      b.checked=(p==='All');
      b.addEventListener('change',function(){sPlat=p;render()});
      pDiv.appendChild(b)
    })(PF[pi])}
    var TF=[{l:'all',v:'All'},{l:'b4xlib',v:'b4xlib'},{l:'native',v:'native'}],tDiv=document.getElementById('typeFilters');
    for(var ti=0;ti<TF.length;ti++){(function(t){
      var b=document.createElement('input');
      b.type='radio';
      b.name='type';
      b.className='btn btn-sm rounded-full checked:bg-success checked:text-success-content checked:border-success '+(t.l==='all'?'filter-reset':'');
      b.setAttribute('aria-label',t.l==='all'?'x':t.v);
      b.checked=(t.l==='all');
      b.addEventListener('change',function(){sType=t.l;render()});
      tDiv.appendChild(b)
    })(TF[ti])}
    var SF=[{l:'all',v:'All'},{l:'name',v:'Name'},{l:'author',v:'Author'}],sDiv=document.getElementById('sortFilters');
    for(var si=0;si<SF.length;si++){(function(s){
      var b=document.createElement('input');
      b.type='radio';
      b.name='sort';
      b.className='btn btn-sm rounded-full checked:bg-success checked:text-success-content checked:border-success '+(s.l==='all'?'filter-reset':'');
      b.setAttribute('aria-label',s.l==='all'?'x':s.v);
      b.checked=(s.l==='all');
      b.addEventListener('change',function(){sSort=s.l;render()});
      sDiv.appendChild(b)
    })(SF[si])}
    document.getElementById('searchInput').addEventListener('input',render);
    function render(){
      var q=document.getElementById('searchInput').value.toLowerCase();
      var f=all.filter(function(e){if(sPlat!=='All'&&e.platform!==sPlat)return false;if(sType!=='all'&&e.library_type!==sType)return false;if(q)return e.name.toLowerCase().indexOf(q)!==-1||e.title.toLowerCase().indexOf(q)!==-1||e.author.toLowerCase().indexOf(q)!==-1||(e.snippet?e.snippet.toLowerCase().indexOf(q)!==-1:false);return true});
      f.sort(function(a,b){
        if(sSort==='all') return 0;
        return (a[sSort]||'').localeCompare(b[sSort]||'');
      });
      document.getElementById('resultCount').textContent=f.length+' of '+all.length+' libraries';
      var g=document.getElementById('libraryGrid'),es=document.getElementById('emptyState');
      if(f.length===0){g.innerHTML='';g.classList.add('hidden');es.classList.remove('hidden');es.classList.add('flex');return}
      g.classList.remove('hidden');es.classList.remove('flex');es.classList.add('hidden');g.innerHTML='';
      for(var i=0;i<f.length;i++){(function(e){var c=document.createElement('div');c.className='card bg-base-100 card-hover border border-base-300 p-4 rounded-lg flex flex-col gap-2 shadow-sm';var hd=document.createElement('div');hd.className='flex flex-col gap-1';var n=document.createElement('div');n.className='font-bold text-sm truncate';n.textContent=e.name;hd.appendChild(n);var bd2=document.createElement('div');bd2.className='flex gap-1 flex-wrap mt-1';if(e.version){var vb=document.createElement('span');vb.className='badge badge-sm rounded-full badge-info';vb.textContent=e.version;vb.dataset.key=e.key;bd2.appendChild(vb)}if(e.author){var au=document.createElement('div');au.className='flex items-center gap-1 text-xs opacity-60';au.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span class="font-medium">'+esc(e.author)+'</span>';bd2.appendChild(au)}hd.appendChild(bd2);var ti=document.createElement('div');ti.className='text-xs opacity-70 break-words whitespace-normal';ti.textContent=e.title;hd.appendChild(ti);var bd1=document.createElement('div');bd1.className='flex gap-1 flex-wrap mt-1';if(e.library_type){var tb=document.createElement('span');tb.className='badge badge-sm rounded-full '+(e.library_type==='b4xlib'?'badge-primary':'badge-secondary');tb.textContent=e.library_type;bd1.appendChild(tb)}if(e.platform){var pb=document.createElement('span');pb.className='badge badge-sm rounded-full badge-accent';pb.textContent=e.platform;bd1.appendChild(pb)}hd.appendChild(bd1);c.appendChild(hd);if(e.tags&&e.tags.length){/* tags removed as requested */}var ac=document.createElement('div');ac.className='flex gap-1 mt-auto pt-1';var btnClass='btn btn-xs btn-outline rounded-full border-gray-400';if(e.readme_url){var rb=document.createElement('button');rb.className=btnClass;rb.textContent='ReadMe';rb.addEventListener('click',function(ev){ev.stopPropagation();vsc.postMessage({type:'openReadme',url:e.readme_url,title:e.title})});ac.appendChild(rb)}if(e.forum_thread){var fb=document.createElement('button');fb.className=btnClass;fb.textContent='Forum';fb.addEventListener('click',function(ev){ev.stopPropagation();vsc.postMessage({type:'openForum',url:e.forum_thread,title:e.title})});ac.appendChild(fb)}if(e.library_file){var db=document.createElement('button');db.className=btnClass;db.textContent='Download';db.addEventListener('click',function(ev){ev.stopPropagation();vsc.postMessage({type:'downloadFile',url:e.library_file})});ac.appendChild(db)}if(e.snippet){var cb=document.createElement('button');cb.className=btnClass;cb.textContent='Copy Snippet';cb.addEventListener('click',function(ev){ev.stopPropagation();vsc.postMessage({type:'copySnippet',snippet:e.snippet})});ac.appendChild(cb)}c.appendChild(ac);c.addEventListener('click',function(){detail(e)});g.appendChild(c)})(f[i])}
    }
    function detail(e){
      document.getElementById('detailTitle').textContent=e.name;
      var vaDiv=document.getElementById('detailVersionAuthor');vaDiv.innerHTML='';if(e.version){var vb=document.createElement('span');vb.className='badge badge-sm rounded-full badge-info';vb.textContent=e.version;vaDiv.appendChild(vb)}if(e.author){var au=document.createElement('div');au.className='flex items-center gap-1 text-xs opacity-60';au.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span class="font-medium">'+esc(e.author)+'</span>';vaDiv.appendChild(au)}
      document.getElementById('detailTitleSub').textContent=e.title;
      var bd=document.getElementById('detailBadges');bd.innerHTML='';if(e.library_type){var tb=document.createElement('span');tb.className='badge badge-sm rounded-full '+(e.library_type==='b4xlib'?'badge-primary':'badge-secondary');tb.textContent=e.library_type;bd.appendChild(tb)}if(e.platform){var pb=document.createElement('span');pb.className='badge badge-sm rounded-full badge-accent';pb.textContent=e.platform;bd.appendChild(pb)}
      if(e.snippet){document.getElementById('detailSnippet').innerHTML=md(e.snippet)}else{document.getElementById('detailSnippet').innerHTML=''}
      var ac=document.getElementById('detailActions');ac.innerHTML='';
      if(e.readme_url){var b3=document.createElement('button');b3.className='btn btn-sm btn-outline rounded-full border-gray-400';b3.textContent='ReadMe';b3.addEventListener('click',function(){vsc.postMessage({type:'openReadme',url:e.readme_url,title:e.title})});ac.appendChild(b3)}
      if(e.forum_thread){var b1=document.createElement('button');b1.className='btn btn-sm btn-outline rounded-full border-gray-400';b1.textContent='Forum';b1.addEventListener('click',function(){vsc.postMessage({type:'openForum',url:e.forum_thread,title:e.title})});ac.appendChild(b1)}
      if(e.library_file){var b2=document.createElement('button');b2.className='btn btn-sm btn-outline rounded-full border-gray-400';b2.textContent='Download';b2.addEventListener('click',function(){vsc.postMessage({type:'downloadFile',url:e.library_file})});ac.appendChild(b2)}
      if(e.snippet){var b4=document.createElement('button');b4.className='btn btn-sm btn-outline rounded-full border-gray-400';b4.textContent='Copy Snippet';b4.addEventListener('click',function(){vsc.postMessage({type:'copySnippet',snippet:e.snippet})});ac.appendChild(b4)}
      document.getElementById('modalOverlay').showModal()
    }
    function md(s){if(!s)return '';s=s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');s=s.replace(/### (.+)/g,'<h3>$1</h3>');s=s.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');s=s.replace(/\\n/g,'<br>');return s}
    window.addEventListener('message',function(ev){var m=ev.data;if(m.type==='setData'){all=m.entries||[];render()}else if(m.type==='refresh'){all=m.entries||[];render()}else if(m.type==='selectLibrary'){for(var i=0;i<all.length;i++){if(all[i].key===m.key){detail(all[i]);return}}}else if(m.type==='updateVersion'){for(var i=0;i<all.length;i++){if(all[i].key===m.key){all[i].version=m.version;all[i].versionStatus=m.versionStatus;var vb=document.querySelector('span[data-key="'+m.key+'"]');if(vb&&m.version){vb.textContent=m.version;vb.style.display='inline-flex'}break}}}});
    vsc.postMessage({type:'ready'});
  </script>
</body>
</html>`;
  }
}
