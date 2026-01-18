export default {
  async fetch(request, env, ctx) {
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD;
    const R2_BUCKET = env.R2_BUCKET;
    if (!ADMIN_PASSWORD || !R2_BUCKET) {
      console.error('缺少必需的配置: ADMIN_PASSWORD 环境变量, R2_BUCKET 绑定');
      return new Response('请配置 ADMIN_PASSWORD 环境变量和 R2_BUCKET 绑定', { status: 500 });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 静态样式
    if (path === '/style.css') {
      return new Response(styleCss(), { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
    }

    // API路由
    if (path.startsWith('/api/')) {
      return handleApiRoutes(request, env, path, ADMIN_PASSWORD, R2_BUCKET);
    }

    // 登录校验 - 简单的cookie验证
    const isAuthenticated = await verifySession(request, ADMIN_PASSWORD);
    if (!isAuthenticated && path !== '/login') {
      return Response.redirect(url.origin + '/login', 302);
    }

    // 页面路由
    switch (path) {
      case '/login':
        return new Response(loginPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      case '/logout':
        return handleLogout();
      default:
        return new Response(adminPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  }
};

/**
 * 会话验证
 */
async function verifySession(request, adminPassword) {
  const cookie = request.headers.get('Cookie') || '';
  const sessionCookie = cookie.split('; ').find(c => c.startsWith('r2_admin_session='));
  if (!sessionCookie) return false;
  try {
    const sessionId = sessionCookie.split('=')[1];
    
    // 验证会话ID是否包含正确的密码哈希
    try {
      const decodedData = atob(sessionId);
      const [storedPassword, timestampStr] = decodedData.split(':');
      
      // 检查时间戳是否在24小时内
      const timestamp = parseInt(timestampStr);
      if (isNaN(timestamp) || Date.now() - timestamp > 24 * 60 * 60 * 1000) { // 24小时
        console.warn('会话已过期');
        return false;
      }
      
      // 验证密码是否匹配
      if (storedPassword === adminPassword) {
        return true;
      }
    } catch (decodeErr) {
      console.error('会话数据解码失败:', decodeErr);
      return false;
    }
    
    return false;
  } catch (e) {
    console.error('会话验证失败:', e);
    return false;
  }
}

/**
 * 创建登录会话
 */
async function createSessionCookie(adminPassword) {
  const timestamp = Date.now();
  const sessionId = btoa(adminPassword + ':' + timestamp);
  return 'r2_admin_session=' + sessionId + '; HttpOnly; Secure; Path=/; Max-Age=86400';
}

/**
 * 退出登录
 */
function handleLogout() {
  return new Response(null, {
    status: 302,
    headers: { 'Location': '/login', 'Set-Cookie': 'r2_admin_session=; HttpOnly; Secure; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT' }
  });
}

/**
 * 工具函数：规范化R2 Key（处理无/结尾的目录）
 */
function normalizeR2Key(key) {
  const trimmedKey = key.trim();
  // 若Key不含/且非空，视为目录（自动加/结尾）
  if (trimmedKey && !trimmedKey.includes('/') && !trimmedKey.endsWith('/')) {
    return trimmedKey + '/';
  }
  return trimmedKey;
}

/**
 * API核心路由（兼容所有Key格式+自动识别多级目录）
 */
async function handleApiRoutes(request, env, path, adminPassword, r2Bucket) {
  const pathParts = path.split('/').filter(part => part.trim());
  const action = pathParts[1] || '';
  const method = request.method;

  // 1. 登录API
  if (action === 'login' && method === 'POST') {
    const { password } = await request.json().catch(() => ({ password: '' }));
    if (password === adminPassword) {
      const cookie = await createSessionCookie(adminPassword);
      return new Response(JSON.stringify({ success: true }), { headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: false, msg: '密码错误' }), { status: 401 });
  }

  // 2. 登录校验
  if (!await verifySession(request, adminPassword)) {
    return new Response(JSON.stringify({ success: false, msg: '未登录' }), { status: 401 });
  }

  // 路径处理：支持多级目录（如""=根目录，"music/song"=music/song目录）
  const currentPath = pathParts.slice(2).join('/') || ''; // 当前目录（兼容多级）
  const folderPrefix = currentPath ? `${currentPath}/` : ''; // 目录前缀（用于R2查询）

  try {
    // 3. 总统计接口（兼容所有Key格式）
    if (action === 'total-stats' && method === 'GET') {
      const listResult = await r2Bucket.list({ prefix: '', limit: 10000 });
      const objects = listResult.objects;

      const folders = new Set();
      let fileCount = 0;
      let storageSize = 0;

      objects.forEach(obj => {
        const key = normalizeR2Key(obj.key);
        // 识别目录：以/结尾
        if (key.endsWith('/')) {
          const folder = key.slice(0, -1);
          if (folder) folders.add(folder);
          // 递归提取所有父目录（如music/song/ → 提取music、music/song）
          const folderParts = folder.split('/').filter(p => p);
          let parentFolder = '';
          folderParts.forEach(part => {
            parentFolder = parentFolder ? `${parentFolder}/${part}` : part;
            folders.add(parentFolder);
          });
        } else {
          fileCount++;
          storageSize += obj.size;
          // 提取文件所属目录及所有父目录
          const folder = key.lastIndexOf('/') > -1 ? key.slice(0, key.lastIndexOf('/')) : '';
          if (folder) {
            folders.add(folder);
            // 递归提取父目录（如music/song/1.2 → 提取music、music/song）
            const folderParts = folder.split('/').filter(p => p);
            let parentFolder = '';
            folderParts.forEach(part => {
              parentFolder = parentFolder ? `${parentFolder}/${part}` : part;
              folders.add(parentFolder);
            });
          }
        }
      });

      return new Response(JSON.stringify({
        success: true,
        totalFolderCount: folders.size,
        totalFileCount: fileCount,
        totalStorageSize: storageSize
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 4. 密钥验证接口
    if (action === 'verify-secret' && method === 'POST') {
      const { secret } = await request.json().catch(() => ({ secret: '' }));
      return new Response(JSON.stringify({ success: secret === adminPassword }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 5. 列表接口（简化版：可靠识别文件夹）
    if (action === 'list' && method === 'GET') {
      const listResult = await r2Bucket.list({ prefix: folderPrefix, limit: 10000 });
      const objects = listResult.objects;

      const currentFolders = new Set(); // 当前目录下的一级子目录
      const currentFiles = []; // 当前目录下的文件
      let dirSize = 0;

      objects.forEach(obj => {
        const originalKey = obj.key.trim();
        const key = normalizeR2Key(originalKey); // 规范化Key
        const relativeKey = key.slice(folderPrefix.length); // 去掉当前目录前缀

        if (!relativeKey) return; // 跳过前缀本身

        // 简化逻辑：
        if (relativeKey.includes('/')) {
          // 如果路径包含'/'，提取第一级目录作为文件夹
          const firstPart = relativeKey.split('/')[0];
          if (firstPart) {
            currentFolders.add(firstPart);
          }
          
          // 如果是文件（不以'/'结尾），添加到文件列表
          if (!relativeKey.endsWith('/')) {
            currentFiles.push({
              name: relativeKey.split('/').pop(), // 只显示文件名
              path: key, // 完整路径
              size: obj.size,
              lastModified: obj.uploaded,
              type: 'file'
            });
            dirSize += obj.size;
          }
        }
        else {
          // 不包含'/'的路径：以'/'结尾是文件夹，否则是文件
          if (relativeKey.endsWith('/')) {
            const folderName = relativeKey.slice(0, -1);
            if (folderName) currentFolders.add(folderName);
          } else {
            currentFiles.push({
              name: relativeKey,
              path: key, // 完整路径
              size: obj.size,
              lastModified: obj.uploaded,
              type: 'file'
            });
            dirSize += obj.size;
          }
        }
      });

      // 格式化目录数据
      const folders = Array.from(currentFolders).map(name => ({
        name: name,
        path: currentPath ? `${currentPath}/${name}` : name, // 目录完整路径
        type: 'folder'
      }));

      const stats = {
        folderCount: folders.length,
        fileCount: currentFiles.length,
        storageSize: dirSize
      };

      // 调试信息
      console.log(`当前目录${currentPath}：查询到${objects.length}个对象，识别出${folders.length}个目录，${currentFiles.length}个文件`);

      return new Response(JSON.stringify({
        success: true,
        debug: { 
          totalObjects: objects.length,
          currentPrefix: folderPrefix,
          sampleKeys: objects.slice(0, 3).map(o => o.key) // 显示前3个对象的原始Key，方便调试
        },
        currentPath: currentPath,
        parentPath: currentPath ? currentPath.split('/').slice(0, -1).join('/') : '',
        folders: folders,
        files: currentFiles,
        stats: stats
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 6. 创建文件夹（支持多级目录创建）
    if (action === 'create-folder' && method === 'POST') {
      const url = new URL(request.url);
      const folderName = decodeURIComponent(url.searchParams.get('name') || '').trim();
      const safeName = folderName.replace(/[^a-zA-Z0-9_\-\/\u4e00-\u9fa5]/g, '');
      
      if (!safeName) {
        return new Response(JSON.stringify({ success: false, msg: '文件夹名称不能为空' }), { status: 400 });
      }

      // 支持多级目录（如"music/song" → 自动创建music/和music/song/）
      const folderParts = safeName.split('/').filter(p => p);
      let currentPrefix = folderPrefix;
      let finalFolderKey = '';

      for (const part of folderParts) {
        const partKey = `${currentPrefix}${part}/`;
        // 检查该层级目录是否已存在
        const exists = await r2Bucket.head(partKey).catch(() => null);
        if (!exists) {
          await r2Bucket.put(partKey, new Uint8Array(0)); // 创建目录标记
        }
        currentPrefix = partKey;
        finalFolderKey = currentPrefix;
      }

      return new Response(JSON.stringify({
        success: true,
        msg: `多级目录创建成功（最终目录Key：${finalFolderKey}）`,
        folderKey: finalFolderKey
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 7. 上传文件（支持上传到多级目录，需要验证）
    if (action === 'upload' && method === 'POST') {
      // 验证密码
      const authHeader = request.headers.get('Authorization');
      const passwordFromHeader = authHeader ? authHeader.replace('Bearer ', '') : '';
      
      if (passwordFromHeader !== adminPassword) {
        return new Response(JSON.stringify({ success: false, msg: '上传操作需要验证密码' }), { status: 401 });
      }
      
      const formData = await request.formData().catch(() => null);
      if (!formData) return new Response(JSON.stringify({ success: false, msg: '表单解析失败' }), { status: 400 });

      const file = formData.get('file');
      if (!file) return new Response(JSON.stringify({ success: false, msg: '未选择文件' }), { status: 400 });

      const fileName = file.name.trim().replace(/[^a-zA-Z0-9_\-\/\u4e00-\u9fa5.()]/g, '');
      if (!fileName) return new Response(JSON.stringify({ success: false, msg: '文件名非法' }), { status: 400 });

      // 文件完整路径：当前目录前缀 + 文件名（支持多级目录下上传，如music/song/1.2）
      const fileKey = `${folderPrefix}${fileName}`;
      const exists = await r2Bucket.head(fileKey).catch(() => null);
      
      if (exists) {
        return new Response(JSON.stringify({ success: false, msg: '文件已存在' }), { status: 400 });
      }

      try {
        // 上传文件
        await r2Bucket.put(fileKey, file.stream(), {
          // 添加元数据信息
          customMetadata: {
            uploadedBy: 'R2AdminPanel',
            uploadedAt: new Date().toISOString()
          }
        });
        
        return new Response(JSON.stringify({
          success: true,
          msg: '文件上传成功',
          fileKey: fileKey,
          fileSize: file.size
        }), { headers: { 'Content-Type': 'application/json' } });
      } catch (uploadError) {
        console.error('文件上传失败:', uploadError);
        return new Response(JSON.stringify({ success: false, msg: '文件上传失败: ' + uploadError.message }), { status: 500 });
      }
    }

    // 8. 下载接口
    if (action === 'download' && method === 'GET') {
      const downloadKey = pathParts.slice(2).join('/') || '';
      if (!downloadKey) return new Response(JSON.stringify({ success: false, msg: '下载路径为空' }), { status: 400 });
      
      try {
        let object = await r2Bucket.get(downloadKey);
        if (!object) {
          // 如果原始路径不存在，尝试解码路径
          try {
            const decodedKey = decodeURIComponent(downloadKey);
            object = await r2Bucket.get(decodedKey);
            if (!object) {
              return new Response('文件不存在: ' + downloadKey, { status: 404 });
            }
          } catch (decodeErr) {
            console.error('路径解码失败:', decodeErr);
            return new Response('文件不存在: ' + downloadKey, { status: 404 });
          }
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        // 提取真实的文件名（最后一部分），确保不包含上级路径
        const pathParts = downloadKey.split('/');
        const actualFilename = pathParts[pathParts.length - 1].split('?')[0];
        // 确保文件名正确处理中文字符
        headers.set('Content-Disposition', 'attachment; filename*=UTF-8\'' + actualFilename + '\'');
        
        return new Response(object.body, {
          headers,
        });
      } catch (err) {
        console.error('文件下载失败:', err);
        return new Response(JSON.stringify({ success: false, msg: '文件下载失败: ' + err.message }), { status: 500 });
      }
    }

    // 9. 删除接口（修复版：支持删除多级目录和文件，需要验证）
    if (action === 'delete' && method === 'DELETE') {
      // 验证密码
      const authHeader = request.headers.get('Authorization');
      const passwordFromHeader = authHeader ? authHeader.replace('Bearer ', '') : '';
      
      if (passwordFromHeader !== adminPassword) {
        return new Response(JSON.stringify({ success: false, msg: '删除操作需要验证密码' }), { status: 401 });
      }
      
      // 从URL路径中获取删除键，需要正确解码
      const rawDeleteKey = pathParts.slice(2).join('/');
      let deleteKey = rawDeleteKey;
      
      // 尝试解码URL编码的路径
      try {
        deleteKey = decodeURIComponent(rawDeleteKey);
      } catch (e) {
        // 如果解码失败，使用原始路径
      }
      
      if (!deleteKey) return new Response(JSON.stringify({ success: false, msg: '删除路径为空' }), { status: 400 });
      
      // 验证路径安全，防止路径遍历攻击
      if (deleteKey.includes('../') || deleteKey.includes('..\\')) {
        return new Response(JSON.stringify({ success: false, msg: '无效路径' }), { status: 400 });
      }
      
      // 尝试删除对象
      try {
        // 先检查对象是否存在
        const headResult = await r2Bucket.head(deleteKey);
        if (!headResult) {
          // 如果不存在，尝试添加/后缀（作为文件夹）
          const folderKey = deleteKey.endsWith('/') ? deleteKey : deleteKey + '/';
          const folderHeadResult = await r2Bucket.head(folderKey);
          if (!folderHeadResult) {
            return new Response(JSON.stringify({ success: false, msg: '目标不存在: ' + deleteKey }), { status: 404 });
          } else {
            // 检查文件夹是否为空
            const listResult = await r2Bucket.list({ prefix: folderKey, limit: 2 });
            const nonDirObjects = listResult.objects.filter(obj => obj.key !== folderKey);
            if (nonDirObjects.length > 0) {
              return new Response(JSON.stringify({ success: false, msg: '文件夹非空，仅允许删除空文件夹' }), { status: 400 });
            }
            // 删除空文件夹
            await r2Bucket.delete(folderKey);
            return new Response(JSON.stringify({
              success: true,
              msg: '文件夹删除成功',
              deletedKey: folderKey
            }), { headers: { 'Content-Type': 'application/json' } });
          }
        }
        
        // 对象存在，直接删除
        await r2Bucket.delete(deleteKey);
        return new Response(JSON.stringify({
          success: true,
          msg: '文件删除成功',
          deletedKey: deleteKey
        }), { headers: { 'Content-Type': 'application/json' } });
        
      } catch (err) {
        console.error('删除失败:', err);
        return new Response(JSON.stringify({ success: false, msg: '删除失败: ' + err.message }), { status: 500 });
      }
    }

    return new Response(JSON.stringify({ success: false, msg: '接口不存在' }), { status: 404 });
  } catch (err) {
    console.error('API错误:', err);
    return new Response(JSON.stringify({ success: false, msg: '操作失败: ' + err.message, error: err.stack }), { status: 500 });
  }
}

/**
 * 登录页面
 */
function loginPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>R2登录</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="login-container">
    <div class="login-card">
      <h2>R2存储管理系统</h2>
      <form id="loginForm">
        <div class="form-group">
          <input type="password" id="password" placeholder="输入管理密码" required>
        </div>
        <button type="submit" class="btn primary-btn w-100">登录</button>
        <div id="error" class="error-msg"></div>
      </form>
    </div>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = document.getElementById('password').value.trim();
      const errorEl = document.getElementById('error');
      if (!pwd) { errorEl.textContent = '请输入密码'; return; }
      try {
        const res = await fetch('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (data.success) window.location.href = '/';
        else errorEl.textContent = data.msg || '登录失败';
      } catch (err) {
        errorEl.textContent = '网络错误: ' + err.message;
      }
    });
  </script>
</body>
</html>`;
}

/**
 * 管理页面（支持多级目录渲染+根目录文件显示）
 */
function adminPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>R2存储管理系统</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="navbar">
    <div class="container">
      <h1>R2存储管理系统</h1>
      <button onclick="window.location.href='/logout'" class="btn danger-btn">退出登录</button>
    </div>
  </header>
  <main class="container">
    <!-- 面包屑（支持多级目录） -->
    <div class="breadcrumbs" id="breadcrumbs">
      <a href="#" data-path="">首页</a>
    </div>

    <!-- 统计区域 -->
    <div class="stats-container" id="statsContainer">
      <div class="stat-item">
        <span class="stat-label" id="folderLabel">总文件夹数</span>
        <span class="stat-value" id="folderCount">加载中...</span>
      </div>
      <div class="stat-item">
        <span class="stat-label" id="fileLabel">总文件数</span>
        <span class="stat-value" id="fileCount">加载中...</span>
      </div>
      <div class="stat-item">
        <span class="stat-label" id="sizeLabel">总存储大小</span>
        <span class="stat-value" id="totalSize">加载中...</span>
      </div>
    </div>

    <!-- 操作按钮区 -->
    <div class="action-bar">
      <button id="createFolderBtn" class="btn primary-btn">创建文件夹</button>
      <label for="fileUpload" class="btn primary-btn" id="uploadBtn">上传文件</label>
      <input type="file" id="fileUpload" style="display: none;">
      <button id="batchDeleteBtn" class="btn danger-btn" style="display:none;">批量删除</button>
      <button id="refreshBtn" class="btn info-btn">刷新</button>
      <span id="selectedCount" style="margin-left: 10px; color: #666;">已选择: 0</span>
    </div>



    <!-- 列表区域 -->
    <div class="content-list">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" id="selectAllCheckbox"></th>
            <th>名称</th>
            <th>类型</th>
            <th>大小</th>
            <th>修改时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="listBody">
          <tr><td colspan="6" class="loading">加载中...</td></tr>
        </tbody>
      </table>
    </div>
  </main>

  <!-- 模态框：创建文件夹 -->
  <div class="modal" id="createFolderModal">
    <div class="modal-content">
      <h3>创建文件夹</h3>
      <div class="form-group">
        <input type="text" id="folderNameInput" placeholder="输入文件夹名称">
      </div>
      <div class="modal-actions">
        <button id="cancelCreateBtn" class="btn secondary-btn">取消</button>
        <button id="confirmCreateBtn" class="btn primary-btn">确认创建</button>
      </div>
    </div>
  </div>

  <!-- 模态框：删除确认 -->
  <div class="modal" id="deleteModal">
    <div class="modal-content">
      <h3 id="deleteModalTitle">确认删除？</h3>
      <p id="deleteModalDesc">此操作不可恢复，请谨慎操作！</p>
      <div class="modal-actions">
        <button id="cancelDeleteBtn" class="btn secondary-btn">取消</button>
        <button id="confirmDeleteBtn" class="btn danger-btn">确认删除</button>
      </div>
    </div>
  </div>

  <!-- 模态框：密钥验证 -->
  <div class="modal" id="verifySecretModal">
    <div class="modal-content">
      <h3>验证管理密钥</h3>
      
      <div class="form-group">
        <input type="password" id="secretInput" placeholder="输入管理密码">
      </div>
      <div class="modal-actions">
        <button id="cancelVerifyBtn" class="btn secondary-btn">取消</button>
        <button id="confirmVerifyBtn" class="btn primary-btn">确认验证</button>
      </div>
    </div>
  </div>

  <!-- 提示框 -->
  <div class="toast" id="toast"></div>

  <script>
    let currentFolderPath = '';
    let deleteTarget = { path: '', type: '' };

    // DOM元素
    const DOM = {
      folderLabel: document.getElementById('folderLabel'),
      fileLabel: document.getElementById('fileLabel'),
      sizeLabel: document.getElementById('sizeLabel'),
      folderCount: document.getElementById('folderCount'),
      fileCount: document.getElementById('fileCount'),
      totalSize: document.getElementById('totalSize'),
      breadcrumbs: document.getElementById('breadcrumbs'),
      listBody: document.getElementById('listBody'),
      createFolderBtn: document.getElementById('createFolderBtn'),
      uploadBtn: document.getElementById('uploadBtn'),
      fileUpload: document.getElementById('fileUpload'),
      createFolderModal: document.getElementById('createFolderModal'),
      folderNameInput: document.getElementById('folderNameInput'),
      cancelCreateBtn: document.getElementById('cancelCreateBtn'),
      confirmCreateBtn: document.getElementById('confirmCreateBtn'),
      deleteModal: document.getElementById('deleteModal'),
      deleteModalTitle: document.getElementById('deleteModalTitle'),
      deleteModalDesc: document.getElementById('deleteModalDesc'),
      cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
      confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
      verifySecretModal: document.getElementById('verifySecretModal'),
      secretInput: document.getElementById('secretInput'),
      cancelVerifyBtn: document.getElementById('cancelVerifyBtn'),
      confirmVerifyBtn: document.getElementById('confirmVerifyBtn'),
      toast: document.getElementById('toast'),


      batchDeleteBtn: document.getElementById('batchDeleteBtn'),
      selectedCount: document.getElementById('selectedCount'),
      selectAllCheckbox: document.getElementById('selectAllCheckbox'),
      refreshBtn: document.getElementById('refreshBtn')
    };

    // 工具函数
    function formatFileSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
    }

    function formatTime(timeStr) {
      return new Date(timeStr).toLocaleString() || '未知';
    }

    function showToast(msg, type = 'info') {
      DOM.toast.textContent = msg;
      DOM.toast.className = 'toast ' + type;
      DOM.toast.style.display = 'block';
      setTimeout(() => DOM.toast.style.display = 'none', 3000);
    }
    
    // 复制到剪贴板功能
    async function copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(decodeURIComponent(text));
        showToast('路径已复制到剪贴板: ' + decodeURIComponent(text), 'success');
      } catch (err) {
        // 如果navigator.clipboard不可用，则使用旧方法
        const textArea = document.createElement('textarea');
        textArea.value = decodeURIComponent(text);
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('路径已复制到剪贴板: ' + decodeURIComponent(text), 'success');
      }
    }
    
    // 更新选择状态
    function updateSelectionStatus() {
      const checkboxes = document.querySelectorAll('.item-checkbox');
      const checkedBoxes = document.querySelectorAll('.item-checkbox:checked');
      
      // 更新选择计数
      DOM.selectedCount.textContent = '已选择: ' + checkedBoxes.length;
      
      // 更新批量删除按钮状态
      if (checkedBoxes.length > 0) {
        DOM.batchDeleteBtn.style.display = 'inline-block';
      } else {
        DOM.batchDeleteBtn.style.display = 'none';
      }
      
      // 更新全选复选框状态
      const allSelected = checkboxes.length > 0 && checkboxes.length === checkedBoxes.length;
      DOM.selectAllCheckbox.checked = allSelected;
    }

    // 渲染面包屑（支持多级目录）
    function renderBreadcrumbs(currentPath, parentPath) {
      let html = '<a href="#" data-path="">首页</a>';
      if (currentPath) {
        const pathParts = currentPath.split('/').filter(p => p);
        let subPath = '';
        pathParts.forEach(part => {
          subPath += (subPath ? '/' : '') + part;
          html += ' / <a href="#" data-path="' + encodeURIComponent(subPath) + '">' + part + '</a>';
        });
      }
      DOM.breadcrumbs.innerHTML = html;
    }

    // 渲染统计数据
    function renderStats(isHome = false, stats = {}) {
      if (isHome) {
        DOM.folderLabel.textContent = '文件夹总数';
        DOM.fileLabel.textContent = '文件总数';
        DOM.sizeLabel.textContent = '总存储';
        DOM.folderCount.textContent = stats.totalFolderCount || 0;
        DOM.fileCount.textContent = stats.totalFileCount || 0;
        DOM.totalSize.textContent = formatFileSize(stats.totalStorageSize || 0);
      } else {
        DOM.folderLabel.textContent = '子文件夹';
        DOM.fileLabel.textContent = '文件数';
        DOM.sizeLabel.textContent = '目录大小';
        DOM.folderCount.textContent = stats.folderCount || 0;
        DOM.fileCount.textContent = stats.fileCount || 0;
        DOM.totalSize.textContent = formatFileSize(stats.storageSize || 0);
      }
    }

    // 加载首页总统计
    async function loadHomeTotalStats() {
      try {
        const res = await fetch('/api/total-stats');
        const data = await res.json();
        if (data.success) {
          renderStats(true, data);
        } else {
          showToast('获取总统计失败: ' + data.msg, 'error');
          renderStats(true, {});
        }
      } catch (err) {
        showToast('获取总统计失败: ' + err.message, 'error');
        renderStats(true, {});
      }
    }

    // 加载目录（支持多级目录+根目录文件）
    async function loadDirectory(targetPath = '') {
      currentFolderPath = targetPath;
      DOM.listBody.innerHTML = '<tr><td colspan="6" class="loading">加载中...</td></tr>';


      try {
        const encodedPath = encodeURIComponent(currentFolderPath);
        const res = await fetch('/api/list/' + encodedPath, { cache: 'no-cache' });
        const data = await res.json();
        


        if (!data.success) {
          DOM.listBody.innerHTML = '<tr><td colspan="6" class="error">加载失败: ' + data.msg + '</td></tr>';
          showToast(data.msg, 'error');
          console.error('列表接口失败:', data);
          return;
        }

        // 渲染面包屑和统计
        renderBreadcrumbs(data.currentPath, data.parentPath);
        if (currentFolderPath === '') {
          // 根目录显示总统计
          await loadHomeTotalStats();
        } else {
          // 子目录显示当前目录统计
          renderStats(false, data.stats);
        }
        
        // 根据当前路径决定显示内容
        let itemsToShow;
        if (currentFolderPath === '') {
          // 根目录只显示文件夹，不显示文件
          itemsToShow = data.folders || [];
          if (itemsToShow.length === 0) {
            if ((data.files || []).length > 0) {
              // 如果没有文件夹但有文件，尝试从文件路径中提取文件夹
              const extractedFolders = new Set();
              data.files.forEach(file => {
                const fileName = file.path || '';
                if (fileName.includes('/')) {
                  const folderName = fileName.split('/')[0];
                  if (folderName) extractedFolders.add(folderName);
                }
              });
              
              if (extractedFolders.size > 0) {
                // 使用提取的文件夹
                itemsToShow = Array.from(extractedFolders).map(folderName => ({
                  name: folderName,
                  path: folderName,
                  type: 'folder'
                }));
              } else {
                DOM.listBody.innerHTML = '<tr><td colspan="6" class="empty">根目录下无文件夹，但有 ' + (data.files || []).length + ' 个文件</td></tr>';
                return;
              }
            } else {
              DOM.listBody.innerHTML = '<tr><td colspan="6" class="empty">根目录下无内容</td></tr>';
              return;
            }
          }
        } else {
          // 子目录显示文件和文件夹
          itemsToShow = [...data.folders, ...data.files];
          if (itemsToShow.length === 0) {
            DOM.listBody.innerHTML = '<tr><td colspan="6" class="empty">此目录为空</td></tr>';
            return;
          }
        }

        let html = '';
        itemsToShow.forEach(item => {
          const name = item.name || '未知名称';
          const itemFullPath = item.path || '';
          const type = item.type || 'file';
          const size = type === 'folder' ? '-' : formatFileSize(item.size || 0);
          const time = type === 'folder' ? '-' : formatTime(item.lastModified);
          const icon = type === 'folder' ? '📁' : '📄';
          
          // 添加文件操作选项
          let actionHtml = '<button class="btn operation-btn delete-btn" data-path="' + encodeURIComponent(itemFullPath) + '" data-type="' + type + '" title="删除"><i class="icon">🗑️</i> 删除</button>';
          
          if (type === 'file') {
            // 为文件添加下载链接
            // 提取文件名部分，避免路径信息
            const fileName = itemFullPath.split('/').pop();
            actionHtml += ' <a href="/api/download/' + encodeURIComponent(itemFullPath) + '" class="btn operation-btn download-btn" target="_blank" download="' + fileName + '" title="下载"><i class="icon">⬇️</i> 下载</a>';

          } else {

          }
          
          const nameHtml = type === 'folder' 
            ? '<span class="folder-name" data-path="' + encodeURIComponent(itemFullPath) + '">' + icon + ' ' + name + '</span>'
            : icon + ' ' + name;
          
          html += '<tr data-path="' + encodeURIComponent(itemFullPath) + '" data-type="' + type + '">' +
            '<td><input type="checkbox" class="item-checkbox" data-path="' + encodeURIComponent(itemFullPath) + '"></td>' +
            '<td>' + nameHtml + '</td>' +
            '<td>' + (type === 'folder' ? '目录' : '文件') + '</td>' +
            '<td>' + size + '</td>' +
            '<td>' + time + '</td>' +
            '<td>' + actionHtml + '</td>' +
          '</tr>';
        });
        DOM.listBody.innerHTML = html;

        // 绑定目录点击事件（进入子目录）
        document.querySelectorAll('.folder-name').forEach(el => {
          el.addEventListener('click', () => {
            const targetPath = decodeURIComponent(el.dataset.path);
            loadDirectory(targetPath);
          });
        });

        // 绑定删除按钮事件
        document.querySelectorAll('.delete-btn').forEach(el => {
          el.addEventListener('click', async () => {
            const path = decodeURIComponent(el.dataset.path);
            const type = el.dataset.type;
            
            // 请求输入密码进行验证
            const password = prompt('请输入管理密码以确认删除操作：');
            if (!password) return;
            
            try {
              // 直接使用路径，避免双重编码
              const res = await fetch('/api/delete/' + path, { 
                method: 'DELETE', 
                cache: 'no-cache',
                headers: {
                  'Authorization': 'Bearer ' + password
                }
              });
              const data = await res.json();
              if (data.success) {
                showToast((type === 'folder' ? '文件夹' : '文件') + '删除成功', 'success');
                loadDirectory(currentFolderPath);
              } else {
                showToast(data.msg, 'error');
              }
            } catch (err) {
              showToast('删除失败: ' + err.message, 'error');
              console.error('删除失败:', err);
            }
          });
        });
        
        // 绑定下载按钮事件（如果有的话）
        document.querySelectorAll('.download-btn').forEach(el => {
          el.addEventListener('click', (e) => {
            // 让默认的链接行为生效
          });
        });
        

      } catch (err) {
        DOM.listBody.innerHTML = '<tr><td colspan="6" class="error">加载失败: ' + err.message + '</td></tr>';
        showToast(err.message, 'error');
        console.error('加载目录失败:', err);
      }
    }

    // 绑定创建文件夹事件（支持多级）
    function bindCreateFolderEvent() {
      DOM.createFolderBtn.addEventListener('click', () => {
        DOM.folderNameInput.value = '';
        DOM.createFolderModal.style.display = 'flex';
        DOM.folderNameInput.focus();
      });

      DOM.cancelCreateBtn.addEventListener('click', () => {
        DOM.createFolderModal.style.display = 'none';
      });

      DOM.confirmCreateBtn.addEventListener('click', async () => {
        const folderName = DOM.folderNameInput.value.trim();
        if (!folderName) {
          showToast('请输入文件夹名称', 'warning');
          return;
        }

        DOM.createFolderModal.style.display = 'none';
        try {
          const encodedPath = encodeURIComponent(currentFolderPath);
          const encodedName = encodeURIComponent(folderName);
          const res = await fetch(
            '/api/create-folder/' + encodedPath + '?name=' + encodedName,
            { method: 'POST', cache: 'no-cache' }
          );
          const data = await res.json();
          if (data.success) {
            showToast(data.msg, 'success');
            loadDirectory(currentFolderPath);
          } else {
            showToast(data.msg, 'error');
          }
          console.log('创建文件夹结果:', data);
        } catch (err) {
          showToast('创建失败: ' + err.message, 'error');
          console.error('创建文件夹失败:', err);
        }
      });
    }

    // 定义上传处理函数（移到函数外部，避免重复定义）
    const handleFileUpload = async (e) => {
      // 使用 setTimeout 来确保 prompt 不会干扰事件流
      setTimeout(async () => {
        const files = e.target.files;
        if (!files || files.length === 0) {
          return;
        }

        const file = files[0];
        if (!file) {
          return;
        }
        
        // 请求输入密码进行验证
        const password = prompt('请输入管理密码以上传文件：');
        if (!password) {
          showToast('上传已取消：未提供密码', 'warning');
          // 只在用户取消密码输入时清空文件输入框
          DOM.fileUpload.value = '';
          return;
        }
        
        const formData = new FormData();
        formData.append('file', file);

        // 显示上传进度
        showToast('正在上传文件: ' + file.name + ' (' + formatFileSize(file.size) + ')', 'info');
        
        try {
          const encodedPath = encodeURIComponent(currentFolderPath);
          
          // 使用 fetch API 实现带进度的上传
          const xhr = new XMLHttpRequest();
          
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const percentComplete = (event.loaded / event.total) * 100;
              showToast('上传进度: ' + percentComplete.toFixed(1) + '% (' + formatFileSize(event.loaded) + '/' + formatFileSize(event.total) + ')', 'info');
            }
          });
          
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText);
                if (data.success) {
                  showToast('文件上传成功（' + data.fileKey + '，' + formatFileSize(data.fileSize) + '）', 'success');
                  loadDirectory(currentFolderPath);
                } else {
                  showToast(data.msg, 'error');
                }
              } catch (parseErr) {
                showToast('服务器响应解析失败', 'error');
                console.error('解析响应失败:', parseErr);
              }
            } else {
              showToast('上传失败: ' + xhr.statusText, 'error');
            }
            // 上传完成后清空文件输入框
            DOM.fileUpload.value = '';
          });
          
          xhr.addEventListener('error', () => {
            showToast('上传失败: 网络错误', 'error');
            // 错误时清空文件输入框
            DOM.fileUpload.value = '';
          });
          
          xhr.addEventListener('abort', () => {
            showToast('上传已取消', 'warning');
            // 取消时清空文件输入框
            DOM.fileUpload.value = '';
          });
          
          xhr.open('POST', '/api/upload/' + encodedPath);
          xhr.setRequestHeader('Authorization', 'Bearer ' + password);
          xhr.send(formData);
        } catch (err) {
          showToast('上传失败: ' + err.message, 'error');
          console.error('上传文件失败:', err);
          // 异常时清空文件输入框
          DOM.fileUpload.value = '';
        }
      }, 0);
    };
    
    // 绑定文件上传事件（支持根目录上传）
    function bindFileUploadEvent() {
      // 不需要额外绑定点击事件，因为HTML中使用了label for属性来触发
      
      // 确保只绑定一次事件，先移除可能存在的事件监听器
      DOM.fileUpload.removeEventListener('change', handleFileUpload);
      DOM.fileUpload.addEventListener('change', handleFileUpload);
    }
    
    // 绑定其他事件
    function bindOtherEvents() {
      // 密钥验证
      DOM.cancelVerifyBtn.addEventListener('click', () => {
        DOM.verifySecretModal.style.display = 'none';
      });

      DOM.secretInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') DOM.confirmVerifyBtn.click();
      });

      // 移除旧的验证按钮事件，因为现在直接在删除操作中验证

      // 批量删除确认
      DOM.cancelDeleteBtn.addEventListener('click', () => {
        DOM.deleteModal.style.display = 'none';
      });

      // 删除确认按钮事件（已废弃，使用直接删除）
      // DOM.confirmDeleteBtn.addEventListener('click', async () => {
      //   DOM.deleteModal.style.display = 'none';
      //   
      //   // 请求输入密码进行验证
      //   const password = prompt('请输入管理密码以确认批量删除操作：');
      //   if (!password) {
      //     return;
      //   }
      //   
      //   const checkedBoxes = document.querySelectorAll('.item-checkbox:checked');
      //   if (checkedBoxes.length > 1) {
      //     // 批量删除
      //     const itemsToDelete = Array.from(checkedBoxes).map(cb => {
      //       return { path: cb.dataset.path, type: cb.closest('tr').dataset.type };
      //     });
      //     
      //     showToast('正在批量删除 ' + itemsToDelete.length + ' 个项目...', 'info');
      //     let successCount = 0;
      //     let errorCount = 0;
      //     
      //     for (const item of itemsToDelete) {
      //       try {
      //         const encodedPath = encodeURIComponent(item.path);
      //         const res = await fetch('/api/delete/' + encodedPath, { 
      //           method: 'DELETE', 
      //           cache: 'no-cache',
      //           headers: {
      //             'Authorization': 'Bearer ' + password
      //           }
      //         });
      //         const data = await res.json();
      //         if (data.success) {
      //           successCount++;
      //         } else {
      //           errorCount++;
      //           console.error('删除失败:', item.path, data.msg);
      //         }
      //       } catch (err) {
      //         errorCount++;
      //         console.error('删除失败:', item.path, err.message);
      //       }
      //     }
      //     
      //     showToast('批量删除完成: 成功 ' + successCount + ', 失败 ' + errorCount, successCount > 0 ? 'success' : 'error');
      //     loadDirectory(currentFolderPath);
      //   }
      // });

      // 面包屑点击（返回上级目录）
      DOM.breadcrumbs.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') {
          e.preventDefault();
          const path = decodeURIComponent(e.target.dataset.path || '');
          loadDirectory(path);
        }
      });

      // 模态框外部关闭
      window.addEventListener('click', (e) => {
        if (e.target === DOM.createFolderModal) DOM.createFolderModal.style.display = 'none';
        if (e.target === DOM.deleteModal) DOM.deleteModal.style.display = 'none';
        if (e.target === DOM.verifySecretModal) DOM.verifySecretModal.style.display = 'none';
      });
      
      // 批量操作事件

      
      // 表格行复选框事件
      document.addEventListener('change', (e) => {
        if (e.target.classList.contains('item-checkbox')) {
          updateSelectionStatus();
        }
      });
      
      // 全选复选框事件
      DOM.selectAllCheckbox.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.item-checkbox');
        checkboxes.forEach(checkbox => {
          checkbox.checked = e.target.checked;
        });
        updateSelectionStatus();
      });
      
      // 批量删除按钮事件
      DOM.batchDeleteBtn.addEventListener('click', async () => {
        const selectedPaths = Array.from(document.querySelectorAll('.item-checkbox:checked')).map(cb => {
          return { path: cb.dataset.path, type: cb.closest('tr').dataset.type };
        });
        
        if (selectedPaths.length === 0) {
          showToast('请先选择要删除的项目', 'warning');
          return;
        }
        
        // 请求输入密码进行验证
        const password = prompt('请输入管理密码以确认批量删除操作：');
        if (!password) return;
        
        showToast('正在批量删除 ' + selectedPaths.length + ' 个项目...', 'info');
        let successCount = 0;
        let errorCount = 0;
        
        for (const item of selectedPaths) {
          try {
            // 直接使用路径，避免双重编码
            const res = await fetch('/api/delete/' + item.path, { 
              method: 'DELETE', 
              cache: 'no-cache',
              headers: {
                'Authorization': 'Bearer ' + password
              }
            });
            const data = await res.json();
            if (data.success) {
              successCount++;
            } else {
              errorCount++;
              console.error('删除失败:', item.path, data.msg);
            }
          } catch (err) {
            errorCount++;
            console.error('删除失败:', item.path, err.message);
          }
        }
        
        showToast('批量删除完成: 成功 ' + successCount + ', 失败 ' + errorCount, successCount > 0 ? 'success' : 'error');
        loadDirectory(currentFolderPath);
        
        // 批量删除后清除所有选中的复选框
        document.querySelectorAll('.item-checkbox:checked').forEach(checkbox => {
          checkbox.checked = false;
        });
        DOM.selectAllCheckbox.checked = false;
        updateSelectionStatus();
      });
      
      // 刷新按钮事件
      DOM.refreshBtn.addEventListener('click', () => {
        loadDirectory(currentFolderPath);
        showToast('页面已刷新', 'info');
      });
    }

    // 初始化
    window.onload = () => {
      bindCreateFolderEvent();
      bindFileUploadEvent();
      bindOtherEvents();
      loadDirectory(''); // 加载根目录
      console.log('页面初始化完成，支持多级目录和根目录文件识别');
    };
  </script>
</body>
</html>`;
}

/**
 * 完整样式
 */
function styleCss() {
  return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: sans-serif;
  }
  body {
    background-color: #f5f5f5;
    color: #333;
  }
  .container {
    width: 95%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 15px;
  }
  .navbar {
    background-color: #fff;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    padding: 15px 0;
    margin-bottom: 20px;
  }
  .navbar .container {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.1s;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  .btn:active {
    transform: translateY(1px);
  }
  .primary-btn {
    background: linear-gradient(to bottom, #165DFF, #0E4BDB);
    color: #fff;
    border: 1px solid #0E4BDB;
  }
  .primary-btn:hover {
    background: linear-gradient(to bottom, #0E4BDB, #0A3DA7);
  }
  .secondary-btn {
    background: linear-gradient(to bottom, #6c757d, #5a6268);
    color: #fff;
    border: 1px solid #5a6268;
  }
  .secondary-btn:hover {
    background: linear-gradient(to bottom, #5a6268, #4a5258);
  }
  .danger-btn {
    background: linear-gradient(to bottom, #dc3545, #c82333);
    color: #fff;
    border: 1px solid #c82333;
  }
  .danger-btn:hover {
    background: linear-gradient(to bottom, #c82333, #a71c2a);
  }
  .success-btn {
    background: linear-gradient(to bottom, #28a745, #218838);
    color: #fff;
    border: 1px solid #218838;
  }
  .success-btn:hover {
    background: linear-gradient(to bottom, #218838, #1e7e34);
  }
  .warning-btn {
    background: linear-gradient(to bottom, #ffc107, #e0a800);
    color: #212529;
    border: 1px solid #e0a800;
  }
  .warning-btn:hover {
    background: linear-gradient(to bottom, #e0a800, #d39e00);
  }
  .info-btn {
    background: linear-gradient(to bottom, #17a2b8, #138496);
    color: #fff;
    border: 1px solid #138496;
  }
  .info-btn:hover {
    background: linear-gradient(to bottom, #138496, #117a8b);
  }
  .operation-btn {
    padding: 6px 8px;
    font-size: 12px;
    margin-right: 5px;
    background: linear-gradient(to bottom, #6c757d, #5a6268);
    color: #fff;
    border: 1px solid #5a6268;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.1s;
    display: inline-block;
    text-align: center;
    min-width: 70px;
    box-sizing: border-box;
  }
  .icon {
    display: inline-block;
    margin-right: 4px;
    font-size: 1em;
    vertical-align: middle;
  }
  .operation-btn:hover {
    background: linear-gradient(to bottom, #5a6268, #4a5258);
  }
  .download-btn {
    background: linear-gradient(to bottom, #28a745, #218838);
    color: #fff;
    border: 1px solid #218838;
    padding: 6px 8px;
    font-size: 12px;
    min-width: 40px;
    display: inline-block;
    text-align: center;
    box-sizing: border-box;
  }
  .download-btn:hover {
    background: linear-gradient(to bottom, #218838, #1e7e34);
  }
  .delete-btn {
    background: linear-gradient(to bottom, #dc3545, #c82333);
    color: #fff;
    border: 1px solid #c82333;
    padding: 6px 8px;
    font-size: 12px;
    min-width: 40px;
    display: inline-block;
    text-align: center;
    box-sizing: border-box;
  }
  .delete-btn:hover {
    background: linear-gradient(to bottom, #c82333, #a71c2a);
  }
  .breadcrumbs {
    margin-bottom: 15px;
    font-size: 14px;
  }
  .breadcrumbs a {
    color: #165DFF;
    text-decoration: none;
    margin: 0 5px;
  }
  .breadcrumbs a:hover {
    text-decoration: underline;
  }
  .stats-container {
    display: flex;
    gap: 20px;
    margin-bottom: 15px;
    flex-wrap: wrap;
  }
  .stat-item {
    background-color: #fff;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    flex: 1;
    min-width: 120px;
  }
  .stat-label {
    font-size: 13px;
    color: #6c757d;
    display: block;
    margin-bottom: 4px;
  }
  .stat-value {
    font-size: 18px;
    font-weight: 600;
    color: #333;
  }
  .action-bar {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
    flex-wrap: wrap;
  }
  .content-list {
    background-color: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 600px;
  }
  th, td {
    padding: 12px 15px;
    text-align: left;
    border-bottom: 1px solid #eee;
  }
  th {
    background-color: #f8f8f8;
    font-weight: 600;
    font-size: 14px;
  }
  td {
    font-size: 14px;
  }
  .folder-name {
    color: #165DFF;
    cursor: pointer;
    font-weight: 500;
  }
  .folder-name:hover {
    text-decoration: underline;
  }
  .operation-btn {
    padding: 4px 8px;
    font-size: 12px;
  }
  .loading {
    text-align: center;
    color: #666;
    padding: 40px;
  }
  .empty {
    text-align: center;
    color: #666;
    padding: 40px;
    font-style: italic;
  }
  .error {
    text-align: center;
    color: #dc3545;
    padding: 40px;
  }
  .modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 999;
  }
  .modal-content {
    background: #fff;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 400px;
  }
  .modal-content h3 {
    margin-bottom: 15px;
    color: #333;
  }
  .modal-content p {
    margin-bottom: 20px;
    color: #666;
    line-height: 1.5;
  }
  .form-group {
    margin-bottom: 20px;
  }
  .form-group input {
    width: 100%;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
  }
  .modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 20px;
    border-radius: 4px;
    color: #fff;
    display: none;
    z-index: 1000;
  }
  .toast.info {
    background-color: #165DFF;
  }
  .toast.success {
    background-color: #28a745;
  }
  .toast.error {
    background-color: #dc3545;
  }
  .toast.warning {
    background-color: #ffc107;
    color: #333;
  }
  .login-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .login-card {
    background-color: #fff;
    padding: 30px;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    width: 90%;
    max-width: 350px;
  }
  .login-card h2 {
    text-align: center;
    margin-bottom: 25px;
    color: #165DFF;
  }
  .login-card .form-group {
    margin-bottom: 20px;
  }
  .login-card .form-group input {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 16px;
  }
  .login-card .btn {
    width: 100%;
    padding: 12px;
    font-size: 16px;
  }
  .error-msg {
    color: #dc3545;
    text-align: center;
    margin-top: 15px;
    font-size: 14px;
  }
  @media (max-width: 768px) {
    .stats-container {
      flex-direction: row;
      gap: 5px;
    }
    .stat-item {
      flex: 1;
      min-width: 0;
      padding: 8px;
      text-align: center;
    }
    .stat-label {
      font-size: 11px;
    }
    .stat-value {
      font-size: 14px;
    }
    .action-bar {
      flex-wrap: wrap;
      flex-direction: row;
      gap: 5px;
    }
    .btn {
      flex: 1;
      min-width: 80px;
      margin-bottom: 0;
      padding: 8px 5px;
      font-size: 13px;
    }
    .container {
      padding: 10px;
    }
    th, td {
      padding: 8px 10px;
      font-size: 13px;
    }
    /* 在小屏幕上隐藏最后两列，只保留关键信息 */
    th:nth-child(4), td:nth-child(4),
    th:nth-child(5), td:nth-child(5) {
      display: none;
    }
    .operation-btn {
      padding: 6px 8px;
      font-size: 12px;
      margin-right: 5px;
      display: inline-block;
      text-align: center;
      min-width: 60px;
    }
    .download-btn, .delete-btn {
      padding: 6px 8px;
      font-size: 12px;
      min-width: 70px;
      display: inline-block;
      text-align: center;
      margin-right: 5px;
      white-space: nowrap;
    }
    #selectedCount {
      font-size: 13px;
      margin-top: 8px;
      display: block;
      text-align: center;
    }
    /* 优化移动端表格水平滚动 */
    .content-list {
      overflow-x: auto;
    }
    table {
      min-width: 100%;
      display: table;
    }
  }`;
}