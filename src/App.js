import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import Tesseract from 'tesseract.js';
import { parseCheckText } from './ocr-parser';
import './App.css';
import { Analytics } from '@vercel/analytics/react';

function App() {
  // App state
  const [step, setStep] = useState(1); // 1: Upload, 2: Names, 3: Assign, 4: Review
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
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareText, setShareText] = useState({});
  const [isDragging, setIsDragging] = useState(false);
  const [tipPercent, setTipPercent] = useState(0);

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

  // Memoize implied percentages
  const impliedPercentages = useMemo(() => {
    if (calculatedSubtotal <= 0) return { tax: '', tip: '' };
    return {
      tax: `(${((tax / calculatedSubtotal) * 100).toFixed(1)}%)`,
      tip: `(${((tip / calculatedSubtotal) * 100).toFixed(1)}%)`
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
  const processImage = useCallback(async (imageData) => {
    setIsProcessing(true);
    setOcrError(null);
    
    try {
      // Create worker with proper configuration
      const worker = await Tesseract.createWorker();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      
      // Perform recognition without custom logger
      const result = await worker.recognize(imageData);
      
      // Clean up worker
      await worker.terminate();
      
      if (!result.data.text || result.data.text.trim() === '') {
        throw new Error('No text detected in the image');
      }
      
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
    setStep(4);
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
    // Create a detailed text summary
    let detailedSummary = "RESTAURANT CHECK SPLIT (DETAILED)\n\n";
    
    Object.keys(finalSplit).forEach(member => {
      const person = finalSplit[member];
      detailedSummary += `${member}: ${formatCurrency(person.total)}\n`;
      detailedSummary += `  Items: ${formatCurrency(person.itemTotal)}\n`;
      detailedSummary += `  Tax: ${formatCurrency(person.taxShare)}\n`;
      detailedSummary += `  Tip: ${formatCurrency(person.tipShare)}\n\n`;
      
      detailedSummary += "  Items details:\n";
      person.items.forEach(item => {
        detailedSummary += `    ${item.name}: ${formatCurrency(item.share)}`;
        if (item.share !== item.price) {
          detailedSummary += ` (shared: ${formatCurrency(item.price)})`;
        }
        detailedSummary += "\n";
      });
      detailedSummary += "\n";
    });

    // Create an abbreviated text summary
    let abbreviatedSummary = "RESTAURANT CHECK SPLIT (SIMPLE)\n\n";
    Object.keys(finalSplit).forEach(member => {
      const person = finalSplit[member];
      abbreviatedSummary += `${member}: ${formatCurrency(person.total)}\n`;
    });
    
    // Set both summaries to state
    setShareText({
      detailed: detailedSummary,
      abbreviated: abbreviatedSummary,
      current: 'detailed' // Set initial view to detailed
    });
    
    // Show the share modal
    setShowShareModal(true);
  };

  // Update tax and total
  const updateTaxAndTotal = (newTax) => {
    setTax(newTax);
  };

  // Update tip and total
  const updateTipAndTotal = (newTip) => {
    setTip(newTip);
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

  return (
    <div className="app">
      <header>
        <h1>Restaurant Check Splitter</h1>
        <div className="progress-bar">
          <div className={`step ${step >= 1 ? 'active' : ''}`}>Upload</div>
          <div className={`step ${step >= 2 ? 'active' : ''}`}>Names</div>
          <div className={`step ${step >= 3 ? 'active' : ''}`}>Assign</div>
          <div className={`step ${step >= 4 ? 'active' : ''}`}>Review</div>
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
                  <span className="upload-icon">📷</span>
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
            
            <div className="skip-option">
              <button onClick={skipToManualEntry}>Skip to Manual Entry</button>
            </div>
          </div>
        )}

        {/* Step 2: Party Members */}
        {step === 2 && (
          <div className="step-content">
            <h2>Who's in Your Party?</h2>
            <p>Add everyone who shared the meal</p>
            
            {ocrError && (
              <div className="error-message">
                <i className="error-icon">⚠️</i>
                <span>{ocrError}</span>
              </div>
            )}
            
            <div className="input-group">
              <input
                type="text"
                placeholder="Enter name"
                value={newMember}
                onChange={(e) => setNewMember(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addPartyMember()}
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
            
            <div className="check-review">
              <div className="check-header">
                <h3>Check Details</h3>
              </div>
              <p>Please review and correct any errors</p>
              
              <h3>Items</h3>
              
              <div className="check-items">
                {extractedItems.map((item, index) => (
                  <div key={item.id} className="check-item">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateItemValue(index, 'name', e.target.value)}
                    />
                    <input
                      type="text"
                      value={item.price}
                      onChange={(e) => updateItemValue(index, 'price', e.target.value)}
                      onBlur={(e) => handlePriceBlur(index, e.target.value)}
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
                <div className="summary-row">
                  <span data-tooltip="Sum of all items before tax and tip">Subtotal:</span>
                  <span className="calculated-value">{formatPrice(subtotal)}</span>
                </div>
                <div className="summary-row">
                  <span data-tooltip="Total tax amount">Tax:</span>
                  <div className="tax-input-group">
                    <span className="implied-percent">
                      {impliedPercentages.tax}
                    </span>
                    <input
                      type="text"
                      value={tax}
                      onChange={(e) => updateTaxAndTotal(e.target.value)}
                      onBlur={(e) => handleTaxBlur(e.target.value)}
                    />
                  </div>
                </div>
                <div className="summary-row">
                  <span data-tooltip="Tip amount for service">Tip:</span>
                  <div className="tax-input-group">
                    <span className="implied-percent">
                      {impliedPercentages.tip}
                    </span>
                    <input
                      type="text"
                      value={tip}
                      onChange={(e) => updateTipAndTotal(e.target.value)}
                      onBlur={(e) => handleTipBlur(e.target.value)}
                    />
                  </div>
                </div>

                <div className="summary-row total-row">
                  <span data-tooltip="Final amount including tax and tip">Total:</span>
                  <span className="calculated-value">{formatPrice(total)}</span>
                </div>
              </div>
            </div>
            
            <div className="navigation-buttons">
              <button onClick={() => setStep(1)}>Back</button>
              <button 
                onClick={() => setStep(3)} 
                disabled={partyMembers.length === 0}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Assign Items */}
        {step === 3 && (
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
              <button onClick={() => setStep(2)}>Back</button>
              <button onClick={calculateSplit}>Calculate Split</button>
            </div>
          </div>
        )}

        {/* Step 4: Review Split */}
        {step === 4 && (
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
              <button onClick={() => setStep(3)}>Back</button>
              <button onClick={shareResults}>Share Results</button>
            </div>
          </div>
        )}
      </main>

      <footer>
        <p>Restaurant Check Splitter © 2025</p>
      </footer>
      {/* Share Modal */}
      {showShareModal && (
        <div className="modal-overlay">
          <div className="share-modal">
            <h2>Share Results</h2>
            <div className="share-options">
              <button 
                className={`share-option-btn ${shareText.current === 'detailed' ? 'active' : ''}`}
                onClick={() => setShareText(prev => ({ ...prev, current: 'detailed' }))}>
                Detailed View
              </button>
              <button 
                className={`share-option-btn ${shareText.current === 'abbreviated' ? 'active' : ''}`}
                onClick={() => setShareText(prev => ({ ...prev, current: 'abbreviated' }))}>
                Simple View
              </button>
            </div>
            <div className="modal-actions">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(shareText[shareText.current]);
                  const button = document.querySelector('.modal-actions button:first-child');
                  button.classList.add('copy-success');
                  button.textContent = '✓ Copied!';
                  setTimeout(() => {
                    button.classList.remove('copy-success');
                    button.textContent = 'Copy to Clipboard';
                  }, 2000);
                }}
                data-tooltip="Copy the split details to your clipboard"
              >
                Copy to Clipboard
              </button>
              <button 
                onClick={() => setShowShareModal(false)}
                data-tooltip="Close this window"
              >
                Close
              </button>
            </div>
            <textarea 
              className="share-text" 
              value={shareText[shareText.current]} 
              readOnly
            />
          </div>
        </div>
      )}
      <Analytics />
    </div>
  );
}

export default App;