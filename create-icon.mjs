import Jimp from 'jimp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createIcon() {
    try {
        // 创建一个新的图像
        const image = new Jimp(256, 256, 0x00000000); // 透明背景
        
        // 绘制圆形背景
        const radius = 120;
        const centerX = 128;
        const centerY = 128;
        
        // 绘制渐变圆形背景
        image.scan(0, 0, 256, 256, function(x, y, idx) {
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= radius) {
                // 创建从深绿到浅绿的渐变
                const gradientFactor = distance / radius;
                const r = Math.floor(76 + (98 - 76) * gradientFactor);  // #4CAF50 到 #62C766
                const g = Math.floor(175 + (199 - 175) * gradientFactor);
                const b = Math.floor(80 + (102 - 80) * gradientFactor);
                
                this.bitmap.data[idx + 0] = r;     // R
                this.bitmap.data[idx + 1] = g;     // G
                this.bitmap.data[idx + 2] = b;     // B
                this.bitmap.data[idx + 3] = 255;   // A
            } else {
                // 设置透明
                this.bitmap.data[idx + 3] = 0;
            }
        });

        // 绘制时钟指针
        const drawHand = (angle, length, width, color) => {
            const radian = (angle - 90) * Math.PI / 180;
            const endX = centerX + length * Math.cos(radian);
            const endY = centerY + length * Math.sin(radian);
            
            image.scan(0, 0, 256, 256, function(x, y, idx) {
                const dx = x - centerX;
                const dy = y - centerY;
                const pointDistance = Math.sqrt(dx * dx + dy * dy);
                const pointAngle = Math.atan2(dy, dx) * 180 / Math.PI;
                
                if (pointDistance <= length && 
                    Math.abs(pointAngle - (angle - 90)) <= width) {
                    this.bitmap.data[idx + 0] = 255;   // R
                    this.bitmap.data[idx + 1] = 255;   // G
                    this.bitmap.data[idx + 2] = 255;   // B
                    this.bitmap.data[idx + 3] = 255;   // A
                }
            });
        };

        // 绘制时钟中心点
        const centerPointRadius = 8;
        image.scan(0, 0, 256, 256, function(x, y, idx) {
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= centerPointRadius) {
                this.bitmap.data[idx + 0] = 255;   // R
                this.bitmap.data[idx + 1] = 255;   // G
                this.bitmap.data[idx + 2] = 255;   // B
                this.bitmap.data[idx + 3] = 255;   // A
            }
        });

        // 绘制时钟指针
        drawHand(45, 80, 4, 0xFFFFFFFF);  // 时针
        drawHand(180, 100, 3, 0xFFFFFFFF); // 分针

        // 保存为 PNG
        await image.writeAsync(path.join(__dirname, 'app.png'));
        
        // 转换为 ICO
        const buf = await image.getBufferAsync(Jimp.MIME_PNG);
        const icoBuffer = await pngToIco(buf);
        fs.writeFileSync(path.join(__dirname, 'app.ico'), icoBuffer);
        
        console.log('图标创建成功');
    } catch (error) {
        console.error('创建图标时出错:', error);
    }
}

createIcon(); 