// ==UserScript==
// @name         Rally.com Image Upload to SharePoint
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Upload pasted images to SharePoint and insert public URL
// @author       You
// @match        https://*.rally.com/*
// @match        https://rally.com/*
// @grant        GM_xmlhttpRequest
// @connect      *.sharepoint.com
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ============ CONFIGURATION ============
    const CONFIG = {
        // Your SharePoint site URL (e.g., 'https://yourcompany.sharepoint.com/sites/yoursite')
        SHAREPOINT_SITE_URL: 'https://yourcompany.sharepoint.com/sites/yoursite',
        
        // Library/folder path where images should be uploaded
        LIBRARY_PATH: 'Shared Documents/RallyImages',
        
        // Image naming pattern (timestamp will be appended)
        IMAGE_PREFIX: 'rally_paste_',
        
        // Show upload notifications
        SHOW_NOTIFICATIONS: true
    };

    // ============ UTILITY FUNCTIONS ============
    
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

    // ============ SHAREPOINT API FUNCTIONS ============

    async function getFormDigest() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${CONFIG.SHAREPOINT_SITE_URL}/_api/contextinfo`,
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'Content-Type': 'application/json;odata=verbose'
                },
                onload: function(response) {
                    if (response.status === 200) {
                        const data = JSON.parse(response.responseText);
                        resolve(data.d.GetContextWebInformation.FormDigestValue);
                    } else {
                        reject(new Error('Failed to get form digest'));
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    async function uploadToSharePoint(fileBuffer, fileName) {
        try {
            // Get form digest for authentication
            const formDigest = await getFormDigest();
            
            // Upload file
            const uploadUrl = `${CONFIG.SHAREPOINT_SITE_URL}/_api/web/GetFolderByServerRelativeUrl('${CONFIG.LIBRARY_PATH}')/Files/add(url='${fileName}',overwrite=true)`;
            
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: uploadUrl,
                    headers: {
                        'Accept': 'application/json;odata=verbose',
                        'X-RequestDigest': formDigest,
                        'Content-Type': 'application/octet-stream'
                    },
                    data: fileBuffer,
                    binary: true,
                    onload: function(response) {
                        if (response.status === 200 || response.status === 201) {
                            const data = JSON.parse(response.responseText);
                            // Get the public URL
                            const fileUrl = `${CONFIG.SHAREPOINT_SITE_URL}/${CONFIG.LIBRARY_PATH}/${fileName}`;
                            resolve(fileUrl);
                        } else {
                            reject(new Error(`Upload failed: ${response.statusText}`));
                        }
                    },
                    onerror: function(error) {
                        reject(error);
                    }
                });
            });
        } catch (error) {
            throw error;
        }
    }

    // ============ PASTE EVENT HANDLER ============

    async function handlePaste(event) {
        const items = (event.clipboardData || event.originalEvent.clipboardData).items;
        
        for (let item of items) {
            if (item.type.indexOf('image') === 0) {
                // Prevent default paste behavior for images
                event.preventDefault();
                
                const blob = item.getAsFile();
                const extension = getImageExtension(blob.type);
                const fileName = generateFileName(extension);
                
                showNotification('Uploading image to SharePoint...', 'info');
                
                try {
                    // Read file as array buffer
                    const reader = new FileReader();
                    reader.onload = async function(e) {
                        try {
                            const arrayBuffer = e.target.result;
                            
                            // Upload to SharePoint
                            const publicUrl = await uploadToSharePoint(arrayBuffer, fileName);
                            
                            showNotification('Image uploaded successfully!', 'success');
                            
                            // Insert URL into the text field
                            const target = event.target;
                            const currentValue = target.value || '';
                            const cursorPos = target.selectionStart || currentValue.length;
                            
                            const newValue = currentValue.substring(0, cursorPos) + 
                                           publicUrl + 
                                           currentValue.substring(cursorPos);
                            
                            target.value = newValue;
                            
                            // Set cursor position after inserted URL
                            const newCursorPos = cursorPos + publicUrl.length;
                            target.setSelectionRange(newCursorPos, newCursorPos);
                            
                            // Trigger input event in case Rally has listeners
                            target.dispatchEvent(new Event('input', { bubbles: true }));
                            target.dispatchEvent(new Event('change', { bubbles: true }));
                            
                        } catch (error) {
                            console.error('Upload error:', error);
                            showNotification('Failed to upload image: ' + error.message, 'error');
                        }
                    };
                    
                    reader.readAsArrayBuffer(blob);
                    
                } catch (error) {
                    console.error('Paste handling error:', error);
                    showNotification('Error processing image: ' + error.message, 'error');
                }
                
                break; // Only handle first image
            }
        }
    }

    // ============ INITIALIZATION ============

    function attachPasteListeners() {
        // Attach to all text inputs, textareas, and contenteditable elements
        const selectors = [
            'input[type="text"]',
            'textarea',
            '[contenteditable="true"]'
        ];
        
        document.querySelectorAll(selectors.join(', ')).forEach(element => {
            if (!element.dataset.sharePointPasteHandler) {
                element.addEventListener('paste', handlePaste);
                element.dataset.sharePointPasteHandler = 'true';
            }
        });
    }

    // Initial attachment
    attachPasteListeners();

    // Re-attach when DOM changes (for dynamically added fields)
    const observer = new MutationObserver(function(mutations) {
        attachPasteListeners();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log('Rally.com SharePoint Image Upload script loaded');
})();