const Jimp = require('jimp');
const pngToIco = require('png-to-ico');
const fs = require('fs');

async function createIcon() {
    try {
        // 创建新图像（透明背景）
        const image = await new Jimp(256, 256, 0x00000000);
        
        // 绘制圆形背景（红色渐变）
        image.scan(0, 0, 256, 256, (x, y) => {
            const dx = x - 128;
            const dy = y - 128;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist <= 120) {
                // 红色渐变 (#e53935 -> #c62828)
                const gradient = dist / 120;
                const r = Math.floor(229 - gradient * 20);
                const g = Math.floor(57 - gradient * 15);
                const b = Math.floor(53 - gradient * 15);
                image.setPixelColor(Jimp.rgbaToInt(r, g, b, 255), x, y);
            }
        });

        // 绘制电源符号（白色）
        const drawPowerSymbol = () => {
            // 绘制圆环
            for (let angle = 0; angle < Math.PI * 2; angle += 0.01) {
                const r = 60;
                const thickness = 12;
                for (let dr = -thickness/2; dr <= thickness/2; dr++) {
                    const currentR = r + dr;
                    const x = Math.round(128 + currentR * Math.cos(angle));
                    const y = Math.round(128 + currentR * Math.sin(angle));
                    if (angle < Math.PI * 1.7) {  // 顶部留出缺口
                        image.setPixelColor(0xFFFFFFFF, x, y);
                    }
                }
            }
            
            // 绘制竖线
            for (let y = 128 - 45; y <= 128; y++) {
                for (let x = 128 - 6; x <= 128 + 6; x++) {
                    image.setPixelColor(0xFFFFFFFF, x, y);
                }
            }
        };

        // 绘制电源符号
        drawPowerSymbol();

        // 添加光晕效果
        image.scan(0, 0, 256, 256, (x, y) => {
            const dx = x - 128;
            const dy = y - 128;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist <= 120) {
                const color = image.getPixelColor(x, y);
                const { r, g, b, a } = Jimp.intToRGBA(color);
                const glow = Math.max(0.7, 1 - dist/120);
                image.setPixelColor(
                    Jimp.rgbaToInt(
                        Math.floor(r * glow),
                        Math.floor(g * glow),
                        Math.floor(b * glow),
                        a
                    ),
                    x, y
                );
            }
        });

        // 保存并转换
        await image.writeAsync('app.png');
        const buf = await pngToIco('app.png');
        fs.writeFileSync('app.ico', buf);
        fs.unlinkSync('app.png');
        
        console.log('关机图标创建成功！');
    } catch (error) {
        console.error('创建图标时出错:', error);
    }
}

createIcon(); 