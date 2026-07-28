// 原生 macOS 菜单（中文）
const { app, Menu, shell } = require('electron');
const path = require('path');

function send(win, action, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('menu:action', { action, payload });
  }
}

function buildMenu(win, ctx) {
  const isMac = process.platform === 'darwin';
  const recent = ctx.getRecent();

  const recentSubmenu = [];
  const recentFiles = (recent.files || []).slice(0, 8);
  const recentFolders = (recent.folders || []).slice(0, 5);
  if (recentFiles.length === 0 && recentFolders.length === 0) {
    recentSubmenu.push({ label: '暂无记录', enabled: false });
  } else {
    recentFiles.forEach((f) => {
      recentSubmenu.push({
        label: path.basename(f),
        sublabel: f,
        click: () => send(win, 'open-path', f),
      });
    });
    if (recentFolders.length) recentSubmenu.push({ type: 'separator' });
    recentFolders.forEach((f) => {
      recentSubmenu.push({
        label: `文件夹：${path.basename(f)}`,
        click: () => send(win, 'open-path', f),
      });
    });
    recentSubmenu.push({ type: 'separator' });
    recentSubmenu.push({ label: '清除记录', click: () => { ctx.clearRecent(); send(win, 'recent-changed'); } });
  }

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: '关于墨流', click: () => send(win, 'about') },
              { type: 'separator' },
              { label: '偏好设置…', accelerator: 'CmdOrCtrl+,', click: () => send(win, 'open-settings') },
              { type: 'separator' },
              { role: 'services', label: '服务' },
              { type: 'separator' },
              { role: 'hide', label: `隐藏${app.name}` },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              { role: 'quit', label: `退出${app.name}` },
            ],
          },
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建文件', accelerator: 'CmdOrCtrl+N', click: () => send(win, 'new-file') },
        { type: 'separator' },
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => send(win, 'open-file-dialog') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send(win, 'open-folder-dialog') },
        { label: '最近打开', submenu: recentSubmenu },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send(win, 'save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send(win, 'save-as') },
        { type: 'separator' },
        { label: '导出为 PDF…', accelerator: 'CmdOrCtrl+Alt+P', click: () => send(win, 'export-pdf') },
        { label: '导出为 Word…', accelerator: 'CmdOrCtrl+Alt+W', click: () => send(win, 'export-word') },
        { label: '导出为图片…', click: () => send(win, 'export-image') },
        { label: '导出为 HTML…', click: () => send(win, 'export-html') },
        { type: 'separator' },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: () => send(win, 'close-tab') },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '加粗', accelerator: 'CmdOrCtrl+B', click: () => send(win, 'format', 'bold') },
        { label: '斜体', accelerator: 'CmdOrCtrl+I', click: () => send(win, 'format', 'italic') },
        { label: '删除线', accelerator: 'CmdOrCtrl+Shift+X', click: () => send(win, 'format', 'strike') },
        { label: '行内代码', accelerator: 'CmdOrCtrl+E', click: () => send(win, 'format', 'inline-code') },
        { type: 'separator' },
        { label: '正文', accelerator: 'CmdOrCtrl+0', click: () => send(win, 'format', 'paragraph') },
        { label: '一级标题', accelerator: 'CmdOrCtrl+1', click: () => send(win, 'format', 'h1') },
        { label: '二级标题', accelerator: 'CmdOrCtrl+2', click: () => send(win, 'format', 'h2') },
        { label: '三级标题', accelerator: 'CmdOrCtrl+3', click: () => send(win, 'format', 'h3') },
        { label: '四级标题', accelerator: 'CmdOrCtrl+4', click: () => send(win, 'format', 'h4') },
        { label: '五级标题', accelerator: 'CmdOrCtrl+5', click: () => send(win, 'format', 'h5') },
        { label: '六级标题', accelerator: 'CmdOrCtrl+6', click: () => send(win, 'format', 'h6') },
        { type: 'separator' },
        { label: '引用', accelerator: 'CmdOrCtrl+Alt+Q', click: () => send(win, 'format', 'quote') },
        { label: '无序列表', accelerator: 'CmdOrCtrl+Alt+U', click: () => send(win, 'format', 'list') },
        { label: '有序列表', accelerator: 'CmdOrCtrl+Alt+O', click: () => send(win, 'format', 'ordered-list') },
        { label: '任务列表', accelerator: 'CmdOrCtrl+Alt+X', click: () => send(win, 'format', 'check') },
        { type: 'separator' },
        { label: '插入链接', accelerator: 'CmdOrCtrl+K', click: () => send(win, 'format', 'link') },
        { label: '插入图片', accelerator: 'CmdOrCtrl+Alt+I', click: () => send(win, 'insert-image') },
        { label: '插入表格', accelerator: 'CmdOrCtrl+Alt+T', click: () => send(win, 'format', 'table') },
        { label: '插入代码块', accelerator: 'CmdOrCtrl+Alt+C', click: () => send(win, 'format', 'code') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '快速打开文件', accelerator: 'CmdOrCtrl+P', click: () => send(win, 'quick-open') },
        { label: '命令面板', accelerator: 'CmdOrCtrl+Shift+P', click: () => send(win, 'command-palette') },
        { type: 'separator' },
        { label: '切换侧边栏', accelerator: 'CmdOrCtrl+Shift+L', click: () => send(win, 'toggle-sidebar') },
        { label: '切换大纲', accelerator: 'CmdOrCtrl+Shift+J', click: () => send(win, 'toggle-outline') },
        { label: '显示工具栏', type: 'checkbox', checked: ctx.getSetting('showToolbar', false), click: (item) => send(win, 'toggle-toolbar', item.checked) },
        { type: 'separator' },
        { label: '专注模式', accelerator: 'CmdOrCtrl+Shift+F', type: 'checkbox', checked: ctx.getSetting('focusMode', false), click: (item) => send(win, 'toggle-focus', item.checked) },
        { label: '打字机模式', accelerator: 'CmdOrCtrl+Shift+T', type: 'checkbox', checked: ctx.getSetting('typewriter', true), click: (item) => send(win, 'toggle-typewriter', item.checked) },
        {
          label: '页面宽度',
          submenu: [
            { label: '正常', type: 'radio', checked: ctx.getSetting('pageWidth', 'normal') === 'normal', click: () => send(win, 'set-page-width', 'normal') },
            { label: '超宽', type: 'radio', checked: ctx.getSetting('pageWidth', 'normal') === 'wide', click: () => send(win, 'set-page-width', 'wide') },
          ],
        },
        { type: 'separator' },
        { label: '外观：浅色', click: () => send(win, 'set-theme', 'light') },
        { label: '外观：深色', click: () => send(win, 'set-theme', 'dark') },
        { label: '外观：跟随系统', click: () => send(win, 'set-theme', 'system') },
        { type: 'separator' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', click: () => send(win, 'zoom', 1) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => send(win, 'zoom', -1) },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+Alt+0', click: () => send(win, 'zoom', 0) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '键盘快捷键', accelerator: 'CmdOrCtrl+/', click: () => send(win, 'show-shortcuts') },
        { label: '功能演示文档', click: () => send(win, 'open-demo') },
        { type: 'separator' },
        { label: 'Vditor 项目主页', click: () => shell.openExternal('https://github.com/Vanessa219/vditor') },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { buildMenu };
