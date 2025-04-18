/**
 * Enhanced OCR Parser for Restaurant Checks
 * 
 * This module provides more robust parsing of OCR text from restaurant receipts.
 * It uses pattern matching and heuristics to extract items, tax, tip, and total.
 */

export function parseCheckText(text) {
    // Normalize text: remove extra spaces, convert to lowercase for analysis
    const lines = text.split('\n').filter(line => line.trim());
    
    // Initialize return values
    const items = [];
    let taxAmount = 0;
    let totalAmount = 0;
    let subtotalAmount = 0;
    let tipAmount = 0;
    
    // Common patterns
    const pricePattern = /\$?\s*(\d+\.\d{2})/g; // Note the 'g' flag to find all matches
    const specialCharPattern = /^[_\-=*]+|[_\-=*]+$/g;
    const percentagePattern = /[\(\-]\s*(\d+(?:\.\d+)?%)\s*[\)\-]?/;

    // Process each line
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        
        // Find all price matches in the line
        const priceMatches = [...line.matchAll(pricePattern)];
        
        if (priceMatches.length > 0) {
            // Use the last price in the line as the actual amount
            const lastPriceMatch = priceMatches[priceMatches.length - 1];
            const price = parseFloat(lastPriceMatch[1]);
            
            // Extract item name (everything before the last price)
            let itemName = line.substring(0, lastPriceMatch.index).trim();
            itemName = itemName.replace(specialCharPattern, '').trim();
            
            // Check for percentage in the item name
            const percentageMatch = itemName.match(percentagePattern);
            if (percentageMatch) {
                // Keep the percentage in the name but clean up the formatting
                const percentage = percentageMatch[1];
                itemName = itemName.replace(percentagePattern, ` (${percentage})`);
            }
            
            // Skip if item name is empty or just special characters
            if (!itemName || /^[_\-=*]+$/.test(itemName)) {
                continue;
            }

            // Handle special items
            if (lowerLine.includes('subtotal')) {
                subtotalAmount = price;
                continue;
            }
            if (lowerLine.match(/^tax\b/)) {
                taxAmount = price;
                continue;
            }
            if (lowerLine.match(/^tip\b/)) {
                tipAmount = price;
                continue;
            }
            if (lowerLine.match(/^total\b/)) {
                totalAmount = price;
                continue;
            }

            // Add as regular item (including health mandate and service charge)
            items.push({
                id: `item-${items.length + 1}`,
                name: itemName,
                price: price
            });
        }
    }
    
    // Calculate missing values if possible
    const calculatedItemsTotal = items.reduce((sum, item) => sum + item.price, 0);
    
    // If we don't have a subtotal, use the sum of items
    if (subtotalAmount === 0) {
        subtotalAmount = calculatedItemsTotal;
    }
    
    // If we have no total but have all components, calculate it
    if (totalAmount === 0 && subtotalAmount > 0) {
        totalAmount = subtotalAmount + taxAmount + tipAmount;
    }
    
    return {
        items,
        tax: taxAmount,
        tip: tipAmount,
        total: totalAmount
    };
}