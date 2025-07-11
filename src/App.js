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
  const [serviceFee, setServiceFee] = useState('0.00'); // Default service fee amount
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
    const serviceFeeNum = parseFloat(serviceFee) || 0;
    const tipNum = parseFloat(tip) || 0;
    const totalNum = parseFloat(calculatedSubtotal) + taxNum + serviceFeeNum + tipNum;
    setTotal(totalNum.toFixed(2));
  }, [calculatedSubtotal, tax, serviceFee, tip]);

  // Recalculate tip when tax inclusion preference changes
  useEffect(() => {
    if (selectedTipPercentage !== null) {
      const subtotalNum = parseFloat(calculatedSubtotal) || 0;
      const taxNum = parseFloat(tax) || 0;
      const serviceFeeNum = parseFloat(serviceFee) || 0;
      
      if (subtotalNum > 0) {
        let baseAmount;
        if (tipIncludesTax) {
          baseAmount = subtotalNum + taxNum + serviceFeeNum;
        } else {
          baseAmount = subtotalNum;
        }
        
        const calculatedTip = (baseAmount * selectedTipPercentage / 100);
        const formattedTip = formatPrice(calculatedTip);
        setTip(formattedTip);
      }
    }
  }, [tipIncludesTax, selectedTipPercentage, calculatedSubtotal, tax, serviceFee]);

  // Memoize implied percentages
  const impliedPercentages = useMemo(() => {
    if (calculatedSubtotal <= 0) return { tax: '', serviceFee: '', tip: '' };
    return {
      tax: `% Subtotal: ${((tax / calculatedSubtotal) * 100).toFixed(1)}%`,
      serviceFee: `% Subtotal: ${((serviceFee / calculatedSubtotal) * 100).toFixed(1)}%`,
      tip: `% Subtotal: ${((tip / calculatedSubtotal) * 100).toFixed(1)}%`
    };
  }, [calculatedSubtotal, tax, serviceFee, tip]);

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

      console.log('Camera stream obtained:', stream);
      setCameraStream(stream);
      setShowCamera(true);
      
      // Wait for video element to be rendered, then set up stream
      const setupVideo = () => {
        if (videoRef.current) {
          console.log('Setting video srcObject');
          videoRef.current.srcObject = stream;
          
          // Wait for video to be ready
          videoRef.current.onloadedmetadata = () => {
            console.log('Video metadata loaded, attempting to play');
            videoRef.current.play().then(() => {
              console.log('Video playing successfully');
            }).catch(playError => {
              console.error('Error playing video:', playError);
              alert('Unable to start camera preview. Please use file upload instead.');
              stopCamera();
            });
          };
          
          videoRef.current.onerror = (error) => {
            console.error('Video element error:', error);
          };
        } else {
          console.log('Video ref still null, retrying in 100ms');
          setTimeout(setupVideo, 100);
        }
      };
      
      // Give React time to render the video element
      setTimeout(setupVideo, 100);
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
  };




  const captureReceipt = async () => {
    if (!canvasRef.current || !videoRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const video = videoRef.current;
    
    // Set canvas size to match video
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    // Draw the current video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to blob and process
    canvas.toBlob(async (blob) => {
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
        if (parsedData.serviceFee > 0) setServiceFee(parseFloat(parsedData.serviceFee).toFixed(2));
        setTip(initialTip);
        
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
        serviceFeeShare: 0,
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
    
    // Calculate tax, service fee, and tip shares
    const totalItemsCost = Object.values(split).reduce(
      (sum, person) => sum + person.itemTotal, 0
    );
    
    if (totalItemsCost > 0) {
      Object.keys(split).forEach(member => {
        if (split[member].itemTotal > 0) {
          const proportion = split[member].itemTotal / totalItemsCost;
          split[member].taxShare = parseFloat((tax * proportion).toFixed(2));
          split[member].serviceFeeShare = parseFloat((serviceFee * proportion).toFixed(2));
          split[member].tipShare = parseFloat((tip * proportion).toFixed(2));
          split[member].total = parseFloat((
            split[member].itemTotal + 
            split[member].taxShare + 
            split[member].serviceFeeShare + 
            split[member].tipShare
          ).toFixed(2));
        }
      });
    }
    
    return split;
  }, [partyMembers, extractedItems, assignedItems, tax, serviceFee, tip]);

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

  // Update service fee and total
  const updateServiceFeeAndTotal = (newServiceFee) => {
    setServiceFee(newServiceFee);
    setSelectedTipPercentage(null); // Clear selection when manually editing
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

  // Handle service fee blur
  const handleServiceFeeBlur = (value) => {
    const serviceFeeNum = parseFloat(value) || 0;
    setServiceFee(formatPrice(serviceFeeNum));
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
    const serviceFeeNum = parseFloat(serviceFee) || 0;
    
    // Don't calculate if no subtotal
    if (subtotalNum <= 0) return;
    
    let baseAmount;
    if (tipIncludesTax) {
      baseAmount = subtotalNum + taxNum + serviceFeeNum;
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
Service Fee Share: $${data.serviceFeeShare.toFixed(2)}
Tip Share: $${data.tipShare.toFixed(2)}
Total: $${data.total.toFixed(2)}`).join('\n\n')}

Implied Tax (%): ${((tax / calculatedSubtotal) * 100).toFixed(1)}%
Implied Service Fee (%): ${((serviceFee / calculatedSubtotal) * 100).toFixed(1)}%
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
            <div className="camera-container">
              <video ref={videoRef} autoPlay playsInline className="camera-video" />
              <div className="camera-overlay">
                <button onClick={stopCamera} className="close-camera">✕</button>
                <div className="camera-instruction">Position receipt inside frame</div>
                <div className="blur-overlay blur-top"></div>
                <div className="blur-overlay blur-bottom"></div>
                <div className="blur-overlay blur-left"></div>
                <div className="blur-overlay blur-right"></div>
                <div className="receipt-frame-guide"></div>
              </div>
              <canvas ref={overlayCanvasRef} className="detection-overlay" style={{ display: 'none' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
            
            <div className="camera-controls">
              <button 
                onClick={captureReceipt} 
                className="manual-capture-btn"
              >
                Capture
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
                  <span data-tooltip="Mandatory service fee (common in SF)">Service Fee:</span>
                  <div className="tax-input-group">
                    <input
                      type="number"
                      inputMode="decimal"
                      pattern="[0-9]*\.?[0-9]*"
                      step="0.01"
                      min="0"
                      value={serviceFee}
                      onChange={(e) => updateServiceFeeAndTotal(e.target.value)}
                      onBlur={(e) => handleServiceFeeBlur(e.target.value)}
                      onFocus={(e) => e.target.select()}
                    />
                    <span className="implied-percent">
                      {impliedPercentages.serviceFee}
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
                        <span>Tip percentage includes tax and service fee</span>
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
                  <span data-tooltip="Final amount including tax, service fee and tip">Grand Total:</span>
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
                        <span>Service Fee:</span>
                        <span>{formatCurrency(person.serviceFeeShare)}</span>
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