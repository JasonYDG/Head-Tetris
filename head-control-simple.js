// Simplified head movement control system - uses default camera only
class HeadControl {
    constructor(tetrisGame, onCalibrationComplete, onFaceStatusChange) {
        this.onFaceStatusChange = onFaceStatusChange;
        this.isFaceDetected = false;
        this.lastFaceDetectionStatus = false;
        this.calibrationCompletedNotified = false;
        this.tetrisGame = tetrisGame;
        this.onCalibrationComplete = onCalibrationComplete;
        this.faceMesh = null;
        this.camera = null;
        this.isActive = false;
        
        // Control parameters (adjustable)
        this.headTiltThreshold = 0.15; // Left/right tilt threshold (based on eye line angle)
        this.mouthOpenThreshold = 0.02; // Mouth open detection threshold
        
        // Debounce parameters
        this.lastAction = '';
        this.actionCooldown = 300;
        this.lastActionTime = 0;
        
        // Left/right movement state tracking
        this.currentTiltState = 'center';
        this.lastTiltState = 'center';
        
        // Baseline position
        this.baselineNose = null;
        this.baselineMouth = null;
        this.calibrationFrames = 0;
        this.maxCalibrationFrames = 30;
        
        // Mouth state tracking
        this.mouthWasOpen = false;
        
        // Continuous movement detection
        this.continuousMoveStartTime = 0;
        this.continuousMoveThreshold = 1000;
        this.continuousMoveInterval = 150;
        this.lastContinuousMoveTime = 0;
        this.isInContinuousMode = false;
        this.isInFastMoveMode = false;
        this.fastMoveStartTime = 0;
        
        // Fast movement detection (large tilt)
        this.fastMoveThreshold = 0.22;
        this.fastMoveInterval = 90;
        
        // Nod acceleration drop detection (modified to nod action detection)
        this.nodStartTime = 0;
        this.nodThreshold = 0.05; // Nod detection threshold (中等灵敏度)
        this.isNodding = false;
        this.lastNodTime = 0;
        this.nodCooldown = 200; // Nod cooldown time, prevent repeated detection (降低冷却时间)
        
        // Nod state tracking
        this.nosePositionHistory = [];
        this.maxNoseHistory = 10;
        this.dynamicBaseline = null;
        this.baselineUpdateInterval = 20; // 更快的基线更新，更好地适应头部位置
        this.frameCount = 0;
        this.lastNoseY = 0;
        this.nodDirection = 'none'; // 'down', 'up', 'none'
        this.nodPhase = 'waiting'; // 'waiting', 'going_down', 'going_up', 'completed'
        
        // Status display control
        this.showDetailedStatus = true; // Can be set to false to show mini status
        
        // Calibration complete prompt control
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
                refineLandmarks: false, // 关闭精细化地标检测以减少CPU使用
                minDetectionConfidence: 0.4, // 降低检测置信度阈值
                minTrackingConfidence: 0.4  // 降低跟踪置信度阈值
            });
            
            this.faceMesh.onResults(this.onResults.bind(this));
            
            console.log('MediaPipe Face Mesh initialized successfully');
        } catch (error) {
            console.error('MediaPipe initialization failed:', error);
        }
    }
    
    async startCamera() {
        try {
            const video = document.getElementById('input_video');
            const canvas = document.getElementById('output_canvas');
            
            // Reset calibration state
            this.resetCalibration();
            
            // Use default camera, simple configuration
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
            
            // Wait for video to load
            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    video.play().then(resolve);
                };
            });
            
            // Create MediaPipe Camera
            this.camera = new Camera(video, {
                onFrame: async () => {
                    try {
                        if (this.faceMesh && video.readyState === 4) {
                            await this.faceMesh.send({image: video});
                        }
                    } catch (error) {
                        console.error('Frame processing error:', error);
                    }
                },
                width: 320,
                height: 240
            });
            
            await this.camera.start();
            this.isActive = true;
            console.log('Default camera started successfully');
            
            // Display initial status
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
            console.error('Camera startup failed:', error);
            let errorMessage = 'Cannot access camera';
            
            if (error.name === 'NotAllowedError') {
                errorMessage = 'Camera permission denied, please check browser settings';
            } else if (error.name === 'NotReadableError') {
                errorMessage = 'Camera is in use by another application';
            }
            
            alert(errorMessage);
            throw error;
        }
    }
    
    onResults(results) {
        try {
            const canvas = document.getElementById('output_canvas');
            const ctx = canvas.getContext('2d');
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw video frame
            if (results.image) {
                ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
            }
            
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                this.isFaceDetected = true; // Face detected
                const landmarks = results.multiFaceLandmarks[0];
                
                // Draw face landmarks every frame
                this.drawLandmarks(ctx, landmarks);
                
                // Calibrate baseline position
                if (this.calibrationFrames < this.maxCalibrationFrames) {
                    this.calibrateBaseline(landmarks);
                    this.calibrationFrames++;
                    
                    // Display calibration progress
                    this.drawCalibrationProgress(ctx);
                    return;
                }
                
                // Display calibration complete status (disappears after 5 seconds)
                const now = Date.now();
                if (this.showCalibrationComplete && (now - this.calibrationCompleteTime < 5000)) {
                    this.drawCalibrationComplete(ctx);
                } else if (this.showCalibrationComplete && (now - this.calibrationCompleteTime >= 5000)) {
                    this.showCalibrationComplete = false;
                }
                
                // Detect head movements
                this.detectHeadMovements(landmarks);
                
                // Display control status (detail level controlled by showDetailedStatus)
                if (this.showDetailedStatus !== false) {
                    this.drawControlStatus(ctx, landmarks);
                } else {
                    this.drawMiniStatus(ctx, landmarks);
                }
            } else {
                // No face detected
                // Draw "Please face the camera" message
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.fillStyle = '#ff6b6b'; // Red color for warning
                ctx.font = 'bold 18px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                ctx.fillText('Please face the camera', canvas.width / 2, canvas.height / 2);
            }
            // Check if status changed and notify
            if (this.isFaceDetected !== this.lastFaceDetectionStatus) {
                this.lastFaceDetectionStatus = this.isFaceDetected;
                if (this.onFaceStatusChange) {
                    this.onFaceStatusChange(this.isFaceDetected);
                }
            }
        } catch (error) {
            console.error('onResults processing error:', error);
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
                
                // Record calibration completion time
                this.calibrationCompleteTime = Date.now();
                this.showCalibrationComplete = true;
                
                console.log('Calibration complete!');

                if (this.onCalibrationComplete) {
                    this.onCalibrationComplete();
                    this.calibrationCompletedNotified = true; // Prevent multiple calls
                }
            }
        } catch (error) {
            console.error('Calibration process error:', error);
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
        
        // Reset calibration complete prompt
        this.calibrationCompleteTime = 0;
        this.showCalibrationComplete = false;
        
        // Reset nod detection system
        this.nosePositionHistory = [];
        this.dynamicBaseline = null;
        this.frameCount = 0;
        this.lastNoseY = 0;
        this.nodDirection = 'none';
        this.nodPhase = 'waiting';

        // Reset face detection status
        this.isFaceDetected = false;
        this.lastFaceDetectionStatus = false;
        this.calibrationCompletedNotified = false; // New property
    }
    
    // Simplified head movement detection
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
            
            // Calculate head tilt
            const tiltX = this.calculateHeadTilt(landmarks);
            const noseY = nose.y;
            
            // Calculate mouth open degree
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            const mouthOpen = mouthDistance - this.baselineMouth.distance;
            const isMouthOpen = mouthOpen > this.mouthOpenThreshold;
            
            let action = '';
            
            // Update current tilt state
            if (tiltX > this.headTiltThreshold) {
                this.currentTiltState = 'right';
            } else if (tiltX < -this.headTiltThreshold) {
                this.currentTiltState = 'left';
            } else {
                this.currentTiltState = 'center';
            }
            
            // Detect mouth open for rotation
            if (isMouthOpen && !this.mouthWasOpen) {
                action = 'rotate';
            }
            // Detect left/right tilt (not disabled during nod, as nod is instantaneous)
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
                    console.log('Head returned to center, ending move mode');
                }
                this.continuousMoveStartTime = 0;
                this.isInContinuousMode = false;
                this.isInFastMoveMode = false;
                this.fastMoveStartTime = 0;
            }
            
            // Detect nod for accelerated drop
            if (this.tetrisGame.gameRunning) {
                this.checkNodAcceleration(noseY);
            }
            
            this.mouthWasOpen = isMouthOpen;
            this.lastTiltState = this.currentTiltState;
            
            // Execute action
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
            console.error('Action detection error:', error);
        }
    }
    
    // Nod detection (detects full nod action: down then up, or up then down)
    checkNodAcceleration(noseY) {
        const now = Date.now();

        this.updateNosePositionHistory(noseY);

        if (!this.dynamicBaseline) return false;

        // Calculate position relative to baseline
        const relativePosition = noseY - this.dynamicBaseline;
        const nodDownThreshold = this.nodThreshold;
        const nodUpThreshold = -this.nodThreshold; // Upward movement is negative

        const currentDirection = relativePosition > nodDownThreshold ? 'down' :
            relativePosition < nodUpThreshold ? 'up' : 'center';

        // 标准点头检测：只检测"向下-向上"的点头动作
        switch (this.nodPhase) {
            case 'waiting':
                // 只有向下的动作才开始点头检测
                if (currentDirection === 'down') {
                    this.nodPhase = 'going_down';
                    this.nodStartTime = now;
                    console.log('开始点头 - 向下阶段');
                }
                // 忽略向上的动作，不触发检测
                break;

            case 'going_down':
                // 从向下阶段返回到中心或向上，完成一次标准点头
                if (currentDirection === 'up' || currentDirection === 'center') {
                    if (now - this.nodStartTime > 80 && now - this.nodStartTime < 1000) { 
                        // 防抖动：80ms-1000ms之间的动作才有效（放宽时间窗口）
                        this.nodPhase = 'completed';
                        console.log('标准点头完成 (向下-向上)，触发快速下降');
                        this.triggerNodDrop();
                    } else {
                        this.nodPhase = 'waiting'; // 动作太快或太慢，重置
                        console.log('点头动作时间不合适，重置');
                    }
                } else if (now - this.nodStartTime > 1000) {
                    // 超时重置
                    this.nodPhase = 'waiting';
                    console.log('点头检测超时，重置');
                }
                break;

            case 'completed':
                // 等待头部回到中心位置，准备下次检测
                if (currentDirection === 'center') {
                    this.nodPhase = 'waiting';
                    console.log('头部回到中心，准备下次点头检测');
                } else if (now - this.nodStartTime > 2000) {
                    // 强制超时重置
                    this.nodPhase = 'waiting';
                    console.log('点头完成状态超时，强制重置');
                }
                break;
        }

        return false; // No continuous acceleration needed
    }
    
    // Trigger nod drop
    triggerNodDrop() {
        const now = Date.now();

        // 冷却时间检查，防止过于频繁触发
        if (now - this.lastNodTime < this.nodCooldown) {
            console.log('点头触发在冷却时间内，忽略');
            return;
        }

        this.lastNodTime = now;

        if (this.tetrisGame.gameRunning && this.tetrisGame.currentPiece) {
            console.log('点头触发快速下降，尝试下降5格');

            // 增加快速下降的格数，让效果更明显
            for (let i = 0; i < 5; i++) {
                // 尝试下降一格
                if (!this.tetrisGame.movePiece(0, 1)) {
                    // 如果下降失败，说明方块已经触底
                    console.log(`第${i + 1}格下降失败，方块触底并立即锁定`);
                    this.tetrisGame.dropTime = this.tetrisGame.dropInterval; // 强制立即锁定
                    break; // 停止继续尝试下降
                } else {
                    console.log(`成功下降第${i + 1}格`);
                }
            }
        } else {
            console.log('游戏未运行或无当前方块，忽略点头触发');
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
        
        // Only disable move operations in accelerated state, allow rotation
        if (this.isAcceleratingDrop && (action === 'left' || action === 'right')) {
            console.log('Move operation disabled in accelerated state:', action);
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
        
        // 提高面部亮度和对比度
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'; // 提高亮度50%
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        // 增加对比度以显示更多面部细节
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = 'rgba(128, 128, 128, 0.15)'; // 增加对比度
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        ctx.globalCompositeOperation = 'source-over'; // 恢复默认混合模式
        
        // Draw simplified face contour
        this.drawBeautifiedFaceContour(ctx, landmarks, canvasWidth, canvasHeight);
        
        // Draw only mouth outline (needed for mouth open detection)
        this.drawBeautifiedMouth(ctx, landmarks, canvasWidth, canvasHeight);
        
        // Skip nose, eyes and eyebrows to reduce CPU usage
        // this.drawBeautifiedNose(ctx, landmarks, canvasWidth, canvasHeight);
        // this.drawBeautifiedEyes(ctx, landmarks, canvasWidth, canvasHeight);
        // this.drawBeautifiedEyebrows(ctx, landmarks, canvasWidth, canvasHeight);
        // this.drawFaceHighlights(ctx, landmarks, canvasWidth, canvasHeight);
    }
    
    // Simplified face highlight effect
    drawFaceHighlights(ctx, landmarks, width, height) {
        // 简化的鼻子高光，减少复杂计算
        const noseHighlight = landmarks[9];
        if (noseHighlight) {
            const x = noseHighlight.x * width;
            const y = noseHighlight.y * height;
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
        // 移除腮红等复杂效果以减少CPU使用
    }
    

    
    // Draw calibration progress
    drawCalibrationProgress(ctx) {
        const progress = this.calibrationFrames / this.maxCalibrationFrames;
        const canvasWidth = ctx.canvas.width;
        const canvasHeight = ctx.canvas.height;
        
        // Draw translucent background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        // Responsive calibration box size
        const boxWidth = Math.min(canvasWidth * 0.9, 250);
        const boxHeight = Math.min(canvasHeight * 0.6, 100);
        const boxX = (canvasWidth - boxWidth) / 2;
        const boxY = (canvasHeight - boxHeight) / 2;
        
        // Background box
        ctx.fillStyle = 'rgba(78, 205, 196, 0.2)';
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        
        // Border
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 2;
        ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
        
        // Title
        ctx.fillStyle = '#4ecdc4';
        ctx.font = `bold ${Math.min(16, boxWidth / 15)}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText('🎯 Calibrating', canvasWidth / 2, boxY + boxHeight * 0.3);
        
        // Progress bar background
        const progressBarWidth = boxWidth * 0.8;
        const progressBarHeight = Math.min(16, boxHeight * 0.2);
        const progressBarX = (canvasWidth - progressBarWidth) / 2;
        const progressBarY = boxY + boxHeight * 0.5;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight);
        
        // Progress bar
        const progressWidth = progressBarWidth * progress;
        const gradient = ctx.createLinearGradient(progressBarX, 0, progressBarX + progressWidth, 0);
        gradient.addColorStop(0, '#4ecdc4');
        gradient.addColorStop(1, '#45b7d1');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(progressBarX, progressBarY, progressWidth, progressBarHeight);
        
        // Progress bar边框
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 1;
        ctx.strokeRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight);
        
        // Progress percentage
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.min(14, boxWidth / 18)}px Arial`;
        ctx.fillText(`${Math.round(progress * 100)}%`, canvasWidth / 2, progressBarY + progressBarHeight - 2);
        
        // Hint text
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.min(12, boxWidth / 20)}px Arial`;
        ctx.fillText('Face the camera', canvasWidth / 2, boxY + boxHeight * 0.85);
        
        // Reset text alignment
        ctx.textAlign = 'left';
    }
    
    // Draw calibration complete prompt
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
    
    // Draw mini status indicator (top-right small icon)
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
        
        // 点头状态图标
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
    
    // Simple brightness adjustment instead of face whitening
    drawFaceFill(ctx, landmarks, width, height) {
        // 简单的亮度提升，不进行复杂的面部美白
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; // 轻微提升亮度
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over'; // 恢复默认混合模式
    }

    // Draw natural and delicate face contour (referencing Rei Ayanami style)
    drawBeautifiedFaceContour(ctx, landmarks, width, height) {
        // 简化的面部轮廓，只绘制基本边框
        const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
        
        ctx.strokeStyle = 'rgba(78, 205, 196, 0.6)'; // 简单的青色轮廓
        ctx.lineWidth = 1.5;
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
    }
    
    // Draw beautified eyes
    drawBeautifiedEyes(ctx, landmarks, width, height) {
        // Left eye contour
        const leftEye = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
        // Right eye contour
        const rightEye = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
        
        // Draw eye fill
        this.drawEyeFill(ctx, landmarks, leftEye, width, height);
        this.drawEyeFill(ctx, landmarks, rightEye, width, height);
        
        // Draw eye contour - soft outer layer
        ctx.strokeStyle = 'rgba(69, 183, 209, 0.4)';
        ctx.lineWidth = 3;
        this.drawEyeContour(ctx, landmarks, leftEye, width, height);
        this.drawEyeContour(ctx, landmarks, rightEye, width, height);
        
        // Draw eye contour - clear inner layer
        ctx.strokeStyle = '#45b7d1';
        ctx.lineWidth = 1.2;
        this.drawEyeContour(ctx, landmarks, leftEye, width, height);
        this.drawEyeContour(ctx, landmarks, rightEye, width, height);
        
        // Draw beautified pupils
        this.drawBeautifiedPupils(ctx, landmarks, width, height);
    }
    
    // Draw eye fill
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
    
    // Draw beautified pupils
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
    
    // Draw natural blue pupils (referencing Rei Ayanami)
    drawPupil(ctx, x, y) {
        // Iris - natural blue gradient
        const irisGradient = ctx.createRadialGradient(x, y, 0, x, y, 6);
        irisGradient.addColorStop(0, 'rgba(70, 130, 180, 0.8)'); // Steel blue center
        irisGradient.addColorStop(0.5, 'rgba(100, 149, 237, 0.7)'); // Cornflower blue
        irisGradient.addColorStop(0.8, 'rgba(65, 105, 225, 0.6)'); // Royal blue
        irisGradient.addColorStop(1, 'rgba(30, 60, 120, 0.5)'); // Dark blue edge
        
        ctx.fillStyle = irisGradient;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        // Pupil
        ctx.fillStyle = 'rgba(20, 20, 60, 0.9)'; // Dark pupil
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
        
        // Natural highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(x - 1, y - 1, 1.2, 0, 2 * Math.PI);
        ctx.fill();
        
        // Secondary highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(x + 1.5, y + 1.5, 0.6, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // Draw beautified mouth
    drawBeautifiedMouth(ctx, landmarks, width, height) {
        // 使用与游戏检测相同的关键点
        const leftCorner = landmarks[61];   // 左嘴角
        const rightCorner = landmarks[291]; // 右嘴角
        const upperLip = landmarks[13];     // 上唇中心（与游戏检测一致）
        const lowerLip = landmarks[14];     // 下唇中心（与游戏检测一致）
        
        if (leftCorner && rightCorner && upperLip && lowerLip && this.baselineMouth) {
            // 计算嘴部中心点
            const centerX = ((leftCorner.x + rightCorner.x) / 2) * width;
            const centerY = ((upperLip.y + lowerLip.y) / 2) * height;
            
            // 计算嘴部宽度
            const mouthWidth = Math.abs(rightCorner.x - leftCorner.x) * width;
            
            // 使用与游戏检测完全相同的逻辑判断嘴部是否张开
            const mouthDistance = Math.abs(upperLip.y - lowerLip.y);
            const mouthOpen = mouthDistance - this.baselineMouth.distance;
            const isMouthOpen = mouthOpen > this.mouthOpenThreshold;
            
            // 设置绘制样式
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)'; // 红色轮廓
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            
            if (!isMouthOpen) {
                // 嘴部闭合时：绘制贴合下嘴唇的轻微弧线
                const smileWidth = mouthWidth * 0.7; // 缩短长度到70%
                const smileHeight = 1; // 降低弧度高度到1像素
                const lowerLipY = lowerLip.y * height; // 贴合下嘴唇位置
                
                ctx.beginPath();
                // 绘制轻微弧线：贴合下嘴唇，只是稍微弯曲
                ctx.moveTo(centerX - smileWidth / 2, lowerLipY);
                ctx.quadraticCurveTo(centerX, lowerLipY + smileHeight, centerX + smileWidth / 2, lowerLipY);
                ctx.stroke();
                
                // 在嘴角添加小点，位置也调整到下嘴唇
                ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.beginPath();
                ctx.arc(centerX - smileWidth / 2, lowerLipY, 1, 0, 2 * Math.PI);
                ctx.arc(centerX + smileWidth / 2, lowerLipY, 1, 0, 2 * Math.PI);
                ctx.fill();
            } else {
                // 嘴部张开时：绘制椭圆
                const mouthHeight = Math.abs(lowerLip.y - upperLip.y) * height;
                
                ctx.beginPath();
                ctx.ellipse(centerX, centerY, mouthWidth / 2, mouthHeight / 2, 0, 0, 2 * Math.PI);
                ctx.stroke();
                
                // 如果嘴张得很大，添加内部轮廓
                if (mouthOpen > this.mouthOpenThreshold * 2) {
                    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.ellipse(centerX, centerY, (mouthWidth / 2) * 0.7, (mouthHeight / 2) * 0.7, 0, 0, 2 * Math.PI);
                    ctx.stroke();
                }
            }
        } else if (leftCorner && rightCorner && upperLip && lowerLip) {
            // 如果还没有基线，绘制默认的轻微弧线
            const centerX = ((leftCorner.x + rightCorner.x) / 2) * width;
            const mouthWidth = Math.abs(rightCorner.x - leftCorner.x) * width;
            const smileWidth = mouthWidth * 0.7;
            const smileHeight = 1;
            const lowerLipY = lowerLip.y * height; // 贴合下嘴唇位置
            
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.lineCap = 'round';
            ctx.beginPath();
            // 校准期间也显示贴合下嘴唇的轻微弧线
            ctx.moveTo(centerX - smileWidth / 2, lowerLipY);
            ctx.quadraticCurveTo(centerX, lowerLipY + smileHeight, centerX + smileWidth / 2, lowerLipY);
            ctx.stroke();
        }
    }
    
    // Draw beautified nose
    drawBeautifiedNose(ctx, landmarks, width, height) {
        // Nose bridge
        const noseBridge = [6, 8, 9, 10, 151];
        
        // Nose bridge外层光晕
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
        
        // Nose bridge内层线条
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
        
        // Nose tip highlight
        const noseTip = landmarks[1];
        if (noseTip) {
            const x = noseTip.x * width;
            const y = noseTip.y * height;
            
            // Outer halo
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, 6);
            gradient.addColorStop(0, 'rgba(255, 165, 0, 0.6)');
            gradient.addColorStop(0.7, 'rgba(255, 165, 0, 0.3)');
            gradient.addColorStop(1, 'rgba(255, 165, 0, 0.1)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, 2 * Math.PI);
            ctx.fill();
            
            // Inner highlight
            ctx.fillStyle = 'rgba(255, 200, 100, 0.8)';
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // Nostrils - more natural color
        const leftNostril = landmarks[220];
        const rightNostril = landmarks[305];
        
        if (leftNostril) {
            this.drawNostril(ctx, leftNostril.x * width, leftNostril.y * height);
        }
        if (rightNostril) {
            this.drawNostril(ctx, rightNostril.x * width, rightNostril.y * height);
        }
    }
    
    // Draw nostrils
    drawNostril(ctx, x, y) {
        // Outer shadow
        ctx.fillStyle = 'rgba(139, 69, 19, 0.3)';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
        
        // Inner nostril
        ctx.fillStyle = 'rgba(139, 69, 19, 0.6)';
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    // Draw beautified eyebrows
    drawBeautifiedEyebrows(ctx, landmarks, width, height) {
        // Left eyebrow key points
        const leftEyebrow = [46, 53, 52, 51, 48];
        // Right eyebrow key points
        const rightEyebrow = [276, 283, 282, 295, 285];
        
        // Draw left eyebrow
        this.drawEyebrow(ctx, landmarks, leftEyebrow, width, height);
        // Draw right eyebrow
        this.drawEyebrow(ctx, landmarks, rightEyebrow, width, height);
    }
    
    // Draw single eyebrow
    drawEyebrow(ctx, landmarks, eyebrowPoints, width, height) {
        // Outer halo
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
        
        // Inner eyebrow
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
        
        // Eyebrow hair effect
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
                
                // Draw a few hair lines
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
        if (this.nodPhase === 'going_down') {
            items.push({ text: '↓ Nodding', color: '#ffcc00' });
        } else if (this.nodPhase === 'completed') {
            items.push({ text: '⚡ Fast Drop', color: '#ff6b6b' });
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
        // Nod is an instantaneous action, no need to reset continuous state
        this.nodPhase = 'waiting';
        this.nodStartTime = 0;
    }
    
    updateSensitivity(tiltThreshold, nodThreshold, mouthThreshold) {
        this.headTiltThreshold = tiltThreshold;
        this.nodThreshold = nodThreshold;
        this.mouthOpenThreshold = mouthThreshold;
        
        // 根据倾斜灵敏度调整移动速度
        // 灵敏度越高(数值越小)，移动越快
        const baseContinuousInterval = 150;
        const baseFastInterval = 90;
        
        // 灵敏度范围 0.05-0.30，反向映射到速度
        const sensitivityFactor = (0.30 - tiltThreshold) / (0.30 - 0.05); // 0-1范围
        
        // 灵敏度高时速度快，灵敏度低时速度慢
        this.continuousMoveInterval = Math.max(50, baseContinuousInterval - (sensitivityFactor * 100));
        this.fastMoveInterval = Math.max(30, baseFastInterval - (sensitivityFactor * 60));
        
        console.log(`灵敏度更新: 倾斜=${tiltThreshold}, 点头=${nodThreshold}, 张嘴=${mouthThreshold}`);
        console.log(`移动速度: 连续=${this.continuousMoveInterval}ms, 快速=${this.fastMoveInterval}ms`);
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