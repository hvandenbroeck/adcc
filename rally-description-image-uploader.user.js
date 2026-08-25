// ==UserScript==
// @name         Rally Description Image → SharePoint Uploader
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  When an image is pasted into a Rally "Description" field, upload it to SharePoint and insert the remote URL as an inline image
// @match        https://rallydev.com/*
// @match        https://*.rallydev.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      yourtenant.sharepoint.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============ CONFIG — edit these ============
    const SP_SITE_URL = 'https://yourtenant.sharepoint.com/sites/YourSite';
    const SP_FOLDER_SERVER_RELATIVE_URL = '/sites/YourSite/Shared Documents/YourFolder';
    const DEBUG = false; // set true to log paste targets in the console while you find your selector
    // ================================================

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

    async function getRequestDigest() {
        const res = await gmRequest({
            method: 'POST',
            url: `${SP_SITE_URL}/_api/contextinfo`,
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

    async function uploadImageToSharePoint(file, fileName) {
        const name = fileName || `pasted-${Date.now()}.png`;
        const digest = await getRequestDigest();
        const uploadUrl =
            `${SP_SITE_URL}/_api/web/GetFolderByServerRelativeUrl('${encodeURIComponent(SP_FOLDER_SERVER_RELATIVE_URL)}')` +
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
        const origin = new URL(SP_SITE_URL).origin;
        return origin + data.d.ServerRelativeUrl;
    }

    function insertImageAtCursor(doc, url) {
        doc.execCommand('insertImage', false, url);
    }

    function notify(message) {
        console.log('[SP Uploader]', message);
        if (typeof GM_notification === 'function') {
            GM_notification({ text: message, title: 'SharePoint Uploader', timeout: 3000 });
        }
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

        event.preventDefault();
        event.stopPropagation();

        const file = imageItem.getAsFile();
        notify('Uploading pasted image to SharePoint…');

        try {
            const url = await uploadImageToSharePoint(file);
            insertImageAtCursor(target.ownerDocument, url);
            notify('Image uploaded — inserted remote link.');
            console.log('[SP Uploader] Uploaded URL:', url);
        } catch (err) {
            console.error('[SP Uploader] Upload failed:', err);
            notify('Upload failed — see console for details.');
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
