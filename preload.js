const { contextBridge } = require('electron');

// レンダラープロセス（画面側）に安全なデスクトップ専用情報を公開
contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0'
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('リハビリ業務管理システム: デスクトップアプリケーションモードで起動しました。');
});
