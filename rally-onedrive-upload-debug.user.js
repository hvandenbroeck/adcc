// ==UserScript==
// @name         Rally.com Image Upload to OneDrive (Debug)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Upload pasted images to OneDrive and insert public URL
// @author       You
// @match        https://*.rally.com/*
// @match        https://rally.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      graph.microsoft.com
// @connect      login.microsoftonline.com
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ============ CONFIGURATION ============
    const CONFIG = {
        ONEDRIVE_FOLDER: '/Pictures/RallyImages',
        IMAGE_PREFIX: 'rally_paste_',
        SHOW_NOTIFICATIONS: true,
        GRAPH_API: 'https://graph.microsoft.com/v1.0',
        CREATE_SHARING_LINK: true,
        SHARING_TYPE: 'view',
        DEBUG_MODE: true  // Enable detailed logging
    };

    // ============ UTILITY FUNCTIONS ============
    
    function debugLog(...args) {
        if (CONFIG.DEBUG_MODE) {
            console.log('[Rally OneDrive Upload]', ...args);
        }
    }

    function showNotification(message, type = 'info') {
        if (!CONFIG.SHOW_NOTIFICATIONS) return;
        
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4CAF50' : '#2196F3'};
            color: white;
            border-radius: 4px;
            z-index: 10000;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif;
            font-size: 14px;
            max-width: 300px;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 4000);
    }

    function generateFileName(extension) {
        const timestamp = new Date().getTime();
        const random = Math.random().toString(36).substring(2, 8);
        return `${CONFIG.IMAGE_PREFIX}${timestamp}_${random}.${extension}`;
    }

    function getImageExtension(mimeType) {
        const extensions = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/bmp': 'bmp',
            'image/webp': 'webp'
        };
        return extensions[mimeType] || 'png';
    }

    // ============ ONEDRIVE API FUNCTIONS ============

    async function ensureFolderExists(folderPath) {
        const parts = folderPath.split('/').filter(p => p);
        let currentPath = '';
        
        for (let part of parts) {
            currentPath += '/' + part;
            await createFolderIfNotExists(currentPath);
        }
    }

    async function createFolderIfNotExists(folderPath) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${CONFIG.GRAPH_API}/me/drive/root:${folderPath}`,
                headers: {
                    'Accept': 'application/json'
                },
                onload: function(response) {
                    if (response.status === 200) {
                        resolve();
                    } else if (response.status === 404) {
                        const pathParts = folderPath.split('/').filter(p => p);
                        const folderName = pathParts.pop();
                        const parentPath = pathParts.length > 0 ? '/' + pathParts.join('/') : '';
                        
                        GM_xmlhttpRequest({
                            method: 'POST',
                            url: `${CONFIG.GRAPH_API}/me/drive/root${parentPath ? ':' + parentPath + ':' : ''}/children`,
                            headers: {
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                            },
                            data: JSON.stringify({
                                name: folderName,
                                folder: {},
                                '@microsoft.graph.conflictBehavior': 'fail'
                            }),
                            onload: function(createResponse) {
                                if (createResponse.status === 201 || createResponse.status === 200 || createResponse.status === 409) {
                                    resolve();
                                } else {
                                    reject(new Error('Failed to create folder'));
                                }
                            },
                            onerror: reject
                        });
                    } else {
                        reject(new Error('Failed to check folder'));
                    }
                },
                onerror: reject
            });
        });
    }

    async function uploadToOneDrive(fileBuffer, fileName, mimeType) {
        try {
            await ensureFolderExists(CONFIG.ONEDRIVE_FOLDER);
            const uploadUrl = `${CONFIG.GRAPH_API}/me/drive/root:${CONFIG.ONEDRIVE_FOLDER}/${fileName}:/content`;
            
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'PUT',
                    url: uploadUrl,
                    headers: {
                        'Content-Type': mimeType,
                        'Accept': 'application/json'
                    },
                    data: fileBuffer,
                    binary: true,
                    onload: function(response) {
                        if (response.status === 200 || response.status === 201) {
                            const data = JSON.parse(response.responseText);
                            resolve(data);
                        } else {
                            reject(new Error(`Upload failed: ${response.status} - ${response.statusText}`));
                        }
                    },
                    onerror: reject
                });
            });
        } catch (error) {
            throw error;
        }
    }

    async function createSharingLink(itemId) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${CONFIG.GRAPH_API}/me/drive/items/${itemId}/createLink`,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                data: JSON.stringify({
                    type: CONFIG.SHARING_TYPE,
                    scope: 'anonymous'
                }),
                onload: function(response) {
                    if (response.status === 200 || response.status === 201) {
                        const data = JSON.parse(response.responseText);
                        resolve(data.link.webUrl);
                    } else {
                        reject(new Error('Failed to create sharing link'));
                    }
                },
                onerror: reject
            });
        });
    }

    // ============ PASTE EVENT HANDLER ============

    async function handlePaste(event) {
        debugLog('Paste event triggered on:', event.target);
        debugLog('Event type:', event.type);
        
        const clipboardData = event.clipboardData || event.originalEvent?.clipboardData || window.clipboardData;
        
        if (!clipboardData) {
            debugLog('No clipboard data available');
            return;
        }
        
        const items = clipboardData.items;
        debugLog('Clipboard items:', items ? items.length : 'none');
        
        if (!items) {
            debugLog('No clipboard items available');
            return;
        }
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            debugLog(`Item ${i}: type=${item.type}, kind=${item.kind}`);
            
            if (item.type.indexOf('image') === 0) {
                debugLog('Image found in clipboard!');
                event.preventDefault();
                
                const blob = item.getAsFile();
                const extension = getImageExtension(blob.type);
                const fileName = generateFileName(extension);
                
                showNotification('Uploading image to OneDrive...', 'info');
                
                try {
                    const reader = new FileReader();
                    reader.onload = async function(e) {
                        try {
                            const arrayBuffer = e.target.result;
                            debugLog('File read successfully, size:', arrayBuffer.byteLength);
                            
                            const uploadResponse = await uploadToOneDrive(arrayBuffer, fileName, blob.type);
                            debugLog('Upload successful:', uploadResponse);
                            
                            let publicUrl = uploadResponse.webUrl;
                            
                            if (CONFIG.CREATE_SHARING_LINK) {
                                try {
                                    publicUrl = await createSharingLink(uploadResponse.id);
                                    debugLog('Sharing link created:', publicUrl);
                                } catch (sharingError) {
                                    console.warn('Could not create sharing link:', sharingError);
                                }
                            }
                            
                            showNotification('Image uploaded successfully!', 'success');
                            
                            const target = event.target;
                            
                            if (target.isContentEditable) {
                                insertIntoContentEditable(target, publicUrl);
                            } else {
                                const currentValue = target.value || '';
                                const cursorPos = target.selectionStart || currentValue.length;
                                
                                const newValue = currentValue.substring(0, cursorPos) + 
                                               publicUrl + 
                                               currentValue.substring(cursorPos);
                                
                                target.value = newValue;
                                
                                const newCursorPos = cursorPos + publicUrl.length;
                                target.setSelectionRange(newCursorPos, newCursorPos);
                            }
                            
                            target.dispatchEvent(new Event('input', { bubbles: true }));
                            target.dispatchEvent(new Event('change', { bubbles: true }));
                            
                        } catch (error) {
                            console.error('Upload error:', error);
                            showNotification('Failed to upload: ' + error.message, 'error');
                        }
                    };
                    
                    reader.readAsArrayBuffer(blob);
                    
                } catch (error) {
                    console.error('Paste handling error:', error);
                    showNotification('Error processing image: ' + error.message, 'error');
                }
                
                break;
            }
        }
    }

    function insertIntoContentEditable(element, text) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            element.textContent += text;
        }
    }

    // ============ INITIALIZATION ============

    function attachPasteListeners() {
        // More comprehensive selector list
        const selectors = [
            'input[type="text"]',
            'input:not([type])',
            'textarea',
            '[contenteditable="true"]',
            '[contenteditable=""]',
            'div[role="textbox"]',
            'div[class*="editor"]',
            'div[class*="input"]',
            'div[class*="text"]'
        ];
        
        let attachedCount = 0;
        
        document.querySelectorAll(selectors.join(', ')).forEach(element => {
            if (!element.dataset.onedrivePasteHandler) {
                element.addEventListener('paste', handlePaste, true); // Use capture phase
                element.dataset.onedrivePasteHandler = 'true';
                attachedCount++;
                debugLog('Attached listener to:', element);
            }
        });
        
        debugLog(`Attached listeners to ${attachedCount} elements`);
    }

    // Also attach to document and body as fallback
    document.addEventListener('paste', function(e) {
        debugLog('Document paste event detected');
        handlePaste(e);
    }, true);

    // Initial attachment
    setTimeout(() => {
        attachPasteListeners();
        debugLog('Initial listener attachment complete');
    }, 1000);

    // Re-attach when DOM changes
    const observer = new MutationObserver(function(mutations) {
        attachPasteListeners();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log('Rally.com OneDrive Image Upload script loaded with debugging enabled');
    showNotification('OneDrive upload script active', 'info');
})();