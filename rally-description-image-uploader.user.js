// ==UserScript==
// @name         Rally Description Image → SharePoint Uploader
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  When an image is pasted into a Rally "Description" field, upload it to SharePoint and insert the remote URL as an inline image
// @match        https://rallydev.com/*
// @match        https://*.rallydev.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect       sharepoint.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============ CONFIG ============
    const DEBUG = false; // set true to log paste targets in the console while you find your selector
    // ================================================

    const STORAGE_KEY_SITE = 'sp_site_url';
    const STORAGE_KEY_FOLDER = 'sp_folder_relative_url';

    // ---------- First-run setup dialog, backed by GM_setValue/GM_getValue ----------
    function getStoredConfig() {
        const siteUrl = GM_getValue(STORAGE_KEY_SITE, '');
        const folderUrl = GM_getValue(STORAGE_KEY_FOLDER, '');
        return siteUrl && folderUrl ? { siteUrl, folderUrl } : null;
    }

    function showConfigDialog(defaults) {
        return new Promise((resolve) => {
            const doc = document; // always shown in the top page, regardless of where the paste happened
            const overlay = doc.createElement('div');
            overlay.style.cssText =
                'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483647;' +
                'display:flex;align-items:center;justify-content:center;font-family:sans-serif;';

            const box = doc.createElement('div');
            box.style.cssText =
                'background:#fff;border-radius:8px;padding:24px;width:440px;max-width:90vw;' +
                'box-shadow:0 10px 40px rgba(0,0,0,0.3);color:#222;';
            box.innerHTML = `
                <h2 style="margin:0 0 8px;font-size:16px;">SharePoint Image Uploader — Setup</h2>
                <p style="margin:0 0 16px;font-size:13px;color:#555;line-height:1.4;">
                    Enter this once — it's saved on this computer for future pastes.
                </p>
                <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">SharePoint site URL</label>
                <input id="sp-cfg-site" type="text" placeholder="https://yourtenant.sharepoint.com/sites/YourSite"
                    style="width:100%;padding:8px;margin-bottom:12px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;font-size:13px;">
                <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Folder (server-relative URL)</label>
                <input id="sp-cfg-folder" type="text" placeholder="/sites/YourSite/Shared Documents/YourFolder"
                    style="width:100%;padding:8px;margin-bottom:18px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;font-size:13px;">
                <div style="text-align:right;">
                    <button id="sp-cfg-cancel" type="button"
                        style="padding:8px 14px;margin-right:8px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;font-size:13px;">Cancel</button>
                    <button id="sp-cfg-save" type="button"
                        style="padding:8px 14px;border:none;background:#0b5cab;color:#fff;border-radius:4px;cursor:pointer;font-size:13px;">Save</button>
                </div>
            `;
            overlay.appendChild(box);
            doc.body.appendChild(overlay);

            const siteInput = box.querySelector('#sp-cfg-site');
            const folderInput = box.querySelector('#sp-cfg-folder');
            siteInput.value = (defaults && defaults.siteUrl) || '';
            folderInput.value = (defaults && defaults.folderUrl) || '';
            siteInput.focus();

            const cleanup = () => overlay.remove();

            box.querySelector('#sp-cfg-save').addEventListener('click', () => {
                const siteUrl = siteInput.value.trim().replace(/\/+$/, '');
                const folderUrl = folderInput.value.trim();
                if (!siteUrl || !folderUrl) {
                    alert('Both fields are required.');
                    return;
                }
                GM_setValue(STORAGE_KEY_SITE, siteUrl);
                GM_setValue(STORAGE_KEY_FOLDER, folderUrl);
                cleanup();
                resolve({ siteUrl, folderUrl });
            });

            box.querySelector('#sp-cfg-cancel').addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    cleanup();
                    resolve(null);
                }
            });
        });
    }

    // Returns the saved config, or shows the setup dialog if nothing's saved yet (or the
    // person explicitly asked to reconfigure). Resolves to null if they cancel.
    async function getConfig(forceDialog) {
        if (!forceDialog) {
            const stored = getStoredConfig();
            if (stored) return stored;
        }
        return showConfigDialog(getStoredConfig());
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Configure SharePoint upload settings', () => getConfig(true));
    }

    // ---------- Heuristic: is this element part of Rally's "Description" field? ----------
    // Adjust this once you've inspected your instance. Turn on DEBUG, paste an image into a
    // few different fields, and look at the console output to see what to match on.
    function isDescriptionField(el) {
        if (!el) return false;
        let node = el;
        for (let i = 0; i < 6 && node; i++) {
            const attrs = node.getAttribute
                ? [node.getAttribute('aria-label'), node.getAttribute('name'), node.getAttribute('id')].filter(Boolean).join(' ')
                : '';
            if (/description/i.test(attrs)) return true;
            node = node.parentElement;
        }
        const container = el.closest && el.closest('.field, .x-field, .form-group, [class*="field"]');
        if (container) {
            const label = container.querySelector('label, .x-form-item-label');
            if (label && /description/i.test(label.textContent)) return true;
        }
        return false;
    }

    // ---------- GM_xmlhttpRequest wrapped as a Promise ----------
    function gmRequest(details) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...details,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) resolve(res);
                    else reject(new Error(`HTTP ${res.status}: ${(res.responseText || '').slice(0, 300)}`));
                },
                onerror: (err) => reject(new Error('Network error: ' + JSON.stringify(err))),
                ontimeout: () => reject(new Error('Request timed out'))
            });
        });
    }

    async function getRequestDigest(siteUrl) {
        const res = await gmRequest({
            method: 'POST',
            url: `${siteUrl}/_api/contextinfo`,
            headers: { Accept: 'application/json;odata=verbose' }
        });
        let data;
        try {
            data = JSON.parse(res.responseText);
        } catch (e) {
            throw new Error('Could not parse SharePoint response — you may not be logged in. Open the SharePoint site in another tab, sign in, then retry.');
        }
        return data.d.GetContextWebInformation.FormDigestValue;
    }

    // Cached per site so we only hit the API once per session, not on every paste.
    const currentUserCache = {};

    function sanitizeForFilename(str) {
        return str.replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    async function getCurrentUserName(siteUrl) {
        if (currentUserCache[siteUrl]) return currentUserCache[siteUrl];

        try {
            const res = await gmRequest({
                method: 'GET',
                url: `${siteUrl}/_api/web/currentuser?$select=Title,Email,LoginName`,
                headers: { Accept: 'application/json;odata=verbose' }
            });
            const data = JSON.parse(res.responseText);
            const info = data.d;
            const raw = info.Email || info.Title || info.LoginName || 'unknown';
            const username = sanitizeForFilename(raw.split('@')[0]);
            currentUserCache[siteUrl] = username;
            return username;
        } catch (e) {
            console.warn('[SP Uploader] Could not determine current user, falling back to "unknown":', e);
            return 'unknown';
        }
    }

    async function uploadImageToSharePoint(file, siteUrl, folderUrl, fileName) {
        const [digest, username] = await Promise.all([
            getRequestDigest(siteUrl),
            getCurrentUserName(siteUrl)
        ]);
        const name = fileName || `pasted-${username}-${Date.now()}.png`;
        const uploadUrl =
            `${siteUrl}/_api/web/GetFolderByServerRelativeUrl('${encodeURIComponent(folderUrl)}')` +
            `/Files/add(url='${encodeURIComponent(name)}',overwrite=true)`;

        const res = await gmRequest({
            method: 'POST',
            url: uploadUrl,
            headers: {
                Accept: 'application/json;odata=verbose',
                'X-RequestDigest': digest
            },
            data: file // Blob/File — GM_xmlhttpRequest sends binary data as-is
        });

        let data;
        try {
            data = JSON.parse(res.responseText);
        } catch (e) {
            throw new Error('Upload succeeded but response could not be parsed: ' + res.responseText.slice(0, 300));
        }
        const origin = new URL(siteUrl).origin;
        return origin + data.d.ServerRelativeUrl;
    }

    // ---------- Subtle in-page toast (bottom-right, auto-fades) ----------
    let toastEl = null;
    let toastHideTimer = null;

    function ensureToastEl() {
        if (toastEl) return toastEl;
        toastEl = document.createElement('div');
        toastEl.style.cssText =
            'position:fixed;bottom:20px;right:20px;z-index:2147483647;' +
            'padding:10px 16px;border-radius:6px;font-family:sans-serif;font-size:13px;' +
            'box-shadow:0 4px 16px rgba(0,0,0,0.25);opacity:0;transform:translateY(8px);' +
            'transition:opacity 0.2s ease,transform 0.2s ease;pointer-events:none;max-width:320px;';
        document.body.appendChild(toastEl);
        return toastEl;
    }

    const TOAST_COLORS = {
        progress: { bg: '#323232', fg: '#fff' },
        success: { bg: '#1e7e34', fg: '#fff' },
        error: { bg: '#b02a2a', fg: '#fff' }
    };

    function showToast(message, kind) {
        const el = ensureToastEl();
        const c = TOAST_COLORS[kind] || TOAST_COLORS.progress;
        el.style.background = c.bg;
        el.style.color = c.fg;
        el.textContent = message;

        clearTimeout(toastHideTimer);
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        });

        // 'progress' toasts stay put until the next call updates/replaces them (we don't know
        // how long the upload will take); success/error toasts fade themselves out.
        if (kind !== 'progress') {
            const hideAfter = kind === 'error' ? 4000 : 2500;
            toastHideTimer = setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(8px)';
            }, hideAfter);
        }
    }

    function notify(message, kind) {
        console.log('[SP Uploader]', message);
        showToast(message, kind || 'progress');
    }

    // ---------- Insert via CKEditor 5's own command API ----------
    // The dialog you captured is CKEditor 5 (all the ck-* classes). CKEditor 5 exposes the live
    // editor instance directly on its editable DOM element as `.ckeditorInstance`, and inserting
    // an image by URL is just editor.execute('insertImage', { source: url }) — the exact same
    // thing that dialog's "Accept" button does internally. No clicking, no dialog, no races.
    function getCkEditorInstance(el) {
        let node = el;
        while (node) {
            if (node.ckeditorInstance) return node.ckeditorInstance;
            node = node.parentElement;
        }
        return null;
    }

    function insertImageViaCkEditor(fieldEl, imageUrl) {
        const editor = getCkEditorInstance(fieldEl);
        if (!editor) {
            throw new Error('No .ckeditorInstance found on any ancestor of the pasted-into element — is this really CKEditor 5 here?');
        }

        const candidateCommands = ['insertImage', 'imageInsert'];
        const commandName = candidateCommands.find((name) => editor.commands.get(name));
        if (!commandName) {
            console.warn('[SP Uploader] No known insert-image command found. Available commands:', [...editor.commands.names()]);
            throw new Error('No insertImage/imageInsert command on this CKEditor instance — see console for the full command list');
        }
        editor.execute(commandName, { source: imageUrl });
    }

    // ---------- Core paste handler ----------
    async function handlePaste(event) {
        const target = event.target;

        if (DEBUG) {
            console.log('[SP Uploader][debug] paste target:', {
                target,
                tag: target && target.tagName,
                id: target && target.id,
                className: target && target.className,
                closestLabel:
                    target && target.closest &&
                    target.closest('.field, .x-field, .form-group, [class*="field"]')?.querySelector('label')?.textContent
            });
        }

        if (!isDescriptionField(target)) return;

        const items = [...((event.clipboardData && event.clipboardData.items) || [])];
        const imageItem = items.find((i) => i.type.startsWith('image/'));
        if (!imageItem) return; // not an image paste — let Rally handle it normally

        // Stop CKEditor's own default paste-image handling (its upload adapter is what's
        // calling Rally's Attachment API and failing) and the browser's default insert — we're
        // inserting directly via the editor's command API instead.
        event.preventDefault();
        event.stopImmediatePropagation();

        const file = imageItem.getAsFile();

        const config = await getConfig();
        if (!config) {
            notify('Upload cancelled — SharePoint not configured.', 'error');
            return;
        }

        notify('Uploading pasted image to SharePoint…', 'progress');

        try {
            const url = await uploadImageToSharePoint(file, config.siteUrl, config.folderUrl);
            insertImageViaCkEditor(target, url);
            notify('Image uploaded and inserted.', 'success');
            console.log('[SP Uploader] Uploaded URL:', url);
        } catch (err) {
            console.error('[SP Uploader] Failed:', err);
            notify('Failed — see console for details.', 'error');
        }
    }

    // ---------- Attach to the top document AND any same-origin iframes ----------
    // Rally's rich-text editor is commonly rendered inside an iframe (often about:blank,
    // populated via JS). We reach into any same-origin iframe so paste events inside it are caught.
    function attachListeners(doc) {
        doc.removeEventListener('paste', handlePaste, true); // avoid duplicate binding on rescans
        doc.addEventListener('paste', handlePaste, true);
    }

    function scanFrames(doc) {
        attachListeners(doc);
        const iframes = doc.querySelectorAll('iframe');
        iframes.forEach((frame) => {
            try {
                const innerDoc = frame.contentDocument;
                if (innerDoc) attachListeners(innerDoc);
            } catch (e) {
                // cross-origin iframe — can't attach, skip
            }
        });
    }

    scanFrames(document);

    // Rally is a dynamic single-page app — editor iframes can appear after initial load,
    // so keep watching for new ones.
    const observer = new MutationObserver(() => scanFrames(document));
    observer.observe(document.body, { childList: true, subtree: true });
})();
