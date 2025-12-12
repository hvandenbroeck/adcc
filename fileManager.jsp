<%@ page session="false" %><%@
  page import="java.io.*, java.util.*" %><%@
  page import="java.net.URLEncoder" %><%

  response.setContentType("text/html; charset=utf-8");
  response.addHeader("Pragma", "no-cache");
  response.addHeader("Cache-Control", "no-cache");
  response.setDateHeader("Expires", System.currentTimeMillis());

  int BUFFER_SIZE = 8192;
  String basePath = "/data/";
  String requestedPath = request.getParameter("path");
  if(requestedPath == null) {
    requestedPath = "";
  }
  
  // Sanitize path to prevent directory traversal
  requestedPath = requestedPath.replaceAll("\\.\\.[\\\\/]", "").replaceAll("\\\\", "/");
  
  // Build the full file system path
  String fullPath = new File(basePath).getAbsolutePath();
  String userPath = new File(fullPath, requestedPath).getAbsolutePath();
  
  // Security check: ensure we're still within the base directory
  if(!userPath.startsWith(fullPath)) {
    userPath = fullPath;
    requestedPath = "";
  }
  
  File currentDir = new File(userPath);
  
  // Handle search functionality
  String searchQuery = request.getParameter("search");
  List<Map<String, Object>> searchResults = new ArrayList<Map<String, Object>>();
  boolean hasSearched = false;
  
  if(searchQuery != null && !searchQuery.trim().isEmpty() && currentDir.exists() && currentDir.isDirectory()) {
    hasSearched = true;
    searchQuery = searchQuery.trim();
    File[] filesToSearch = currentDir.listFiles();
    
    if(filesToSearch != null) {
      for(File file : filesToSearch) {
        if(file.isFile()) {
          try {
            BufferedReader reader = new BufferedReader(new FileReader(file));
            String line;
            int lineNumber = 0;
            
            while((line = reader.readLine()) != null) {
              lineNumber++;
              if(line.toLowerCase().contains(searchQuery.toLowerCase())) {
                Map<String, Object> result = new HashMap<String, Object>();
                result.put("file", file.getName());
                result.put("line", lineNumber);
                result.put("content", line);
                searchResults.add(result);
              }
            }
            reader.close();
          } catch(Exception e) {
            // Skip files that can't be read
          }
        }
      }
    }
  }
  
  // Handle file download
  String downloadFile = request.getParameter("download");
  if(downloadFile != null && !downloadFile.isEmpty()) {
    downloadFile = downloadFile.replaceAll("\\.\\.[\\\\/]", "");
    File fileToDownload = new File(currentDir, downloadFile);
    
    if(fileToDownload.exists() && fileToDownload.isFile() && fileToDownload.getAbsolutePath().startsWith(fullPath)) {
      try {
        response.setContentType("application/octet-stream");
        response.addHeader("Content-Disposition", "attachment; filename=\"" + fileToDownload.getName() + "\"");
        
        FileInputStream fis = new FileInputStream(fileToDownload);
        OutputStream outStream = response.getOutputStream();
        byte[] buffer = new byte[BUFFER_SIZE];
        int bytesRead;
        while((bytesRead = fis.read(buffer)) != -1) {
          outStream.write(buffer, 0, bytesRead);
        }
        fis.close();
        outStream.flush();
        return;
      } catch(Exception e) {
        response.setContentType("text/html; charset=utf-8");
        out.println("<h3>Error downloading file: " + e.getMessage() + "</h3>");
      }
    }
  }
%><!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>File Manager - /data/</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #00A758 0%, #007A45 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #00A758 0%, #007A45 100%);
      color: white;
      padding: 25px;
      border-bottom: 1px solid rgba(0,0,0,0.1);
    }
    .header h1 {
      font-size: 24px;
      margin-bottom: 10px;
    }
    .breadcrumb {
      font-size: 13px;
      opacity: 0.9;
      word-break: break-all;
    }
    .breadcrumb a {
      color: rgba(255,255,255,0.8);
      text-decoration: none;
      font-weight: 500;
    }
    .breadcrumb a:hover {
      color: white;
      text-decoration: underline;
    }
    .breadcrumb span {
      margin: 0 5px;
      opacity: 0.6;
    }
    .content {
      padding: 25px;
    }
    .error {
      background: #fee;
      border-left: 4px solid #c33;
      padding: 15px;
      border-radius: 4px;
      color: #c33;
      margin-bottom: 20px;
    }
    .empty {
      text-align: center;
      padding: 40px;
      color: #999;
    }
    .file-list {
      border-collapse: collapse;
      width: 100%;
    }
    .file-list thead {
      background: #f5f5f5;
      border-bottom: 2px solid #ddd;
    }
    .file-list th {
      padding: 12px 15px;
      text-align: left;
      font-weight: 600;
      color: #333;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .file-list tbody tr {
      border-bottom: 1px solid #eee;
      transition: background-color 0.2s;
    }
    .file-list tbody tr:hover {
      background: #f9f9f9;
    }
    .file-list td {
      padding: 12px 15px;
      vertical-align: middle;
    }
    .file-name {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: #00A758;
      font-weight: 500;
      word-break: break-all;
    }
    .file-name:hover {
      text-decoration: underline;
    }
    .icon {
      font-size: 18px;
      flex-shrink: 0;
    }
    .folder-icon {
      color: #f39c12;
    }
    .file-icon {
      color: #00A758;
    }
    .size {
      text-align: right;
      color: #666;
      font-size: 13px;
      min-width: 80px;
    }
    .actions {
      text-align: center;
    }
    .btn {
      display: inline-block;
      padding: 6px 12px;
      margin: 0 4px;
      border-radius: 4px;
      text-decoration: none;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-download {
      background: #00A758;
      color: white;
    }
    .btn-download:hover {
      background: #007A45;
      box-shadow: 0 2px 8px rgba(0, 167, 88, 0.3);
    }
    .btn-open {
      background: #f39c12;
      color: white;
    }
    .btn-open:hover {
      background: #e67e22;
      box-shadow: 0 2px 8px rgba(243, 156, 18, 0.3);
    }
    .footer {
      background: #f5f5f5;
      padding: 15px 25px;
      border-top: 1px solid #ddd;
      color: #666;
      font-size: 12px;
    }
    .search-box {
      margin-bottom: 20px;
      padding: 20px;
      background: #f9f9f9;
      border-radius: 6px;
      border: 1px solid #e0e0e0;
    }
    .search-box h3 {
      margin-bottom: 12px;
      color: #333;
      font-size: 16px;
    }
    .search-form {
      display: flex;
      gap: 10px;
    }
    .search-input {
      flex: 1;
      padding: 10px 15px;
      border: 2px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    .search-input:focus {
      outline: none;
      border-color: #00A758;
    }
    .btn-search {
      background: #00A758;
      color: white;
      padding: 10px 25px;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-search:hover {
      background: #007A45;
      box-shadow: 0 2px 8px rgba(0, 167, 88, 0.3);
    }
    .search-results {
      margin-bottom: 20px;
      padding: 20px;
      background: #f0f8f4;
      border-radius: 6px;
      border-left: 4px solid #00A758;
    }
    .search-results h3 {
      color: #00A758;
      margin-bottom: 15px;
      font-size: 16px;
    }
    .search-result-item {
      background: white;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 4px;
      border: 1px solid #e0e0e0;
    }
    .search-result-file {
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .search-result-line {
      font-size: 12px;
      color: #666;
      margin-bottom: 5px;
    }
    .search-result-content {
      background: #fafafa;
      padding: 10px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
      border-left: 3px solid #00A758;
    }
    .highlight {
      background: #ffeb3b;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>File Manager</h1>
      <div class="breadcrumb">
        <a href="fileManager.jsp">root</a>
        <%
          String[] pathParts = requestedPath.split("/");
          String currentBreadcrumb = "";
          for(int i = 0; i < pathParts.length; i++) {
            if(!pathParts[i].isEmpty()) {
              currentBreadcrumb += pathParts[i];
              String encodedPath = URLEncoder.encode(currentBreadcrumb, "UTF-8");
        %>
        <span>/</span>
        <a href="fileManager.jsp?path=<%= encodedPath %>"><%= pathParts[i] %></a>
        <%
              currentBreadcrumb += "/";
            }
          }
        %>
      </div>
    </div>
    
    <div class="content">
      <%-- Search Box --%>
      <div class="search-box">
        <h3>🔍 Search in Current Folder</h3>
        <form method="get" action="fileManager.jsp" class="search-form">
          <input type="hidden" name="path" value="<%= requestedPath %>" />
          <input type="text" name="search" class="search-input" placeholder="Enter search text..." value="<%= searchQuery != null ? searchQuery : "" %>" />
          <button type="submit" class="btn-search">Search</button>
        </form>
      </div>
      
      <%-- Search Results --%>
      <%
        if(hasSearched) {
          if(searchResults.size() > 0) {
      %>
      <div class="search-results">
        <h3>Search Results (<%= searchResults.size() %> match<%= searchResults.size() != 1 ? "es" : "" %> found for "<%= searchQuery %>")</h3>
        <%
          for(Map<String, Object> result : searchResults) {
            String fileName = (String)result.get("file");
            int lineNum = (Integer)result.get("line");
            String content = (String)result.get("content");
            String encodedFileName = URLEncoder.encode(fileName, "UTF-8");
            
            // Highlight the search query in the content
            String highlightedContent = content;
            int index = content.toLowerCase().indexOf(searchQuery.toLowerCase());
            if(index >= 0) {
              String before = content.substring(0, index);
              String match = content.substring(index, index + searchQuery.length());
              String after = content.substring(index + searchQuery.length());
              highlightedContent = before + "<span class='highlight'>" + match + "</span>" + after;
            }
        %>
        <div class="search-result-item">
          <div class="search-result-file">
            <span>📄 <%= fileName %></span>
            <a href="fileManager.jsp?path=<%= URLEncoder.encode(requestedPath, "UTF-8") %>&download=<%= encodedFileName %>" class="btn btn-download">Download</a>
          </div>
          <div class="search-result-line">Line <%= lineNum %></div>
          <div class="search-result-content"><%= highlightedContent %></div>
        </div>
        <%
          }
        %>
      </div>
      <%
          } else {
      %>
      <div class="search-results">
        <h3>No results found for "<%= searchQuery %>"</h3>
        <p style="color: #666; margin-top: 10px;">Try a different search term.</p>
      </div>
      <%
          }
        }
      %>
      
      <%
        if(!currentDir.exists() || !currentDir.isDirectory()) {
      %>
      <div class="error">
        Error: Directory not found or is not accessible.
      </div>
      <%
        } else {
          File[] files = currentDir.listFiles();
          if(files == null || files.length == 0) {
      %>
      <div class="empty">
        <p>This folder is empty</p>
      </div>
      <%
          } else {
            // Sort files: directories first, then files
            Arrays.sort(files, new Comparator<File>() {
              public int compare(File a, File b) {
                if(a.isDirectory() != b.isDirectory()) {
                  return a.isDirectory() ? -1 : 1;
                }
                return a.getName().compareToIgnoreCase(b.getName());
              }
            });
      %>
      <table class="file-list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <%
            // Add parent directory link if not at root
            if(!requestedPath.isEmpty()) {
              String parentPath = requestedPath;
              int lastSlash = parentPath.lastIndexOf('/');
              if(lastSlash > 0) {
                parentPath = parentPath.substring(0, lastSlash);
              } else {
                parentPath = "";
              }
              String encodedParent = URLEncoder.encode(parentPath, "UTF-8");
          %>
          <tr>
            <td colspan="3">
              <a href="fileManager.jsp?path=<%= encodedParent %>" class="file-name">
                <span class="icon folder-icon">📁</span>
                <span>..</span>
              </a>
            </td>
          </tr>
          <%
            }
            
            for(File file : files) {
              String fileName = file.getName();
              String encodedName = URLEncoder.encode(fileName, "UTF-8");
              String newPath = requestedPath.isEmpty() ? fileName : requestedPath + "/" + fileName;
              String encodedPath = URLEncoder.encode(newPath, "UTF-8");
          %>
          <tr>
            <td>
              <%
                if(file.isDirectory()) {
              %>
              <a href="fileManager.jsp?path=<%= encodedPath %>" class="file-name">
                <span class="icon folder-icon">📁</span>
                <span><%= fileName %></span>
              </a>
              <%
                } else {
              %>
              <span class="file-name">
                <span class="icon file-icon">📄</span>
                <span><%= fileName %></span>
              </span>
              <%
                }
              %>
            </td>
            <td class="size">
              <%
                if(file.isDirectory()) {
                  out.print("—");
                } else {
                  long size = file.length();
                  String sizeStr;
                  if(size < 1024) {
                    sizeStr = size + " B";
                  } else if(size < 1024 * 1024) {
                    sizeStr = String.format("%.1f KB", size / 1024.0);
                  } else if(size < 1024 * 1024 * 1024) {
                    sizeStr = String.format("%.1f MB", size / (1024.0 * 1024));
                  } else {
                    sizeStr = String.format("%.1f GB", size / (1024.0 * 1024 * 1024));
                  }
                  out.print(sizeStr);
                }
              %>
            </td>
            <td class="actions">
              <%
                if(file.isDirectory()) {
              %>
              <a href="fileManager.jsp?path=<%= encodedPath %>" class="btn btn-open">Open</a>
              <%
                } else {
              %>
              <a href="fileManager.jsp?path=<%= URLEncoder.encode(requestedPath, "UTF-8") %>&download=<%= encodedName %>" class="btn btn-download">Download</a>
              <%
                }
              %>
            </td>
          </tr>
          <%
            }
          %>
        </tbody>
      </table>
      <%
          }
        }
      %>
    </div>
    
    <div class="footer">
      <p>Current path: <strong><%= currentDir.getAbsolutePath() %></strong></p>
    </div>
  </div>
</body>
</html>
