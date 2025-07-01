import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import Tesseract from 'tesseract.js';
import { parseCheckText } from './ocr-parser';
import './App.css';
import { Analytics } from '@vercel/analytics/react';

function App() {
  // App state
  const [step, setStep] = useState(1); // 1: Upload, 2: Review, 3: Names, 4: Assign, 5: Split
  const [checkImage, setCheckImage] = useState(null);
  const [extractedItems, setExtractedItems] = useState([]);
  const [tax, setTax] = useState('0.00'); // Default tax amount
  const [tip, setTip] = useState('0.00');
  const [total, setTotal] = useState('0.00');
  const [subtotal, setSubtotal] = useState('0.00');
  const [partyMembers, setPartyMembers] = useState([]);
  const [newMember, setNewMember] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrError, setOcrError] = useState(null);
  const [assignedItems, setAssignedItems] = useState({});
  const [finalSplit, setFinalSplit] = useState({});
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showModal, setShowModal] = useState(false);
  
  // Camera capture states
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [edgeDetectionCanvas, setEdgeDetectionCanvas] = useState(null);
  const [detectionConfidence, setDetectionConfidence] = useState(0);
  const [consecutiveFrames, setConsecutiveFrames] = useState(0);
  const [qualityIssues, setQualityIssues] = useState([]);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const [currentView, setCurrentView] = useState('simple');
  const [tipIncludesTax, setTipIncludesTax] = useState(false);
  const [selectedTipPercentage, setSelectedTipPercentage] = useState(null);

  // Memoize calculated values
  const calculatedSubtotal = useMemo(() => {
    return parseFloat(extractedItems.reduce((sum, item) => {
      const itemPrice = typeof item.price === 'string' ? parseFloat(item.price) || 0 : item.price;
      return sum + itemPrice;
    }, 0)).toFixed(2);
  }, [extractedItems]);

  // Update subtotal effect
  useEffect(() => {
    setSubtotal(calculatedSubtotal);
    const taxNum = parseFloat(tax) || 0;
    const tipNum = parseFloat(tip) || 0;
    const totalNum = parseFloat(calculatedSubtotal) + taxNum + tipNum;
    setTotal(totalNum.toFixed(2));
  }, [calculatedSubtotal, tax, tip]);

  // Recalculate tip when tax inclusion preference changes
  useEffect(() => {
    if (selectedTipPercentage !== null) {
      const subtotalNum = parseFloat(calculatedSubtotal) || 0;
      const taxNum = parseFloat(tax) || 0;
      
      if (subtotalNum > 0) {
        let baseAmount;
        if (tipIncludesTax) {
          baseAmount = subtotalNum + taxNum;
        } else {
          baseAmount = subtotalNum;
        }
        
        const calculatedTip = (baseAmount * selectedTipPercentage / 100);
        const formattedTip = formatPrice(calculatedTip);
        setTip(formattedTip);
      }
    }
  }, [tipIncludesTax, selectedTipPercentage, calculatedSubtotal, tax]);

  // Memoize implied percentages
  const impliedPercentages = useMemo(() => {
    if (calculatedSubtotal <= 0) return { tax: '', tip: '' };
    return {
      tax: `% Subtotal: ${((tax / calculatedSubtotal) * 100).toFixed(1)}%`,
      tip: `% Subtotal: ${((tip / calculatedSubtotal) * 100).toFixed(1)}%`
    };
  }, [calculatedSubtotal, tax, tip]);

  // Handle drag events
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Process image with OCR
  // Conservative autocrop function
  const autocropImage = (canvas, ctx) => {
    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // Calculate content density in grid sections
    const gridSize = 20; // 20x20 grid for analysis
    const sectionWidth = Math.floor(width / gridSize);
    const sectionHeight = Math.floor(height / gridSize);
    
    let minX = width, maxX = 0, minY = height, maxY = 0;
    let hasContent = false;
    
    // Analyze each grid section for content
    for (let gridY = 0; gridY < gridSize; gridY++) {
      for (let gridX = 0; gridX < gridSize; gridX++) {
        const startX = gridX * sectionWidth;
        const startY = gridY * sectionHeight;
        const endX = Math.min(startX + sectionWidth, width);
        const endY = Math.min(startY + sectionHeight, height);
        
        let variation = 0;
        let pixelCount = 0;
        let avgBrightness = 0;
        
        // Calculate pixel variation and brightness in this section
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = (y * width + x) * 4;
            const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            avgBrightness += brightness;
            pixelCount++;
            
            // Check variation with neighboring pixels
            if (x < endX - 1) {
              const nextIdx = (y * width + x + 1) * 4;
              const nextBrightness = (data[nextIdx] + data[nextIdx + 1] + data[nextIdx + 2]) / 3;
              variation += Math.abs(brightness - nextBrightness);
            }
          }
        }
        
        avgBrightness /= pixelCount;
        variation /= pixelCount;
        
        // Consider section as having content if:
        // 1. High variation (text creates edges)
        // 2. Not too bright (not blank background)
        // 3. Not too dark (not solid background)
        const hasContentHere = variation > 15 && avgBrightness > 50 && avgBrightness < 240;
        
        if (hasContentHere) {
          minX = Math.min(minX, startX);
          maxX = Math.max(maxX, endX);
          minY = Math.min(minY, startY);
          maxY = Math.max(maxY, endY);
          hasContent = true;
        }
      }
    }
    
    // Conservative cropping: only crop if we found content and it's reasonable
    if (hasContent) {
      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;
      const originalArea = width * height;
      const contentArea = contentWidth * contentHeight;
      
      // Only crop if content area is at least 30% of original (conservative)
      if (contentArea / originalArea >= 0.3) {
        // Add 10% padding around detected content
        const paddingX = Math.floor(contentWidth * 0.1);
        const paddingY = Math.floor(contentHeight * 0.1);
        
        const cropX = Math.max(0, minX - paddingX);
        const cropY = Math.max(0, minY - paddingY);
        const cropWidth = Math.min(width - cropX, contentWidth + paddingX * 2);
        const cropHeight = Math.min(height - cropY, contentHeight + paddingY * 2);
        
        // Create new canvas with cropped content
        const croppedCanvas = document.createElement('canvas');
        const croppedCtx = croppedCanvas.getContext('2d');
        croppedCanvas.width = cropWidth;
        croppedCanvas.height = cropHeight;
        
        // Copy cropped region
        const croppedImageData = ctx.getImageData(cropX, cropY, cropWidth, cropHeight);
        croppedCtx.putImageData(croppedImageData, 0, 0);
        
        return { canvas: croppedCanvas, ctx: croppedCtx };
      }
    }
    
    // Return original if no good crop found
    return { canvas, ctx };
  };

  // Image preprocessing function
  const preprocessImage = (imageData) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Draw original image
        ctx.drawImage(img, 0, 0);
        
        // Step 1: Autocrop
        const { canvas: croppedCanvas, ctx: croppedCtx } = autocropImage(canvas, ctx);
        
        // Step 2: Apply contrast and brightness to cropped image
        const imageDataObj = croppedCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
        const data = imageDataObj.data;
        
        // Light preprocessing: increase contrast and brightness
        for (let i = 0; i < data.length; i += 4) {
          // Increase contrast (factor of 1.2) and brightness (+20)
          data[i] = Math.min(255, Math.max(0, (data[i] - 128) * 1.25 + 128 + 20));     // Red
          data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * 1.25 + 128 + 20)); // Green  
          data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * 1.25 + 128 + 20)); // Blue
        }
        
        // Put processed image data back
        croppedCtx.putImageData(imageDataObj, 0, 0);
        
        // Convert to blob and resolve
        croppedCanvas.toBlob(resolve, 'image/png', 0.95);
      };
      
      img.src = imageData;
    });
  };

  // Camera capture functions
  const startCamera = async () => {
    try {
      // Check if running on HTTPS or localhost
      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        alert('Camera requires HTTPS connection. Please use file upload instead.');
        return;
      }

      // Check if mediaDevices is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Camera not supported on this device. Please use file upload instead.');
        return;
      }

      let stream;
      try {
        // Try with back camera first
        stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        });
      } catch (backCameraError) {
        console.log('Back camera failed, trying any camera:', backCameraError);
        try {
          // Fallback to any available camera
          stream = await navigator.mediaDevices.getUserMedia({
            video: { 
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }
          });
        } catch (anyCameraError) {
          console.log('Any camera failed, trying basic video:', anyCameraError);
          // Final fallback - basic video request
          stream = await navigator.mediaDevices.getUserMedia({
            video: true
          });
        }
      }

      setCameraStream(stream);
      setShowCamera(true);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Wait for video to be ready
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().then(() => {
            // Start edge detection processing after video starts
            setTimeout(() => startEdgeDetection(), 500);
          }).catch(playError => {
            console.error('Error playing video:', playError);
            alert('Unable to start camera preview. Please use file upload instead.');
            stopCamera();
          });
        };
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
      let errorMessage = 'Unable to access camera. ';
      
      if (err.name === 'NotAllowedError') {
        errorMessage += 'Please allow camera permissions and try again.';
      } else if (err.name === 'NotFoundError') {
        errorMessage += 'No camera found on this device.';
      } else if (err.name === 'NotSupportedError') {
        errorMessage += 'Camera not supported on this device.';
      } else {
        errorMessage += 'Please use file upload instead.';
      }
      
      alert(errorMessage);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setShowCamera(false);
    setDetectionConfidence(0);
    setConsecutiveFrames(0);
    setQualityIssues([]);
  };

  // Edge detection with Canvas processing
  const detectEdges = (canvas, ctx, width, height) => {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // Convert to grayscale and apply edge detection
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      gray[i / 4] = avg;
    }
    
    // Simple edge detection using Sobel-like filter
    const edges = new Uint8ClampedArray(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const gx = gray[idx - width - 1] + 2 * gray[idx - 1] + gray[idx + width - 1] -
                   gray[idx - width + 1] - 2 * gray[idx + 1] - gray[idx + width + 1];
        const gy = gray[idx - width - 1] + 2 * gray[idx - width] + gray[idx - width + 1] -
                   gray[idx + width - 1] - 2 * gray[idx + width] - gray[idx + width + 1];
        edges[idx] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    
    // Find rectangular contours (simplified)
    return findReceiptContour(edges, width, height);
  };

  const findReceiptContour = (edges, width, height) => {
    // Simplified contour detection - find strong edges that form rectangle
    const points = [];
    const threshold = 50;
    
    // Scan for strong edges
    for (let y = 0; y < height; y += 10) {
      for (let x = 0; x < width; x += 10) {
        if (edges[y * width + x] > threshold) {
          points.push([x, y]);
        }
      }
    }
    
    if (points.length < 4) return null;
    
    // Find approximate corners (top-left, top-right, bottom-right, bottom-left)
    points.sort((a, b) => a[0] + a[1] - (b[0] + b[1])); // Top-left first
    const topLeft = points[0];
    
    points.sort((a, b) => (b[0] - a[1]) - (a[0] - b[1])); // Top-right
    const topRight = points[0];
    
    points.sort((a, b) => (b[0] + b[1]) - (a[0] + a[1])); // Bottom-right
    const bottomRight = points[0];
    
    points.sort((a, b) => (a[0] - b[1]) - (b[0] - a[1])); // Bottom-left
    const bottomLeft = points[0];
    
    const corners = [topLeft, topRight, bottomRight, bottomLeft];
    
    // Calculate confidence based on rectangle quality
    const confidence = calculateReceiptConfidence(corners, width, height);
    
    return { corners, confidence };
  };

  const calculateReceiptConfidence = (corners, width, height) => {
    if (!corners || corners.length !== 4) return 0;
    
    // Check if corners form a reasonable rectangle
    const [tl, tr, br, bl] = corners;
    
    // Calculate area
    const area = Math.abs((tr[0] - tl[0]) * (bl[1] - tl[1]));
    const imageArea = width * height;
    const areaRatio = area / imageArea;
    
    // Receipt should be significant portion of image
    if (areaRatio < 0.1 || areaRatio > 0.9) return 0;
    
    // Check aspect ratio (receipts are typically taller than wide)
    const receiptWidth = Math.abs(tr[0] - tl[0]);
    const receiptHeight = Math.abs(bl[1] - tl[1]);
    const aspectRatio = receiptHeight / receiptWidth;
    
    if (aspectRatio < 1.2 || aspectRatio > 4) return 0.3; // Lower confidence for unusual ratios
    
    return Math.min(0.9, areaRatio * 2); // Max confidence 0.9
  };

  const startEdgeDetection = () => {
    let frameCount = 0;
    
    const processFrame = () => {
      if (!showCamera || !videoRef.current || !canvasRef.current) return;
      
      frameCount++;
      
      // Process every 3rd frame for performance
      if (frameCount % 3 === 0) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Perform edge detection
        const detection = detectEdges(canvas, ctx, canvas.width, canvas.height);
        
        if (detection) {
          setDetectionConfidence(detection.confidence);
          
          // Draw overlay on overlay canvas
          drawDetectionOverlay(detection.corners, detection.confidence);
          
          // Check for auto-capture
          if (detection.confidence > 0.8) {
            setConsecutiveFrames(prev => prev + 1);
            
            if (consecutiveFrames >= 4) { // 5 consecutive frames
              captureReceipt(detection.corners);
              return;
            }
          } else {
            setConsecutiveFrames(0);
          }
        }
        
        // Quality checks
        performQualityChecks(canvas, ctx);
      }
      
      if (showCamera) {
        requestAnimationFrame(processFrame);
      }
    };
    
    requestAnimationFrame(processFrame);
  };

  const drawDetectionOverlay = (corners, confidence) => {
    if (!overlayCanvasRef.current || !corners) return;
    
    const overlay = overlayCanvasRef.current;
    const ctx = overlay.getContext('2d');
    
    // Match video dimensions
    if (videoRef.current) {
      overlay.width = videoRef.current.videoWidth || 640;
      overlay.height = videoRef.current.videoHeight || 480;
    }
    
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    
    // Draw polygon
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    corners.forEach(corner => ctx.lineTo(corner[0], corner[1]));
    ctx.closePath();
    
    // Style based on confidence
    const color = confidence > 0.8 ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 165, 0, 0.8)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Draw corner points
    ctx.fillStyle = color;
    corners.forEach(corner => {
      ctx.beginPath();
      ctx.arc(corner[0], corner[1], 8, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  const performQualityChecks = (canvas, ctx) => {
    const issues = [];
    
    // Blur detection (edge sharpness)
    const blurScore = calculateBlurScore(canvas, ctx);
    if (blurScore < 0.3) issues.push('Image appears blurry - hold camera steady');
    
    // Glare detection (overexposed areas)
    const glareScore = calculateGlareScore(canvas, ctx);
    if (glareScore > 0.7) issues.push('Too much glare - adjust lighting or angle');
    
    // Luminance analysis
    const luminance = calculateLuminance(canvas, ctx);
    if (luminance < 0.2 && glareScore < 0.3) {
      issues.push('Lighting too dark - consider using flash');
    }
    
    setQualityIssues(issues);
  };

  const calculateBlurScore = (canvas, ctx) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let edgeCount = 0;
    let sharpEdges = 0;
    
    // Sample edges for sharpness
    for (let i = 0; i < data.length; i += 400) { // Sample every 100 pixels
      if (i + 4 < data.length) {
        const current = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const next = (data[i + 4] + data[i + 5] + data[i + 6]) / 3;
        const diff = Math.abs(current - next);
        
        if (diff > 20) {
          edgeCount++;
          if (diff > 50) sharpEdges++;
        }
      }
    }
    
    return edgeCount > 0 ? sharpEdges / edgeCount : 0;
  };

  const calculateGlareScore = (canvas, ctx) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let overexposedPixels = 0;
    let totalPixels = data.length / 4;
    
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness > 240) overexposedPixels++;
    }
    
    return overexposedPixels / totalPixels;
  };

  const calculateLuminance = (canvas, ctx) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let totalBrightness = 0;
    const pixelCount = data.length / 4;
    
    for (let i = 0; i < data.length; i += 4) {
      totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    
    return (totalBrightness / pixelCount) / 255;
  };

  const captureReceipt = async (corners) => {
    if (!canvasRef.current || !corners) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Create perspective-corrected image
    const correctedCanvas = document.createElement('canvas');
    correctedCanvas.width = 2500;
    correctedCanvas.height = 3500; // Typical receipt aspect ratio
    const correctedCtx = correctedCanvas.getContext('2d');
    
    // Apply perspective correction (simplified transformation)
    const [tl, tr, br, bl] = corners;
    
    // For simplicity, use basic crop instead of full perspective correction
    const minX = Math.min(tl[0], tr[0], br[0], bl[0]);
    const maxX = Math.max(tl[0], tr[0], br[0], bl[0]);
    const minY = Math.min(tl[1], tr[1], br[1], bl[1]);
    const maxY = Math.max(tl[1], tr[1], br[1], bl[1]);
    
    const cropWidth = maxX - minX;
    const cropHeight = maxY - minY;
    
    // Draw cropped and scaled image
    correctedCtx.drawImage(
      canvas, 
      minX, minY, cropWidth, cropHeight,
      0, 0, correctedCanvas.width, correctedCanvas.height
    );
    
    // Convert to blob and process
    correctedCanvas.toBlob(async (blob) => {
      const imageUrl = URL.createObjectURL(blob);
      setCheckImage(imageUrl);
      stopCamera();
      
      // Feed to existing pipeline
      await processImage(imageUrl);
    }, 'image/jpeg', 0.95);
  };

  const processImage = useCallback(async (imageData) => {
    setIsProcessing(true);
    setOcrError(null);
    
    try {
      // Preprocess image for better OCR
      const preprocessedImage = await preprocessImage(imageData);
      
      // Create worker with proper configuration
      const worker = await Tesseract.createWorker();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      
      // Perform recognition with preprocessed image
      const result = await worker.recognize(preprocessedImage);
      
      // Clean up worker
      await worker.terminate();
      
      if (!result.data.text || result.data.text.trim() === '') {
        throw new Error('No text detected in the image');
      }
      
      // Debug: Log raw OCR output
      console.log('Raw OCR Output:', result.data.text);
      
      // Parse OCR text to extract items
      const parsedData = parseCheckText(result.data.text);
      
      if (parsedData.items.length === 0) {
        setOcrError('No menu items detected. Try a clearer image or enter items manually.');
        setExtractedItems([{ id: 'item-1', name: 'Item 1', price: '0.00' }]);
      } else {
        // Format all parsed items to have 2 decimal places
        const formattedItems = parsedData.items.map(item => ({
          ...item,
          price: parseFloat(item.price || 0).toFixed(2)
        }));
        setExtractedItems(formattedItems);
        
        // Use memoized calculatedSubtotal
        const initialTip = parsedData.tip > 0 ? parseFloat(parsedData.tip).toFixed(2) : '0.00';
        
        setSubtotal(calculatedSubtotal);
        if (parsedData.tax > 0) setTax(parseFloat(parsedData.tax).toFixed(2));
        setTip(initialTip);
        setTotal(calculatedSubtotal + (parsedData.tax || tax) + initialTip);
        
        // Initialize assigned items
        const initialAssignments = Object.fromEntries(
          parsedData.items.map(item => [item.id, []])
        );
        setAssignedItems(initialAssignments);
      }
      
      setIsProcessing(false);
      setStep(2);
    } catch (error) {
      console.error('OCR Error:', error);
      setIsProcessing(false);
      setOcrError(`Error processing image: ${error.message}. You can enter items manually.`);
      setExtractedItems([{ id: 'item-1', name: 'Item 1', price: '0.00' }]);
      setStep(2);
    }
  }, [calculatedSubtotal, tax]);

  // Handle image upload more efficiently
  const handleImageUpload = useCallback((file) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        setCheckImage(reader.result);
        processImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  }, [processImage]);

  // Update drop handlers to use the new upload function
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleImageUpload(file);
  }, [handleImageUpload]);

  const handleFileInput = useCallback((e) => {
    const file = e.target.files[0];
    handleImageUpload(file);
  }, [handleImageUpload]);

  // Skip OCR and go directly to manual entry
  const skipToManualEntry = () => {
    setExtractedItems([{ id: 'item-1', name: 'Item 1', price: '0.00' }]);
    setStep(2);
  };

  // Add a party member
  const addPartyMember = () => {
    if (newMember.trim() && !partyMembers.includes(newMember.trim())) {
      setPartyMembers([...partyMembers, newMember.trim()]);
      setNewMember('');
    }
  };

  // Remove a party member
  const removePartyMember = (index) => {
    const updatedMembers = [...partyMembers];
    updatedMembers.splice(index, 1);
    setPartyMembers(updatedMembers);
    
    // Remove this member from all item assignments
    const updatedAssignments = { ...assignedItems };
    Object.keys(updatedAssignments).forEach(itemId => {
      updatedAssignments[itemId] = updatedAssignments[itemId].filter(
        member => member !== partyMembers[index]
      );
    });
    setAssignedItems(updatedAssignments);
  };

  // Memoize assignment handlers
  const toggleItemAssignment = useCallback((itemId, memberName) => {
    setAssignedItems(prevAssignments => {
      const updatedAssignments = { ...prevAssignments };
      const currentAssignments = updatedAssignments[itemId] || [];
      
      if (currentAssignments.includes(memberName)) {
        updatedAssignments[itemId] = currentAssignments.filter(
          member => member !== memberName
        );
      } else {
        updatedAssignments[itemId] = [...currentAssignments, memberName];
      }
      
      return updatedAssignments;
    });
  }, []);

  // Memoize final split calculations
  const calculateFinalSplit = useCallback(() => {
    const split = {};
    
    // Initialize each person's totals
    partyMembers.forEach(member => {
      split[member] = {
        items: [],
        itemTotal: 0,
        taxShare: 0,
        tipShare: 0,
        total: 0
      };
    });
    
    // Calculate item shares
    extractedItems.forEach(item => {
      const assignedMembers = assignedItems[item.id] || [];
      
      if (assignedMembers.length > 0) {
        const itemPrice = parseFloat(item.price);
        const perPersonCost = itemPrice / assignedMembers.length;
        
        assignedMembers.forEach(member => {
          if (split[member]) {
            split[member].items.push({
              name: item.name,
              price: itemPrice,
              share: perPersonCost
            });
            
            split[member].itemTotal += perPersonCost;
          }
        });
      }
    });
    
    // Calculate tax and tip shares
    const totalItemsCost = Object.values(split).reduce(
      (sum, person) => sum + person.itemTotal, 0
    );
    
    if (totalItemsCost > 0) {
      Object.keys(split).forEach(member => {
        if (split[member].itemTotal > 0) {
          const proportion = split[member].itemTotal / totalItemsCost;
          split[member].taxShare = parseFloat((tax * proportion).toFixed(2));
          split[member].tipShare = parseFloat((tip * proportion).toFixed(2));
          split[member].total = parseFloat((
            split[member].itemTotal + 
            split[member].taxShare + 
            split[member].tipShare
          ).toFixed(2));
        }
      });
    }
    
    return split;
  }, [partyMembers, extractedItems, assignedItems, tax, tip]);

  // Use memoized calculation in the calculateSplit handler
  const calculateSplit = useCallback(() => {
    const split = calculateFinalSplit();
    setFinalSplit(split);
    setStep(5);
  }, [calculateFinalSplit]);

  // Format price for display
  const formatPrice = (price) => {
    return parseFloat(price || 0).toFixed(2);
  };

  // Handle manual editing of extracted data
  const updateItemValue = (index, field, value) => {
    const updatedItems = [...extractedItems];
    updatedItems[index][field] = value;
    setExtractedItems(updatedItems);
    
    // Only update calculations if we have a valid number and it's a price field
    if (field === 'price') {
      const numValue = parseFloat(value) || 0;
      if (!isNaN(numValue)) {
        const newSubtotal = updatedItems.reduce((sum, item) => {
          const itemPrice = parseFloat(item.price) || 0;
          return sum + itemPrice;
        }, 0);
        setSubtotal(newSubtotal);
      }
    }
  };

  // Handle price input blur
  const handlePriceBlur = (index, value) => {
    const numValue = parseFloat(value) || 0;
    const updatedItems = [...extractedItems];
    updatedItems[index].price = formatPrice(numValue);
    setExtractedItems(updatedItems);
  };

  // Add a new item manually
  const addNewItem = () => {
    const newItem = {
      id: `item-${extractedItems.length + 1}`,
      name: `Item ${extractedItems.length + 1}`,
      price: '0.00'
    };
    
    setExtractedItems([...extractedItems, newItem]);
    
    // Add this item to assignments
    setAssignedItems({
      ...assignedItems,
      [newItem.id]: []
    });
  };
  
  // Remove an item
  const removeItem = (index) => {
    const updatedItems = [...extractedItems];
    const removedItem = updatedItems[index];
    updatedItems.splice(index, 1);
    setExtractedItems(updatedItems);
    
    // Remove from assignments
    const updatedAssignments = { ...assignedItems };
    delete updatedAssignments[removedItem.id];
    setAssignedItems(updatedAssignments);
  };
  
  // Format currency
  const formatCurrency = (amount) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return `$${(numAmount || 0).toFixed(2)}`;
  };

  // Share results
  const shareResults = () => {
    setShowModal(true);
  };

  // Update tax and total
  const updateTaxAndTotal = (newTax) => {
    setTax(newTax);
  };

  // Update tip and total
  const updateTipAndTotal = (newTip) => {
    setTip(newTip);
    setSelectedTipPercentage(null); // Clear selection when manually editing
  };

  // Handle tax blur
  const handleTaxBlur = (value) => {
    const taxNum = parseFloat(value) || 0;
    setTax(formatPrice(taxNum));
  };

  // Handle tip blur
  const handleTipBlur = (value) => {
    const tipNum = parseFloat(value) || 0;
    setTip(formatPrice(tipNum));
  };

  // Calculate tip based on percentage and tax inclusion preference
  const calculateTipFromPercentage = (percentage) => {
    const subtotalNum = parseFloat(calculatedSubtotal) || 0;
    const taxNum = parseFloat(tax) || 0;
    
    // Don't calculate if no subtotal
    if (subtotalNum <= 0) return;
    
    let baseAmount;
    if (tipIncludesTax) {
      baseAmount = subtotalNum + taxNum;
    } else {
      baseAmount = subtotalNum;
    }
    
    const calculatedTip = (baseAmount * percentage / 100);
    const formattedTip = formatPrice(calculatedTip);
    setTip(formattedTip);
    setSelectedTipPercentage(percentage);
  };

  const getClipboardText = (view) => {
    if (view === 'simple') {
      return `splityourcheck.com\n\n${Object.entries(finalSplit)
        .map(([name, data]) => `${name}: $${data.total.toFixed(2)}`)
        .join('\n')}`;
    }

    return `splityourcheck.com\n\n${Object.entries(finalSplit).map(([name, data]) => `${name}:
Items: ${data.items.map(item => `\n  - ${item.name}: $${item.price.toFixed(2)} (Your share: $${item.share.toFixed(2)})`).join('')}
Tax Share: $${data.taxShare.toFixed(2)}
Tip Share: $${data.tipShare.toFixed(2)}
Total: $${data.total.toFixed(2)}`).join('\n\n')}

Implied Tax (%): ${((tax / calculatedSubtotal) * 100).toFixed(1)}%
Implied Tip (%): ${((tip / calculatedSubtotal) * 100).toFixed(1)}%`;
  };

  // Add this function to handle view changes
  const handleViewChange = (view) => {
    setCurrentView(view);
  };

  // Handle navigation to specific step
  const navigateToStep = (targetStep) => {
    // Allow navigation to any previous step, or to the next step only
    if (targetStep < step || targetStep === step + 1) {
      setStep(targetStep);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Split Your Check</h1>
        <div className="progress-bar">
          <div 
            className={`step ${step >= 1 ? 'active' : ''} ${step !== 1 ? 'clickable' : ''}`}
            onClick={() => navigateToStep(1)}
          >
            Upload
          </div>
          <div 
            className={`step ${step >= 2 ? 'active' : ''} ${step !== 2 ? 'clickable' : ''}`}
            onClick={() => navigateToStep(2)}
          >
            Review
          </div>
          <div 
            className={`step ${step >= 3 ? 'active' : ''} ${step !== 3 ? 'clickable' : ''}`}
            onClick={() => navigateToStep(3)}
          >
            Names
          </div>
          <div 
            className={`step ${step >= 4 ? 'active' : ''} ${step !== 4 ? 'clickable' : ''}`}
            onClick={() => navigateToStep(4)}
          >
            Assign
          </div>
          <div 
            className={`step ${step >= 5 ? 'active' : ''} ${step !== 5 ? 'clickable' : ''}`}
            onClick={() => navigateToStep(5)}
          >
            Split
          </div>
        </div>
      </header>

      <main>
        {/* Step 1: Image Upload */}
        {step === 1 && (
          <div className="step-content">
            <h2>Upload Your Check</h2>
            <p>Take a clear photo of your restaurant check</p>
            
            <div 
              className={`upload-area ${isDragging ? 'dragging' : ''}`}
              onClick={() => fileInputRef.current.click()}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {checkImage ? (
                <img src={checkImage} alt="Receipt" className="preview-image" />
              ) : (
                <div className="upload-placeholder">
                  <span className="upload-icon">⏏︎</span>
                  <span>{isDragging ? 'Drop image here' : 'Click to upload or drag and drop'}</span>
                </div>
              )}
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleFileInput} 
                ref={fileInputRef}
                className="hidden-input" 
              />
            </div>
            
            {isProcessing && (
              <div className="processing-indicator">
                <div className="spinner"></div>
                <p>Processing check image...</p>
              </div>
            )}
            
            <div className="camera-option">
              <button onClick={startCamera} className="camera-btn">
                Use Camera
              </button>
            </div>
            
            <div className="skip-option">
              <button onClick={skipToManualEntry}>Skip to Manual Entry</button>
            </div>
            
            <div className="navigation-buttons">
              <div></div>
              <button onClick={() => setStep(2)}>Next</button>
            </div>
          </div>
        )}

        {/* Camera Capture Interface */}
        {showCamera && (
          <div className="camera-interface">
            <div className="camera-header">
              <h2>Position Receipt in Frame</h2>
              <button onClick={stopCamera} className="close-camera">✕</button>
            </div>
            
            <div className="camera-container">
              <video ref={videoRef} autoPlay playsInline className="camera-video" />
              <canvas ref={overlayCanvasRef} className="detection-overlay" />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
            
            <div className="camera-info">
              <div className="detection-status">
                {detectionConfidence > 0.8 ? (
                  <span className="status-good">✓ Receipt detected - Auto-capturing...</span>
                ) : detectionConfidence > 0.4 ? (
                  <span className="status-partial">⚠ Position receipt fully in frame</span>
                ) : (
                  <span className="status-searching">🔍 Searching for receipt...</span>
                )}
              </div>
              
              {qualityIssues.length > 0 && (
                <div className="quality-alerts">
                  {qualityIssues.map((issue, index) => (
                    <div key={index} className="quality-alert">⚠ {issue}</div>
                  ))}
                </div>
              )}
              
              <div className="camera-progress">
                <div className="confidence-bar">
                  <div 
                    className="confidence-fill" 
                    style={{ width: `${detectionConfidence * 100}%` }}
                  />
                </div>
                <span>Confidence: {Math.round(detectionConfidence * 100)}%</span>
              </div>
            </div>
            
            <div className="camera-controls">
              <button onClick={stopCamera} className="cancel-btn">Cancel</button>
              <button 
                onClick={() => captureReceipt(null)} 
                className="manual-capture-btn"
                disabled={detectionConfidence < 0.3}
              >
                Capture Now
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Review Items */}
        {step === 2 && (
          <div className="step-content">
            <h2>Review Your Check</h2>
            <p>Please review and correct any errors. Sometimes the receipt scan will include tip or tax amount as menu items!</p>
            
            {ocrError && (
              <div className="error-message">
                <i className="error-icon">⚠️</i>
                <span>{ocrError}</span>
              </div>
            )}
            
            <div className="check-review">
              <h3>Items</h3>
              
              <div className="check-items">
                {extractedItems.map((item, index) => (
                  <div key={item.id} className="check-item">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateItemValue(index, 'name', e.target.value)}
                      onFocus={(e) => e.target.select()}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      pattern="[0-9]*\.?[0-9]*"
                      step="0.01"
                      min="0"
                      value={item.price}
                      onChange={(e) => updateItemValue(index, 'price', e.target.value)}
                      onBlur={(e) => handlePriceBlur(index, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      tabIndex={0}
                    />
                    <button 
                      className="remove-btn" 
                      onClick={() => removeItem(index)}
                      tabIndex={-1}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              
              <button 
                className="add-item-btn" 
                onClick={addNewItem}
                data-tooltip="Add another item to the check"
              >
                + Add Item
              </button>
              
              <div className="check-summary">
                <div className="summary-row subtotal-row">
                  <span data-tooltip="Sum of all items before tax and tip">Subtotal:</span>
                  <div className="tax-input-group">
                    <span className="calculated-value">${formatPrice(subtotal)}</span>
                  </div>
                </div>
                <div className="summary-row">
                  <span data-tooltip="Total tax amount">Tax:</span>
                  <div className="tax-input-group">
                    <input
                      type="number"
                      inputMode="decimal"
                      pattern="[0-9]*\.?[0-9]*"
                      step="0.01"
                      min="0"
                      value={tax}
                      onChange={(e) => updateTaxAndTotal(e.target.value)}
                      onBlur={(e) => handleTaxBlur(e.target.value)}
                      onFocus={(e) => e.target.select()}
                    />
                    <span className="implied-percent">
                      {impliedPercentages.tax}
                    </span>
                  </div>
                </div>
                <div className="summary-row">
                  <span data-tooltip="Tip amount for service">Tip:</span>
                  <div className="tax-input-group">
                    <input
                      type="number"
                      inputMode="decimal"
                      pattern="[0-9]*\.?[0-9]*"
                      step="0.01"
                      min="0"
                      value={tip}
                      onChange={(e) => updateTipAndTotal(e.target.value)}
                      onBlur={(e) => handleTipBlur(e.target.value)}
                      onFocus={(e) => e.target.select()}
                    />
                    <span className="implied-percent">
                      {impliedPercentages.tip}
                    </span>
                  </div>
                </div>

                <div className="tip-calculator">
                  <div className="tip-calculator-header">
                    <span>Tip Calculator</span>
                  </div>
                  <div className="tip-calculator-content">
                    <div className="tip-toggle">
                      <label>
                        <input
                          type="checkbox"
                          checked={tipIncludesTax}
                          onChange={(e) => setTipIncludesTax(e.target.checked)}
                        />
                        <span>Tip percentage includes tax</span>
                      </label>
                    </div>
                    <div className="tip-buttons">
                      <button 
                        type="button"
                        onClick={() => calculateTipFromPercentage(18)}
                        className={`tip-percent-btn ${selectedTipPercentage === 18 ? 'selected' : ''}`}
                      >
                        18%
                      </button>
                      <button 
                        type="button"
                        onClick={() => calculateTipFromPercentage(20)}
                        className={`tip-percent-btn ${selectedTipPercentage === 20 ? 'selected' : ''}`}
                      >
                        20%
                      </button>
                      <button 
                        type="button"
                        onClick={() => calculateTipFromPercentage(22)}
                        className={`tip-percent-btn ${selectedTipPercentage === 22 ? 'selected' : ''}`}
                      >
                        22%
                      </button>
                    </div>
                  </div>
                </div>

                <div className="summary-row total-row">
                  <span data-tooltip="Final amount including tax and tip">Grand Total:</span>
                  <div className="tax-input-group">
                    <span className="calculated-value">${formatPrice(total)}</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="navigation-buttons">
              <button onClick={() => setStep(1)}>Back</button>
              <button onClick={() => setStep(3)}>Next</button>
            </div>
          </div>
        )}

        {/* Step 3: Party Members */}
        {step === 3 && (
          <div className="step-content">
            <h2>Who's in Your Party?</h2>
            <p>Add everyone who shared the meal. You'll assign them to items in the next step.</p>
            
            <div className="input-group">
              <input
                type="text"
                placeholder="Enter name"
                value={newMember}
                onChange={(e) => setNewMember(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPartyMember()}
              />
              <button onClick={addPartyMember}>Add</button>
            </div>
            
            <ul className="party-list">
              {partyMembers.map((member, index) => (
                <li key={index}>
                  {member}
                  <button 
                    className="remove-btn" 
                    onClick={() => removePartyMember(index)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            
            <div className="navigation-buttons">
              <button onClick={() => setStep(2)}>Back</button>
              <button 
                onClick={() => setStep(4)} 
                disabled={partyMembers.length === 0}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Assign Items */}
        {step === 4 && (
          <div className="step-content">
            <h2>Who Had What?</h2>
            <p>Assign each item to one or more people</p>
            
            <div className="assignment-area">
              {extractedItems.map((item) => (
                <div key={item.id} className="assignment-item">
                  <div className="item-info">
                    <span className="item-name">{item.name}</span>
                    <span className="item-price">{formatCurrency(item.price)}</span>
                  </div>
                  
                  <div className="member-assignments">
                    {partyMembers.map((member, index) => (
                      <label key={index} className="member-checkbox">
                        <input
                          type="checkbox"
                          checked={assignedItems[item.id]?.includes(member)}
                          onChange={() => toggleItemAssignment(item.id, member)}
                        />
                        <span>{member}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            
            <div className="navigation-buttons">
              <button onClick={() => setStep(3)}>Back</button>
              <button onClick={calculateSplit}>Calculate Split</button>
            </div>
          </div>
        )}

        {/* Step 5: Review Split */}
        {step === 5 && (
          <div className="step-content">
            <h2>Final Split</h2>
            <p>Here's what everyone owes:</p>
            
            <div className="final-split">
              {Object.keys(finalSplit).map((member, index) => {
                const person = finalSplit[member];
                return (
                  <div key={index} className="person-summary">
                    <h3>{member}: {formatCurrency(person.total)}</h3>
                    
                    <div className="cost-breakdown">
                      <div className="breakdown-row">
                        <span>Items:</span>
                        <span>{formatCurrency(person.itemTotal)}</span>
                      </div>
                      <div className="breakdown-row">
                        <span>Tax:</span>
                        <span>{formatCurrency(person.taxShare)}</span>
                      </div>
                      <div className="breakdown-row">
                        <span>Tip:</span>
                        <span>{formatCurrency(person.tipShare)}</span>
                      </div>
                    </div>
                    
                    <div className="item-details">
                      <h4>Items:</h4>
                      <ul>
                        {person.items.map((item, i) => (
                          <li key={i}>
                            {item.name}: {formatCurrency(item.share)}
                            {item.share !== item.price && (
                              <span className="shared-note">
                                (shared: {formatCurrency(item.price)})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="navigation-buttons">
              <button onClick={() => setStep(4)}>Back</button>
              <button onClick={shareResults}>Share Results</button>
            </div>
          </div>
        )}
      </main>

      <footer>
        <p>splityourcheck.com © 2025</p>
      </footer>
      {showModal && (
        <div className="modal">
          <div className="modal-content">
            <h2>Share Results</h2>
            <div className={`modal-actions ${currentView === 'detailed' ? 'detailed' : ''}`}>
              <button 
                className={currentView === 'simple' ? 'active' : ''} 
                onClick={() => handleViewChange('simple')}
              >
                Simple View
              </button>
              <button 
                className={currentView === 'detailed' ? 'active' : ''} 
                onClick={() => handleViewChange('detailed')}
              >
                Detailed View
              </button>
            </div>
            <textarea 
              className="share-text" 
              value={getClipboardText(currentView)} 
              readOnly
            />
            <div className="modal-buttons">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(getClipboardText(currentView));
                  const button = document.querySelector('.copy-btn');
                  button.classList.add('copy-success');
                  setTimeout(() => button.classList.remove('copy-success'), 2000);
                }}
                className="copy-btn"
              >
                Copy to Clipboard
              </button>
              <button onClick={() => setShowModal(false)} className="close-btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <Analytics />
    </div>
  );
}

export default App;