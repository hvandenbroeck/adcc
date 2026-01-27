// ==UserScript==
// @name         Rally Image Upload to OneDrive for Business
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Upload pasted images to OneDrive for Business (SharePoint)
// @author       You
// @match        *://*.rally.com/*
// @match        *://*.rallydev.com/*
// @match        *://rally.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      graph.microsoft.com
// @connect      BUSINESS-my.sharepoint.com
// @connect      login.microsoftonline.com
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    console.log('🚀 Rally OneDrive for Business Upload Script Starting...');

    // ============ CONFIGURATION ============
    const CONFIG = {
        // OneDrive folder path (relative to your OneDrive root)
        ONEDRIVE_FOLDER: 'Pictures/RallyImages', // No leading slash
        
        IMAGE_PREFIX: 'rally_paste_',
        SHOW_NOTIFICATIONS: true,
        
        // Microsoft Graph API endpoint
        GRAPH_API: 'https://graph.microsoft.com/v1.0',
        
        // Create sharing link after upload
        CREATE_SHARING_LINK: true,
        SHARING_TYPE: 'view', // 'view' or 'edit'
        
        DEBUG_MODE: true
    };

    // ============ UTILITY FUNCTIONS ============
    
    function debugLog(...args) {
        console.log('🔍 [Rally Upload]', ...args);
    }

    function showNotification(message, type = 'info') {
        debugLog('Notification:', message);
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
            z-index: 999999;
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

    // ============ ONEDRIVE FOR BUSINESS API FUNCTIONS ============

    async function uploadToOneDrive(fileBuffer, fileName, mimeType) {
        const folderPath = CONFIG.ONEDRIVE_FOLDER.replace(/^\//, '').replace(/\/$/, '');
        const uploadPath = folderPath ? `${folderPath}/${fileName}` : fileName;
        const uploadUrl = `${CONFIG.GRAPH_API}/me/drive/root:/${uploadPath}:/content`;
        
        debugLog('📤 Upload URL:', uploadUrl);
        
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'PUT',
                url: uploadUrl,
                headers: {
                    'Content-Type': 'application/octet-stream'
                },
                data: fileBuffer,
                binary: true,
                anonymous: false, // Use cookies for authentication
                onload: function(response) {
                    debugLog('📥 Upload response status:', response.status);
                    debugLog('📥 Upload response headers:', response.responseHeaders);
                    
                    if (response.status === 200 || response.status === 201) {
                        try {
                            const data = JSON.parse(response.responseText);
                            debugLog('✅ Upload successful:', data);
                            resolve(data);
                        } catch (e) {
                            debugLog('❌ Parse error:', e);
                            reject(new Error('Failed to parse upload response'));
                        }
                    } else if (response.status === 401 || response.status === 403) {
                        debugLog('❌ Authentication failed');
                        reject(new Error('Authentication failed. Please make sure you are logged into OneDrive for Business (BUSINESS-my.sharepoint.com)'));
                    } else if (response.status === 404) {
                        debugLog('⚠️ Folder not found, attempting to create...');
                        createFolderStructure()
                            .then(() => uploadToOneDrive(fileBuffer, fileName, mimeType))
                            .then(resolve)
                            .catch(reject);
                    } else {
                        debugLog('❌ Upload failed:', response.responseText);
                        reject(new Error(`Upload failed: ${response.status} - ${response.statusText}`));
                    }
                },
                onerror: function(error) {
                    debugLog('❌ Network error:', error);
                    reject(new Error('Network error during upload. Check console for details.'));
                },
                ontimeout: function() {
                    debugLog('❌ Upload timeout');
                    reject(new Error('Upload timed out'));
                }
            });
        });
    }

    async function createFolderStructure() {
        debugLog('📁 Creating folder structure...');
        
        const pathParts = CONFIG.ONEDRIVE_FOLDER.split('/').filter(p => p);
        let currentPath = '';
        
        for (const part of pathParts) {
            const parentPath = currentPath;
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            
            try {
                await createSingleFolder(part, parentPath);
                debugLog(`✅ Folder created/verified: ${currentPath}`);
            } catch (error) {
                debugLog(`⚠️ Folder creation warning for ${currentPath}:`, error.message);
                // Continue anyway - folder might already exist
            }
        }
    }

    async function createSingleFolder(folderName, parentPath) {
        return new Promise((resolve, reject) => {
            const createUrl = parentPath 
                ? `${CONFIG.GRAPH_API}/me/drive/root:/${parentPath}:/children`
                : `${CONFIG.GRAPH_API}/me/drive/root/children`;
            
            debugLog('📁 Creating folder:', folderName, 'in', parentPath || 'root');
            
            GM_xmlhttpRequest({
                method: 'POST',
                url: createUrl,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({
                    name: folderName,
                    folder: {},
                    '@microsoft.graph.conflictBehavior': 'replace'
                }),
                anonymous: false,
                onload: function(response) {
                    if (response.status === 200 || response.status === 201 || response.status === 409) {
                        resolve();
                    } else {
                        reject(new Error(`Folder creation failed: ${response.status}`));
                    }
                },
                onerror: reject
            });
        });
    }

    async function createSharingLink(itemId) {
        debugLog('🔗 Creating sharing link for item:', itemId);
        
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${CONFIG.GRAPH_API}/me/drive/items/${itemId}/createLink`,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({
                    type: CONFIG.SHARING_TYPE,
                    scope: 'organization' // Changed from 'anonymous' for corporate account
                }),
                anonymous: false,
                onload: function(response) {
                    debugLog('🔗 Sharing link response:', response.status);
                    
                    if (response.status === 200 || response.status === 201) {
                        const data = JSON.parse(response.responseText);
                        debugLog('✅ Sharing link created:', data.link.webUrl);
                        resolve(data.link.webUrl);
                    } else {
                        debugLog('⚠️ Sharing link failed:', response.responseText);
                        reject(new Error('Failed to create sharing link'));
                    }
                },
                onerror: reject
            });
        });
    }

    // ============ PASTE EVENT HANDLER ============

    async function handlePaste(event) {
        debugLog('✅ Paste event triggered!');
        debugLog('Target:', event.target.tagName, event.target.className);
        
        const clipboardData = event.clipboardData || event.originalEvent?.clipboardData || window.clipboardData;
        
        if (!clipboardData) {
            debugLog('❌ No clipboard data');
            return;
        }
        
        const items = clipboardData.items || clipboardData.files;
        debugLog('📋 Clipboard items:', items ? items.length : 0);
        
        if (!items || items.length === 0) {
            return;
        }
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            debugLog(`Item ${i}:`, { type: item.type, kind: item.kind });
            
            if (item.type && item.type.indexOf('image') === 0) {
                debugLog('🖼️ IMAGE FOUND!');
                event.preventDefault();
                event.stopPropagation();
                
                const blob = item.getAsFile ? item.getAsFile() : item;
                debugLog('Blob size:', blob.size, 'bytes');
                
                const extension = getImageExtension(blob.type);
                const fileName = generateFileName(extension);
                
                showNotification('Uploading to OneDrive...', 'info');
                
                const reader = new FileReader();
                reader.onload = async function(e) {
                    try {
                        const arrayBuffer = e.target.result;
                        debugLog('✅ File read, size:', arrayBuffer.byteLength, 'bytes');
                        
                        const uploadResponse = await uploadToOneDrive(arrayBuffer, fileName, blob.type);
                        debugLog('✅ Upload complete!');
                        
                        let publicUrl = uploadResponse.webUrl;
                        
                        if (CONFIG.CREATE_SHARING_LINK) {
                            try {
                                const sharingUrl = await createSharingLink(uploadResponse.id);
                                publicUrl = sharingUrl;
                            } catch (sharingError) {
                                debugLog('⚠️ Could not create sharing link, using direct URL');
                            }
                        }
                        
                        showNotification('✅ Uploaded! Inserting URL...', 'success');
                        
                        // Insert URL into text field
                        const target = event.target;
                        
                        if (target.isContentEditable) {
                            insertIntoContentEditable(target, publicUrl);
                        } else if (target.value !== undefined) {
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
                        
                        debugLog('✅ URL inserted successfully');
                        
                    } catch (error) {
                        debugLog('❌ Error:', error);
                        showNotification('❌ ' + error.message, 'error');
                    }
                };
                
                reader.onerror = function() {
                    debugLog('❌ FileReader error');
                    showNotification('Failed to read image file', 'error');
                };
                
                reader.readAsArrayBuffer(blob);
                return;
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

    debugLog('📌 Attaching paste listeners...');
    window.addEventListener('paste', handlePaste, true);
    document.addEventListener('paste', handlePaste, true);
    
    debugLog('✅ Script loaded!');
    showNotification('📤 Rally Upload Active', 'success');
    
    // Add test button
    setTimeout(() => {
        const testBtn = document.createElement('button');
        testBtn.textContent = '🧪 Test OneDrive';
        testBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 10px 15px;
            background: #0078d4;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            z-index: 999998;
            font-size: 12px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        `;
        testBtn.onclick = function() {
            debugLog('🧪 Testing OneDrive connection...');
            showNotification('Testing connection...', 'info');
            
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://graph.microsoft.com/v1.0/me/drive',
                anonymous: false,
                onload: function(response) {
                    debugLog('Test response:', response.status, response.responseText);
                    if (response.status === 200) {
                        const data = JSON.parse(response.responseText);
                        showNotification(`✅ Connected to: ${data.owner.user.displayName}`, 'success');
                        console.log('OneDrive info:', data);
                    } else if (response.status === 401) {
                        showNotification('❌ Not logged in. Please login to BUSINESS-my.sharepoint.com', 'error');
                    } else {
                        showNotification(`❌ Error: ${response.status}`, 'error');
                    }
                }
            });
        };
        document.body.appendChild(testBtn);
    }, 2000);

})();