if (process.platform === 'win32') {
    // 仅设置命令行编码
    require('child_process').exec('chcp 65001', (error) => {
        if (error) {
            console.warn('设置控制台编码失败:', error);
        }
    });
}

const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, dialog } = require('electron')
const path = require('path')
const { exec } = require('child_process')
const fs = require('fs')

let tray = null
let mainWindow = null

// 在文件顶部添加单实例锁定检查
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 如果已经有实例在运行，就退出当前实例
  app.quit()
} else {
  // 监听第二个实例的启动
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 如果有第二个实例试图启动，则聚焦到主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // 添加这行设置
  app.setAppUserModelId('com.yourapp.shutdown-timer')

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 600,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        devTools: false  // 禁用开发者工具
      },
      resizable: true,
      minWidth: 500,
      minHeight: 500,
      autoHideMenuBar: true,
      icon: path.join(__dirname, 'app.png')  // 主窗口图标
    })

    mainWindow.loadFile('index.html')
    
    mainWindow.webContents.on('did-finish-load', async () => {
      console.log('窗口加载完成');
      const shutdownInfo = await checkAndCleanShutdownTask();
      console.log('准备发送关机信息:', shutdownInfo);
      
      if (shutdownInfo) {
        console.log('发送关机信息到渲染进程');
        mainWindow.webContents.send('existing-shutdown', shutdownInfo);
        startTrayBlink();
      } else {
        console.log('发送空的关机信息');
        mainWindow.webContents.send('existing-shutdown', null);
      }
      
      // 其他初始化
      mainWindow.webContents.send('get-content-size');
      mainWindow.webContents.send('get-auto-start-status');
      mainWindow.webContents.send('get-auto-minimize');
    })
    
    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault()
        mainWindow.hide()
      }
      return false
    })

    // 添加最小化事件处理
    mainWindow.on('minimize', (event) => {
      event.preventDefault();
      mainWindow.webContents.send('get-minimize-setting');
    });
  }

  // 修改生成默认图标的函数
  function generateDefaultIcon() {
    const { nativeImage } = require('electron');
    const icon = nativeImage.createEmpty();
    
    // 创建一个 16x16 的绿色图标
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);
    
    // 填充绿色 (#4CAF50)
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 0x4C;     // R
      buffer[i + 1] = 0xAF; // G
      buffer[i + 2] = 0x50; // B
      buffer[i + 3] = 0xFF; // Alpha
    }
    
    icon.addRepresentation({
      width: size,
      height: size,
      buffer: buffer,
      scaleFactor: 1.0
    });
    
    return icon;
  }

  function createTray() {
    let trayIcon;
    try {
        // 使用 icon.png 作为托盘图标
        trayIcon = path.join(__dirname, 'icon.png');
        if (!fs.existsSync(trayIcon)) {
            console.warn('找不到 icon.png，尝试生成图标...');
            require('./create-icon.cjs');
            // 等待一会儿确保图标生成完成
            setTimeout(() => {
                if (tray && fs.existsSync(trayIcon)) {
                    tray.setImage(trayIcon);
                }
            }, 1000);
        }
        tray = new Tray(trayIcon);
    } catch (error) {
        console.error('创建托盘图标失败:', error);
        return;
    }
    
    function buildQuickShutdownMenu() {
      const quickTimes = JSON.parse(
        fs.existsSync(path.join(__dirname, 'quick-times.json')) ?
          fs.readFileSync(path.join(__dirname, 'quick-times.json'), 'utf8') :
          '[]'
      );
      
      const defaultTimes = [
        { label: '30分钟后关机', minutes: 30 },
        { label: '1小时后关机', minutes: 60 },
        { label: '2小时后关机', minutes: 120 }
      ];
      
      return [...defaultTimes, ...quickTimes].map(time => ({
        label: time.label,
        click: () => {
          mainWindow.webContents.send('quick-shutdown', time.minutes);
        }
      }));
    }
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => mainWindow.show()
      },
      { type: 'separator' },
      {
        label: '快速设置',
        submenu: buildQuickShutdownMenu()
      },
      {
        label: '取消关机',
        click: () => {
          mainWindow.webContents.send('cancel-shutdown-request');
        }
      },
      { type: 'separator' },
      {
        label: '开机自启动',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (menuItem) => {
          app.setLoginItemSettings({
            openAtLogin: menuItem.checked
          })
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.isQuitting = true
          app.quit()
        }
      }
    ])

    tray.setToolTip('定时关机程序')
    tray.setContextMenu(contextMenu)
    
    tray.on('double-click', () => {
      mainWindow.show()
    })

    // 监听快速时间更新
    ipcMain.on('quick-times-updated', () => {
      const newContextMenu = Menu.buildFromTemplate([
        ...buildQuickShutdownMenu()
      ]);
      tray.setContextMenu(newContextMenu);
    });
  }

  // 检查必要文件
  function checkRequiredFiles() {
    // 移除文件检查，因为我们会在使用时进行处理
    return true;
  }

  // 添加自动更新检查
  function checkForUpdates() {
    // 开发环境下不检查更新
    if (process.env.NODE_ENV === 'development') return;
    
    try {
      const { autoUpdater } = require('electron-updater');
      
      autoUpdater.on('checking-for-update', () => {
        log('INFO', '检查更新...');
      });
      
      autoUpdater.on('update-available', (info) => {
        log('INFO', `发现新版本: ${info.version}`);
        const { dialog } = require('electron');
        dialog.showMessageBox({
          type: 'info',
          title: '发现新版本',
          message: `发现新版本 ${info.version}，是否更新？`,
          buttons: ['更新', '取消']
        }).then(({ response }) => {
          if (response === 0) {
            autoUpdater.downloadUpdate();
          }
        });
      });
      
      autoUpdater.on('error', (error) => {
        log('ERROR', `更新检查失败: ${error.message}`);
      });
      
      autoUpdater.on('update-downloaded', (info) => {
        dialog.showMessageBox({
          message: `新版本 ${info.version} 已下载，将在退出后安装`,
          buttons: ['立即重启', '稍后']
        }).then((result) => {
          if (result.response === 0) {
            autoUpdater.quitAndInstall();
          }
        });
      });
      
      autoUpdater.checkForUpdates().catch(error => {
        log('ERROR', `检查更新时出错: ${error.message}`);
      });
    } catch (error) {
      // 如果模块不存在，记录日志但不影响程序运行
      log('WARN', `自动更新功能未启用: ${error.message}`);
    }
  }

  // 添加自动更新检查
  async function checkAndCleanShutdownTask() {
    try {
        const cmd = `schtasks /query /tn "定时关机" /fo CSV /nh`;
        const result = await new Promise((resolve) => {
            exec(cmd, { encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    resolve(null);
                    return;
                }
                resolve(stdout);
            });
        });

        if (result) {
            // CSV格式解析示例："\定时关机","2025/2/23 7:09:00","就绪"
            const parts = result.split(',');
            if (parts.length >= 2) {
                const timeStr = parts[1].replace(/"/g, '').trim();
                const [datePart, timePart] = timeStr.split(' ');
                const [year, month, day] = datePart.split('/').map(Number);
                const [hours, minutes] = timePart.split(':').map(Number);
                
                // 创建Date对象（注意月份需要-1）
                const shutdownTime = new Date(year, month - 1, day, hours, minutes);
                
                // 计算剩余时间
                const now = new Date();
                const remainingSeconds = Math.floor((shutdownTime - now) / 1000);
                
                if (remainingSeconds > 0) {
                    return {
                        seconds: remainingSeconds,
                        type: 'schedule',
                        targetTime: shutdownTime.getTime()
                    };
                }
            }
        }
        return null;
    } catch (error) {
        log('ERROR', `检查关机任务时出错: ${error}`);
        return null;
    }
  }

  app.whenReady().then(async () => {
    checkRequiredFiles();
    createWindow();
    createTray();
    checkForUpdates();
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  function sendNotification(title, body) {
    const notification = new Notification({
        title,
        body,
        silent: false,
        actions: [
            { type: 'button', text: '取消关机' }
        ]
    });

    notification.on('action', () => {
        mainWindow.webContents.send('cancel-shutdown-request');
    });
  }

  // 添加错误处理
  process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    const { dialog } = require('electron');
    dialog.showErrorBox('程序错误', error.message);
  });

  // 优化日志功能
  function log(type, message, error = null) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] ${type}: ${message}\n`;
    
    if (error) {
        logMessage += `Error Stack: ${error.stack}\n`;
    }
    
    // 确保日志目录存在
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)){
        fs.mkdirSync(logDir);
    }
    
    const logFile = path.join(logDir, 'app.log');
    try {
        fs.appendFileSync(logFile, logMessage, { encoding: 'utf8', flag: 'a' });
        return true;
    } catch (error) {
        return false;
    }
  }

  // 添加权限检查
  async function checkPermissions() {
    if (process.platform === 'win32') {
        return new Promise((resolve) => {
            exec('NET SESSION', { windowsHide: true }, (error) => {
                if (error) {
                    log('WARN', '需要管理员权限: ' + error.message);
                }
                resolve(!error);
            });
        });
    }
    return true;
  }

  // 修改获取系统关机计划函数
  async function getSystemShutdownPlan() {
      return new Promise((resolve) => {
          if (process.platform === 'win32') {
              const cmd = `schtasks /query /tn "定时关机" /fo LIST /v`;
              log('INFO', `执行命令: ${cmd}`);
              
              const options = {
                  encoding: 'utf8',
                  env: { 
                      ...process.env, 
                      LANG: 'zh_CN.UTF-8',
                      LC_ALL: 'zh_CN.UTF-8'
                  }
              };
              
              exec(cmd, options, (error, stdout, stderr) => {
                  if (error) {
                      log('INFO', `查询任务失败: ${error.message}`);
                      resolve(null);
                      return;
                  }

                  try {
                      // 添加详细日志
                      log('DEBUG', `原始输出: ${stdout}`);
                      
                      // 支持多种日期格式
                      const dateTimePattern = /(\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}:\d{2})/;
                      const match = stdout.match(dateTimePattern);
                      
                      if (match) {
                          const timeStr = match[1]; // 2025/2/22 15:49:00
                          log('INFO', `解析到时间字符串: ${timeStr}`);
                          
                          // 分割日期时间
                          const [datePart, timePart] = timeStr.split(' ');
                          const [year, month, day] = datePart.split('/').map(Number);
                          const [hours, minutes, seconds] = timePart.split(':').map(Number);
                          
                          // 创建Date对象（注意月份需要-1）
                          const shutdownTime = new Date(year, month - 1, day, hours, minutes, seconds);
                          
                          if (isNaN(shutdownTime.getTime())) {
                              log('WARN', '日期解析失败:', timeStr);
                              resolve(null);
                              return;
                          }

                          // 添加时区偏移处理
                          const timezoneOffset = shutdownTime.getTimezoneOffset() * 60 * 1000;
                          const localShutdownTime = new Date(shutdownTime.getTime() - timezoneOffset);
                          
                          // 计算剩余时间
                          const now = new Date();
                          const remainingSeconds = Math.floor((localShutdownTime - now) / 1000);
                          
                          if (remainingSeconds > 0) {
                              const plan = {
                                  seconds: remainingSeconds,
                                  type: 'schedule',
                                  targetTime: shutdownTime.getTime()
                              };
                              log('INFO', `有效关机计划: ${JSON.stringify(plan)}`);
                              resolve(plan);
                          } else {
                              log('INFO', '发现已过期任务');
                              resolve(null);
                          }
                      } else {
                          log('INFO', '未找到匹配的时间格式');
                          resolve(null);
                      }
                  } catch (error) {
                      log('WARN', '解析关机计划时出错:', error);
                      resolve(null);
                  }
              });
          } else {
              resolve(null);
          }
      });
  }

  // 添加日志处理
  ipcMain.on('log', (event, logData) => {
    const logMessage = `${new Date().toISOString()} [${logData.level || 'INFO'}] ${logData.message}`;
    fs.appendFile('logs/app.log', logMessage + '\n', (err) => {
        if (err) console.error('写入日志失败:', err);
    });
  });

  // 添加开发者工具切换处理
  ipcMain.on('toggle-devtools', () => {
      if (mainWindow) {
          mainWindow.webContents.toggleDevTools();
      }
  });

  // 创建自定义提醒窗口
  function createReminderWindow(message) {
      const reminderWindow = new BrowserWindow({
          width: 400,
          height: 200,
          frame: false,  // 无边框窗口
          transparent: true,  // 支持透明
          resizable: false,
          alwaysOnTop: true,
          webPreferences: {
              nodeIntegration: true,
              contextIsolation: false
          }
      });

      // 加载提醒窗口的HTML
      reminderWindow.loadFile('reminder.html');

      // 窗口加载完成后发送消息内容
      reminderWindow.webContents.on('did-finish-load', () => {
          reminderWindow.webContents.send('reminder-message', message);
      });

      return reminderWindow;
  }

  // 修改处理对话框的函数
  ipcMain.handle('show-confirm-dialog', async (event, options) => {
      const reminderWindow = createReminderWindow(options.message);
      return new Promise((resolve) => {
          ipcMain.once('reminder-response', (event, response) => {
              reminderWindow.close();
              resolve({ response });
          });
      });
  });

  // 修改取消关机处理
  ipcMain.on('cancel-shutdown', () => {
      log('INFO', '取消关机计划');
      console.log('收到取消关机请求');
      
      exec(`schtasks /delete /tn "定时关机" /f`, (error, stdout, stderr) => {
          if (error) {
              log('WARN', `删除关机计划失败: ${error.message}`);
              console.log('删除任务失败:', error);
              mainWindow.webContents.send('shutdown-error', '取消关机失败: ' + error.message);
          } else {
              log('INFO', '成功取消关机计划');
              console.log('成功删除任务');
              mainWindow.webContents.send('shutdown-success');
              stopTrayBlink();
          }
          // 无论成功失败都重新检查任务状态
          checkAndCleanShutdownTask().then(shutdownInfo => {
              mainWindow.webContents.send('existing-shutdown', shutdownInfo);
          });
      });
  });

  let trayBlinkInterval;

  function startTrayBlink() {
    let isOriginal = true;
    const originalIcon = path.join(__dirname, 'icon.png');
    const warningIcon = path.join(__dirname, 'icon-warning.png');
    
    // 生成默认的警告图标（红色）
    const defaultWarningIcon = (() => {
      const { nativeImage } = require('electron');
      const icon = nativeImage.createEmpty();
      const size = 16;
      const buffer = Buffer.alloc(size * size * 4);
      
      // 填充红色
      for (let i = 0; i < buffer.length; i += 4) {
        buffer[i] = 0xFF;     // R
        buffer[i + 1] = 0x00; // G
        buffer[i + 2] = 0x00; // B
        buffer[i + 3] = 0xFF; // Alpha
      }
      
      icon.addRepresentation({
        width: size,
        height: size,
        buffer: buffer,
        scaleFactor: 1.0
      });
      return icon;
    })();

    // 使用存在的图标或默认图标
    const normalIcon = fs.existsSync(originalIcon) ? originalIcon : generateDefaultIcon();
    const blinkIcon = fs.existsSync(warningIcon) ? warningIcon : defaultWarningIcon;
    
    trayBlinkInterval = setInterval(() => {
      try {
        tray.setImage(isOriginal ? normalIcon : blinkIcon);
        isOriginal = !isOriginal;
      } catch (error) {
        console.warn('切换托盘图标失败:', error);
      }
    }, 500);
  }

  function stopTrayBlink() {
    clearInterval(trayBlinkInterval);
    tray.setImage(path.join(__dirname, 'icon.png'));
  }

  ipcMain.on('cancel-shutdown-request', () => {
    stopTrayBlink();
    mainWindow.webContents.send('cancel-shutdown');
  });

  // 修改窗口大小调整处理
  ipcMain.on('resize-window', (event, size) => {
    if (mainWindow) {
      const currentSize = mainWindow.getSize();
      const newWidth = Math.max(size.width, 400);  // 确保不小于最小宽度
      const newHeight = Math.max(size.height, 500); // 确保不小于最小高度
      
      // 只在大小确实需要改变时调整
      if (currentSize[0] !== newWidth || currentSize[1] !== newHeight) {
        // 获取当前窗口位置
        const currentPosition = mainWindow.getPosition();
        
        // 调整大小但保持位置不变
        mainWindow.setBounds({
          x: currentPosition[0],
          y: currentPosition[1],
          width: newWidth,
          height: newHeight
        });
      }
    }
  });

  // 添加最小化到托盘的处理
  ipcMain.on('should-minimize-to-tray', (event, shouldMinimize) => {
    if (shouldMinimize) {
      mainWindow.hide();
    } else {
      mainWindow.minimize();
    }
  });

  // 获取自动启动状态
  ipcMain.on('get-auto-start', (event) => {
    const status = app.getLoginItemSettings().openAtLogin;
    event.reply('auto-start-status', status);
  });

  // 添加输入验证
  function validateShutdownTime(time) {
    const minTime = Date.now() + 300000; // 5分钟
    const maxTime = Date.now() + 2592000000; // 30天
    return time >= minTime && time <= maxTime;
  }

  ipcMain.on('shutdown', async (event, data) => {
    log('INFO', '收到关机请求');
    log('INFO', `关机数据: ${JSON.stringify(data, null, 2)}`);
    
    if (!validateShutdownTime(data.targetTime)) {
      log('WARN', `无效的关机时间: ${data.targetTime}`);
      event.reply('shutdown-error', '无效的关机时间设置');
      return;
    }
    
    const hasPermission = await checkPermissions();
    if (!hasPermission) {
      log('WARN', '缺少管理员权限');
      event.reply('shutdown-error', '需要管理员权限才能执行关机命令');
      return;
    }

    const { time, notify, notifyTime, type, targetTime } = data;
    log('INFO', `设置关机计划: ${time}秒后关机`);
    
    // 创建关机命令（使用完整路径）
    const shutdownCmd = `C:\\Windows\\System32\\shutdown.exe /s /f`;
    const taskTime = new Date(targetTime);
    
    // 格式化时间为 schtasks 所需格式
    const timeString = `${String(taskTime.getHours()).padStart(2, '0')}:${String(taskTime.getMinutes()).padStart(2, '0')}`;
    const dateString = `${taskTime.getFullYear()}/${String(taskTime.getMonth() + 1).padStart(2, '0')}/${String(taskTime.getDate()).padStart(2, '0')}`;
    
    const createTaskCmd = `schtasks /create /tn "定时关机" /tr "shutdown.exe /s /f" /sc once /st ${timeString} /sd ${dateString} /f /ru SYSTEM /rl HIGHEST`;

    log('INFO', `执行命令: ${createTaskCmd}`);
    
    exec(createTaskCmd, { windowsVerbatimArguments: true }, (error, stdout, stderr) => {
        if (error) {
            const errorMsg = `创建计划任务失败: ${error.message}\n${stderr}`;
            log('ERROR', errorMsg, error);
            event.reply('shutdown-error', errorMsg);
            return;
        }
        
        log('INFO', `计划任务创建成功: ${stdout}`);
        event.reply('shutdown-success');
        startTrayBlink();
    });
  });

  // 添加应用退出处理
  app.on('before-quit', (event) => {
    // 检查是否存在关机任务
    exec(`schtasks /query /tn "定时关机" /fo LIST`, (error, stdout) => {
      if (!error && stdout) {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          title: '退出提醒',
          message: '还有未执行的关机计划，确定要退出吗？',
          detail: '退出后将无法收到关机提醒，但系统仍会按计划关机。',
          buttons: ['继续退出', '取消'],
          defaultId: 1,
          cancelId: 1
        });
        
        if (choice === 1) {
          event.preventDefault();
        }
      }
    });
  });
}