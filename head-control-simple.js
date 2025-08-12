// 简化版头部动作控制系统 - 只使用默认摄像头
class HeadControl {
    constructor(tetrisGame, onCalibrationComplete) {
        this.tetrisGame = tetrisGame;
        this.onCalibrationComplete = onCalibrationComplete;
        this.faceMesh = null;
        this.camera = null;
        this.isActive = false;
        
        // 控制参数 (可调节)
        this.headTiltThreshold = 0.15; // 左右倾斜阈值（基于眼线角度）
        this.mouthOpenThreshold = 0.02; // 张嘴检测阈值
        
        // 防抖动参数
        this.lastAction = '';
        this.actionCooldown = 300;
        this.lastActionTime = 0;
        
        // 左右移动状态跟踪
        this.currentTiltState = 'center';
        this.lastTiltState = 'center';
        
        // 基准位置
        this.baselineNose = null;
        this.baselineMouth = null;
        this.calibrationFrames = 0;
        this.maxCalibrationFrames = 30;
        
        // 嘴巴状态跟踪
        this.mouthWasOpen = false;
        
        // 连续移动检测
        this.continuousMoveStartTime = 0;
        this.continuousMoveThreshold = 1000;
        this.continuousMoveInterval = 150;
        this.lastContinuousMoveTime = 0;
        this.isInContinuousMode = false;
        this.isInFastMoveMode = false;
        this.fastMoveStartTime = 0;
        
        // 快速移动检测（大幅度倾斜）
        this.fastMoveThreshold = 0.22;
        this.fastMoveInterval = 90;
        
        // 点头加速下降检测（修改为点头动作检测）
        this.nodStartTime = 0;
        this.nodThreshold = 0.03; // 点头检测阈值
        this.isNodding = false;
        this.lastNodTime = 0;
        this.nodCooldown = 300; // 点头冷却时间，防止重复检测
        
        // 点头状态跟踪
        this.nosePositionHistory = [];
        this.maxNoseHistory = 10;
        this.dynamicBaseline = null;
        this.baselineUpdateInterval = 30;
        this.frameCount = 0;
        this.lastNoseY = 0;
        this.nodDirection = 'none'; // 'down', 'up', 'none'
        this.nodPhase = 'waiting'; // 'waiting', 'going_down', 'going_up', 'completed'
        
        // 状态显示控制
        this.showDetailedStatus = true; // 可以设为false来显示迷你状态
        
        // 校准完成提示控制
        this.calibrationCompleteTime = 0;
        this.showCalibrationComplete = false;
        
        this.initMediaPipe();
    }
    
    async initMediaPipe() {
        try {
            this.faceMesh = new FaceMesh({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
                }
            });
            
            this.faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            
            this.faceMesh.onResults(this.onResults.bind(this));
            
            console.log('MediaPipe Face Mesh 初始化成功');
        } catch (error) {
            console.error('MediaPipe 初始化失败:', error);
        }
    }
    
    async startCamera() {
        try {
            const video = document.getElementById('input_video');
            const canvas = document.getElementById('output_canvas');
            
            // 重置校准状态
            this.resetCalibration();
            
            // 使用默认摄像头，简单配置
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: 320,
                    height: 240
                }
            });
            
            video.srcObject = stream;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            
            // 等待视频加载
            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    video.play().then(resolve);
                };
            });
            
            // 创建MediaPipe Camera
            this.camera = new Camera(video, {
                onFrame: async () => {
                    try {
                        if (this.faceMesh && video.readyState === 4) {
                            await this.faceMesh.send({image: video});
                        }
                    } catch (error) {
                        console.error('帧处理错误:', error);
                    }
                },
                width: 320,
                height: 240
            });
            
            await this.camera.start();
            this.isActive = true;
            console.log('默认摄像头启动成功');
            
            // 显示初始状态
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = '#4ecdc4';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const line1 = 'Camera started';
            const line2 = 'Waiting for face detection...';
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;

            ctx.fillText(line1, centerX, centerY - 15);
            ctx.fillText(line2, centerX, centerY + 15);
            
        } catch (error) {
            console.error('摄像头启动失败:', error);
            let errorMessage = '无法访问摄像头';
            
            if (error.name === 'NotAllowedError') {
                errorMessage = '摄像头权限被拒绝，请检查浏览器设置';
            } else if (error.name === 'NotReadableError') {
                errorMessage = '摄像头被其他应用占用';
            }
            
            alert(errorMessage);
            throw error;
        }
    }
    
    onResults(results) {
        try {
            const canvas = document.getElementById('output_canvas');
            const ctx = canvas.getContext('2d');
            
            // 清空画布
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // 绘制视频帧
            if (results.image) {
                ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
            }
            
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                const landmarks = results.multiFaceLandmarks[0];
                
                // 绘制面部关键点
                this.drawLandmarks(ctx, landmarks);
                
                // 校准基准位置
                if (this.calibrationFrames < this.maxCalibrationFrames) {
                    this.calibrateBaseline(landmarks);
                    this.calibrationFrames++;
                    
                    // 显示校准进度
                    this.drawCalibrationProgress(ctx);
                    return;
                }
                
                // 显示校准完成状态（5秒后消失）
                const now = Date.now();
                if (this.showCalibrationComplete && (now - this.calibrationCompleteTime < 5000)) {
                    this.drawCalibrationComplete(ctx);
                } else if (this.showCalibrationComplete && (now - this.calibrationCompleteTime >= 5000)) {
                    this.showCalibrationComplete = false;
                }
                
                // 检测头部动作
                this.detectHeadMovements(landmarks);
                
                // 显示控制状态（可以通过showDetailedStatus控制详细程度）
                if (this.showDetailedStatus !== false) {
                    this.drawControlStatus(ctx, landmarks);
                } else {
                    this.drawMiniStatus(ctx, landmarks);
                }
            } else {
                // 没有检测到面部时重置校准
                this.resetCalibration();
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.fillStyle = '#ff6b6b'; // Red color for warning
                ctx.font = 'bold 18px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                ctx.fillText('Please face the camera', canvas.width / 2, canvas.height / 2);
            }
        } catch (error) {
            console.error('onResults 处理错误:', error);
        }
    }
    
    calibrateBaseline(landmarks) {
        try {
            const nose = landmarks[1];
            const upperLip = landmarks[13] || landmarks[12];
            const lowerLip = landmarks[14] || landmarks[15];
            
            if (!nose || !upperLip || !lowerLip) {
                return;
            }
            
            if (!this.baselineNose) {
                this.baselineNose = {x: 0, y: 0, z: 0};
                this.baselineMouth = {distance: 0};
            }
            
            this.baselineNose.x += nose.x;
            this.baselineNose.y += nose.y;
            this.baselineNose.z += nose.z;
            
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            this.baselineMouth.distance += mouthDistance;
            
            if (this.calibrationFrames === this.maxCalibrationFrames - 1) {
                this.baselineNose.x /= this.maxCalibrationFrames;
                this.baselineNose.y /= this.maxCalibrationFrames;
                this.baselineNose.z /= this.maxCalibrationFrames;
                this.baselineMouth.distance /= this.maxCalibrationFrames;
                
                // 记录校准完成时间
                this.calibrationCompleteTime = Date.now();
                this.showCalibrationComplete = true;
                
                console.log('Calibration complete!');

                if (this.onCalibrationComplete) {
                    this.onCalibrationComplete();
                }
            }
        } catch (error) {
            console.error('校准过程错误:', error);
        }
    }
    
    resetCalibration() {
        this.calibrationFrames = 0;
        this.baselineNose = null;
        this.baselineMouth = null;
        this.mouthWasOpen = false;
        this.currentTiltState = 'center';
        this.lastTiltState = 'center';
        this.continuousMoveStartTime = 0;
        this.isInContinuousMode = false;
        this.isInFastMoveMode = false;
        this.fastMoveStartTime = 0;
        this.nodStartTime = 0;
        this.isNodding = false;
        this.lastNodTime = 0;
        this.lastAction = '';
        this.lastActionTime = 0;
        
        // 重置校准完成提示
        this.calibrationCompleteTime = 0;
        this.showCalibrationComplete = false;
        
        // 重置点头检测系统
        this.nosePositionHistory = [];
        this.dynamicBaseline = null;
        this.frameCount = 0;
        this.lastNoseY = 0;
        this.nodDirection = 'none';
        this.nodPhase = 'waiting';
    }
    
    // 简化的头部动作检测
    detectHeadMovements(landmarks) {
        if (!this.baselineNose || !this.baselineMouth) {
            return;
        }
        
        const now = Date.now();
        if (now - this.lastActionTime < this.actionCooldown) return;
        
        try {
            const nose = landmarks[1];
            const upperLip = landmarks[13] || landmarks[12];
            const lowerLip = landmarks[14] || landmarks[15];
            
            if (!nose || !upperLip || !lowerLip) {
                return;
            }
            
            // 计算头部倾斜
            const tiltX = this.calculateHeadTilt(landmarks);
            const noseY = nose.y;
            
            // 计算嘴巴张开程度
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            const mouthOpen = mouthDistance - this.baselineMouth.distance;
            const isMouthOpen = mouthOpen > this.mouthOpenThreshold;
            
            let action = '';
            
            // 更新当前倾斜状态
            if (tiltX > this.headTiltThreshold) {
                this.currentTiltState = 'right';
            } else if (tiltX < -this.headTiltThreshold) {
                this.currentTiltState = 'left';
            } else {
                this.currentTiltState = 'center';
            }
            
            // 检测张嘴旋转
            if (isMouthOpen && !this.mouthWasOpen) {
                action = 'rotate';
            }
            // 检测左右倾斜（点头时不禁用，因为点头是瞬时动作）
            else if (this.currentTiltState !== 'center') {
                const isFastTilt = Math.abs(tiltX) > this.fastMoveThreshold;
                
                if (this.lastTiltState === 'center') {
                    action = this.currentTiltState;
                    this.continuousMoveStartTime = now;
                    this.isInContinuousMode = false;
                    
                    if (isFastTilt) {
                        this.fastMoveStartTime = now;
                        this.isInFastMoveMode = true;
                    } else {
                        this.isInFastMoveMode = false;
                    }
                } else if (this.currentTiltState === this.lastTiltState) {
                    const holdTime = now - this.continuousMoveStartTime;
                    
                    if (isFastTilt && this.isInFastMoveMode) {
                        if (now - this.lastContinuousMoveTime >= this.fastMoveInterval) {
                            action = this.currentTiltState;
                            this.lastContinuousMoveTime = now;
                        }
                    } else if (holdTime >= this.continuousMoveThreshold && !this.isInContinuousMode) {
                        this.isInContinuousMode = true;
                        this.lastContinuousMoveTime = now;
                        action = this.currentTiltState;
                    } else if (this.isInContinuousMode && 
                              now - this.lastContinuousMoveTime >= this.continuousMoveInterval) {
                        action = this.currentTiltState;
                        this.lastContinuousMoveTime = now;
                    }
                    
                    if (isFastTilt && !this.isInFastMoveMode) {
                        this.isInFastMoveMode = true;
                        this.fastMoveStartTime = now;
                    } else if (!isFastTilt && this.isInFastMoveMode) {
                        this.isInFastMoveMode = false;
                    }
                }
            } else {
                if (this.isInContinuousMode || this.isInFastMoveMode) {
                    console.log('头部回到中心，结束移动模式');
                }
                this.continuousMoveStartTime = 0;
                this.isInContinuousMode = false;
                this.isInFastMoveMode = false;
                this.fastMoveStartTime = 0;
            }
            
            // 检测点头加速下降
            if (this.tetrisGame.gameRunning) {
                this.checkNodAcceleration(noseY);
            }
            
            this.mouthWasOpen = isMouthOpen;
            this.lastTiltState = this.currentTiltState;
            
            // 执行动作
            if (action) {
                if (action === 'rotate' || action !== this.lastAction) {
                    this.executeAction(action);
                    this.lastAction = action;
                    this.lastActionTime = now;
                    
                    setTimeout(() => {
                        this.lastAction = '';
                    }, this.actionCooldown);
                }
            }
        } catch (error) {
            console.error('动作检测错误:', error);
        }
    }
    
    // 点头检测（检测完整的点头动作：向下然后向上，或向上然后向下）
    checkNodAcceleration(noseY) {
        const now = Date.now();

        this.updateNosePositionHistory(noseY);

        if (!this.dynamicBaseline) return false;

        // 计算相对于基准线的位置
        const relativePosition = noseY - this.dynamicBaseline;
        const nodDownThreshold = this.nodThreshold;
        const nodUpThreshold = -this.nodThreshold; // 向上移动是负值

        const currentDirection = relativePosition > nodDownThreshold ? 'down' :
            relativePosition < nodUpThreshold ? 'up' : 'center';

        // 点头/抬头状态机
        switch (this.nodPhase) {
            case 'waiting':
                if (currentDirection === 'down') {
                    this.nodPhase = 'going_down';
                    this.nodStartTime = now;
                    console.log('开始点头 - 向下阶段');
                } else if (currentDirection === 'up') {
                    this.nodPhase = 'going_up';
                    this.nodStartTime = now;
                    console.log('开始抬头 - 向上阶段');
                }
                break;

            case 'going_down':
                // 如果从向下阶段返回，则完成一次“下-上”晃头
                if (currentDirection === 'up' || currentDirection === 'center') {
                    if (now - this.nodStartTime > 100) { // 防抖
                        this.nodPhase = 'completed';
                        console.log('晃头(下-上)完成，触发下降');
                        this.triggerNodDrop();
                    } else {
                        this.nodPhase = 'waiting'; // 动作太快，重置
                    }
                } else if (now - this.nodStartTime > 1000) {
                    // 超时重置
                    this.nodPhase = 'waiting';
                }
                break;

            case 'going_up':
                // 如果从向上阶段返回，则完成一次“上-下”晃头
                if (currentDirection === 'down' || currentDirection === 'center') {
                    if (now - this.nodStartTime > 100) { // 防抖
                        this.nodPhase = 'completed';
                        console.log('晃头(上-下)完成，触发下降');
                        this.triggerNodDrop();
                    } else {
                        this.nodPhase = 'waiting'; // 动作太快，重置
                    }
                } else if (now - this.nodStartTime > 1000) {
                    // 超时重置
                    this.nodPhase = 'waiting';
                }
                break;

            case 'completed':
                // 等待头部回到中心位置，准备下一次检测
                if (currentDirection === 'center') {
                    this.nodPhase = 'waiting';
                } else if (now - this.nodStartTime > 2000) {
                    // 超时强制重置
                    this.nodPhase = 'waiting';
                }
                break;
        }

        return false; // 不需要持续加速
    }
    
    // 触发点头下降
    triggerNodDrop() {
        const now = Date.now();

        // 冷却时间检查，防止过于频繁
        if (now - this.lastNodTime < this.nodCooldown) {
            return;
        }

        this.lastNodTime = now;

        if (this.tetrisGame.gameRunning && this.tetrisGame.currentPiece) {
            console.log('点头/晃头触发，执行下降三格');

            for (let i = 0; i < 3; i++) {
                // 尝试下降
                if (!this.tetrisGame.movePiece(0, 1)) {
                    // 如果任何一次下降失败，意味着方块已经触底
                    console.log(`下降第 ${i + 1} 格失败，方块触底立即固定`);
                    this.tetrisGame.dropTime = this.tetrisGame.dropInterval; // 强制立即锁定
                    break; // 停止尝试继续下降
                }
            }
        }
    }
    
    updateNosePositionHistory(noseY) {
        this.nosePositionHistory.push(noseY);
        if (this.nosePositionHistory.length > this.maxNoseHistory) {
            this.nosePositionHistory.shift();
        }
        
        this.frameCount++;
        
        if (this.frameCount % this.baselineUpdateInterval === 0 && this.nosePositionHistory.length >= 10) {
            const sortedHistory = [...this.nosePositionHistory].sort((a, b) => a - b);
            const medianIndex = Math.floor(sortedHistory.length / 2);
            this.dynamicBaseline = sortedHistory[medianIndex];
        }
    }
    
    calculateHeadTilt(landmarks) {
        const leftEye = landmarks[33];
        const rightEye = landmarks[362];
        
        if (!leftEye || !rightEye) {
            const nose = landmarks[1];
            return nose.x - this.baselineNose.x;
        }
        
        const eyeLineAngle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
        return Math.sin(eyeLineAngle);
    }
    
    executeAction(action) {
        if (!this.tetrisGame.gameRunning) return;
        
        // 在加速状态下只禁用移动操作，允许旋转
        if (this.isAcceleratingDrop && (action === 'left' || action === 'right')) {
            console.log('加速状态下禁用移动操作:', action);
            return;
        }
        
        switch (action) {
            case 'left':
                this.tetrisGame.movePiece(1, 0);
                break;
            case 'right':
                this.tetrisGame.movePiece(-1, 0);
                break;
            case 'rotate':
                this.tetrisGame.rotatePiece();
                break;
        }
    }
    
    drawLandmarks(ctx, landmarks) {
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;
        
        // 先绘制美白面部填充
        this.drawFaceFill(ctx, landmarks, canvasWidth, canvasHeight);
        
        // 绘制美化的面部轮廓
        this.drawBeautifiedFaceContour(ctx, landmarks, canvasWidth, canvasHeight);
        
        // 绘制美化的眼睛
        this.drawBeautifiedEyes(ctx, landmarks, canvasWidth, canvasHeight);
        
        // 绘制美化的嘴巴
        this.drawBeautifiedMouth(ctx, landmarks, canvasWidth, canvasHeight);
        
        // 绘制美化的鼻子
        this.drawBeautifiedNose(ctx, landmarks, canvasWidth, canvasHeight);
        
        // 绘制美化的眉毛
        this.drawBeautifiedEyebrows(ctx, landmarks, canvasWidth, canvasHeight);
        
        // 添加面部高光效果
        this.drawFaceHighlights(ctx, landmarks, canvasWidth, canvasHeight);
    }
    
    // 绘制自然的面部高光效果
    drawFaceHighlights(ctx, landmarks, width, height) {
        // 轻微的鼻梁高光
        const noseHighlight = landmarks[9];
        if (noseHighlight) {
            const x = noseHighlight.x * width;
            const y = noseHighlight.y * height;
            
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, 4);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
            gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // 脸颊的自然腮红
        const leftCheek = landmarks[116];
        const rightCheek = landmarks[345];
        
        if (leftCheek) {
            this.drawNaturalBlush(ctx, leftCheek.x * width, leftCheek.y * height);
        }
        if (rightCheek) {
            this.drawNaturalBlush(ctx, rightCheek.x * width, rightCheek.y * height);
        }
    }
    
    // 绘制自然腮红
    drawNaturalBlush(ctx, x, y) {
        // 主要腮红渐变 - 自然粉色
        const blushGradient = ctx.createRadialGradient(x, y, 0, x, y, 12);
        blushGradient.addColorStop(0, 'rgba(255, 182, 193, 0.2)'); // 淡粉色中心
        blushGradient.addColorStop(0.4, 'rgba(255, 192, 203, 0.15)'); // 浅粉色
        blushGradient.addColorStop(0.7, 'rgba(255, 218, 185, 0.1)'); // 桃色
        blushGradient.addColorStop(1, 'rgba(255, 228, 225, 0)');
        
        ctx.fillStyle = blushGradient;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // 绘制脸颊高光
    drawCheekHighlight(ctx, x, y) {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 15);
        gradient.addColorStop(0, 'rgba(255, 182, 193, 0.2)'); // 淡粉色
        gradient.addColorStop(0.5, 'rgba(255, 192, 203, 0.1)');
        gradient.addColorStop(1, 'rgba(255, 192, 203, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // 绘制校准进度
    drawCalibrationProgress(ctx) {
        const progress = this.calibrationFrames / this.maxCalibrationFrames;
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;
        
        // 绘制半透明背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        // 响应式校准框尺寸
        const boxWidth = Math.min(canvasWidth * 0.9, 250);
        const boxHeight = Math.min(canvasHeight * 0.6, 100);
        const boxX = (canvasWidth - boxWidth) / 2;
        const boxY = (canvasHeight - boxHeight) / 2;
        
        // 背景框
        ctx.fillStyle = 'rgba(78, 205, 196, 0.2)';
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        
        // 边框
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 2;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
        
        // 标题
        ctx.fillStyle = '#4ecdc4';
        ctx.font = `bold ${Math.min(16, boxWidth / 15)}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText('🎯 Calibrating', canvasWidth / 2, boxY + boxHeight * 0.3);
        
        // 进度条背景
        const progressBarWidth = boxWidth * 0.8;
        const progressBarHeight = Math.min(16, boxHeight * 0.2);
        const progressBarX = (canvasWidth - progressBarWidth) / 2;
        const progressBarY = boxY + boxHeight * 0.5;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight);
        
        // 进度条
        const progressWidth = progressBarWidth * progress;
        const gradient = ctx.createLinearGradient(progressBarX, 0, progressBarX + progressWidth, 0);
        gradient.addColorStop(0, '#4ecdc4');
        gradient.addColorStop(1, '#45b7d1');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(progressBarX, progressBarY, progressWidth, progressBarHeight);
        
        // 进度条边框
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 1;
        ctx.strokeRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight);
        
        // 进度百分比
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.min(14, boxWidth / 18)}px Arial`;
        ctx.fillText(`${Math.round(progress * 100)}%`, canvasWidth / 2, progressBarY + progressBarHeight - 2);
        
        // 提示文字
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.min(12, boxWidth / 20)}px Arial`;
        ctx.fillText('Face the camera', canvasWidth / 2, boxY + boxHeight * 0.85);
        
        // 重置文本对齐
        ctx.textAlign = 'left';
    }
    
    // 绘制校准完成提示
    drawCalibrationComplete(ctx) {
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;

        // --- New Design ---
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const text = '✅ Calibration Complete!';
        const textMetrics = ctx.measureText(text);
        const textWidth = textMetrics.width;

        const paddingX = 20;
        const paddingY = 10;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = 14 + paddingY * 2; // 14 is font size

        const boxX = (canvasWidth - boxWidth) / 2;
        const boxY = canvasHeight - boxHeight - 10; // Position 10px from bottom

        // Draw the background box with a gradient
        const gradient = ctx.createLinearGradient(boxX, boxY, boxX + boxWidth, boxY + boxHeight);
        gradient.addColorStop(0, 'rgba(78, 205, 196, 0.9)');
        gradient.addColorStop(1, 'rgba(69, 183, 209, 0.9)');
        ctx.fillStyle = gradient;
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

        // Draw a thin white border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        // Draw the text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, canvasWidth / 2, boxY + boxHeight / 2);

        // Reset alignment for other functions
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
    
    // 绘制迷你状态指示器（右上角小图标）
    drawMiniStatus(ctx, landmarks) {
        if (!this.baselineNose || !landmarks) return;
        
        const canvasWidth = ctx.canvas.width;
        const iconSize = 20;
        const spacing = 25;
        let iconX = canvasWidth - 30;
        const iconY = 15;
        
        ctx.font = '16px Arial';
        
        // Tilt status icon
        let tiltIcon = '↔';
        if (this.currentTiltState === 'left') {
            tiltIcon = '←';
        } else if (this.currentTiltState === 'right') {
            tiltIcon = '→';
        }
        ctx.fillText(tiltIcon, iconX, iconY);
        iconX -= spacing;
        
        // Nod status icon
        if (this.nodPhase === 'going_down') {
            ctx.fillText('↓', iconX, iconY);
            iconX -= spacing;
        } else if (this.nodPhase === 'completed') {
            ctx.fillText('⚡', iconX, iconY);
            iconX -= spacing;
        }
        
        // Move mode icon
        if (this.isInFastMoveMode) {
            ctx.fillText('⚡', iconX, iconY);
            iconX -= spacing;
        } else if (this.isInContinuousMode) {
            ctx.fillText('H', iconX, iconY); // Changed from ↻ to H
            iconX -= spacing;
        }
        
        // Mouth status icon
        const upperLip = landmarks[13] || landmarks[12];
        const lowerLip = landmarks[14] || landmarks[15];
        if (upperLip && lowerLip && this.baselineMouth) {
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            const mouthOpen = mouthDistance - this.baselineMouth.distance;
            const isMouthOpen = mouthOpen > this.mouthOpenThreshold;
            
            if (isMouthOpen) {
                ctx.fillText('↻', iconX, iconY);
            }
        }
    }
    
    // 绘制自然的面部填充（去除过度美白）
    drawFaceFill(ctx, landmarks, width, height) {
        const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
        
        ctx.beginPath();
        for (let i = 0; i < faceOval.length; i++) {
            const point = landmarks[faceOval[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        
        // 自然肌肤色调，参考凌波丽的真实肤色
        const centerX = width / 2;
        const centerY = height / 2;
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.min(width, height) / 2);
        gradient.addColorStop(0, 'rgba(245, 235, 225, 0.4)'); // 自然肤色中心
        gradient.addColorStop(0.4, 'rgba(240, 228, 218, 0.3)'); // 温暖肤色
        gradient.addColorStop(0.7, 'rgba(235, 220, 210, 0.2)'); // 自然过渡
        gradient.addColorStop(1, 'rgba(230, 215, 205, 0.1)'); // 柔和边缘
        
        ctx.fillStyle = gradient;
        ctx.fill();
    }

    // 绘制自然精致的面部轮廓（参考凌波丽风格）
    drawBeautifiedFaceContour(ctx, landmarks, width, height) {
        const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
        
        // 主轮廓线 - 自然的肤色边界
        ctx.strokeStyle = 'rgba(160, 140, 120, 0.5)'; // 自然肤色轮廓
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < faceOval.length; i++) {
            const point = landmarks[faceOval[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
        
        // 内层精致线条 - 柔和的阴影定义
        ctx.strokeStyle = 'rgba(140, 120, 100, 0.3)'; // 淡褐色阴影
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < faceOval.length; i++) {
            const point = landmarks[faceOval[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
    }
    
    // 绘制美化的眼睛
    drawBeautifiedEyes(ctx, landmarks, width, height) {
        // 左眼轮廓
        const leftEye = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
        // 右眼轮廓
        const rightEye = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
        
        // 绘制眼部填充
        this.drawEyeFill(ctx, landmarks, leftEye, width, height);
        this.drawEyeFill(ctx, landmarks, rightEye, width, height);
        
        // 绘制眼部轮廓 - 柔和外层
        ctx.strokeStyle = 'rgba(69, 183, 209, 0.4)';
        ctx.lineWidth = 3;
        this.drawEyeContour(ctx, landmarks, leftEye, width, height);
        this.drawEyeContour(ctx, landmarks, rightEye, width, height);
        
        // 绘制眼部轮廓 - 清晰内层
        ctx.strokeStyle = '#45b7d1';
        ctx.lineWidth = 1.2;
        this.drawEyeContour(ctx, landmarks, leftEye, width, height);
        this.drawEyeContour(ctx, landmarks, rightEye, width, height);
        
        // 绘制美化的瞳孔
        this.drawBeautifiedPupils(ctx, landmarks, width, height);
    }
    
    // 绘制眼部填充
    drawEyeFill(ctx, landmarks, eyePoints, width, height) {
        ctx.beginPath();
        for (let i = 0; i < eyePoints.length; i++) {
            const point = landmarks[eyePoints[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        
        // 眼部白色填充
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fill();
    }
    
    // 绘制眼部轮廓
    drawEyeContour(ctx, landmarks, eyePoints, width, height) {
        ctx.beginPath();
        for (let i = 0; i < eyePoints.length; i++) {
            const point = landmarks[eyePoints[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
    }
    
    // 绘制美化的瞳孔
    drawBeautifiedPupils(ctx, landmarks, width, height) {
        const leftPupil = landmarks[468]; // 左眼中心
        const rightPupil = landmarks[473]; // 右眼中心
        
        if (leftPupil) {
            this.drawPupil(ctx, leftPupil.x * width, leftPupil.y * height);
        }
        if (rightPupil) {
            this.drawPupil(ctx, rightPupil.x * width, rightPupil.y * height);
        }
    }
    
    // 绘制自然的蓝色瞳孔（参考凌波丽）
    drawPupil(ctx, x, y) {
        // 虹膜 - 自然的蓝色渐变
        const irisGradient = ctx.createRadialGradient(x, y, 0, x, y, 6);
        irisGradient.addColorStop(0, 'rgba(70, 130, 180, 0.8)'); // 钢蓝色中心
        irisGradient.addColorStop(0.5, 'rgba(100, 149, 237, 0.7)'); // 矢车菊蓝
        irisGradient.addColorStop(0.8, 'rgba(65, 105, 225, 0.6)'); // 皇家蓝
        irisGradient.addColorStop(1, 'rgba(30, 60, 120, 0.5)'); // 深蓝边缘
        
        ctx.fillStyle = irisGradient;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        // 瞳孔
        ctx.fillStyle = 'rgba(20, 20, 60, 0.9)'; // 深色瞳孔
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
        
        // 自然高光
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(x - 1, y - 1, 1.2, 0, 2 * Math.PI);
        ctx.fill();
        
        // 次要高光
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(x + 1.5, y + 1.5, 0.6, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // 绘制美化的嘴巴
    drawBeautifiedMouth(ctx, landmarks, width, height) {
        // 嘴巴外轮廓
        const mouthOuter = [61, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318];
        // 嘴巴内轮廓
        const mouthInner = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324];
        
        // 绘制嘴唇填充
        ctx.beginPath();
        for (let i = 0; i < mouthOuter.length; i++) {
            const point = landmarks[mouthOuter[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        
        // 凌波丽风格的精致嘴唇渐变
        const mouthCenter = landmarks[13];
        if (mouthCenter) {
            const centerX = mouthCenter.x * width;
            const centerY = mouthCenter.y * height;
            
            // 主要嘴唇渐变 - 更加精致的粉色
            const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 18);
            gradient.addColorStop(0, 'rgba(255, 192, 203, 0.8)'); // 淡粉色中心
            gradient.addColorStop(0.4, 'rgba(255, 182, 193, 0.6)'); // 浅粉色
            gradient.addColorStop(0.7, 'rgba(255, 160, 180, 0.4)'); // 中等粉色
            gradient.addColorStop(1, 'rgba(255, 140, 160, 0.2)'); // 边缘粉色
            
            ctx.fillStyle = gradient;
            ctx.fill();
            
            // 嘴唇高光 - 动漫风格的光泽感
            const highlightGradient = ctx.createLinearGradient(centerX - 10, centerY - 3, centerX + 10, centerY + 3);
            highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
            highlightGradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
            highlightGradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.4)');
            highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = highlightGradient;
            ctx.beginPath();
            ctx.ellipse(centerX, centerY - 2, 8, 2, 0, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // 外层轮廓 - 柔和光晕
        ctx.strokeStyle = 'rgba(255, 107, 107, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < mouthOuter.length; i++) {
            const point = landmarks[mouthOuter[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
        
        // 内层轮廓 - 清晰线条
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < mouthOuter.length; i++) {
            const point = landmarks[mouthOuter[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
        
        // 嘴唇分界线
        ctx.strokeStyle = 'rgba(255, 138, 138, 0.8)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < mouthInner.length; i++) {
            const point = landmarks[mouthInner[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.closePath();
        ctx.stroke();
    }
    
    // 绘制美化的鼻子
    drawBeautifiedNose(ctx, landmarks, width, height) {
        // 鼻梁
        const noseBridge = [6, 8, 9, 10, 151];
        
        // 鼻梁外层光晕
        ctx.strokeStyle = 'rgba(255, 165, 0, 0.3)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < noseBridge.length; i++) {
            const point = landmarks[noseBridge[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
        
        // 鼻梁内层线条
        ctx.strokeStyle = 'rgba(255, 165, 0, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < noseBridge.length; i++) {
            const point = landmarks[noseBridge[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
        
        // 鼻尖高光
        const noseTip = landmarks[1];
        if (noseTip) {
            const x = noseTip.x * width;
            const y = noseTip.y * height;
            
            // 外层光晕
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, 6);
            gradient.addColorStop(0, 'rgba(255, 165, 0, 0.6)');
            gradient.addColorStop(0.7, 'rgba(255, 165, 0, 0.3)');
            gradient.addColorStop(1, 'rgba(255, 165, 0, 0.1)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, 2 * Math.PI);
            ctx.fill();
            
            // 内层高光
            ctx.fillStyle = 'rgba(255, 200, 100, 0.8)';
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // 鼻孔 - 更自然的颜色
        const leftNostril = landmarks[220];
        const rightNostril = landmarks[305];
        
        if (leftNostril) {
            this.drawNostril(ctx, leftNostril.x * width, leftNostril.y * height);
        }
        if (rightNostril) {
            this.drawNostril(ctx, rightNostril.x * width, rightNostril.y * height);
        }
    }
    
    // 绘制鼻孔
    drawNostril(ctx, x, y) {
        // 外层阴影
        ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
        
        // 内层鼻孔
        ctx.fillStyle = 'rgba(139, 69, 19, 0.6)';
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // 绘制美化的眉毛
    drawBeautifiedEyebrows(ctx, landmarks, width, height) {
        // 左眉毛关键点
        const leftEyebrow = [46, 53, 52, 51, 48];
        // 右眉毛关键点
        const rightEyebrow = [276, 283, 282, 295, 285];
        
        // 绘制左眉毛
        this.drawEyebrow(ctx, landmarks, leftEyebrow, width, height);
        // 绘制右眉毛
        this.drawEyebrow(ctx, landmarks, rightEyebrow, width, height);
    }
    
    // 绘制单个眉毛
    drawEyebrow(ctx, landmarks, eyebrowPoints, width, height) {
        // 外层光晕
        ctx.strokeStyle = 'rgba(139, 69, 19, 0.4)';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        for (let i = 0; i < eyebrowPoints.length; i++) {
            const point = landmarks[eyebrowPoints[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
        
        // 内层眉毛
        ctx.strokeStyle = 'rgba(101, 67, 33, 0.8)';
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        for (let i = 0; i < eyebrowPoints.length; i++) {
            const point = landmarks[eyebrowPoints[i]];
            if (point) {
                const x = point.x * width;
                const y = point.y * height;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        ctx.stroke();
        
        // 眉毛毛发效果
        ctx.strokeStyle = 'rgba(139, 69, 19, 0.6)';
        ctx.lineWidth = 0.8;
        
        for (let i = 0; i < eyebrowPoints.length - 1; i++) {
            const point1 = landmarks[eyebrowPoints[i]];
            const point2 = landmarks[eyebrowPoints[i + 1]];
            
            if (point1 && point2) {
                const x1 = point1.x * width;
                const y1 = point1.y * height;
                const x2 = point2.x * width;
                const y2 = point2.y * height;
                
                // 绘制几根毛发线条
                for (let j = 0; j < 3; j++) {
                    const t = j / 2;
                    const x = x1 + (x2 - x1) * t;
                    const y = y1 + (y2 - y1) * t;
                    
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + (Math.random() - 0.5) * 4, y - 2 - Math.random() * 3);
                    ctx.stroke();
                }
            }
        }
    }
    
    drawControlStatus(ctx, landmarks) {
        if (!this.baselineNose || !landmarks) return;

        const canvasWidth = ctx.canvas.width;
        const statusX = 5;
        let statusY = 5;
        const lineHeight = 15; // Line height for vertical layout
        const padding = 5;
        ctx.font = 'bold 12px Arial'; // Larger font

        // --- Step 1: Collect all status items to be drawn ---
        const items = [];
        items.push({ text: '▶ Status', color: '#4ecdc4' }); // Title

        // 1. Tilt Status
        let tiltIcon = '↔';
        let tiltColor = '#FFF';
        if (this.currentTiltState === 'left') {
            tiltIcon = '←';
            tiltColor = '#ff6b6b';
        } else if (this.currentTiltState === 'right') {
            tiltIcon = '→';
            tiltColor = '#45b7d1';
        }
        items.push({ text: `${tiltIcon} Tilt`, color: tiltColor });

        // 2. Nod Status
        if (this.nodPhase === 'going_down' || this.nodPhase === 'completed') {
            items.push({ text: '↓ Nod', color: '#ffcc00' });
        }

        // 3. Mouth Status
        const upperLip = landmarks[13] || landmarks[12];
        const lowerLip = landmarks[14] || landmarks[15];
        if (upperLip && lowerLip && this.baselineMouth) {
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            const mouthOpen = mouthDistance - this.baselineMouth.distance;
            if (mouthOpen > this.mouthOpenThreshold) {
                items.push({ text: '↻ Rotate', color: '#ff6b6b' });
            }
        }

        // 4. Continuous/Fast Move Status
        if (this.isInFastMoveMode) {
            items.push({ text: '⚡ Fast', color: '#ff6b6b' });
        } else if (this.isInContinuousMode) {
            items.push({ text: 'H Hold', color: '#45b7d1' });
        }

        // --- Step 2: Calculate box size and draw background ---
        const boxHeight = items.length * lineHeight + padding * 2;
        let maxTextWidth = 0;
        items.forEach(item => {
            const width = ctx.measureText(item.text).width;
            if (width > maxTextWidth) {
                maxTextWidth = width;
            }
        });
        const boxWidth = maxTextWidth + padding * 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(statusX, statusY, boxWidth, boxHeight);

        // --- Step 3: Draw the text items vertically ---
        ctx.textBaseline = 'top';
        items.forEach((item, index) => {
            ctx.fillStyle = item.color;
            ctx.fillText(item.text, statusX + padding, statusY + padding + (index * lineHeight));
        });
    }
    
    resetDropSpeed() {
        // 点头是瞬时动作，不需要重置持续状态
        this.nodPhase = 'waiting';
        this.nodStartTime = 0;
    }
    
    updateSensitivity(tiltThreshold, nodThreshold, mouthThreshold) {
        this.headTiltThreshold = tiltThreshold;
        this.nodThreshold = nodThreshold;
        this.mouthOpenThreshold = mouthThreshold;
    }
    
    stop() {
        if (this.camera) {
            this.camera.stop();
        }
        
        const video = document.getElementById('input_video');
        if (video && video.srcObject) {
            const tracks = video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            video.srcObject = null;
        }
        
        this.isActive = false;
        this.resetCalibration();
    }
}