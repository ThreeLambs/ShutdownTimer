const { ipcRenderer } = require('electron')

let countdownInterval;
let isPaused = false;
let remainingOnPause = 0;

async function setShutdown() {
    try {
        const shutdownType = document.querySelector('input[name="shutdownType"]:checked').value;
        
        let seconds = 0;
        let targetTime = null;
        
        if (shutdownType === 'timer') {
            const minutes = document.getElementById('minutes').value;
            if (!minutes || minutes <= 0) {
                showMessage('请输入有效的分钟数！', 'error');
                return;
            }
            seconds = minutes * 60;
            targetTime = Date.now() + (seconds * 1000);
        } else {
            const scheduleDate = document.getElementById('scheduleDate').value;
            const scheduleTime = document.getElementById('scheduleTime').value;
            
            if (!scheduleDate || !scheduleTime) {
                showMessage('请选择关机日期和时间！', 'error');
                return;
            }
            
            try {
                // 确保时间格式正确
                if (!/^\d{2}:\d{2}$/.test(scheduleTime)) {
                    showMessage('时间格式不正确！', 'error');
                    return;
                }
                
                const [hours, minutes] = scheduleTime.split(':').map(Number);
                if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
                    showMessage('请输入有效的时间！', 'error');
                    return;
                }
                
                // 创建日期时间对象
                const now = new Date();
                const [year, month, day] = scheduleDate.split('-').map(Number);
                const shutdownTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
                
                if (shutdownTime <= now) {
                    showMessage('关机时间不能早于当前时间！', 'error');
                    return;
                }
                
                // 计算时间差（毫秒）
                const timeDiff = shutdownTime.getTime() - now.getTime();
                seconds = Math.floor(timeDiff / 1000);
                targetTime = shutdownTime.getTime();
            } catch (error) {
                showMessage('时间处理出错，请检查输入！', 'error');
                return;
            }
        }

        const settings = JSON.parse(localStorage.getItem('shutdown-settings')) || {};
        const notifyTime = settings.notifyBeforeShutdown ? 
            (settings.notifyTime * 60) : 300; // 默认5分钟
        
        ipcRenderer.send('shutdown', {
            time: seconds,
            notify: settings.notifyBeforeShutdown,
            notifyTime: notifyTime,
            type: shutdownType,
            targetTime: targetTime
        });
        
        // 立即更新消息
        if (shutdownType === 'timer') {
            showMessage(`将在 ${Math.floor(seconds/60)} 分钟后关机`, 'success');
        } else {
            const shutdownDate = new Date(targetTime);
            showMessage(`将在 ${shutdownDate.toLocaleString('zh-CN', {
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })} 关机`, 'success');
        }
        
        startCountdown(seconds);
    } catch (error) {
        showMessage('设置关机时出错: ' + error.message, 'error');
    }
}

function startCountdown(totalSeconds) {
    clearInterval(countdownInterval);
    let remainingSeconds = totalSeconds;
    
    // 获取提醒设置
    const settings = JSON.parse(localStorage.getItem('shutdown-settings')) || {};
    const notifyBeforeShutdown = settings.notifyBeforeShutdown !== false;
    const notifyTime = (settings.notifyTime || 5) * 60; // 默认5分钟
    
    // 更新倒计时显示
    function updateCountdown() {
        if (!isPaused) {
        remainingSeconds--;
            
        if (remainingSeconds <= 0) {
            clearInterval(countdownInterval);
            return;
        }
        
            // 计算剩余时间
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
            const seconds = remainingSeconds % 60;
            
            // 格式化显示
            let timeString = '';
            if (hours > 0) {
                timeString += `${hours}时`;
            }
            if (minutes > 0 || hours > 0) {
                timeString += `${minutes}分`;
            }
            timeString += `${seconds}秒`;
            
            showMessage(`关机倒计时：${timeString}`, 'info');
            
            // 检查是否需要显示提醒
            if (notifyBeforeShutdown && remainingSeconds === notifyTime) {
                ipcRenderer.send('show-notification', {
                    title: '关机提醒',
                    body: `系统将在${Math.floor(notifyTime/60)}分钟后关机`
                });
            }
        }
    }
    
    // 立即更新一次
    updateCountdown();
    // 启动定时器
    countdownInterval = setInterval(updateCountdown, 1000);
}

function cancelShutdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }
    ipcRenderer.send('cancel-shutdown');
}

// 监听取消关机的结果
ipcRenderer.on('shutdown-success', () => {
    showMessage('当前无关机计划', 'info');
});

ipcRenderer.on('shutdown-error', (event, message) => {
    showMessage(`错误：${message}`, 'error');
});

function showMessage(text, type, persist = false) {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = text;
    
    // 添加信息类型的样式
    switch (type) {
        case 'error':
            messageDiv.style.color = '#f44336';
            messageDiv.style.background = '#ffebee';
            break;
        case 'success':
            messageDiv.style.color = '#4CAF50';
            messageDiv.style.background = '#e8f5e9';
            break;
        case 'info':
            messageDiv.style.color = '#2196F3';
            messageDiv.style.background = '#e3f2fd';
            break;
    }
    
    messageDiv.classList.add('show');
}

// 修改事件监听器注册
function initInputSelectors() {
    const elements = {
        minutes: document.getElementById('minutes'),
        scheduleDate: document.getElementById('scheduleDate'),
        scheduleTime: document.getElementById('scheduleTime'),
        timer: document.getElementById('timer'),
        schedule: document.getElementById('schedule')
    };
    
    // 检查所有必需元素是否存在
    if (Object.values(elements).some(el => !el)) {
        console.error('初始化选择器时缺少必需元素');
        return;
    }
    
    // 指定时间后关机的输入框
    const { minutes: minutesInput } = elements;
    minutesInput.addEventListener('mousedown', () => {
        elements.timer.checked = true;
    });
    minutesInput.addEventListener('keydown', () => {
        elements.timer.checked = true;
    });
    minutesInput.addEventListener('wheel', () => {
        elements.timer.checked = true;
    });

    // 定时关机的日期和时间输入框
    const dateInput = document.getElementById('scheduleDate');
    const timeInput = document.getElementById('scheduleTime');
    
    const scheduleHandler = () => {
        elements.schedule.checked = true;
    };

    // 日期选择器事件
    dateInput.addEventListener('mousedown', scheduleHandler);
    dateInput.addEventListener('change', scheduleHandler);
    dateInput.addEventListener('click', scheduleHandler);

    // 时间选择器事件
    timeInput.addEventListener('mousedown', scheduleHandler);
    timeInput.addEventListener('change', scheduleHandler);
    timeInput.addEventListener('click', scheduleHandler);
    timeInput.addEventListener('wheel', scheduleHandler);
    timeInput.addEventListener('keydown', scheduleHandler);
}

// 添加获取提醒时间的函数
function getReminderTime() {
    const notifyTime = document.getElementById('notifyTime').value;
    return notifyTime * 60; // 转换为秒
}

// 添加暂停/恢复功能
function togglePause() {
    isPaused = !isPaused;
    if (isPaused) {
        remainingOnPause = remainingSeconds;
        clearInterval(countdownInterval);
    } else {
        startCountdown(remainingOnPause);
    }
}

// 添加资源清理
function cleanup() {
    clearInterval(countdownInterval);
    ipcRenderer.removeAllListeners();
    document.removeEventListener('keyup', handleKeyPress);
}

window.addEventListener('beforeunload', cleanup);

// 添加全局错误处理
window.onerror = function(message, source, lineno, colno, error) {
    console.error('全局错误:', { message, source, lineno, colno, error });
};

// 初始化日期输入框
function initDateInput(date) {
    const dateInput = document.getElementById('scheduleDate');
    if (dateInput) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        dateInput.value = `${year}-${month}-${day}`;
        dateInput.min = dateInput.value; // 设置最小日期为今天
    }
}

// 初始化时间输入框
function initTimeInput(date) {
    const timeInput = document.getElementById('scheduleTime');
    if (timeInput) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        timeInput.value = `${hours}:${minutes}`;
    }
}

// 添加快速时间按钮事件
function initQuickTimeButtons() {
    const quickTimeButtons = document.querySelectorAll('.quick-times button');
    quickTimeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const minutes = button.getAttribute('data-minutes');
            if (minutes) {
                document.getElementById('timer').checked = true;
                document.getElementById('minutes').value = minutes;
            }
        });
    });
}

// 添加设置保存功能
function saveSettings() {
    const settings = {
        notifyBeforeShutdown: document.getElementById('notifyBeforeShutdown').checked,
        notifyTime: document.getElementById('notifyTime').value
    };
    localStorage.setItem('shutdown-settings', JSON.stringify(settings));
}

// 加载设置
function loadSettings() {
    try {
        const settings = JSON.parse(localStorage.getItem('shutdown-settings')) || {};
        
        // 设置通知选项
        const notifyCheckbox = document.getElementById('notifyBeforeShutdown');
        if (notifyCheckbox) {
            notifyCheckbox.checked = settings.notifyBeforeShutdown !== false;
        }
        
        // 设置通知时间
        const notifyTimeInput = document.getElementById('notifyTime');
        if (notifyTimeInput) {
            notifyTimeInput.value = settings.notifyTime || 5;
        }
        
        // 初始化日期和时间
        const now = new Date();
        now.setMinutes(now.getMinutes() + 1); // 设置默认时间为当前时间后1分钟
        initDateInput(now);
        initTimeInput(now);
        
        // 初始化其他功能
        initQuickTimeButtons();
        initInputSelectors();
        
        // 添加设置变更监听
        document.getElementById('notifyBeforeShutdown').addEventListener('change', saveSettings);
        document.getElementById('notifyTime').addEventListener('change', saveSettings);
        
        // 添加按钮事件监听
        document.getElementById('setShutdownBtn').addEventListener('click', setShutdown);
        document.getElementById('cancelShutdownBtn').addEventListener('click', cancelShutdown);
        
        setTimeout(adjustWindowSize, 100);
    } catch (error) {
        console.error('加载设置时出错:', error);
    }
}

// 注册事件监听器
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    
    // 先注册事件监听器
    ipcRenderer.on('existing-shutdown', (event, shutdownInfo) => {
        if (!shutdownInfo) {
            ipcRenderer.send('log', { level: 'INFO', message: '没有未完成的关机计划' });
            showMessage('当前无关机计划', 'info');
            initDateInput(new Date());
            return;
        }

        ipcRenderer.send('log', { level: 'INFO', message: `检测到现有关机计划: ${JSON.stringify(shutdownInfo)}` });
        // 根据计划类型设置界面
        if (shutdownInfo.type === 'timer') {
            const timerRadio = document.getElementById('timer');
            if (timerRadio) {
                timerRadio.checked = true;
            }
            
            const minutesInput = document.getElementById('minutes');
            if (minutesInput) {
                minutesInput.value = Math.floor(shutdownInfo.seconds / 60);
            }
        } else {
            const scheduleRadio = document.getElementById('schedule');
            if (scheduleRadio) {
                scheduleRadio.checked = true;
            }
            
            const targetDate = new Date(shutdownInfo.targetTime);
            ipcRenderer.send('log', { level: 'INFO', message: `设置目标时间: ${targetDate}` });
            
            const dateInput = document.getElementById('scheduleDate');
            const timeInput = document.getElementById('scheduleTime');
            
            if (dateInput) {
                const year = targetDate.getFullYear();
                const month = String(targetDate.getMonth() + 1).padStart(2, '0');
                const day = String(targetDate.getDate()).padStart(2, '0');
                dateInput.value = `${year}-${month}-${day}`;
            }
            
            if (timeInput) {
                const hours = String(targetDate.getHours()).padStart(2, '0');
                const minutes = String(targetDate.getMinutes()).padStart(2, '0');
                timeInput.value = `${hours}:${minutes}`;
            }
        }

        ipcRenderer.send('log', { level: 'INFO', message: `开始倒计时显示，剩余秒数: ${shutdownInfo.seconds}` });
        startCountdown(shutdownInfo.seconds);
    });
    
    // 发送检查消息前记录日志
    ipcRenderer.send('log', { level: 'INFO', message: '正在检查现有关机计划...' });
    // 然后再发送检查消息
    ipcRenderer.send('check-shutdown');
    
    // 监听窗口大小调整请求
    ipcRenderer.on('get-content-size', () => {
        const container = document.querySelector('.container');
        if (container) {
            ipcRenderer.send('resize-window', {
                width: container.scrollWidth + 60, // 添加一些边距
                height: container.scrollHeight + 60
            });
        }
    });
});

// 添加窗口大小调整函数
function adjustWindowSize() {
    const container = document.querySelector('.container');
    if (container) {
        ipcRenderer.send('resize-window', {
            width: container.scrollWidth + 60,
            height: container.scrollHeight + 60
        });
    }
}
